// Tour helpers: capture base PNG + aria-snapshot per screen,
// inline the snapshot YAML into every MDX that references the
// screen id under `docs/books/{operation-manual,screen-design}/`.
//
// Replaces the Phase 5 `scripts/capture-shots.mjs` stop-gap.
// Until `@ingcreators/annot-product-docs@0.1.1` republishes
// (#947), this module rolls its own equivalent of the
// upstream `screen.capture` fixture. Two responsibilities:
//
//   1. Snapshot PNGs for the docs site
//      (`docs-site/public/shots/<id>.png`).
//   2. Inline aria-snapshot YAML into every MDX that contains
//      `<Screen id="<id>">` — finds the placeholder
//      `{/* annot:snapshot */}` marker (or a previously-filled
//      block) and rewrites it to the current capture.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SHOTS_DIR = path.resolve(ROOT, "docs-site/public/shots");
const BOOKS_DIR = path.resolve(ROOT, "docs/books");

// Marker pattern: matches both the placeholder ({/* annot:snapshot */})
// and a previously-filled block ({/* annot:snapshot\n<body>\n*/}).
// We replace the entire match with a freshly-filled block.
const SNAPSHOT_MARKER_RE = /\{\/\*\s*annot:snapshot[\s\S]*?\*\/\}/;

export interface CaptureOptions {
  /** Logical screen id — matches `<Screen id="...">` in MDX. */
  readonly id: string;
}

export async function capture(page: Page, options: CaptureOptions): Promise<void> {
  const { id } = options;

  await ensureDir(SHOTS_DIR);
  const shotPath = path.join(SHOTS_DIR, `${id}.png`);
  await page.screenshot({ path: shotPath, fullPage: false });

  // Playwright's aria-snapshot is the canonical match input
  // for `<Overlay match={{ role, name }}>` blocks. We grab the
  // entire body's tree.
  const yaml = await page.locator("body").ariaSnapshot();

  await refreshSnapshotInMdx(id, yaml);
}

async function refreshSnapshotInMdx(id: string, yaml: string): Promise<void> {
  const targets = await findMdxFilesForScreen(id);
  if (targets.length === 0) {
    // Not every screen id has a matching MDX (the SPA might
    // have transient routes). Skip silently rather than fail
    // the tour.
    return;
  }
  const block = formatSnapshotBlock(id, yaml);
  for (const file of targets) {
    const raw = await fs.readFile(file, "utf8");
    if (!SNAPSHOT_MARKER_RE.test(raw)) {
      // MDX lacks a snapshot marker — append one at end of file.
      const next = `${raw.replace(/\s*$/, "")}\n\n${block}\n`;
      await fs.writeFile(file, next);
      continue;
    }
    const next = raw.replace(SNAPSHOT_MARKER_RE, block);
    if (next !== raw) {
      await fs.writeFile(file, next);
    }
  }
}

function formatSnapshotBlock(id: string, yaml: string): string {
  // Strip a leading "- " from Playwright's yaml output if
  // present so the inlined block reads cleanly.
  const body = yaml.trim();
  return [
    "{/* annot:snapshot",
    `id: ${id}`,
    "capturedBy: workflow-app-tour",
    `capturedAt: ${new Date().toISOString()}`,
    "---",
    body,
    "*/}",
  ].join("\n");
}

async function findMdxFilesForScreen(id: string): Promise<string[]> {
  const entries = await walk(BOOKS_DIR);
  const matching: string[] = [];
  for (const file of entries) {
    if (!file.endsWith(".mdx")) continue;
    const raw = await fs.readFile(file, "utf8");
    if (raw.includes(`<Screen id="${id}"`)) {
      matching.push(file);
    }
  }
  return matching;
}

async function walk(dir: string): Promise<string[]> {
  let out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(await walk(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}
