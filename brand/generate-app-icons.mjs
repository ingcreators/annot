// Generate application PNG icons from the canonical brand SVGs.
// Writes directly into each package's public/ directory, so running
// this script is the single step needed to propagate brand changes
// to every shipping surface (Chrome Web Store, PWA install, favicon).
//
// Run: node brand/generate-app-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "../node_modules/.pnpm/@resvg+resvg-js@2.6.2/node_modules/@resvg/resvg-js/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

// [source SVG, output PNG path (repo-relative), pixel size]
//
// Which source to use:
//   • annot-icon-16.svg       → for ≤ 24 px (pin removed, legible at 16)
//   • annot-icon.svg          → for 25 – 399 px (full mark with pin)
//   • annot-icon-maskable.svg → for PWA maskable purpose (full-bleed bg,
//                               80% safe zone centered)
const targets = [
  // Chrome extension (manifest references these exact filenames)
  ["annot-icon-16.svg", "packages/browser-extension/public/icons/icon-16.png", 16],
  ["annot-icon.svg",    "packages/browser-extension/public/icons/icon-48.png", 48],
  ["annot-icon.svg",    "packages/browser-extension/public/icons/icon-128.png", 128],

  // PWA (vite-plugin-pwa references these)
  ["annot-icon.svg",          "packages/web-annotation/public/icons/icon-192.png", 192],
  ["annot-icon.svg",          "packages/web-annotation/public/icons/icon-512.png", 512],
  ["annot-icon-maskable.svg", "packages/web-annotation/public/icons/icon-512-maskable.png", 512],
];

for (const [src, outRel, size] of targets) {
  const svg = readFileSync(resolve(here, src), "utf8");
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "transparent",
  });
  const png = resvg.render().asPng();
  const outAbs = resolve(repoRoot, outRel);
  writeFileSync(outAbs, png);
  console.log(`✓ ${outRel}  (${size}×${size}, ${png.length} bytes, from ${src})`);
}
