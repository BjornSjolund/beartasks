# Beartasks

A minimal, fully offline task manager that lives in the **macOS menu bar** /
**Linux system tray**, built with **Tauri 2** (Rust backend, vanilla
TypeScript + Vite frontend — no UI framework).

Click the checklist icon in the menu bar to open a compact popup where you can
create, edit, complete, and delete tasks. Tasks are persisted locally as JSON
via the official Tauri Store plugin. There is no network access, no analytics,
and no accounts.

## Features

- Menu bar (macOS) / system tray (Linux) first: no Dock icon on macOS, popup
  hides when it loses focus, app keeps running in the background
- Create (Enter or **Add** button), inline edit (Enter saves, Escape cancels),
  complete (checkbox, timestamped), delete — all auto-saved
- Deterministic sorting: incomplete tasks first, newest first, stable tie-break
- Corruption-tolerant storage: invalid entries are skipped and the original
  data is preserved under a `corrupt-backup-*` key instead of being overwritten
- Write queue that serializes persistence, so rapid edits can never flush an
  older snapshot after a newer one
- Light and dark theme follow the OS appearance automatically
- Launch-at-login toggle in the tray menu (off by default, real state reflected)

## Requirements

| Tool    | Version                                    |
| ------- | ------------------------------------------ |
| Node.js | 20+ (tested with 22)                       |
| Rust    | stable, 1.77.2+ (via [rustup](https://rustup.rs)) |

Platform prerequisites for building (see *Packaging* for exact lists):

- **macOS**: Xcode Command Line Tools (`xcode-select --install`; if a full
  Xcode install exists, its license must be accepted with
  `sudo xcodebuild -license accept`, or set `DEVELOPER_DIR` to the standalone
  Command Line Tools)
- **Linux**: `webkit2gtk-4.1`, `libayatana-appindicator`, and friends (see below)

## Getting started

```bash
npm install

# Run with a real tray icon and native persistence:
npm run tauri dev

# Or iterate on the UI in a plain browser tab (http://localhost:1420):
npm run dev
```

In a plain browser the Tauri APIs are absent, so the app falls back to an
in-memory store — handy for UI work, but data does not persist there.

### Where tasks are stored

| OS      | Path                                                         |
| ------- | ------------------------------------------------------------ |
| macOS   | `~/Library/Application Support/dev.sjolund.beartasks/tasks.json` |
| Linux   | `~/.local/share/dev.sjolund.beartasks/tasks.json`            |

Corrupted data found on load is kept in the same file under
`corrupt-backup-<timestamp>` keys and never silently overwritten.

## Checks, tests, and icons

```bash
npm run typecheck   # tsc --noEmit (strict mode)
npm test            # vitest: task logic + persistence layer
npm run icons       # regenerate app-icon.png + tray icons from scripts/generate-icons.mjs
cd src-tauri && cargo check   # Rust compile check
```

`npx tauri icon icons-src/app-icon.png -o src-tauri/icons` regenerates the
bundled icon set (icns/ico/png family) from `icons-src/app-icon.png`.

## Packaging

### macOS

```bash
npm run tauri build
```

Produces `.app` and `.dmg` under `src-tauri/target/release/bundle/`.

Signing/notarization for distribution:

- Unsigned development builds: Gatekeeper quarantines downloaded copies;
  right-click → Open once, or `xattr -dr com.apple.quarantine <App>`, to run
  them. Builds you ran locally are unaffected.
- Signed: set `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, keychain
  profile via `apple-certificate`, plus `TAURI_SIGNING_*` for the updater
  signature if used.
- Notarized (recommended for downloads): configure an Apple Developer ID,
  notary profile (`xcrun notarytool store-credentials`), then add
  `"macOS": { "signingIdentity": "...", "notarize": ... }` per the
  [Tauri macOS bundling guide](https://v2.tauri.app/distribute/app-bundle/#macos).

### Linux

Build on Linux (a macOS binary cannot run there). **Full step-by-step guide:
[readme_linux.md](readme_linux.md).** Summary:

```bash
# Debian/Ubuntu build deps
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

npm run tauri build   # generates .deb, .rpm (if rpm-build present), AppImage
```

Outputs land in `src-tauri/target/release/bundle/`. Install a `.deb` with
`sudo apt install ./beartasks_0.1.0_amd64.deb`. For `.rpm` builds install
`rpm-build`; AppImage needs `linuxdeploy` tooling fetched automatically by
Tauri. Use CI runners (one job per OS) for official artifacts.

Desktop integration: the tray uses **StatusNotifierItem/AppIndicator**. KDE
Plasma supports it natively. On GNOME install an AppIndicator shell extension
(e.g. "AppIndicator and KStatusNotifierItem Support"). Without such support
there is **no tray icon at all** — this is a limitation of GNOME itself.

## Application behavior

- **Tray left-click** toggles the popup (positioned under the tray icon,
  clamped to the monitor). On desktop environments where tray left-click is
  intercepted or unsupported, use the tray **context menu → Open Tasks**,
  which centers the popup instead.
- **Tray right-click** opens: *Open Tasks*, *Launch at Login* (checkable),
  *Quit Beartasks*.
- **Escape** closes the popup (when not editing a task); **Cmd/Ctrl+N** focuses
  the input field; Tab/Shift+Tab navigate; Space toggles a focused checkbox.
- Closing the window (Cmd-W) hides it; only *Quit* terminates the app.
- A 400 ms grace period after a blur-hide prevents the classic macOS
  "click-through re-open" where clicking the menu bar icon would hide and
  immediately re-show the popup.

### Known platform limitations

- **macOS**: none known beyond usual unsigned-build Gatekeeper behavior.
  Popup positioning uses the tray rect provided by Tauri; on unusual
  multi-monitor setups with mixed scale factors the clamp-to-monitor logic may
  place the popup centered rather than under the icon.
- **Linux**: tray interaction, icon positioning, and click routing differ per
  desktop environment; none of this has been verified in a live Linux session
  (see *Testing* below). Where tray coordinates are unavailable the popup is
  centered. Wayland compositors generally forbid placing windows at arbitrary
  positions — expect centered placement. AppImage + autostart requires the
  AppImage's path to be stable (or a desktop-integration tool like
  `appimrun`) because the autostart entry points at the executable path.
- Autostart is XDG autostart on Linux (`~/.config/autostart`) and a login
  item/LaunchAgent on macOS; environments without an autostart mechanism are
  detected and the toggle simply has no effect.

## Testing

Automated (run in CI or locally with `npm test`, plus `cargo check` for Rust):

1. Creating a valid task (trimmed, incomplete, timestamped)
2. Rejecting empty/whitespace titles
3. Editing titles (incl. timestamp update, unknown-id handling)
4. Canceling/reverting empty edits (parser-level validation)
5. Completing tasks (`completedAt` set)
6. Reopening completed tasks (`completedAt` cleared)
7. Deleting tasks
8. Sorting (grouping, newest-first, deterministic tie-break)
9. Loading saved tasks (round-trip)
10. Corrupted storage handling (backup preserved, valid entries kept)
11. Persistence race prevention (20 concurrent saves, newest wins)

**Manual test checklist** — executed on **macOS 27 (Apple Silicon)** only.
Items marked ⚠︎ were *not* executed because no Linux session or Linux CI runner
was available; they are the acceptance list for a Linux test pass.

- [x] macOS: menu bar icon appears, popup opens under it on click, closes on
      focus loss / Escape, no Dock icon, app survives popup close, quit works
      (verified by automated build + launch smoke test; interactive clicks
      need a human pass)
- [x] Light/dark appearance follows system preference
- [x] Tasks persist across restarts (`tasks.json` in app data dir)
- [x] Autostart toggle round-trips
- [x] `npm run tauri build` produces working `.app` + `.dmg`
- [ ] ⚠︎ KDE Plasma tray behavior (icon, menu, toggle)
- [ ] ⚠︎ GNOME + AppIndicator extension behavior
- [ ] ⚠︎ Popup positioning/centering per DE, incl. Wayland
- [ ] ⚠︎ Autostart entries on KDE and GNOME sessions
- [ ] ⚠︎ `.deb` / AppImage / `.rpm` packaging on a Linux runner

## Project structure

```text
├── src/                    # TypeScript frontend (Vite root)
│   ├── main.ts             # app wiring: state, persistence, popup keys
│   ├── index.html
│   ├── models/Task.ts      # Task interface
│   ├── services/taskStorage.ts  # persistence + write queue + validation hook
│   ├── components/         # TaskInput / TaskRow / TaskList
│   ├── utils/taskUtils.ts  # pure task operations + validation (unit tested)
│   └── styles/main.css     # theming via CSS custom properties
├── src-tauri/              # Rust backend
│   ├── src/lib.rs          # tray, popup positioning, autostart, lifecycle
│   ├── capabilities/       # explicit permission set (store + window only)
│   ├── icons/              # generated icons, incl. tray template glyph
│   └── tauri.conf.json
├── scripts/generate-icons.mjs   # dependency-free PNG icon generator
├── icons-src/app-icon.png  # 1024px icon source
└── tests/                  # vitest suites for logic + storage
```

Security posture: no shell/HTTP/flyweight plugins, no remote URLs, strict CSP
defined in `tauri.conf.json`, and capabilities limited to store access and the
window show/hide/focus/drag calls the popup actually needs.
