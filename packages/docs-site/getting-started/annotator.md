# Install `annot-annotator`

Use `annot-annotator` directly when you want the headless renderer
without Playwright — a CLI tool, a build pipeline, a CI step that
isn't running browser tests.

## Install

```bash
npm install @ingcreators/annot-annotator
```

The package inlines `annot-core` at build time, so installing
`annot-annotator` alone is enough.

## Hello, annotated screenshot

```ts
import { readFile, writeFile } from "node:fs/promises";
import { createAnnotator } from "@ingcreators/annot-annotator";

const annotator = createAnnotator();
const baseImage = await readFile("./screenshot.png");

const annotated = await annotator.toPng({
  baseImage,
  annotationsSvg: `
    <rect x="100" y="100" width="200" height="40"
          fill="none" stroke="#ff5252" stroke-width="3" />
    <text x="100" y="92" fill="#ff5252"
          font-family="sans-serif" font-size="14">Sign-in button</text>
  `,
});

await writeFile("./annotated.png", annotated);
```

`createAnnotator()` returns an object with two methods:

- `toPng(input)` — produces an annotated PNG buffer
- `toSvg(input)` — produces the underlying SVG as a string

Both take an `ImageRecord`-shaped input. The base image can be a
`Buffer`, a `data:image/png;base64,...` URL, or a `Uint8Array`.

## Why headless

The Node-side annotator runs entirely without a browser. It uses
`@resvg/resvg-js` for rasterisation and `@xmldom/xmldom` for SVG
sanitisation. Output is byte-identical to what the PWA produces
for the same inputs — same fonts, same colors, same arrowheads.

This means you can:

- Generate annotated screenshots from a CI build artefact.
- Embed annotation generation into a docs build.
- Pre-compute alt-text overlays for accessibility.

## Next steps

- [API reference: `createAnnotator`](../api/create-annotator.md)
- [Playwright integration](./playwright.md) if you're running E2E
  tests alongside.
