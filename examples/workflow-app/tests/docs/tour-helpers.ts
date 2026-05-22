// Tour helpers — captures a screen for both books in one step.
//
// Combines:
//   1. `page.screenshot()` — writes the base PNG into
//      `docs-site/public/shots/<id>.png`.
//   2. `captureScreen()` from `@ingcreators/annot-product-docs` —
//      refreshes the MDX `annot:snapshot` + `annot:attributes`
//      comment blocks for the screen, per book.
//
// The upstream `@ingcreators/annot-product-docs-astro/playwright`
// subpath ships a one-call `page.screenshot({ annot: { mdx } })`
// API that does all three steps at once, but its 0.2.0 publish
// is missing the compiled `dist/playwright/index.js` (a separate
// publish-pipeline bug from the prepack one fixed in #947 —
// vite.config.ts's `lib.entry` is single-entry only and never
// emits the subpath bundle). A follow-up PR fixes the vite
// config + ships 0.2.1; once that lands, this whole module
// collapses to one call per (screen, mdx) pair.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { captureScreen } from "@ingcreators/annot-product-docs";
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
 * screenshot) plus updates each MDX's `annot:snapshot` /
 * `annot:attributes` comment blocks via the upstream
 * `captureScreen` helper.
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
  await page.screenshot({ path: shotPath, fullPage: false });
  for (const mdxPath of targets) {
    await captureScreen(page, { id: options.id, mdxPath });
  }
}
