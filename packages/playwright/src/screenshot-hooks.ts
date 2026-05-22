// `page.screenshot({ annot: { … } })` hook registry.
//
// Phase 1 of `docs/plans/playwright-screenshot-fixture-relayer.md`.
//
// `@ingcreators/annot-playwright` owns the `Page.prototype.screenshot`
// / `Locator.prototype.screenshot` interception primitive plus the
// generic `overlays` / `tags` / `editable` handling. Other packages
// (e.g. `@ingcreators/annot-product-docs` for MDX, hypothetical
// Figma / Sentry adapters) extend the surface by pushing a resolver
// into the module-level `annotSourceResolvers` registry exported
// here. annot-playwright stays MDX-unaware — it only knows about
// the generic fields above; extra `annot.*` fields opt resolvers
// in.
//
// `AnnotScreenshotOptions` is the base interface — it lives here so
// downstream packages can `declare module "@ingcreators/annot-playwright"
// { interface AnnotScreenshotOptions { mdx?: { … } } }` to layer in
// new fields without touching the runtime patch.

import type { BboxAnnotation } from "@ingcreators/annot-annotator";
import type { Locator, Page } from "@playwright/test";

/**
 * Idempotency guard for the prototype patch — checked + set inside
 * `patchScreenshot`. `Symbol.for(...)` cross-module realm-stable so
 * re-importing annot-playwright in the same worker process picks up
 * the existing patch instead of double-wrapping.
 */
export const ANNOT_PATCHED = Symbol.for("@ingcreators/annot:screenshot-patched");

/**
 * Compositional options for `page.screenshot({ annot })` /
 * `locator.screenshot({ annot })`. Each known field is an
 * independent contribution to the output:
 *
 * - `overlays` — inline `BboxAnnotation[]` (the DSL accepted by
 *                `@ingcreators/annot-annotator`)
 * - `tags`     — provenance metadata written verbatim into the XMP
 * - `editable` — bake-vs-preserve toggle (default `true`)
 *
 * Extra fields (e.g. `mdx`, future `figma`) are claimed by resolvers
 * registered in [`annotSourceResolvers`](#annotSourceResolvers).
 * Downstream packages declare those fields via TypeScript module
 * augmentation:
 *
 * ```ts
 * declare module "@ingcreators/annot-playwright" {
 *   interface AnnotScreenshotOptions {
 *     mdx?: { id: string; path: string };
 *   }
 * }
 * ```
 *
 * `annot: true` / `annot: {}` is treated as a no-op shorthand — the
 * patch detects no contribution and the screenshot falls through to
 * vanilla Playwright behaviour.
 */
export interface AnnotScreenshotOptions {
  /** Caller-supplied annotations — merged with any resolver-derived
   *  ones. Same DSL `@ingcreators/annot-annotator` accepts. */
  overlays?: BboxAnnotation[];
  /** Provenance metadata written verbatim into the PNG's XMP. The
   *  fixture adds no defaults; callers who want `WELL_KNOWN_TAG_KEYS`
   *  (`source` / `screen` / `capturedAt` / `commit`) write them. */
  tags?: Record<string, string>;
  /** When `true` (default): annotations stored as SVG in XMP +
   *  original capture embedded → re-editable in Annot Cloud. When
   *  `false`: annotations baked into the visible pixels, no XMP
   *  layer, no embedded original — flat PNG, no round-trip. */
  editable?: boolean;
}

declare module "@playwright/test" {
  interface PageScreenshotOptions {
    // `annot: true` is also accepted at runtime as a no-op shorthand,
    // but typing it as the option-object only keeps the auto-complete
    // surface readable. The patch's runtime check covers `true` /
    // `{}` / `{ editable }` fall-through.
    annot?: AnnotScreenshotOptions;
  }
  interface LocatorScreenshotOptions {
    annot?: AnnotScreenshotOptions;
  }
}

/**
 * Context passed to every resolver registered in
 * [`annotSourceResolvers`](#annotSourceResolvers).
 */
export interface AnnotSourceContext {
  /** The `annot` option as supplied by the caller. Resolvers
   *  inspect this for the fields they're responsible for (e.g. an
   *  MDX resolver reads `annot.mdx`). */
  annot: AnnotScreenshotOptions;
  /** `Page` for `page.screenshot()`; `Locator.page()` for
   *  `locator.screenshot()`. Resolvers should always operate
   *  against the full page — clip rebasing happens in the patch
   *  pipeline after resolvers return. */
  page: Page;
  /** The receiver of the original `screenshot(...)` call. Either
   *  `Page` (for `page.screenshot`) or `Locator` (for
   *  `locator.screenshot`). Most resolvers only need
   *  [`page`](#page), but the locator handle is exposed for
   *  resolvers that want to read its bounding box etc. */
  receiver: Page | Locator;
}

/**
 * One source-of-annotations contribution returned from a resolver.
 *
 * `prepare()` runs serially in registration order BEFORE the
 * screenshot is taken — e.g. an MDX resolver rewrites the
 * `annot:snapshot` block here so the resolved bboxes match the
 * about-to-be-captured DOM.
 *
 * `resolveAnnotations(dims)` runs AFTER the raw screenshot is taken
 * and receives the page-space dimensions (clip-aware:
 * `{ width: clip.x + clip.width, height: clip.y + clip.height }`).
 * Returned annotations are in page-space; the patch pipeline
 * rebases them onto the clipped image afterwards.
 */
export interface AnnotSourceContribution {
  /** Optional side effect to run BEFORE the raw screenshot is
   *  taken. Runs serially in registration order. */
  prepare?: () => Promise<void>;
  /** Resolver-derived page-space annotations. The patch pipeline
   *  rebases them onto clip-space if a clip is in effect. */
  resolveAnnotations: (dims: { width: number; height: number }) => Promise<BboxAnnotation[]>;
}

/**
 * A resolver inspects `ctx.annot` for fields it cares about and
 * returns a contribution, or `null` if the call carries nothing it
 * recognises. The registry is walked once per `page.screenshot({
 * annot })` call; resolvers MUST be idempotent (no side effects
 * unless triggered by their own field's presence).
 */
export type AnnotSourceResolver = (
  ctx: AnnotSourceContext,
) => Promise<AnnotSourceContribution | null>;

/**
 * Module-level resolver registry. Packages that extend the patch
 * (e.g. `@ingcreators/annot-product-docs` for MDX-derived overlays)
 * push their resolver at module load time:
 *
 * ```ts
 * import { annotSourceResolvers } from "@ingcreators/annot-playwright";
 *
 * annotSourceResolvers.push(async ({ annot, page }) => {
 *   if (!annot.mdx) return null;
 *   return {
 *     prepare: () => refreshMdxSnapshot(page, annot.mdx),
 *     resolveAnnotations: (dims) => readMdxOverlays(annot.mdx, dims),
 *   };
 * });
 * ```
 *
 * One singleton per process — the `Symbol.for(...)` lookup makes
 * the registry stable across realm boundaries the way the
 * idempotency symbol on the prototype is.
 */
export const annotSourceResolvers: AnnotSourceResolver[] = [];
