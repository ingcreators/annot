#!/usr/bin/env node
/**
 * Add `import { builtinIcon } from "@ingcreators/annot-core"` and
 * `import "<relative>/ui/annot-icon.js"` to every file that needs
 * them after the bulk migration in
 * `scripts/migrate-icon-callsites.mjs`.
 *
 * Phase 4 of `docs/plans/svg-icons-and-plugin-icon-spec.md`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const FILES = [
  "packages/web/src/editor/right-panel.ts",
  "packages/web/src/editor/editor-header.ts",
  "packages/web/src/editor/editor-statusbar.ts",
  "packages/web/src/editor/annot-file-details-drawer.ts",
  "packages/web/src/editor/annot-scratchpad-section.ts",
  "packages/web/src/gallery/sidebar.ts",
  "packages/web/src/gallery/annot-gallery-page.ts",
  "packages/web/src/gallery/file-manager-shell.ts",
  "packages/web/src/capture/annot-capture-progress-toast.ts",
];

for (const rel of FILES) {
  const path = resolve(repoRoot, rel);
  let src = readFileSync(path, "utf8");
  if (!src.includes("builtinIcon(")) continue;

  let changed = false;
  if (!/import\s*\{[^}]*\bbuiltinIcon\b/.test(src)) {
    // Insert after the existing imports block.
    const importBlock = src.match(/^(?:import [^\n]+\n)+/);
    const insertAt = importBlock ? importBlock[0].length : 0;
    src =
      src.slice(0, insertAt) +
      `import { builtinIcon } from "@ingcreators/annot-core";\n` +
      src.slice(insertAt);
    changed = true;
  }

  // Compute relative import for the annot-icon side-effect import.
  // packages/web/src/<somepath>/file.ts → relative path to ../ui/annot-icon.js
  const fileDir = dirname(path);
  const iconModulePath = resolve(repoRoot, "packages/web/src/ui/annot-icon.js");
  let relImport = relative(fileDir, iconModulePath).replace(/\\/g, "/");
  if (!relImport.startsWith(".")) relImport = "./" + relImport;

  if (!src.includes("annot-icon.js")) {
    const importBlock = src.match(/^(?:import [^\n]+\n)+/);
    const insertAt = importBlock ? importBlock[0].length : 0;
    src =
      src.slice(0, insertAt) +
      `import "${relImport}";\n` +
      src.slice(insertAt);
    changed = true;
  }

  if (changed) {
    writeFileSync(path, src, "utf8");
    console.log(`  [imports added] ${rel}`);
  }
}
