#!/usr/bin/env node
/**
 * Walk every .ts / .html / .css file under packages/ and emit the
 * deduplicated set of glyph names referenced in any of these
 * patterns:
 *
 *   - <span class="material-symbols-outlined …">name</span>  (inline)
 *   - <… class="… material-symbols-outlined …" …>NAME</…>     (multi-line attrs)
 *   - el.textContent = "name"                                  (programmatic)
 *   - icon: "name"                                             (registry data)
 *   - materialIcon: "name"                                     (registry data)
 *
 * Output goes to stdout, one glyph per line, sorted, deduplicated.
 *
 * Used during Phase 2 of `docs/plans/svg-icons-and-plugin-icon-spec.md`
 * to populate the extraction script's GLYPH_NAMES list.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const packagesDir = resolve(repoRoot, "packages");

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "storybook-static") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|html|css)$/.test(entry)) out.push(full);
  }
}

const files = [];
walk(packagesDir, files);

const found = new Set();

for (const file of files) {
  const src = readFileSync(file, "utf8");
  // Pattern 1: inline `<… class="material-symbols-outlined …">NAME<`
  for (const match of src.matchAll(/material-symbols-outlined[^"]*"[^>]*>\s*([a-z][a-z0-9_]*)\s*</g)) {
    found.add(match[1]);
  }
  // Pattern 2: multi-line — `class="…material-symbols-outlined…"` attr
  // followed (eventually) by `>NAME<`. We bound by 800 chars to skip
  // unrelated tags.
  for (const match of src.matchAll(/class="[^"]*material-symbols-outlined[^"]*"[\s\S]{0,800}?>\s*([a-z][a-z0-9_]*)\s*<\/(?:span|button|div)/g)) {
    found.add(match[1]);
  }
  // Pattern 3: textContent assignment.
  for (const match of src.matchAll(/textContent\s*=\s*"([a-z][a-z0-9_]*)"/g)) {
    found.add(match[1]);
  }
  // Pattern 4: explicit icon: "name" / materialIcon: "name"
  for (const match of src.matchAll(/(?:icon|materialIcon):\s*"([a-z][a-z0-9_]*)"/g)) {
    found.add(match[1]);
  }
  // Pattern 5 (template-interpolated glyph names — `${"name"}` after
  // the class) is intentionally skipped: the literal can't be
  // recovered statically. Left documented here so future patterns
  // don't accidentally re-add a noisy / no-op scan.
}

// Filter out non-glyph false positives (English words used as button
// labels via textContent =).
const NOT_GLYPHS = new Set([
  "a", "b", "c", "open", "hi", "cancel", "continue", "ok", "elements", "sticky", "tags", "hello", "projects",
  "name", "summary", "private", "repo", "not", "pt", "malicious",
]);

const sorted = [...found].filter((n) => !NOT_GLYPHS.has(n)).sort();
console.log(sorted.join("\n"));
