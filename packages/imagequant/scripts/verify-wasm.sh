#!/usr/bin/env bash
# Re-build the wasm artefact into a temp directory and diff it against
# the committed `packages/imagequant/pkg/`. Used by CI (Phase 2 of
# vendor-libimagequant.md) and by humans before sending a PR that
# touches the Rust source.
#
# Exit non-zero if any byte differs.

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "error: wasm-pack not found on PATH." >&2
  echo "install with: cargo install wasm-pack --version 0.13.1 --locked" >&2
  exit 1
fi

out_dir="${VERIFY_WASM_OUT_DIR:-}"
if [[ -n "$out_dir" ]]; then
  mkdir -p "$out_dir"
  fresh_pkg="$out_dir/pkg"
  rm -rf "$fresh_pkg"
else
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  fresh_pkg="$tmp/pkg"
fi

wasm-pack build \
  --release \
  --target web \
  --out-dir "$fresh_pkg" \
  --out-name annot_imagequant \
  -- --locked

rm -f "$fresh_pkg/.gitignore" "$fresh_pkg/package.json" "$fresh_pkg/README.md" "$fresh_pkg/LICENSE"

if ! diff -ruN pkg "$fresh_pkg" >/dev/null; then
  echo "verify-wasm: committed pkg/ differs from a fresh build." >&2
  diff -ruN pkg "$fresh_pkg" >&2 || true
  exit 1
fi

echo "verify-wasm: ok — committed pkg/ matches a fresh build."
