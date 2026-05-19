# `@ingcreators/annot-annotator`

[![npm](https://img.shields.io/npm/v/@ingcreators/annot-annotator.svg)](https://www.npmjs.com/package/@ingcreators/annot-annotator)
[![license](https://img.shields.io/npm/l/@ingcreators/annot-annotator.svg)](https://github.com/ingcreators/annot/blob/main/LICENSE)

Headless annotator — produce annotated screenshots from Node without
a browser. Reads an `ImageRecord`-shaped input (base image + saved
annotations SVG) and emits a PNG or the merged SVG.

Companion package: [`@ingcreators/annot-playwright`](https://www.npmjs.com/package/@ingcreators/annot-playwright) —
a Playwright fixture composing this annotator into idiomatic
`test.extend({ annotator })` form.

## Install

```sh
npm install @ingcreators/annot-annotator
# or
pnpm add @ingcreators/annot-annotator
```

Peer runtime requirements: Node 20+. The package depends on
`@resvg/resvg-js` (native binding via `@napi-rs`) — npm install
fetches the platform-matched prebuild automatically.

## Usage

```ts
import { createAnnotator } from "@ingcreators/annot-annotator";
import { writeFileSync } from "node:fs";

const annotator = createAnnotator({
  // Optional — register fonts so CJK / Arabic / Indic / Thai glyphs
  // render correctly. Without these, resvg-js falls back to its
  // built-in font and unusual scripts may render as boxes.
  fontFiles: ["./fonts/NotoSans-Regular.ttf"],
  defaultFontFamily: "Noto Sans",
});

const png = annotator.toPng({
  originalDataUrl: "data:image/png;base64,...",  // base bitmap
  annotationsSvg: "<svg ...>...</svg>",          // editor's saved output
  width: 1280,
  height: 720,
});

writeFileSync("./annotated.png", png);
```

Or get just the merged SVG without rasterisation:

```ts
const svg: string = annotator.toSvg({ ... });
```

## API

### `createAnnotator(options?: AnnotatorOptions): Annotator`

Construct an annotator. The instance is stateless — reuse it across
calls. Per-call inputs are passed to `toPng` / `toSvg`.

`AnnotatorOptions`:

| Field | Type | Default | Notes |
|---|---|---|---|
| `fontFiles` | `string[]` | `[]` | Absolute paths to TTF / OTF files |
| `fontDirs` | `string[]` | `[]` | Absolute paths to directories of font files |
| `loadSystemFonts` | `boolean` | `false` | `false` for CI determinism; opt in to system fonts |
| `defaultFontFamily` | `string` | resvg default | Fallback when an annotation references an unknown family |

`Annotator`:

- `toPng(input: AnnotatorInput): Uint8Array` — rasterise to PNG bytes.
- `toSvg(input: AnnotatorInput): string` — merged SVG (base image +
  sanitised annotations); no rasterisation.

`AnnotatorInput` is a structural subset of `ImageRecord` (a real
`ImageRecord` from `@ingcreators/annot-core/storage` works):

```ts
interface AnnotatorInput {
  originalDataUrl: string;   // base bitmap as data: URL
  annotationsSvg: string;    // editor's saved annotations.svg
  width: number;             // output pixel width
  height: number;            // output pixel height
}
```

## What the annotator does to the input SVG

The editor's `exportAnnotationsSvgForIdb` already strips
`#ui-overlay`, the base bitmap inside the wrapper, and the
`<g id="annotations">` wrapper — but the `<style data-annot-fonts>`
block survives, and we want defensive handling for any future code
path that doesn't go through `exportAnnotationsSvgForIdb` first.

The annotator's sanitiser:

- Keeps `<defs>` but removes any `<style data-annot-fonts>` inside
  (the editor injects this for self-contained SVG export; resvg
  can't use it).
- Skips top-level `<image>` with no `data-redact-style` (legacy
  base-bitmap-in-wrapper). Mosaic / blur redact images carry
  `data-redact-style` and survive.
- Skips `<g id="ui-overlay">` and `<g id="annotations">` wrappers
  (lifting the latter's children).
- Passes everything else through unchanged.

## Limitations (known, with Phase 1.5+ follow-ups planned)

- **PNG output only.** JPEG round-trip parity with the browser-
  side `renderImageRecord` requires `sharp` (or equivalent) to
  pipe PNG → JPEG. Phase 1.5 brings this as an optional peer dep.
- **No bundled fonts.** Pass `fontFiles` / `fontDirs` yourself.
  For deterministic CI rendering across distros, bundle the fonts
  with your test suite.

## How this fits the bigger picture

This package is Phase 1 of the headless-annotator track in the Annot
productization roadmap (top-priority strategic moat per
`PRODUCT_DIRECTION.md`). Phase 2 — `@ingcreators/annot-playwright` —
wraps this annotator in a Playwright fixture so test engineers can
emit annotated screenshots from failing assertions in CI.

See also:

- [`docs/plans/_done/headless-annotator-spike.md`](../../docs/plans/_done/headless-annotator-spike.md)
  — Phase 0 feasibility report (`@resvg/resvg-js` vs
  `@napi-rs/canvas` trade-offs; documented gaps).
- [`docs/plans/annot-annotator-package.md`](../../docs/plans/annot-annotator-package.md)
  — Phase 1 design + rationale for the public API shape.
- [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) — strategic
  context (Playwright + GitHub vectors).
