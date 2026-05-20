# `annot-win-clipboard` — atomic multi-format Win32 clipboard write

A small `napi-rs` addon that drives Win32 directly so Annot can
set GVML + CF_DIB on the system clipboard in one transaction.
Loaded by the Electron main process from
`prebuilds/win-clipboard.win32-x64.node`; the path is resolved
at app-ready time in `packages/desktop/src-electron/main.ts`.

## Why this addon exists

Electron's `clipboard.writeBuffer(format, buffer)` runs a full
`OpenClipboard + EmptyClipboard + SetClipboardData +
CloseClipboard` cycle per call. Back-to-back calls don't
accumulate formats — the second call wipes the first. Office's
native shape paste needs the `Art::GVML ClipFormat` envelope;
Paint, browsers, and Google Sheets need `CF_DIB`. To set both,
we need one Win32 cycle that calls `SetClipboardData` twice. This
addon exposes exactly that.

The implementation is a direct port of the deleted
`packages/desktop/src-tauri/src/commands/clipboard.rs::set_clipboard_all`.

## Surface

```ts
type Format = string | number; // string = custom (RegisterClipboardFormatW), number = standard id
function writeMultiFormat(formats: Array<{ format: Format; data: Buffer }>): void;
```

Errors from any Win32 call (`OpenClipboard`, `EmptyClipboard`,
`RegisterClipboardFormatW`, `GlobalAlloc`, `GlobalLock`,
`SetClipboardData`) surface as a `napi::Error` rejection.
`CloseClipboard` always runs, even on the error path.

## Building

The committed `prebuilds/win-clipboard.win32-x64.node` is the
authoritative artefact at PR-review time. **The canonical build
is the one produced by the `verify-win-clipboard` CI job on
GitHub's `windows-latest` runner** — a developer-local
`bash scripts/build-addon.sh` may produce a slightly different
binary because the MSVC `link.exe` / Windows SDK versions on a
contributor's machine rarely match the runner exactly.

To rebuild from source on a Windows host with the Rust MSVC
toolchain installed:

```bash
bash scripts/build-addon.sh
```

To verify the committed prebuild matches a fresh build (the
supply-chain check CI runs):

```bash
bash scripts/verify-addon.sh
```

`scripts/verify-addon.sh` is byte-exact: a single byte of drift
fails. The model mirrors the (now-retired) `verify-wasm` gate
that protected the `@ingcreators/annot-imagequant` WASM blob
before that package was removed — same supply-chain rationale (a
tampered binary can't slip past review because CI rebuilds from
source).

### Updating the prebuild

When the addon source changes, push the PR and let
`verify-win-clipboard` produce the canonical binary:

1. Push the source change with a stale prebuild. CI's
   `verify-win-clipboard` job will fail with "committed differs
   from a fresh build" and upload the fresh `.node` as a
   `win-clipboard-fresh-prebuild` artefact.
2. `gh run download <run-id> -n win-clipboard-fresh-prebuild` —
   download the CI-built binary.
3. Replace `prebuilds/win-clipboard.win32-x64.node` with the
   downloaded file and push the update commit. CI will pass.

The local build is fine for quick iteration, but the committed
artefact must match CI.

## Distribution

The prebuild is committed to the repo and bundled into the
Electron installer via the package's `build.extraResources` in
`packages/desktop/package.json`:

```json
{
  "from": "native/win-clipboard/prebuilds/win-clipboard.win32-x64.node",
  "to": "win-clipboard.node"
}
```

In production the runtime loader looks under
`process.resourcesPath`; in dev (`electron-vite dev`) it falls
back to the in-repo path under `native/win-clipboard/prebuilds/`.

## Versions are pinned

`Cargo.toml` pins exact versions of `napi`, `napi-derive`,
`napi-build`, and `windows`. The verify-build gate is a byte
equivalence check — any transitive bump that changes the
generated DLL would fail the CI job until someone deliberately
re-runs `build-addon.sh` and commits the new prebuild. The
original supply-chain rationale for this byte-exact verification
model is documented in
`docs/plans/_done/vendor-libimagequant.md`.
