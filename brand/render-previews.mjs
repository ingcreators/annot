// Render brand SVG assets to PNG for preview.
// Produces: brand/preview/<name>-<width>.png for every target.
// For 16px-variant targets, additionally produces <name>-at-16.png
// at actual favicon size so small-size legibility can be inspected.
//
// Run: node brand/render-previews.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Pnpm isolates deps per-package; pull the resvg-js module directly from
// the workspace-hoisted location instead of relying on node resolution.
import { Resvg } from "../node_modules/.pnpm/@resvg+resvg-js@2.6.2/node_modules/@resvg/resvg-js/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "preview");
mkdirSync(outDir, { recursive: true });

// Canonical brand assets. Each entry: [filename-stem, previewWidth].
// Wordmarks + family use width 512 so the icon portion is not tiny.
const targets = [
  // Annot
  ["annot-icon", 256],
  ["annot-icon-16", 256],
  ["annot-wordmark", 512],
  ["annot-wordmark-inverse", 512],
  ["annot-wordmark-stacked", 512],
  ["annot-wordmark-stacked-inverse", 512],

  // ingcreators
  ["ingcreators-icon", 256],
  ["ingcreators-icon-16", 256],
  ["ingcreators-wordmark", 512],
  ["ingcreators-wordmark-inverse", 512],

  // Family
  ["family", 768],
];

function render(name, width, suffix) {
  const svg = readFileSync(resolve(here, `${name}.svg`), "utf8");
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: "transparent",
  });
  const png = resvg.render().asPng();
  const outPath = resolve(outDir, `${name}-${suffix}.png`);
  writeFileSync(outPath, png);
  console.log(`✓ preview/${name}-${suffix}.png (${png.length} bytes)`);
}

for (const [name, width] of targets) {
  render(name, width, String(width));
  // For -16 variants, also render at true 16px so we can see what the
  // user will actually see in a browser tab / OS favicon.
  if (name.endsWith("-16")) {
    render(name, 16, "at-16");
  }
}
