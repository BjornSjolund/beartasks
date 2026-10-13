//! Beartasks application core: tray integration, popup lifecycle, autostart.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Monitor, PhysicalPosition, Position, Rect, Size, WebviewWindow,
    WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;

/// Label of the single popup webview window (defined in tauri.conf.json).
const POPUP_LABEL: &str = "main";
const TRAY_ID: &str = "main-tray";
const MENU_OPEN: &str = "open";
const MENU_AUTOSTART: &str = "autostart";
const MENU_QUIT: &str = "quit";

/// Grace period that suppresses a tray click arriving right after the popup
/// was hidden by focus loss. On macOS, clicking the menu bar icon first makes
/// the popup resign key focus (which hides it) and *then* delivers the click;
/// without this guard the popup would immediately reopen and could never be
/// closed with a second click.
const HIDE_GRACE_MS: u64 = 400;

/// Epoch milliseconds of the last blur-triggered hide.
static LAST_HIDDEN_MS: AtomicU64 = AtomicU64::new(0);

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Keeps a handle on the tray's "Launch at Login" item so its check state can
/// be refreshed after toggling.
struct TrayState {
    autostart_item: CheckMenuItem<tauri::Wry>,
}

/// Physical (x, y, width, height) of a tray rect, or None when the platform
/// does not report usable coordinates (e.g. many GNOME shells).
fn tray_geometry(rect: &Rect) -> Option<(i32, i32, u32, u32)> {
    match (rect.position, rect.size) {
        (Position::Physical(pos), Size::Physical(size)) if size.width > 0 && size.height > 0 => {
            Some((pos.x, pos.y, size.width, size.height))
        }
        _ => None,
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // Menu-bar utility: no Dock icon, no app switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            build_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(handle_window_event)
        .build(tauri::generate_context!())
        .expect("error while building Beartasks")
        .run(|app, event| {
            match event {
                // Clicking the app in Finder while running reopens the popup.
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { .. } => show_popup(app, None),
                _ => {
                    let _ = (app, event);
                }
            }
        });
}

/* ---------- Window events ---------- */

fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    if window.label() != POPUP_LABEL {
        return;
    }
    match event {
        // Popups dismiss themselves when they lose focus, like native
        // menu-bar panels. (Opening the native tray menu counts as focus
        // loss; acceptable for this app.)
        WindowEvent::Focused(false) => {
            if window.is_visible().unwrap_or(false) {
                LAST_HIDDEN_MS.store(epoch_ms(), Ordering::Relaxed);
                let _ = window.hide();
            }
        }
        // Closing the window (e.g. Cmd-W) hides it instead of quitting.
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window.hide();
        }
        _ => {}
    }
}

/* ---------- Tray ---------- */

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, MENU_OPEN, "Open Tasks", true, None::<&str>)?;
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart_item = CheckMenuItem::with_id(
        app,
        MENU_AUTOSTART,
        "Launch at Login",
        true, // enabled
        autostart_enabled,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, MENU_QUIT, "Quit Beartasks", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(app, &[&open_item, &sep1, &autostart_item, &sep2, &quit_item])?;

    // Checklist-style glyph; the alpha channel is what matters for the macOS
    // template rendering, the mid-grey tone keeps it visible on light and
    // dark Linux panels.
    let icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        // Left click toggles the popup; the native menu opens on right click
        // (Linux DEs that always show the menu on click still expose "Open Tasks").
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_event)
        .tooltip("Beartasks — My Tasks")
        .icon(icon);

    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }

    builder.build(app)?;
    app.manage(TrayState { autostart_item });
    Ok(())
}

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id.as_ref() {
        MENU_OPEN => show_popup(app, tray_geometry_from_tray(app)),
        MENU_AUTOSTART => toggle_autostart(app),
        MENU_QUIT => app.exit(0),
        _ => {}
    }
}

fn handle_tray_event(tray: &TrayIcon<tauri::Wry>, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        rect,
        ..
    } = event
    {
        let last_hidden = LAST_HIDDEN_MS.load(Ordering::Relaxed);
        if epoch_ms().saturating_sub(last_hidden) < HIDE_GRACE_MS {
            // The click that just caused the blur-hide; treat it as a close.
            return;
        }
        toggle_popup(tray.app_handle(), tray_geometry(&rect));
    }
}

fn tray_geometry_from_tray(app: &AppHandle) -> Option<(i32, i32, u32, u32)> {
    app.tray_by_id(TRAY_ID)
        .and_then(|tray| tray.rect().ok())
        .flatten()
        .and_then(|rect| tray_geometry(&rect))
}

/* ---------- Popup ---------- */

fn popup_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(POPUP_LABEL)
}

fn show_popup(app: &AppHandle, tray: Option<(i32, i32, u32, u32)>) {
    let Some(window) = popup_window(app) else {
        return;
    };
    position_popup(&window, tray.or_else(|| tray_geometry_from_tray(app)));
    let _ = window.show();
    let _ = window.set_focus();
}

fn toggle_popup(app: &AppHandle, tray: Option<(i32, i32, u32, u32)>) {
    let Some(window) = popup_window(app) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        position_popup(&window, tray);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Place the popup next to the tray icon where coordinates are available
/// (always on macOS, on many Linux DEs via SNI), clamped to the monitor.
/// Without tray coordinates (e.g. GNOME shells with no position information)
/// the window is centered instead.
fn position_popup(window: &WebviewWindow, tray: Option<(i32, i32, u32, u32)>) {
    let Ok(size) = window.outer_size() else {
        let _ = window.center();
        return;
    };

    let Some((tray_x, tray_y, tray_w, tray_h)) = tray else {
        let _ = window.center();
        return;
    };

    let monitors = match window.available_monitors() {
        Ok(monitors) if !monitors.is_empty() => monitors,
        _ => {
            let _ = window.center();
            return;
        }
    };

    // Physical centre of the tray icon.
    let cx = tray_x + tray_w as i32 / 2;
    let cy = tray_y + tray_h as i32 / 2;

    let monitor: Monitor = monitors
        .iter()
        .find(|m| monitor_contains(m, cx, cy))
        .cloned()
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| monitors.into_iter().next())
        .expect("monitors was non-empty");

    let scale = monitor.scale_factor();
    let margin = (8.0 * scale).round() as i32;
    let (w, h) = (size.width as i32, size.height as i32);
    let (mx, my) = (monitor.position().x, monitor.position().y);
    let (mw, mh) = (monitor.size().width as i32, monitor.size().height as i32);

    // Menu-bar icons sit at the top on macOS and in most Linux panels; when
    // the icon is in the upper half of the monitor the popup opens below it,
    // otherwise above.
    let tray_in_top_half = (tray_y - my) * 2 < mh;
    let below = tray_y + tray_h as i32 + margin;
    let above = tray_y - h - margin;

    let mut x = cx - w / 2;
    let mut y = if tray_in_top_half { below } else { above };

    // Flip to the other side when the popup would overflow the monitor.
    if tray_in_top_half && y + h > my + mh {
        y = above;
    } else if !tray_in_top_half && y < my {
        y = below;
    }

    x = x.clamp(mx, mx + (mw - w).max(0));
    y = y.clamp(my, my + (mh - h).max(0));

    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn monitor_contains(monitor: &Monitor, x: i32, y: i32) -> bool {
    let p = monitor.position();
    let s = monitor.size();
    x >= p.x && x < p.x + s.width as i32 && y >= p.y && y < p.y + s.height as i32
}

/* ---------- Autostart ---------- */

fn toggle_autostart(app: &AppHandle) {
    let manager = app.autolaunch();
    let currently_enabled = manager.is_enabled().unwrap_or(false);
    let result = if currently_enabled {
        manager.disable()
    } else {
        manager.enable()
    };
    if result.is_ok() {
        if let Some(state) = app.try_state::<TrayState>() {
            let _ = state.autostart_item.set_checked(!currently_enabled);
        }
    }
    // On unsupported environments `is_enabled` keeps reporting the truth and
    // the check state simply never changes; errors are ignored by design.
}
