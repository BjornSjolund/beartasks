# Building Beartasks on Linux (Ubuntu)

Exact steps to build the Ubuntu installable bundles (`.deb` and AppImage)
from source on a Linux machine.

**Requirements:** a native Linux box or VM (Ubuntu 24.04 LTS recommended;
anything newer with WebKitGTK **4.1** works). The produced package targets
the architecture you build on (`uname -m`: build on `x86_64` → `amd64`,
build on `aarch64` → `arm64`). Building on macOS or cross-compiling to Linux
is not supported — Tauri links against the host WebKit/GTK stack.

**Verification status:** the build steps below follow the official
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/). The app
itself compiles and its tests pass as of this writing; these Linux commands
have *not* been executed in a live Linux session — see the note at the end.

---

## 1. System dependencies

Ubuntu / Debian:

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl wget file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

Other distributions, equivalents:

| Distro | Packages |
|---|---|
| Fedora | `sudo dnf install gtk3-devel glib2-devel webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel patchelf` |
| Arch | `sudo pacman -S base-devel webkit2gtk-4.1 openssl curl wget file libxdo libayatana-appindicator librsvg patchelf` |

> **Ubuntu 22.04 note:** its WebKitGTK is too old (no 4.1 API). Use 24.04+
> or a distribution with WebKitGTK ≥ 2.40.

## 2. Toolchain

Rust (stable, via rustup):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc -V   # 1.77.2 or newer
```

Node.js 20+ (NodeSource LTS 22 shown; any Node ≥ 20 works — avoid Ubuntu's
`apt nodejs` 18):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v
```

## 3. Get the source

Clone, or copy the project directory (everything *except*
`node_modules/`, `dist/`, and `src-tauri/target/` is needed — these are
rebuilt):

```bash
git clone <your-repo-url> beartasks
cd beartasks
npm ci
```

## 4. Verify the checkout (optional but recommended)

```bash
npm run typecheck        # tsc --noEmit, strict
npm test                 # vitest: task logic + persistence layer
(cd src-tauri && cargo check)
```

All three should finish clean before you build.

## 5. Build the bundles

```bash
npm run tauri build -- --bundles deb,appimage
```

This runs the frontend build (Vite) and a release Rust build, then bundles.
Expect a few minutes on first build (all crates compile). On success:

```bash
find src-tauri/target/release/bundle -type f \( -name '*.deb' -o -name '*.AppImage' \)
# src-tauri/target/release/bundle/deb/Beartasks_0.1.0_amd64.deb
# src-tauri/target/release/bundle/appimage/Beartasks_0.1.0_amd64.AppImage
```

(`_arm64` instead of `_amd64` on ARM machines.)

To also build an RPM you need `sudo apt install rpm-build` and
`--bundles deb,rpm,appimage`; Debian tooling makes this awkward — prefer the
deb on Ubuntu and build RPMs on Fedora/openSUSE or in CI.

## 6. Install and launch

**deb (recommended):**

```bash
sudo apt install ./src-tauri/target/release/bundle/deb/Beartasks_0.1.0_amd64.deb
```

This installs the binary to `/usr/bin` (or `/usr/lib` path per Tauri default)
plus an icon and an application-menu (`.desktop`) entry.

**AppImage (no root needed):**

```bash
chmod +x Beartasks_0.1.0_amd64.AppImage
./Beartasks_0.1.0_amd64.AppImage
```

On Ubuntu 24.04+ AppImages need the legacy FUSE package to run:
`sudo apt install libfuse2t64` (or run with `--appimage-extract-and-run`).

**Launch:** Beartasks is a tray-only app. Starting it (app grid or terminal)
shows **no window** by design — a checklist icon should appear in your system
tray; click it (or right-click → *Open Tasks*) for the popup. See the next
section if the icon is missing. To stop it: right-click the tray icon →
*Quit Beartasks*, or `pkill -f beartasks`.

## 7. System tray on Ubuntu (read this if the icon is missing)

Beartasks uses StatusNotifierItem/AppIndicator, which Ubuntu's stock GNOME
shell does **not** display out of the box:

- Ubuntu ships `ubuntu-appindicators@ubuntu.com`, which only renders icons on
  an allowlist — third-party tray icons are hidden.
- Fix (pick one):
  1. Install the full AppIndicator extension:
     ```bash
     sudo apt install gnome-shell-extension-appindicator
     # log out and back in, then:
     gnome-extensions enable appindicatorsupport@rgcjonas.gmail.com
     ```
     (enable it *instead of* the Ubuntu allowlist extension; disable the
     latter with `gnome-extensions disable ubuntu-appindicators@ubuntu.com`
     if both are active).
  2. Use KDE Plasma or another SNI-native desktop — no extension needed.

- **Window positioning:** on GNOME (and generally on Wayland), the desktop
  does not expose tray-icon coordinates, so the popup appears **centered**
  rather than under the icon. On X11 with an SNI host it positions next to
  the tray icon like on macOS.

## 8. Launch at login

Toggle **Launch at Login** in the tray's right-click menu. It writes an XDG
autostart entry (`~/.config/autostart/`), honored by GNOME and KDE sessions.
This persists across reboots for deb installs. For AppImages the entry
points at the file's path — keep the `.AppImage` at a stable location. The
setting is never enabled automatically.

Tasks are stored at `~/.local/share/dev.sjolund.beartasks/tasks.json`
(removed only if you delete it yourself).

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `libwebkit2gtk-4.1-dev: not found` | OS too old (see §1 note) or `universe` repo disabled: `sudo apt install software-properties-common && sudo add-apt-repository universe` |
| Blank/white window on NVIDIA or older GPUs | Launch with `WEBKIT_DISABLE_DMABUF_RENDERER=1 beartasks` (or add it to the `.desktop` Exec line) |
| Tray icon invisible on GNOME | §7 |
| Popup never appears after launch | The tray icon is the only entry point; if you have no SNI support, run on a supported desktop |
| `error: linker cc not found` | `sudo apt install build-essential` |
| AppImage won't start | `sudo apt install libfuse2t64` or run with `--appimage-extract-and-run` |

## 10. Building from a non-Linux machine

If the build machine isn't Linux, produce the artifacts on a Linux runner:

- **GitHub Actions** (recommended): build job on `ubuntu-24.04` (amd64) or
  `ubuntu-24.04-arm` (arm64), with steps §1–§5.
- **Docker** on Apple Silicon: use a Tauri Linux image
  (`tauri-apps/docker:linux`) with `--platform linux/amd64`. Builds run under
  QEMU emulation and are slow (tens of minutes); native runners are better.

---

*Honesty note: the project compiles, typechecks, and passes its test suite
(verified on macOS/Apple Silicon); the Linux sections above were authored
from the official Tauri 2 requirements, not from a run on a live Ubuntu
system. If you hit drift, fix it here and open a pull request.*
