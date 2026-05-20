# @ingcreators/annot-imagequant

## 0.1.0

### Minor Changes

- adae49d: Initial public release of `@ingcreators/annot-imagequant` — a small wasm-bindgen wrapper around the upstream [ImageOptim/libimagequant](https://github.com/ImageOptim/libimagequant) Rust crate (the same engine pngquant uses). Drives the PNG-8 palette quantization path in Annot's "smart" capture encoder.

  **License: GPL-3.0-or-later** — inherited from libimagequant. The package is published as an opt-in `optionalDependencies` of `@ingcreators/annot-annotator@0.3.0`; the annotator stays Apache-2.0 and falls back gracefully to PNG-32 / JPEG when this WASM module isn't installed. Consumers who want the smaller PNG-8 output explicitly add this package to their own dependencies and assume the GPL-3.0 obligations that entails.

  ABI (unchanged since the workspace-internal 0.1.0):

  ```ts
  import init, { quantize_image } from "@ingcreators/annot-imagequant";
  await init();
  const { palette, indices } = quantize_image(rgba, w, h, /* maxColors */ 256);
  // palette: Uint8Array — flattened RGBA8, length = colorCount * 4
  // indices: Uint8Array — one byte per pixel, index into palette
  ```

  Build artefacts (`pkg/annot_imagequant.{js,d.ts}` + `_bg.wasm`) are committed to the repo so consumers don't need a Rust toolchain on install. Rebuilds happen only when the upstream `libimagequant-sys` pin moves.
