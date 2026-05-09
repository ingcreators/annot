/**
 * `injectDocumentStyles(doc)` — Phase 2 of
 * `docs/plans/annot-html-document.md`.
 *
 * Returns a new `AnnotDocument` whose `styleBlock` carries a
 * canonical CSS payload covering: logical font-family stacks
 * (delegated to `@ingcreators/annot-core`'s
 * [multilingual-fonts-os-stack plan](../../../docs/plans/_done/multilingual-fonts-os-stack.md)),
 * base typography, per-block rules, callout tones, print rules,
 * and (for `theme === "auto"`) a `prefers-color-scheme: dark`
 * branch.
 *
 * Pure: no DOM dependency, no I/O. The output is the inner content
 * of the `<style>` element the serializer writes — see
 * `serialize.ts` for the wrapping (the `<style>` opaque-content
 * rule keeps round-trip byte-equivalence).
 *
 * Doc-property → CSS variable mapping:
 *
 * - `meta.maxWidth` (`narrow` / `medium` / `wide` / `full`)
 *   → `--annot-doc-max-width`.
 * - `meta.theme` (`auto` / `light` / `dark`):
 *   - `auto` (default): light vars at top + `@media
 *     (prefers-color-scheme: dark)` overrides.
 *   - `light`: light vars only; no dark branch.
 *   - `dark`: dark vars at top; no `prefers-color-scheme`
 *     branch.
 */

import { cssStackFor } from "@ingcreators/annot-core/headless";
import type { AnnotDocument, DocMeta } from "./types.js";

/** CSS values for each `meta.maxWidth` keyword. */
const MAX_WIDTH_VALUES: Readonly<Record<NonNullable<DocMeta["maxWidth"]>, string>> = {
  narrow: "600px",
  medium: "720px",
  wide: "960px",
  full: "100%",
};

/** Light-mode CSS custom property values. */
const LIGHT_VARS: ReadonlyArray<readonly [string, string]> = [
  ["--annot-doc-bg", "#ffffff"],
  ["--annot-doc-fg", "#1f2937"],
  ["--annot-doc-muted", "#6b7280"],
  ["--annot-doc-accent", "#2563eb"],
  ["--annot-doc-code-bg", "#f3f4f6"],
  ["--annot-doc-callout-info-bg", "#eff6ff"],
  ["--annot-doc-callout-info-border", "#2563eb"],
  ["--annot-doc-callout-warn-bg", "#fef3c7"],
  ["--annot-doc-callout-warn-border", "#d97706"],
  ["--annot-doc-callout-note-bg", "#f3f4f6"],
  ["--annot-doc-callout-note-border", "#6b7280"],
];

/** Dark-mode CSS custom property values (same key set as `LIGHT_VARS`). */
const DARK_VARS: ReadonlyArray<readonly [string, string]> = [
  ["--annot-doc-bg", "#111827"],
  ["--annot-doc-fg", "#f9fafb"],
  ["--annot-doc-muted", "#9ca3af"],
  ["--annot-doc-accent", "#60a5fa"],
  ["--annot-doc-code-bg", "#1f2937"],
  ["--annot-doc-callout-info-bg", "#1e3a8a"],
  ["--annot-doc-callout-info-border", "#60a5fa"],
  ["--annot-doc-callout-warn-bg", "#78350f"],
  ["--annot-doc-callout-warn-border", "#fbbf24"],
  ["--annot-doc-callout-note-bg", "#1f2937"],
  ["--annot-doc-callout-note-border", "#9ca3af"],
];

/** Returns a new document with `styleBlock` set to canonical CSS.
 *  Idempotent: re-running replaces the previous styleBlock. */
export function injectDocumentStyles(doc: AnnotDocument): AnnotDocument {
  return { ...doc, styleBlock: buildStyleBlock(doc) };
}

/** Build the canonical inner CSS for the doc-style block. Pure. */
export function buildStyleBlock(doc: AnnotDocument): string {
  const maxWidthKey = doc.meta.maxWidth ?? "medium";
  const maxWidth = MAX_WIDTH_VALUES[maxWidthKey];
  const theme = doc.meta.theme ?? "auto";

  const sections: string[] = [];
  sections.push(rootSection(maxWidth, theme));
  sections.push(fontFamilyRules());
  sections.push(typographyRules());
  sections.push(blockRules());
  sections.push(inlineRules());
  sections.push(printRules());
  if (theme === "auto") {
    sections.push(darkModeRules());
  }
  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function rootSection(maxWidth: string, theme: "auto" | "light" | "dark"): string {
  const vars = theme === "dark" ? DARK_VARS : LIGHT_VARS;
  const lines = vars.map(([name, value]) => `  ${name}: ${value};`);
  // `--annot-doc-max-width` is independent of theme; emit alongside.
  lines.unshift(`  --annot-doc-max-width: ${maxWidth};`);
  return `:root {\n${lines.join("\n")}\n}`;
}

function fontFamilyRules(): string {
  // Logical font-family resolution. The selectors mirror the SVG
  // export path's `injectLogicalFontStyles` so the same documents
  // render with the same OS font-stack regardless of which side
  // (HTML doc vs. embedded SVG) is doing the resolution.
  const stacks = [
    `[data-font-family="Annot Sans"] { font-family: ${cssStackFor("Annot Sans")}; }`,
    `[data-font-family="Annot Serif"] { font-family: ${cssStackFor("Annot Serif")}; }`,
    `[data-font-family="Annot Mono"] { font-family: ${cssStackFor("Annot Mono")}; }`,
  ];
  return stacks.join("\n");
}

function typographyRules(): string {
  const sansStack = cssStackFor("Annot Sans");
  return [
    "html, body {",
    "  margin: 0;",
    "  padding: 0;",
    "  background: var(--annot-doc-bg);",
    "  color: var(--annot-doc-fg);",
    `  font-family: ${sansStack};`,
    "  line-height: 1.6;",
    "  font-size: 16px;",
    "}",
    "article[data-annot-doc] {",
    "  max-width: var(--annot-doc-max-width);",
    "  margin: 0 auto;",
    "  padding: 2rem 1rem;",
    "}",
  ].join("\n");
}

function blockRules(): string {
  const monoStack = cssStackFor("Annot Mono");
  return [
    // Headings
    '[data-annot-block="heading"][data-level="1"] {',
    "  font-size: 2rem;",
    "  font-weight: 700;",
    "  line-height: 1.2;",
    "  margin: 2rem 0 1rem;",
    "}",
    '[data-annot-block="heading"][data-level="2"] {',
    "  font-size: 1.5rem;",
    "  font-weight: 700;",
    "  line-height: 1.3;",
    "  margin: 1.5rem 0 0.75rem;",
    "}",
    '[data-annot-block="heading"][data-level="3"] {',
    "  font-size: 1.25rem;",
    "  font-weight: 600;",
    "  line-height: 1.4;",
    "  margin: 1.25rem 0 0.5rem;",
    "}",
    // Paragraph
    '[data-annot-block="paragraph"] {',
    "  margin: 0.75rem 0;",
    "}",
    // List
    '[data-annot-block="list"] {',
    "  margin: 0.75rem 0;",
    "  padding-left: 1.5rem;",
    "}",
    '[data-annot-block="list"] > li {',
    "  margin: 0.25rem 0;",
    "}",
    // Code
    '[data-annot-block="code"] {',
    "  background: var(--annot-doc-code-bg);",
    "  border-radius: 4px;",
    "  padding: 0.75rem 1rem;",
    "  margin: 1rem 0;",
    "  overflow-x: auto;",
    `  font-family: ${monoStack};`,
    "  font-size: 0.9rem;",
    "  line-height: 1.5;",
    "}",
    // Quote
    '[data-annot-block="quote"] {',
    "  margin: 1rem 0;",
    "  padding: 0.5rem 1rem;",
    "  border-left: 4px solid var(--annot-doc-muted);",
    "  color: var(--annot-doc-muted);",
    "}",
    '[data-annot-block="quote"] p {',
    "  margin: 0.5rem 0;",
    "}",
    // Callout
    '[data-annot-block="callout"] {',
    "  margin: 1rem 0;",
    "  padding: 0.75rem 1rem;",
    "  border-radius: 4px;",
    "  border-left: 4px solid;",
    "}",
    '[data-annot-block="callout"][data-tone="info"] {',
    "  background: var(--annot-doc-callout-info-bg);",
    "  border-left-color: var(--annot-doc-callout-info-border);",
    "}",
    '[data-annot-block="callout"][data-tone="warn"] {',
    "  background: var(--annot-doc-callout-warn-bg);",
    "  border-left-color: var(--annot-doc-callout-warn-border);",
    "}",
    '[data-annot-block="callout"][data-tone="note"] {',
    "  background: var(--annot-doc-callout-note-bg);",
    "  border-left-color: var(--annot-doc-callout-note-border);",
    "}",
    '[data-annot-block="callout"] p {',
    "  margin: 0.25rem 0;",
    "}",
    // Divider
    '[data-annot-block="divider"] {',
    "  border: none;",
    "  border-top: 1px solid var(--annot-doc-muted);",
    "  margin: 2rem 0;",
    "}",
    // Image (figure with embedded SVG)
    '[data-annot-block="image"] {',
    "  margin: 1.5rem 0;",
    "}",
    '[data-annot-block="image"] svg {',
    "  width: 100%;",
    "  height: auto;",
    "  display: block;",
    "}",
    '[data-annot-block="image"] figcaption {',
    "  font-size: 0.9rem;",
    "  color: var(--annot-doc-muted);",
    "  margin-top: 0.5rem;",
    "  text-align: center;",
    "}",
  ].join("\n");
}

function inlineRules(): string {
  const monoStack = cssStackFor("Annot Mono");
  return [
    "a {",
    "  color: var(--annot-doc-accent);",
    "  text-decoration: underline;",
    "}",
    // Inline code (NOT the `code` block kind — that's `<pre><code>`)
    "p code, li code, blockquote code, aside code, h1 code, h2 code, h3 code, figcaption code {",
    `  font-family: ${monoStack};`,
    "  font-size: 0.9em;",
    "  background: var(--annot-doc-code-bg);",
    "  padding: 0.1em 0.3em;",
    "  border-radius: 3px;",
    "}",
    "strong { font-weight: 700; }",
    "em { font-style: italic; }",
    "u { text-decoration: underline; }",
  ].join("\n");
}

function printRules(): string {
  return [
    "@media print {",
    "  html, body {",
    "    background: white;",
    "    color: black;",
    "  }",
    "  article[data-annot-doc] {",
    "    max-width: none;",
    "    padding: 0;",
    "  }",
    '  [data-annot-block="image"] {',
    "    break-inside: avoid;",
    "  }",
    '  [data-annot-block="heading"] {',
    "    break-after: avoid-page;",
    "  }",
    "}",
  ].join("\n");
}

function darkModeRules(): string {
  const lines = DARK_VARS.map(([name, value]) => `    ${name}: ${value};`);
  return ["@media (prefers-color-scheme: dark) {", "  :root {", ...lines, "  }", "}"].join("\n");
}
