// Playwright `productDocs` fixture + standalone `syncProductDocs`
// helper.
//
// Phase 1 PR 3 of `docs/plans/living-product-docs.md`. Renamed
// from `screen` / `captureScreen` in Phase 3 of
// `docs/plans/playwright-screenshot-fixture-relayer.md` — old
// names ship as deprecated back-compat aliases.
//
// Extends the `@ingcreators/annot-playwright` fixture (so callers
// still get `annotator` + the `rectForBoundingBox` / `arrowBetween`
// / `textAt` primitives) with a `productDocs` fixture whose
// `sync(...)` method:
//
//   1. Takes a Playwright `aria-snapshot` of the current page.
//   2. Reads the target MDX file via `parseMdxFile`.
//   3. For each `<Overlay match>` in the file's screen with the
//      matching `id`, collects a whitelist of HTML attributes via
//      `locator.evaluate(...)`.
//   4. Rewrites the MDX file's `annot:snapshot` and
//      `annot:attributes` comment blocks in-place via
//      `updateCommentBlocks`. Authored Markdown / JSX is
//      byte-stable for unchanged regions.
//
// The Playwright wrapping lives in
// `test = annotatorTest.extend(...)`; the actual sync work lives
// in `syncProductDocs(page, opts)` so vitest can drive it with a
// stub `Page` against a temp MDX file without needing a real
// browser.

import { writeFile } from "node:fs/promises";

import { test as annotatorTest } from "@ingcreators/annot-playwright";
import type { Locator, Page } from "@playwright/test";

import { parseMdxFile, updateCommentBlocks } from "./mdx.js";
// Side-effect import: registers the MDX-aware resolver into
// `@ingcreators/annot-playwright`'s `annotSourceResolvers`
// registry + augments `AnnotScreenshotOptions` with `mdx`. Phase 2
// of `docs/plans/playwright-screenshot-fixture-relayer.md` — once
// loaded, `page.screenshot({ annot: { mdx: { id, path } } })`
// runs the refresh + screenshot + bake + write pipeline in a
// single call.
import "./playwright-screenshot-hook.js";
import type { OverlaySpec } from "./types.js";

export interface ProductDocsSyncOptions {
  /** Must match a `<Screen id="...">` JSX block in the MDX file. */
  id: string;
  /** Absolute or cwd-relative path to the `.mdx` file. */
  mdxPath: string;
  /**
   * Override the locator used as the snapshot root. Defaults to
   * the page's `body` element. Useful when the test is scoped to
   * a specific dialog or section.
   */
  rootLocator?: Locator;
  /**
   * Override the HTML attribute whitelist for `annot:attributes`
   * collection. Default is `DEFAULT_ATTR_WHITELIST` — covers the
   * common form-control + accessibility attrs.
   */
  attributeWhitelist?: readonly string[];
}

/**
 * @deprecated Renamed to {@link ProductDocsSyncOptions} in Phase 3
 * of `docs/plans/playwright-screenshot-fixture-relayer.md` for
 * naming clarity (the helper synchronizes the MDX comment blocks
 * with the live UI — it does not take a screenshot). The old name
 * keeps working but new code should use `ProductDocsSyncOptions`.
 */
export type ScreenCaptureOptions = ProductDocsSyncOptions;

export interface ProductDocs {
  sync(opts: ProductDocsSyncOptions): Promise<void>;
}

/**
 * @deprecated Renamed to {@link ProductDocs} in Phase 3 of
 * `docs/plans/playwright-screenshot-fixture-relayer.md`. The old
 * `Screen` name is ambiguous (collides with `@testing-library/react`'s
 * `screen` + reads like a Playwright built-in). New code should
 * use `ProductDocs`.
 */
export type Screen = ProductDocs;

/**
 * HTML attributes captured into the `annot:attributes` block by
 * default. Focused on form-control + accessibility shape — the
 * stuff a screen-specifications spreadsheet / operation manual cares about per element.
 *
 * Hosts can override per-call via `opts.attributeWhitelist`.
 */
export const DEFAULT_ATTR_WHITELIST: readonly string[] = [
  "type",
  "required",
  "placeholder",
  "maxlength",
  "minlength",
  "pattern",
  "min",
  "max",
  "step",
  "disabled",
  "readonly",
  "checked",
  "aria-required",
  "aria-disabled",
  "aria-readonly",
];

/**
 * `test = annotatorTest.extend({ productDocs })` — drop-in for
 * `@playwright/test`'s `test` plus a `productDocs` fixture for
 * the docs flow. Tour files (`tests/docs/*.spec.ts`) import this
 * `test` instead of `@playwright/test`:
 *
 * ```ts
 * import { test } from "@ingcreators/annot-product-docs";
 *
 * test("login flow", async ({ page, productDocs }) => {
 *   await page.goto("/login");
 *   await productDocs.sync({
 *     id: "login",
 *     mdxPath: "docs/books/screen-spec/screens/SC-001-login.mdx",
 *   });
 * });
 * ```
 *
 * For back-compat the same fixture is also exposed as `screen`
 * with a `.capture()` method (deprecated since Phase 3 of the
 * relayer plan; remove after the documented deprecation window).
 */
export const test = annotatorTest.extend<{ productDocs: ProductDocs; screen: ProductDocs }>({
  productDocs: async ({ page }, use) => {
    await use({
      sync: (opts: ProductDocsSyncOptions) => syncProductDocs(page, opts),
    });
  },
  // Deprecated alias. The function literal is necessary because the
  // fixture body cannot reference `productDocs` directly (the
  // Playwright resolver constructs each fixture fresh per test
  // worker). We construct a parallel surface and expose `sync` AND
  // its old name `capture` — same closure either way.
  screen: async ({ page }, use) => {
    const syncFn = (opts: ProductDocsSyncOptions) => syncProductDocs(page, opts);
    await use({ sync: syncFn, capture: syncFn } as ProductDocs & {
      capture: typeof syncFn;
    });
  },
});

/**
 * Standalone sync helper — same behaviour as
 * `productDocs.sync(...)` but takes the `Page` directly.
 * Exported so callers who build their own Playwright fixture
 * (e.g. composing additional fixtures on top) can still drive
 * the docs-sync flow.
 *
 * Idempotent: if `mdxPath` already has `annot:snapshot` /
 * `annot:attributes` blocks, they're replaced in place; if not,
 * they're appended. Files without `annot:` frontmatter throw —
 * the fixture refuses to touch non-annot MDX.
 */
export async function syncProductDocs(page: Page, opts: ProductDocsSyncOptions): Promise<void> {
  const parsed = await parseMdxFile(opts.mdxPath);
  if (!parsed) {
    throw new Error(
      `syncProductDocs: ${opts.mdxPath} has no \`annot:\` frontmatter — refusing to write.`,
    );
  }
  const screen = parsed.screens.find((s) => s.id === opts.id);
  if (!screen) {
    throw new Error(`syncProductDocs: ${opts.mdxPath} has no <Screen id="${opts.id}"> block.`);
  }

  const rootLocator = opts.rootLocator ?? page.locator("body");
  // - `mode: "ai"` includes the `[ref=eN]` markers the resolver
  //   depends on. Default `ariaSnapshot()` (no mode) omits them.
  // - `boxes: true` appends `[box=x,y,w,h]` markers per entry.
  //   The Image Service in `@ingcreators/annot-product-docs-astro`
  //   uses these to position callouts at build time without
  //   re-launching Playwright. Skipping it leaves the captured
  //   snapshot bbox-less and the Astro adapter falls back to
  //   the base PNG verbatim.
  const snapshotYaml = await rootLocator.ariaSnapshot({ mode: "ai", boxes: true });

  const attributesYaml = await collectAttributesYaml(
    page,
    screen.overlays,
    opts.attributeWhitelist ?? DEFAULT_ATTR_WHITELIST,
  );

  const updated = updateCommentBlocks(parsed.source, {
    snapshot: snapshotYaml.trim(),
    attributes: attributesYaml,
  });
  await writeFile(opts.mdxPath, updated, "utf8");
}

/**
 * @deprecated Renamed to {@link syncProductDocs} in Phase 3 of
 * `docs/plans/playwright-screenshot-fixture-relayer.md`. The old
 * name reads as if a screenshot is captured; the function
 * actually synchronizes MDX comment blocks. The deprecated alias
 * is a reference-equality re-export of the new implementation so
 * `===` checks across the rename boundary keep working.
 */
export const captureScreen = syncProductDocs;

/**
 * Walk the overlays in a `<Screen>`, resolve each one's `match`
 * against the live page, and emit a YAML block of the form:
 *
 *   role "Name":
 *     attrA: value
 *     attrB: value
 *
 * Only overlays whose `match` resolves to exactly one element
 * contribute a section. Overlays with zero hits or multiple
 * hits are skipped (the drift detector in Phase 1 PR 4 raises
 * those — duplicating the diagnostic here would be noisy).
 */
export async function collectAttributesYaml(
  page: Page,
  overlays: OverlaySpec[],
  whitelist: readonly string[],
): Promise<string> {
  const lines: string[] = [];
  for (const overlay of overlays) {
    const locator = page.getByRole(overlay.match.role as Parameters<Page["getByRole"]>[0], {
      name: overlay.match.name,
      exact: true,
    });
    if ((await locator.count()) !== 1) continue;
    const attrs = await locator.evaluate((el: Element, names: readonly string[]) => {
      const out: Record<string, string> = {};
      for (const name of names) {
        const v = el.getAttribute(name);
        if (v !== null) out[name] = v;
      }
      return out;
    }, whitelist);
    const keys = Object.keys(attrs);
    if (keys.length === 0) continue;
    lines.push(`${overlay.match.role} "${overlay.match.name}":`);
    for (const key of keys) {
      lines.push(`  ${key}: ${attrs[key]}`);
    }
  }
  return lines.join("\n");
}
