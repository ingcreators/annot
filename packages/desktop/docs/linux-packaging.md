# Linux Packaging

> Phase 8 of [`docs/plans/desktop-electron-migration.md`](../../../docs/plans/desktop-electron-migration.md).
> Target inventory + smoke-test recipe + known compatibility
> issues for the Linux build of Annot.

## Targets

`pnpm --filter @ingcreators/annot-desktop build --linux` produces
three artifacts via `electron-builder` (config in
[`package.json`](../package.json#L82-L120)):

| Target       | Output filename                  | Use case                                                                                                                  |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **AppImage** | `Annot-<version>.AppImage`       | Universal Linux binary. Single-file, runs without root, drag-and-drop into any modern desktop. Recommended default.       |
| **deb**     | `annot_<version>_amd64.deb`      | Debian / Ubuntu / derivatives. `sudo apt install ./annot_<version>_amd64.deb` integrates into the package manager.        |
| **rpm**     | `annot-<version>.x86_64.rpm`     | Fedora / RHEL / OpenSUSE. `sudo rpm -i annot-<version>.x86_64.rpm` (or `dnf install`).                                    |

Each target embeds the bundled Electron runtime — no separate
runtime install needed.

## Building

```bash
pnpm --filter @ingcreators/annot-desktop build --linux
```

By default this builds **all three** Linux targets. To narrow:

```bash
pnpm --filter @ingcreators/annot-desktop build --linux AppImage
pnpm --filter @ingcreators/annot-desktop build --linux deb rpm
```

The build runs on Linux directly (preferred) or on a Linux
container from any host. Cross-compilation from macOS / Windows
sometimes works for AppImage but **deb / rpm builds need
`fakeroot` + `dpkg-deb` / `rpmbuild`** which are easiest to
provide on Linux.

If you don't have `fakeroot` installed, deb / rpm builds fail
with `error: fakeroot: command not found`. Install:

```bash
sudo apt install fakeroot rpm     # Ubuntu / Debian
sudo dnf install fakeroot rpm     # Fedora
```

## Smoke test on Ubuntu LTS

The Phase 8 verify gate is "AppImage launches and captures work
end-to-end on Ubuntu LTS." Steps:

1. Copy `Annot-<version>.AppImage` to a clean Ubuntu LTS host
   (22.04 or 24.04). Make executable:
   ```bash
   chmod +x Annot-<version>.AppImage
   ```
2. Launch:
   ```bash
   ./Annot-<version>.AppImage
   ```
   The window opens against `<userData>/library/Inbox/` —
   `<userData>` resolves to `~/.config/Annot/` on Linux. First
   launch creates the empty Inbox.
3. Click **Capture Window** or **Capture Region**. Under X11
   the screen capture works without prompts. Under Wayland the
   first capture triggers a system permission dialog (xdg-
   desktop-portal — see _Wayland_ below); grant access.
4. Confirm the captured image lands in the gallery and the
   editor opens. Save annotations; reload the gallery to verify
   round-trip.
5. Open the **Browse** window (`Ctrl+B`), navigate to a URL,
   click **📷 Capture Visible**. Confirm the capture lands at
   `~/.config/Annot/library/Inbox/`.
6. Quit + relaunch. Verify the saved files persist and reopen
   correctly.

## Known compatibility issues

### Wayland + screen capture

Electron 22+ uses **xdg-desktop-portal** for screen capture
under Wayland. The first capture call surfaces a system dialog
asking the user to pick the screen / window to share — there's
no way to bypass it (security model). Subsequent calls within
the same session are silent.

If the dialog never appears and the capture fails:

- Ensure `xdg-desktop-portal` and a backend are installed:
  ```bash
  sudo apt install xdg-desktop-portal xdg-desktop-portal-gtk
  # GNOME-specific backend (auto-pulled on Ubuntu Desktop):
  sudo apt install xdg-desktop-portal-gnome
  # KDE Plasma:
  sudo apt install xdg-desktop-portal-kde
  ```
- Restart the user session so the portal services pick up the
  new install.
- Some KDE distros default the capture portal to "no source
  available" — open System Settings → Sharing → Screen Capture
  and grant Annot access manually.

This is an upstream limitation of Wayland's security model, not
an Annot-specific issue. Tracked as a follow-up if regressions
surface.

### Fractional-DPI scaling

Linux desktops with fractional scaling (e.g. 125%, 150%) can
render Electron apps blurry under X11 because Chromium's
auto-detection reports the integer scale and lets the
compositor stretch the result. Workarounds:

- Pass the explicit force-scale flag at launch:
  ```bash
  ./Annot-<version>.AppImage --force-device-scale-factor=1.5
  ```
- Under Wayland, fractional scaling works correctly without
  any flag (Wayland reports fractional values to Chromium
  natively).

If Wayland-default fractional rendering still looks fuzzy,
that's a Chromium-upstream issue tracked at
[crbug/1267781](https://crbug.com/1267781) and is independent
of Annot.

### PipeWire 0.3 vs 1.x

Annot's `desktopCapturer` flow goes through Chromium's PipeWire
backend on Wayland. Distros shipping PipeWire < 0.3.40 have
known capture-stall bugs under multi-monitor setups. Verify:

```bash
pipewire --version
```

Ubuntu 22.04's archive PipeWire is 0.3.48 (post-fix); 24.04 ships
PipeWire 1.0+ which is rock-solid. If you're on a niche distro
shipping older PipeWire, upgrade or avoid multi-monitor capture
until the upgrade.

## Known follow-ups

- **Higher-resolution app icon.** The current
  [`build/icon.png`](../build/icon.png) is 128×128, copied from
  the Tauri-era assets. Modern Linux desktops use up to 512×512
  for app launchers + dock thumbnails; smaller icons render
  fuzzy at HiDPI. A re-rendered 512×512 (and ideally an SVG
  source for sharp vector scaling) is queued as a brand-asset
  pass.
- **Snap + Flatpak**. `electron-builder` supports both targets
  via additional `linux.target` entries (`snap`, `flatpak`).
  Not enabled in Phase 8 — sandbox model needs review against
  Annot's `~/.config/Annot/library/` write requirements
  (Flatpak's filesystem permissions are stricter than the
  AppImage / deb / rpm path).
- **CI release pipeline.** All Linux builds today run on a
  developer workstation. A GitHub Actions release workflow
  that emits all three targets on every `release/*` tag is
  queued behind Phase 9 (Tauri removal).

## Out of scope

- ARM64 Linux. The default `electron-builder` build is x86_64.
  Arm64 is a one-line `target` config flip when needed; no
  arch-specific code paths in Annot itself.
- AppArmor / SELinux profile. Annot writes to
  `~/.config/Annot/` like any other desktop app; no
  privileged operations need a profile.

## Related

- [`packages/desktop/docs/notarization.md`](./notarization.md)
  — macOS counterpart.
- [`electron-builder` Linux config](https://www.electron.build/configuration/linux)
- [xdg-desktop-portal screen-capture docs](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Screencast.html)
