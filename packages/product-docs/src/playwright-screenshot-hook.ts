// Side-effect module that registers the MDX-aware resolver into
// `@ingcreators/annot-playwright`'s `annotSourceResolvers`
// registry, so `page.screenshot({ annot: { mdx: { id, path } } })`
// works for callers who import `test` from
// `@ingcreators/annot-product-docs`.
//
// Phase 2 of `docs/plans/playwright-screenshot-fixture-relayer.md`.
// annot-playwright owns the generic patch + the resolver registry;
// MDX-aware behaviour layers in here via one
// `annotSourceResolvers.push(...)` call at module load.
//
// Module load order: imported from `./fixture.js` (the file
// callers reach for `test`) AND from `./index.js` (the package
// root). Belt-and-braces — anyone touching the package is
// guaranteed the resolver is registered before their first
// `page.screenshot({ annot: { mdx } })` call. Idempotent via the
// per-realm `Symbol.for(...)` sentinel set on the resolver
// reference so double-registration via repeated imports stays a
// no-op.

import { type AnnotSourceResolver, annotSourceResolvers } from "@ingcreators/annot-playwright";

import { syncProductDocs } from "./fixture.js";
import { resolveMdxAnnotations } from "./mdx-annotations.js";

// Module augmentation: extends annot-playwright's
// `AnnotScreenshotOptions` with the MDX-aware `mdx` field.
// Callers who `import { test } from "@ingcreators/annot-product-docs"`
// (or import anything else from the package — `index.ts`
// side-effect imports this module) get `annot.mdx` autocomplete
// on `page.screenshot()` / `locator.screenshot()`.
declare module "@ingcreators/annot-playwright" {
  interface AnnotScreenshotOptions {
    /**
     * Refresh the MDX `annot:snapshot` block and resolve the
     * `<Screen id>`'s `<Overlay>` blocks into bbox-keyed badge
     * annotations. The MDX file is rewritten in-place with the
     * current page's aria-snapshot before overlays resolve, so a
     * single `page.screenshot({ annot: { mdx } })` call covers the
     * "refresh + capture + bake + write" pipeline.
     */
    mdx?: { id: string; path: string };
  }
}

/** Idempotency sentinel — keyed on `Symbol.for(...)` so it is
 *  realm-stable across multiple module instances in the same
 *  worker. The resolver function reference is the registry's
 *  entry, so the check below skips registration when the same
 *  reference is already present. */
const RESOLVER_REGISTERED = Symbol.for("@ingcreators/annot-product-docs:mdx-resolver");

interface ResolverSentinel {
  [RESOLVER_REGISTERED]?: true;
}

/**
 * MDX resolver — claims a `page.screenshot({ annot: { mdx } })`
 * call by:
 *
 *   1. (prepare) Rewriting the MDX file's
 *      `annot:snapshot` + `annot:attributes` blocks against the
 *      live page via `syncProductDocs`. Runs BEFORE the raw
 *      screenshot so the resolved bboxes match the visible DOM.
 *   2. (resolveAnnotations) Reading the freshly-written
 *      `annot:snapshot` block + the `<Overlay match>` blocks and
 *      returning page-space `BboxNumberedBadgeAnnotation[]`.
 *
 * Returns `null` when `annot.mdx` is absent — other resolvers /
 * fall-through paths handle the call.
 */
const mdxResolver: AnnotSourceResolver = async ({ annot, page }) => {
  if (!annot.mdx) return null;
  const { id, path } = annot.mdx;
  return {
    prepare: () => syncProductDocs(page, { id, mdxPath: path }),
    resolveAnnotations: (dims) =>
      // `BboxNumberedBadgeAnnotation[]` is assignable to
      // `BboxAnnotation[]` — TypeScript needs the up-cast since
      // the contribution's return type is the union.
      resolveMdxAnnotations({ mdxPath: path, screenId: id, dims }),
  };
};

const tagged = mdxResolver as typeof mdxResolver & ResolverSentinel;
if (!tagged[RESOLVER_REGISTERED]) {
  tagged[RESOLVER_REGISTERED] = true;
  annotSourceResolvers.push(mdxResolver);
}
