#!/usr/bin/env bash
# Re-build the `annot-win-clipboard` addon into a temp directory
# and diff the result against the committed
# `prebuilds/win-clipboard.win32-x64.node`. Used by CI (verify-
# addon job) and by humans before sending a PR that touches the
# addon source.
#
# Exit non-zero if any byte differs.
#
# Modeled on `packages/imagequant/scripts/verify-wasm.sh` — same
# supply-chain rationale: a contributor PR, a compromised
# maintainer account, or a typo'd commit can't ship a tampered
# binary because CI rebuilds from source and a single byte of
# divergence fails the build.

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v cargo >/dev/null 2>&1; then
  echo "error: cargo not found on PATH." >&2
  exit 1
fi

out_dir="${VERIFY_ADDON_OUT_DIR:-}"
if [[ -n "$out_dir" ]]; then
  mkdir -p "$out_dir"
  fresh="$out_dir/win-clipboard.win32-x64.node"
  rm -f "$fresh"
else
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  fresh="$tmp/win-clipboard.win32-x64.node"
fi

cargo build --release --target x86_64-pc-windows-msvc --locked
cp target/x86_64-pc-windows-msvc/release/annot_win_clipboard.dll "$fresh"

committed="prebuilds/win-clipboard.win32-x64.node"
if ! cmp -s "$committed" "$fresh"; then
  echo "verify-addon: committed $committed differs from a fresh build." >&2
  echo "  committed: $(stat -c %s "$committed" 2>/dev/null || wc -c < "$committed") bytes" >&2
  echo "  fresh:     $(stat -c %s "$fresh" 2>/dev/null || wc -c < "$fresh") bytes" >&2
  echo "" >&2
  echo "  The canonical build environment is the windows-latest CI runner:" >&2
  echo "  byte-identity requires the same rustc (pinned in rust-toolchain.toml)" >&2
  echo "  AND the same MSVC linker. A different local Visual Studio version" >&2
  echo "  produces a diverging Rich header / PE layout, so a local mismatch" >&2
  echo "  does not by itself mean the source changed." >&2
  echo "  To refresh the committed prebuild after an intentional change:" >&2
  echo "  download the 'win-clipboard-fresh-prebuild' artifact from the" >&2
  echo "  failed CI run and commit it as $committed." >&2
  exit 1
fi

echo "verify-addon: ok — committed prebuild matches a fresh build."
