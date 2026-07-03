# Dev container

Docker-Compose-based dev container for annot, mirroring the setup used in
`ingcreators/hypermedia-components`. Node 24 + pnpm 11 on Debian bookworm,
with the GitHub CLI and Claude Code installed as devcontainer features.

## Prerequisites (Windows + WSL)

1. Install WSL 2 with a Linux distro (e.g. `wsl --install -d Ubuntu`).
2. Install Docker Desktop with the **WSL 2 backend** enabled, and enable
   integration for your distro (Settings → Resources → WSL integration).
   Alternatively, install Docker Engine directly inside the distro.
3. **Clone the repository inside the WSL filesystem** (e.g.
   `~/workspaces/annot`), NOT under `/mnt/c/...`. Bind-mounting a Windows
   path into the container makes `pnpm install` and Vite watch orders of
   magnitude slower and breaks file-event watching.
4. Open the WSL clone in VS Code (`code .` from the distro shell, which
   uses the Remote-WSL extension), then run **Dev Containers: Reopen in
   Container**.

## What you get

- `postCreateCommand` runs `pnpm install --frozen-lockfile` and installs
  Playwright Chromium (with system deps) for the docs-site tour /
  annot-playwright / annot-mcp suites.
- Named volumes persist Claude Code state, gh auth, the pnpm store, the
  npm cache, and Playwright browsers across container rebuilds.
- Forwarded ports: 3000 (PWA), 4321 (marketing), 4322 (docs-site), 6006
  (Storybook), 8787 (wrangler dev).
- Local-only secrets go in `.devcontainer/devcontainer.local.env`
  (gitignored) — see `devcontainer.local.env.example`.

## Known limitations

- `packages/desktop` (Electron) needs a display server. Typecheck and
  build work in the container; running the app is best done on the host
  (or via WSLg, untested).
- `packages/extension` builds fine, but loading the MV3 extension into
  Chrome for manual testing happens on the host browser.
