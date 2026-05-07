// Generate application PNG icons from the canonical brand SVGs.
// Writes into each package's public/ directory AND into
// `brand/generated/` for icons that aren't shipped inside a package
// (OAuth consent logo, Marketplace/Drive UI Integration assets,
// etc. — i.e. things you upload to an admin console rather than
// bundle into a build).
//
// Run: node brand/generate-app-icons.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "../node_modules/.pnpm/@resvg+resvg-js@2.6.2/node_modules/@resvg/resvg-js/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

// [source SVG, output PNG path (repo-relative), pixel size]
//
// Which source to use:
//   • annot-icon-16.svg → for ≤ 24 px (pin removed, legible at 16)
//   • annot-icon.svg    → for 25 – 399 px (full mark with pin)
//
// `annot-icon-maskable.svg` was used by the PWA `purpose:"maskable"`
// icon for Android adaptive masks; dropped along with the PWA layer
// (web app no longer ships a manifest). The source SVG stays in
// `brand/` for future use.
const targets = [
  // Chrome extension (manifest references these exact filenames)
  ["annot-icon-16.svg", "packages/extension/public/icons/icon-16.png", 16],
  ["annot-icon.svg",    "packages/extension/public/icons/icon-48.png", 48],
  ["annot-icon.svg",    "packages/extension/public/icons/icon-128.png", 128],

  // Web app — favicon only. The PWA manifest used a 512 + maskable
  // pair; both went away when the PWA layer was removed.
  ["annot-icon.svg", "packages/web/public/icons/icon-192.png", 192],

  // Electron desktop. `electron-builder` reads `build/icon.png`
  // and auto-generates the per-OS variants from it:
  //   • Linux: uses the PNG directly for the .desktop entry +
  //     dock thumbnails. 512 px is the minimum modern Linux
  //     desktops sample for high-DPI; 1024 gives headroom.
  //   • macOS: derives the .icns icon set when `build/icon.icns`
  //     is absent. Apple recommends the source be ≥ 1024 px so
  //     the @2x Retina variants stay crisp.
  //   • Windows: derives `icon.ico` (multi-resolution) when
  //     `build/icon.ico` is absent.
  // One 1024 × 1024 source therefore covers all three platforms
  // without per-OS conversion steps.
  ["annot-icon.svg", "packages/desktop/build/icon.png", 1024],

  // Not bundled — uploaded to Google Cloud Console / Marketplace.
  // Kept under brand/generated/ so we can regenerate from the SVG
  // source when the brand evolves.
  //
  //   120 × 120 — OAuth consent screen "App logo"
  //   16 × 16 / 32 × 32 / 64 × 64 / 128 × 128 / 256 × 256 —
  //     Drive UI Integration asks for the full five-icon set so
  //     Drive can render crisply across list / detail / high-dpi
  //     variants without interpolation. The ≤ 32 px sizes use
  //     `annot-icon-16.svg` (pin-less variant, legible small).
  //   512 × 512 — Marketplace listing main icon
  ["annot-icon-16.svg", "brand/generated/oauth-logo-120.png", 120],
  ["annot-icon-16.svg", "brand/generated/drive-ui-16.png", 16],
  ["annot-icon-16.svg", "brand/generated/drive-ui-32.png", 32],
  ["annot-icon.svg",    "brand/generated/drive-ui-64.png", 64],
  ["annot-icon.svg",    "brand/generated/drive-ui-128.png", 128],
  ["annot-icon.svg",    "brand/generated/drive-ui-256.png", 256],
  ["annot-icon.svg",    "brand/generated/marketplace-512.png", 512],

  // GitHub org / repo avatars. GitHub recommends ≥ 500 px square; we
  // ship 1024 so the avatar stays crisp in PR / commit lists on
  // high-DPI displays. Uploaded manually via Settings → Profile
  // (org) or Settings → General → Social preview (repo).
  ["ingcreators-icon.svg", "brand/generated/github-avatar-ingcreators-1024.png", 1024],
  ["annot-icon.svg",       "brand/generated/github-avatar-annot-1024.png", 1024],
];

for (const [src, outRel, size] of targets) {
  const svg = readFileSync(resolve(here, src), "utf8");
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "transparent",
  });
  const png = resvg.render().asPng();
  const outAbs = resolve(repoRoot, outRel);
  // Some of the output paths (notably `brand/generated/`) may not
  // exist on a fresh clone; create them lazily so running the script
  // is still a single step.
  const outDir = dirname(outAbs);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(outAbs, png);
  console.log(`✓ ${outRel}  (${size}×${size}, ${png.length} bytes, from ${src})`);
}
