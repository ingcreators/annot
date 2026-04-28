#!/usr/bin/env node
/**
 * One-shot migration helper for Phase 4 of
 * `docs/plans/svg-icons-and-plugin-icon-spec.md`. Rewrites
 * `<span class="material-symbols-outlined">name</span>`
 * call-sites onto `<annot-icon .spec=${builtinIcon("name")}>`
 * across a fixed file list.
 *
 * Usage: `node scripts/migrate-icon-callsites.mjs`
 *
 * The script is idempotent — files already migrated are left
 * unchanged. After the bulk pass, hand-fix any oddities the
 * regex couldn't handle (mixed classes, `${expr}`-driven names,
 * etc.).
 *
 * Safe-by-construction: the script only operates on files in
 * the explicit FILES list and only on the specific patterns
 * below. Anything it doesn't recognise is left alone.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Files to migrate. Excludes test files (snapshots regenerate
// themselves) and the registry / sanitiser / renderer / element /
// stories themselves.
const FILES = [
  // packages/web/src/editor/
  "packages/web/src/editor/right-panel.ts",
  "packages/web/src/editor/editor-header.ts",
  "packages/web/src/editor/editor-statusbar.ts",
  "packages/web/src/editor/keyboard-help.ts",
  "packages/web/src/editor/toolbar.ts",
  "packages/web/src/editor/tool-property-renderer.ts",
  "packages/web/src/editor/annot-toolbar.ts",
  "packages/web/src/editor/annot-tool-flyout.ts",
  "packages/web/src/editor/annot-file-details-drawer.ts",
  "packages/web/src/editor/annot-scratchpad-section.ts",
  "packages/web/src/editor/drawer-sections/external-links-section.ts",
  "packages/web/src/editor/right-panel-sections/annot-page-elements-section.ts",
  // packages/web/src/gallery/
  "packages/web/src/gallery/sidebar.ts",
  "packages/web/src/gallery/annot-gallery-page.ts",
  "packages/web/src/gallery/file-manager-shell.ts",
  "packages/web/src/gallery/annot-context-menu.ts",
  // packages/web/src/capture/ + ui/ + app/
  "packages/web/src/capture/annot-capture-progress-toast.ts",
  "packages/web/src/ui/error-bar.ts",
  "packages/web/src/app.ts",
  // packages/editor/
  "packages/editor/src/property-controls.ts",
  "packages/editor/src/property-panel-renderer.ts",
  "packages/editor/src/canvas-context-menu.ts",
  "packages/editor/src/custom-select.ts",
  "packages/editor/src/theme-toggle.ts",
];

let totalReplaced = 0;
let totalFiles = 0;

for (const rel of FILES) {
  const path = resolve(repoRoot, rel);
  let src;
  try {
    src = readFileSync(path, "utf8");
  } catch {
    console.warn(`  [skip] ${rel} — not found`);
    continue;
  }
  const before = src;

  // Pattern 1: single-line `<span class="material-symbols-outlined">name</span>`
  src = src.replace(
    /<span class="material-symbols-outlined">([a-z][a-z0-9_]*)<\/span>/g,
    (_m, name) => `<annot-icon .spec=\${builtinIcon("${name}")}></annot-icon>`,
  );

  // Pattern 2: single-line with ADDITIONAL classes
  src = src.replace(
    /<span class="([^"]*?)material-symbols-outlined([^"]*?)">([a-z][a-z0-9_]*)<\/span>/g,
    (_m, before, after, name) => {
      const cls = `${before}${after}`.replace(/\s+/g, " ").trim();
      const classAttr = cls ? ` class="${cls}"` : "";
      return `<annot-icon${classAttr} .spec=\${builtinIcon("${name}")}></annot-icon>`;
    },
  );

  // Pattern 3: single-line with reversed class order (… material-symbols-outlined CLS)
  // already covered by Pattern 2's bidirectional match.

  // Pattern 4: single-line `<span class="… material-symbols-outlined" data-tooltip="…" aria-label="…">name</span>`
  src = src.replace(
    /<span class="([^"]*?)material-symbols-outlined([^"]*?)"\s+([^>]+?)>([a-z][a-z0-9_]*)<\/span>/g,
    (_m, before, after, attrs, name) => {
      const cls = `${before}${after}`.replace(/\s+/g, " ").trim();
      const classAttr = cls ? ` class="${cls}"` : "";
      return `<annot-icon${classAttr} ${attrs} .spec=\${builtinIcon("${name}")}></annot-icon>`;
    },
  );

  // Pattern 5: multi-line button — `<button class="toolbar-btn material-symbols-outlined" …attrs… >NAME</button>`
  // Replaced by `<button class="toolbar-btn" …attrs…><annot-icon .spec=${builtinIcon("NAME")}></annot-icon></button>`
  src = src.replace(
    /<button\s+([\s\S]*?class="(?:[^"]*?)material-symbols-outlined(?:[^"]*?)"[\s\S]*?)>\s*([a-z][a-z0-9_]*)\s*<\/button>/g,
    (_m, attrs, name) => {
      // Strip `material-symbols-outlined` from class attribute,
      // collapse whitespace, drop the class attr if it became
      // empty (rare).
      const newAttrs = attrs.replace(
        /class="([^"]*)"/,
        (_a, cls) => {
          const reduced = cls.replace(/\bmaterial-symbols-outlined\b/, "").replace(/\s+/g, " ").trim();
          return reduced ? `class="${reduced}"` : "";
        },
      );
      return `<button ${newAttrs.trim()}>\n            <annot-icon .spec=\${builtinIcon("${name}")}></annot-icon>\n          </button>`;
    },
  );

  if (src !== before) {
    const replacements = (before.match(/material-symbols-outlined/g) ?? []).length -
      (src.match(/material-symbols-outlined/g) ?? []).length;
    writeFileSync(path, src, "utf8");
    console.log(`  [migrated] ${rel} (~${replacements} sites)`);
    totalReplaced += replacements;
    totalFiles += 1;
  } else {
    console.log(`  [unchanged] ${rel}`);
  }
}

console.log(`\nDone. ${totalFiles} files updated, ~${totalReplaced} call-sites migrated.`);
console.log(`Hand-check residuals: grep -rEn 'material-symbols-outlined' packages/web packages/editor`);
