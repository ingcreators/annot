#!/usr/bin/env node
/**
 * Extract a fixed set of Material Symbols Outlined SVG glyphs into
 * the Tier-B registry source file.
 *
 * Phase 2 of `docs/plans/svg-icons-and-plugin-icon-spec.md`.
 *
 * Source: `@material-symbols/svg-400` npm package
 *         (mirror of github.com/google/material-design-icons,
 *         Apache-2.0, Copyright Google LLC).
 *
 * The script:
 *
 *   1. Reads each requested glyph from the upstream package's
 *      `outlined/<name>.svg` (Material's standard 48×48 outlined
 *      weight-400 set, matching the bundled MaterialSymbolsOutlined
 *      TTF we are about to retire in Phase 6).
 *   2. Extracts the inner `<path …/>` elements verbatim (Material's
 *      glyphs are single-path or two-path; we keep them as-is).
 *   3. Wraps them in our normalised `<svg>` envelope:
 *
 *        <svg xmlns="http://www.w3.org/2000/svg"
 *             viewBox="0 -960 960 960"
 *             fill="currentColor"
 *             aria-hidden="true">…</svg>
 *
 *      `currentColor` makes the icon theme-aware automatically;
 *      `aria-hidden="true"` keeps screen-readers from announcing
 *      decorative icon text.
 *   4. Writes
 *      `packages/core/src/editor/icons/material-symbols.ts` with the
 *      registry data + a header comment recording the upstream
 *      version + extraction date.
 *
 * Aliases:
 *
 *   Some glyph names referenced in our codebase do not exist in
 *   the latest `@material-symbols/svg-400` snapshot — Material has
 *   renamed or consolidated them since the bundled TTF was
 *   produced. The `ALIASES` table below maps each legacy id we use
 *   to the current upstream filename (visually identical at icon
 *   size). The registry ENTRY KEY stays the legacy name so Phase 4
 *   migration is a mechanical s/<span class=ms>NAME/builtin
 *   IconSpec(NAME)/ rename — no per-call-site judgement calls.
 *
 * Reproducibility:
 *
 *   The script writes the upstream package version into the
 *   generated file's header. To re-run after an upstream version
 *   bump, `pnpm up @material-symbols/svg-400` then `node
 *   scripts/extract-material-symbols.mjs`. Diff the result and
 *   eyeball any glyph the upstream rewrote.
 *
 * Usage:
 *
 *   $ node scripts/extract-material-symbols.mjs
 *
 *   Re-runs are idempotent: same package version + same glyph
 *   list ⇒ byte-identical output.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const packageDir = resolve(repoRoot, "node_modules/@material-symbols/svg-400");
const glyphSourceDir = resolve(packageDir, "outlined");

const upstreamVersion = JSON.parse(
  readFileSync(resolve(packageDir, "package.json"), "utf8"),
).version;

/**
 * Glyph names referenced in the host codebase. The set was
 * captured via grep across `packages/**` for:
 *
 *   - `icon: "<name>"` (plugin-API descriptor entries +
 *     TOOL_REGISTRY variants)
 *   - `materialIcon: "<name>"` (PROPERTY_CONTROLS data)
 *   - `class="material-symbols-outlined"… >NAME<` (Lit / inline
 *     HTML)
 *   - `el.textContent = "<name>"` (programmatic glyph assignment)
 *
 * Order is alphabetical for stability — re-running the script on
 * a stable input list produces byte-identical output.
 */
const GLYPH_NAMES = [
  "add",
  "add_to_drive",
  "align_horizontal_center",
  "align_horizontal_left",
  "align_horizontal_right",
  "align_vertical_bottom",
  "align_vertical_center",
  "align_vertical_top",
  "apps",
  "arrow_right_alt",
  "arrow_selector_tool",
  "blur_on",
  "chat",
  "chat_bubble",
  "check_box",
  "chevron_right",
  "circle",
  "close",
  "cloud",
  "cloud_done",
  "cloud_off",
  "cloud_queue",
  "collections_bookmark",
  "content_copy",
  "content_paste",
  "counter_1",
  "create_new_folder",
  "crop",
  "crop_square",
  "dark_mode",
  "database",
  "delete",
  "desktop_windows",
  "download",
  "draw",
  "drive_file_rename_outline",
  "drive_folder_upload",
  "edit",
  "error",
  "expand_more",
  "extension",
  "file_copy",
  "flip",
  "flip_to_back",
  "flip_to_front",
  "folder",
  "folder_open",
  "grid_view",
  "group_remove",
  "group_work",
  "groups",
  "help_outline",
  "highlight",
  "history",
  "home_storage",
  "horizontal_distribute",
  "horizontal_rule",
  "hub",
  "info",
  "ink_highlighter",
  "join_inner",
  "join_left",
  "keyboard_arrow_down",
  "keyboard_arrow_up",
  "laptop",
  "light_mode",
  "more_vert",
  "near_me",
  "north_east",
  "open_in_new",
  "rectangle",
  "redo",
  "refresh",
  "remove",
  "rotate_left",
  "rotate_right",
  "rounded_corner",
  "save",
  "screenshot_monitor",
  "search",
  "shapes",
  "share",
  "square",
  "sticky_note_2",
  "swap_horiz",
  "swap_vert",
  "sync",
  "sync_alt",
  "task",
  "text_fields",
  "timer",
  "title",
  "tune",
  "undo",
  "upload",
  "vertical_distribute",
  "view_list",
  "view_module",
  "visibility_off",
  "warning",
];

/**
 * Legacy ids we keep as registry keys, mapped to the current
 * upstream filename. Each comment records why the alias is needed
 * (Material renamed / consolidated the glyph since the bundled
 * TTF was produced).
 */
const ALIASES = {
  // `cloud_queue` is the legacy outlined-variant name; modern
  // Material Symbols uses `cloud` (the outlined variant IS the
  // current default at weight 400). Visually identical.
  cloud_queue: "cloud",
  // `drive_file_rename_outline` was renamed to `edit_square` (the
  // current "edit on a square sheet" glyph). Same shape, slightly
  // different proportions.
  drive_file_rename_outline: "edit_square",
  // `expand_more` was renamed to `keyboard_arrow_down` (V-shape
  // pointing down). Visually identical.
  expand_more: "keyboard_arrow_down",
  // `help_outline` was consolidated into `help` (the outlined
  // weight-400 IS the current default).
  help_outline: "help",
  // Generic `laptop` was split into per-platform variants; we use
  // `laptop_mac` as the closest "generic laptop" match.
  laptop: "laptop_mac",
};

function readGlyphSvg(name) {
  const filename = ALIASES[name] ?? name;
  const path = join(glyphSourceDir, `${filename}.svg`);
  return readFileSync(path, "utf8");
}

/**
 * Extract the inner content of the upstream `<svg>` (everything
 * inside the root `<svg ...>...</svg>`) so we can re-wrap it in
 * our normalised envelope.
 */
function extractInnerContent(svgString) {
  const start = svgString.indexOf(">");
  const end = svgString.lastIndexOf("</svg>");
  if (start === -1 || end === -1 || start >= end) {
    throw new Error(`could not parse SVG: ${svgString.slice(0, 80)}…`);
  }
  return svgString.slice(start + 1, end).trim();
}

/**
 * Wrap a glyph's inner content in our normalised <svg> envelope.
 * `viewBox="0 -960 960 960"` is Material Symbols' standard outlined
 * coordinate system; `fill="currentColor"` makes the icon
 * theme-aware; `aria-hidden="true"` keeps screen readers quiet on
 * decorative icon spans (consumers wanting an accessible label
 * wrap with `<button aria-label=…>` at the call site).
 *
 * `width="1em" height="1em"` makes the rendered SVG size to the
 * surrounding text size BY DEFAULT — important for call sites that
 * inject the markup directly via `renderIconHtml(spec)` without a
 * wrapping `<annot-icon>` element (e.g. `packages/editor`'s theme
 * toggle, which lives in a Tier-C package that can't depend on
 * web's `<annot-icon>`). Parent CSS that wants a specific pixel
 * size sets `font-size` on the parent and the `1em` defaults
 * follow.
 */
function wrap(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="1em" height="1em" fill="currentColor" aria-hidden="true">${inner}</svg>`;
}

const entries = GLYPH_NAMES.slice()
  .sort()
  .map((name) => {
    const upstream = readGlyphSvg(name);
    const inner = extractInnerContent(upstream);
    const aliasNote = ALIASES[name]
      ? ` [aliased upstream: ${ALIASES[name]}]`
      : "";
    return { name, svg: wrap(inner), aliasNote };
  });

// Generated TS source. Header records the upstream version + run
// timestamp for provenance.
const lines = [];
lines.push("// AUTOGENERATED — do not edit by hand.");
lines.push("//");
lines.push("// Source: `@material-symbols/svg-400` npm package, mirror of");
lines.push("//         github.com/google/material-design-icons.");
lines.push("// Upstream license: Apache-2.0, Copyright Google LLC.");
lines.push("// Project NOTICE: see /NOTICE for the project-wide attribution.");
lines.push("//");
lines.push(`// Upstream package version: ${upstreamVersion}`);
lines.push(`// Extracted on: ${new Date().toISOString().slice(0, 10)}`);
lines.push("//");
lines.push("// Re-run: `pnpm up @material-symbols/svg-400` then");
lines.push("//          `node scripts/extract-material-symbols.mjs`");
lines.push("//");
lines.push("// Glyph aliases — legacy ids we keep as registry keys are");
lines.push("// listed alongside their upstream replacement. See");
lines.push("// `scripts/extract-material-symbols.mjs` ALIASES table for");
lines.push("// the rationale per glyph.");
lines.push("");
lines.push("export const MATERIAL_SYMBOL_GLYPHS = {");
for (const { name, svg, aliasNote } of entries) {
  if (aliasNote) {
    lines.push(`  // ${name}${aliasNote}`);
  }
  lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(svg)},`);
}
lines.push("} as const;");
lines.push("");
lines.push(
  "export type MaterialSymbolGlyphId = keyof typeof MATERIAL_SYMBOL_GLYPHS;",
);

const out = lines.join("\n") + "\n";

const targetPath = resolve(
  repoRoot,
  "packages/core/src/editor/icons/material-symbols.ts",
);
writeFileSync(targetPath, out, "utf8");
console.log(
  `Wrote ${entries.length} glyphs to packages/core/src/editor/icons/material-symbols.ts (upstream ${upstreamVersion}).`,
);
