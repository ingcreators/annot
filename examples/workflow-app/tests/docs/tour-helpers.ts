// Tour helpers — captures a screen for both books in one step.
//
// Uses the unified `page.screenshot({ annot: { mdx: { id, path } } })`
// API from `@ingcreators/annot-product-docs-astro/playwright`,
// which in a single Playwright call:
//
//   1. Writes the base PNG to `path` (in `docs-site/public/shots/`).
//   2. Refreshes the MDX `annot:snapshot` + `annot:attributes`
//      comment blocks via upstream `captureScreen`.
//   3. Bakes the MDX `<Overlay match>` blocks into the PNG as
//      editable SVG annotations stored in an XMP chunk — drop
//      the resulting `.png` into Annot Cloud (`annot.work/app/`)
//      and the overlays come back editable.
//
// Each screen maps to one MDX per book. The MDX update happens
// per-call, so we loop the lookup table and call screenshot once
// per (screen, mdx) pair. The PNG path is the same on each
// iteration — the second write overwrites the first with the
// same image bytes plus updated XMP tags reflecting the
// later-walked overlay set, which is harmless when both books
// declare overlays at the same coordinates.

import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SHOTS_DIR = path.resolve(ROOT, "docs-site/public/shots");
const BOOKS_DIR = path.resolve(ROOT, "docs/books");

// Per-screen lookup table — explicit (rather than glob) so a
// typo'd id fails fast at tour time.
const SCREEN_TO_MDX: Record<string, ReadonlyArray<string>> = {
  login: [
    path.join(BOOKS_DIR, "operation-manual/OM-001-login.mdx"),
    path.join(BOOKS_DIR, "screen-design/SD-001-login.mdx"),
  ],
  "menu-applicant": [
    path.join(BOOKS_DIR, "operation-manual/OM-002-menu-applicant.mdx"),
    path.join(BOOKS_DIR, "screen-design/SD-002-menu.mdx"),
  ],
  "application-form": [
    path.join(BOOKS_DIR, "operation-manual/OM-003-application-form.mdx"),
    path.join(BOOKS_DIR, "screen-design/SD-003-application-form.mdx"),
  ],
  "application-confirm": [
    path.join(BOOKS_DIR, "operation-manual/OM-004-application-confirm.mdx"),
    path.join(BOOKS_DIR, "screen-design/SD-004-application-confirm.mdx"),
  ],
  "application-submitted": [
    path.join(BOOKS_DIR, "operation-manual/OM-005-application-submitted.mdx"),
    path.join(BOOKS_DIR, "screen-design/SD-005-application-submitted.mdx"),
  ],
  "menu-approver": [
    path.join(BOOKS_DIR, "operation-manual/OM-006-menu-approver.mdx"),
    // SD-002 already covers menu via the applicant variant; the
    // approver variant is documented inline in the same file.
  ],
  "approval-list": [
    path.join(BOOKS_DIR, "operation-manual/OM-007-approval-list.mdx"),
    path.join(BOOKS_DIR, "screen-design/SD-006-approval-list.mdx"),
  ],
  "approval-detail": [
    path.join(BOOKS_DIR, "operation-manual/OM-008-approval-detail.mdx"),
    path.join(BOOKS_DIR, "screen-design/SD-007-approval-detail.mdx"),
  ],
  "approval-decided": [
    path.join(BOOKS_DIR, "operation-manual/OM-009-approval-decided.mdx"),
    path.join(BOOKS_DIR, "screen-design/SD-008-approval-decided.mdx"),
  ],
};

export interface CaptureOptions {
  /** Logical screen id — matches `<Screen id="...">` in MDX. */
  readonly id: string;
}

/**
 * Capture one screen for every MDX in the lookup table.
 *
 * Writes a single `<id>.png` (each book uses the same base
 * screenshot) and updates each MDX's `annot:snapshot` /
 * `annot:attributes` comment blocks via the upstream
 * `page.screenshot({ annot: { mdx } })` interceptor.
 */
export async function capture(page: Page, options: CaptureOptions): Promise<void> {
  const targets = SCREEN_TO_MDX[options.id];
  if (!targets) {
    throw new Error(
      `capture: no MDX targets known for screen id "${options.id}". ` +
        "Add an entry to SCREEN_TO_MDX in tests/docs/tour-helpers.ts.",
    );
  }
  const shotPath = path.join(SHOTS_DIR, `${options.id}.png`);
  for (const mdxPath of targets) {
    await page.screenshot({
      path: shotPath,
      annot: { mdx: { id: options.id, path: mdxPath } },
    });
  }
}
