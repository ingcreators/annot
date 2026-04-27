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

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

wasm-pack build \
  --release \
  --target web \
  --out-dir "$tmp/pkg" \
  --out-name annot_imagequant \
  -- --locked

rm -f "$tmp/pkg/.gitignore" "$tmp/pkg/package.json" "$tmp/pkg/README.md" "$tmp/pkg/LICENSE"

if ! diff -ruN pkg "$tmp/pkg" >/dev/null; then
  echo "verify-wasm: committed pkg/ differs from a fresh build." >&2
  diff -ruN pkg "$tmp/pkg" >&2 || true
  exit 1
fi

echo "verify-wasm: ok — committed pkg/ matches a fresh build."
