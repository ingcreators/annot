#!/usr/bin/env bash
# Build the `annot-win-clipboard` napi-rs addon and copy the
# resulting `.dll` into `prebuilds/win-clipboard.win32-x64.node`.
# Modeled on `packages/imagequant/scripts/build-wasm.sh`. Run on
# any Windows-x64 host with the Rust MSVC toolchain installed
# (`rustup target add x86_64-pc-windows-msvc` is the default
# Windows host).
#
# Output: a single byte-deterministic `.node` file under
# `prebuilds/`, ready to commit to git. The verify-build CI job
# (see `verify-addon.sh`) re-runs this script on every PR that
# touches the addon directory and diffs against the committed
# binary.

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v cargo >/dev/null 2>&1; then
  echo "error: cargo not found on PATH." >&2
  echo "install with: https://www.rust-lang.org/tools/install" >&2
  exit 1
fi

cargo build --release --target x86_64-pc-windows-msvc --locked

src="target/x86_64-pc-windows-msvc/release/annot_win_clipboard.dll"
dst="prebuilds/win-clipboard.win32-x64.node"
mkdir -p "$(dirname "$dst")"
cp "$src" "$dst"
echo "build-addon: wrote $dst"
