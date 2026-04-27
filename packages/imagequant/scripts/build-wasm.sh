#!/usr/bin/env bash
# Build the wasm-bindgen artifact for `@ingcreators/annot-imagequant`.
#
# Reproducibility checklist:
#   - Toolchain: rustc + cargo from the project's pinned Rust release
#     (see ../README.md). wasm-pack 0.13.1.
#   - Target: wasm32-unknown-unknown (rustup target add).
#   - Build flags: `--release --target web --locked`.
#   - Profile: `[profile.release]` in Cargo.toml (opt-level=z, lto=true,
#     codegen-units=1, strip=true, panic=abort).
#   - Output: packages/imagequant/pkg/ — committed to the repo.
#
# This script is invoked manually when the Rust source or pinned crate
# versions change. CI re-runs it (Phase 2 of vendor-libimagequant.md)
# and diffs against the committed artifact to catch drift.

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "error: wasm-pack not found on PATH." >&2
  echo "install with: cargo install wasm-pack --version 0.13.1 --locked" >&2
  exit 1
fi

if ! rustup target list --installed | grep -q '^wasm32-unknown-unknown$'; then
  echo "error: wasm32-unknown-unknown target not installed." >&2
  echo "install with: rustup target add wasm32-unknown-unknown" >&2
  exit 1
fi

# Clean previous output so removed exports don't linger.
rm -rf pkg

wasm-pack build \
  --release \
  --target web \
  --out-dir pkg \
  --out-name annot_imagequant \
  -- --locked

# wasm-pack writes a `pkg/.gitignore` containing `*` and a `pkg/package.json`
# tailored to publishing the crate as a standalone npm package. Neither
# applies here: we ship `pkg/` as committed in-tree files driven by the
# parent `packages/imagequant/package.json`. Drop both so `git status`
# tracks just the artefact files we actually care about.
rm -f pkg/.gitignore pkg/package.json pkg/README.md pkg/LICENSE

echo
echo "build-wasm: done. artefact at packages/imagequant/pkg/"
ls -la pkg/
