# Re-layer the `page.screenshot({ annot })` fixture into the right packages

> **Status:** Draft — written 2026-05-22 during a Q&A session that
> exposed an architectural mismatch in
> [`_done/playwright-screenshot-annot-fixture.md`](./_done/playwright-screenshot-annot-fixture.md).
>
> **Trigger:** A reader asking "if `page.screenshot` is patched, is
> the fixture codegen-compatible?" surfaced that the patching lives
> in `@ingcreators/annot-product-docs-astro/playwright` (Astro
> integration package), but the capability is **not Astro-specific**
> — it's a general Playwright affordance that any annot user should
> get without taking an Astro dep. The parent plan landed it at the
> top of the stack because the triggering use case (docs-tour spec)
> happened to live in the Astro package; this plan corrects the
> layering.
>
> **Compatibility:** Additive at the API level. The existing
> `@ingcreators/annot-product-docs-astro/playwright` subpath stays
> working as a deprecated re-export pointing at
> `@ingcreators/annot-product-docs` (which is where the `mdx`-aware
> extension naturally lives). Existing callers get a one-line
> deprecation notice in JSDoc; no source edits required to keep
> building.
>
> **Risk:** Low. The interception logic is unchanged; only the file
> homes move. Two prototype patches (annot-playwright base + annot-
> product-docs `mdx` extension) compose via a small hook registry
> instead of one monolithic patch. Same `ANNOT_PATCHED` idempotency
> guard logic, just per-layer.

## TL;DR

The `page.screenshot({ annot: { … } })` prototype patch landed by
[`_done/playwright-screenshot-annot-fixture.md`](./_done/playwright-screenshot-annot-fixture.md)
currently lives at
[`packages/product-docs-astro/src/playwright/fixture.ts`](../../packages/product-docs-astro/src/playwright/fixture.ts).
The Astro package is the wrong home for it:

1. **Nothing Astro-specific is involved.** The patch handles
   `overlays`, `tags`, `editable`, coordinate rebasing for Locator
   /clip screenshots — all generic Playwright concerns.
2. **`mdx` is the only field that needs more than annot-playwright
   already has.** It calls into `@ingcreators/annot-product-docs`'s
   `captureScreen` + a pure-data `resolveMdxAnnotations` helper
   (incorrectly homed in `product-docs-astro/src/render.ts` despite
   the file's own "pure data; no DOM, no Playwright" comment).
3. **VRT / marketing-screenshot / AI-agent flows** all want
   `page.screenshot({ annot: { overlays, tags } })` but would have
   to drag in Astro (peer dep `^5.0.0 || ^6.0.0`) today to get it.

The fix is layered:

```
annot-playwright (existing — Tier C, Playwright runtime)
  ├── patchScreenshot() prototype patch mechanism
  ├── annot: { overlays, tags, editable } handling
  ├── composeOutput (editable / flat / tags-only paths)
  ├── rebase.ts (Page / Locator clip coordinate rebasing)
  └── page fixture override that calls patchScreenshot once per worker

annot-product-docs (existing — Tier A, extends annot-playwright)
  ├── module augmentation: AnnotScreenshotOptions.mdx?: { id, path }
  ├── resolveMdxAnnotations() (moved from product-docs-astro/render.ts)
  └── page fixture override that adds the mdx hook to annot-playwright's
      registry

annot-product-docs-astro (existing — Tier B-render, no Playwright fixture)
  └── /playwright subpath becomes a deprecated re-export of
      annot-product-docs's test + types
```

Callers' new recommended import path becomes:

```ts
// Was: @ingcreators/annot-product-docs-astro/playwright
import { test } from "@ingcreators/annot-product-docs";

// Or if you don't need MDX-linked screenshots:
import { test } from "@ingcreators/annot-playwright";
```

Both surfaces accept the same `annot: { … }` option. The
annot-playwright import doesn't accept `mdx` (that field requires
MDX awareness), but `overlays` / `tags` / `editable` / clip
rebasing all work identically.

## Why this matters now

The Q&A session that surfaced the mismatch was specifically about
**codegen compatibility**. The current API surface IS codegen-
compatible (vanilla `page.screenshot({ path })` falls through
unchanged), but recommending it to a codegen user means
recommending they take the Astro package as a dep — which is
backwards for any user who isn't actually using Astro.

Concrete affected use cases:

| Use case | Annot deps needed today | After this plan |
|---|---|---|
| Codegen-driven VRT spec | `@ingcreators/annot-product-docs-astro` (Astro peer dep) | `@ingcreators/annot-playwright` only |
| AI agent inline overlays | Same | Same — direct annot-playwright |
| Marketing screenshot scripts | Same | Same |
| Living product docs tour | `@ingcreators/annot-product-docs-astro` | `@ingcreators/annot-product-docs` (drops the Astro peer dep) |
| Astro docs site Image Service | `@ingcreators/annot-product-docs-astro` | Unchanged (this IS the right home for it) |

Bonus: `@ingcreators/annot-playwright`'s existing
`annotator.annotateScreenshot(page, opts)` method becomes
redundant. The patched `page.screenshot({ annot: { overlays } })`
returns the same `Buffer` and reads more idiomatically. We don't
delete `annotateScreenshot` in this plan — it's still convenient
for callers who want bytes without setting `path` — but a
follow-up can deprecate it once the new path settles.

## Design decisions

### How does the `mdx` extension compose?

annot-playwright has no awareness of MDX. annot-product-docs needs
to add MDX-aware behaviour on top. Three candidate shapes:

- **(A) Two-layer prototype patch, two `Symbol.for` guards.**
  annot-product-docs's fixture re-patches `Page.prototype.screenshot`
  on top of annot-playwright's already-patched method. Each layer
  guards with its own symbol so double-patching is still prevented
  per-layer.
- **(B) Hook registry in annot-playwright.** annot-playwright
  exports an `screenshotAnnotSources` array; each entry is a
  resolver `(annot, this) => Promise<{ annotations, sideEffects? }>`.
  annot-product-docs imports the registry and registers its `mdx`
  resolver at module load. One prototype patch, composable
  contributors.
- **(C) Configurable fixture.** annot-playwright's `test` accepts
  a configuration object via `test.extend({ ... })`; the resolver
  list lives in fixture options. annot-product-docs's `test` calls
  `base.extend(...)` with its MDX resolver in the config.

**Decision: (B).** Reasons:

1. **One prototype patch, multiple contributors.** Avoids the
   "patch-on-top-of-patch" double-wrap that's harder to reason
   about (each layer would have to think about whether the
   underlying method is already patched and what's been done to
   `opts`).
2. **Tree-shake friendly.** A consumer who only imports
   `@ingcreators/annot-playwright` doesn't load the `mdx`
   resolver at all — it's never registered.
3. **Plugin-author extensibility.** A future third-party package
   (e.g. an `@ingcreators/annot-product-docs-figma` adapter that
   pulls overlays from Figma instead of MDX) registers its own
   resolver the same way annot-product-docs does. No fixture-
   composition gymnastics required.

Concrete shape in annot-playwright:

```ts
// packages/playwright/src/screenshot-hooks.ts
import type { BboxAnnotation } from "@ingcreators/annot-annotator";
import type { Page, Locator } from "@playwright/test";

export interface AnnotSourceContext {
  /** The `annot` option as supplied by the caller. */
  annot: AnnotScreenshotOptions;
  /** `Page` for `page.screenshot()`; `Locator.page()` for
   *  `locator.screenshot()`. Resolvers should always operate
   *  against the full page (clip rebasing happens later). */
  page: Page;
}

export interface AnnotSourceContribution {
  /** Page-space `BboxAnnotation[]` contributed by this resolver. */
  annotations: BboxAnnotation[];
  /** Optional callback fired before the screenshot capture (for
   *  side effects like MDX in-place rewrite). Runs serially in
   *  registration order. */
  prepare?: () => Promise<void>;
}

export type AnnotSourceResolver = (
  ctx: AnnotSourceContext,
) => Promise<AnnotSourceContribution | null>;

/** Module-level registry. annot-product-docs and any future
 *  source-providing package register themselves at module load. */
export const annotSourceResolvers: AnnotSourceResolver[] = [];
```

annot-product-docs registers its `mdx` resolver:

```ts
// packages/product-docs/src/playwright-screenshot-hook.ts
import { annotSourceResolvers } from "@ingcreators/annot-playwright";
import { captureScreen, resolveMdxAnnotations } from "./index.js";

annotSourceResolvers.push(async ({ annot, page }) => {
  if (!annot.mdx) return null;
  const { id, path } = annot.mdx;
  return {
    annotations: [], // Filled in `prepare()`
    prepare: async () => {
      await captureScreen(page, { id, mdxPath: path });
    },
  };
});
```

Hmm — but the `annotations` need to be returned AFTER `captureScreen`
runs (since `captureScreen` rewrites the MDX snapshot in place and
THEN `resolveMdxAnnotations` reads the freshly-written blocks). So
the resolver signature needs to be richer:

```ts
export type AnnotSourceResolver = (
  ctx: AnnotSourceContext,
) => Promise<{
  /** Side effect to run BEFORE the screenshot capture (e.g. MDX
   *  in-place rewrite). */
  prepare?: () => Promise<void>;
  /** Annotations to merge into the output, in page-space. Called
   *  AFTER `prepare()` runs and AFTER the screenshot is taken (so
   *  the resolver has access to the resolved bboxes). */
  resolveAnnotations: (
    dims: { width: number; height: number },
  ) => Promise<BboxAnnotation[]>;
} | null>;
```

annot-product-docs's resolver then reads like:

```ts
annotSourceResolvers.push(async ({ annot, page }) => {
  if (!annot.mdx) return null;
  const { id, path } = annot.mdx;
  return {
    prepare: () => captureScreen(page, { id, mdxPath: path }),
    resolveAnnotations: (dims) =>
      resolveMdxAnnotations({ mdxPath: path, screenId: id, dims }),
  };
});
```

annot-playwright's `runAnnotMode` walks the registry:

```ts
async function runAnnotMode(this: Page | Locator, original, opts) {
  const { annot, path: outputPath, ...rest } = opts;
  const ctx: AnnotSourceContext = { annot, page: pageFor(this) };

  // Phase 1: gather resolver contributions and run their prepare()
  // hooks serially.
  const contributions = (
    await Promise.all(annotSourceResolvers.map((r) => r(ctx)))
  ).filter((c): c is NonNullable<typeof c> => c !== null);
  for (const c of contributions) {
    if (c.prepare) await c.prepare();
  }

  // Phase 2: take the raw screenshot.
  const clip = await resolveClip(this, opts.clip);
  const rawBytes = await original.call(this, { ...rest, path: undefined });
  const rawU8 = toUint8Array(rawBytes);
  const dims = readPngDimensions(rawU8);
  const pageDims = clip
    ? { width: clip.x + clip.width, height: clip.y + clip.height }
    : dims;

  // Phase 3: ask each contribution for its page-space annotations.
  const sourceAnnotations: BboxAnnotation[] = [];
  for (const c of contributions) {
    sourceAnnotations.push(...(await c.resolveAnnotations(pageDims)));
  }
  if (annot.overlays) sourceAnnotations.push(...annot.overlays);

  // Phase 4: rebase + compose + write (unchanged from current).
  const bytes = await composeOutput({ rawBytes: rawU8, sourceAnnotations, annot, clip });
  if (outputPath) await writeFile(outputPath, bytes);
  return Buffer.from(bytes);
}
```

### Type augmentation for `annot.mdx`

annot-playwright defines the base interface; annot-product-docs
extends it via TypeScript module augmentation:

```ts
// annot-playwright
export interface AnnotScreenshotOptions {
  overlays?: BboxAnnotation[];
  tags?: Record<string, string>;
  editable?: boolean;
}

declare module "@playwright/test" {
  interface PageScreenshotOptions {
    annot?: AnnotScreenshotOptions;
  }
  interface LocatorScreenshotOptions {
    annot?: AnnotScreenshotOptions;
  }
}
```

```ts
// annot-product-docs
declare module "@ingcreators/annot-playwright" {
  interface AnnotScreenshotOptions {
    mdx?: { id: string; path: string };
  }
}
```

Callers who import `@ingcreators/annot-product-docs` get `mdx`
auto-completion; callers who import `@ingcreators/annot-playwright`
directly don't see `mdx` in their auto-complete. Both paths share
the `annot:` key at runtime (the registry on annot-playwright is
the same singleton).

### Why a module-level registry vs. fixture-scoped

Module-level (singleton) registry is the right call because:

1. **Per-worker patching already happens at module load** — the
   `Symbol.for("@ingcreators/annot:screenshot-patched")` symbol
   guarantees one patch per process regardless of how many workers
   import the fixture. The resolver registry follows the same
   lifetime: registered once at module load, reused for every
   screenshot in the process.
2. **No "which fixture extends which" puzzle.** annot-product-docs
   just imports + pushes; no `base.extend({ ... })` choreography
   to route configuration through.
3. **Plugin authors extend with one line.** Adding a Figma /
   Sentry / custom adapter is a single `push()` at module load
   in the adapter package.

The downside — global mutation — is bounded because resolvers are
idempotent (the function shape says "given annot + page, return
maybe a contribution"). Adding the same resolver twice produces
duplicate annotations, but that's a programming error caught in
tests.

### Should `annotator.annotateScreenshot` be deprecated?

The patched `page.screenshot({ annot: { overlays } })` covers the
same use case AS LONG AS the caller has imported a `test` from a
package that runs the prototype patch (annot-playwright or
annot-product-docs).

For callers who haven't taken the fixture — say, ad-hoc scripts
that import `@ingcreators/annot-annotator` directly and need an
annotated screenshot — `annotator.annotateScreenshot(page, opts)`
is still the most ergonomic call (no fixture import required).

**Decision: keep `annotator.annotateScreenshot` for v1.** Document
the patched path as the recommended approach for tests; flag
`annotateScreenshot` with a "consider `page.screenshot({ annot })`
when using the fixture" JSDoc note. Re-evaluate deprecation in a
follow-up after 1-2 release cycles of real-world usage.

## Phases

| Phase | Output | Estimate |
|---|---|---|
| 0 | This plan doc | ~1 hour (this PR) |
| 1 | Move generic patch + composeOutput + rebase to `@ingcreators/annot-playwright`; `page` fixture override; hook registry interface | ~3 hours |
| 2 | Move `resolveMdxAnnotations` + `svgFromBboxAnnotations` to `@ingcreators/annot-product-docs`; register `mdx` resolver; module augment `AnnotScreenshotOptions.mdx` | ~2 hours |
| 3 | Convert `@ingcreators/annot-product-docs-astro/playwright` to a deprecated re-export pointing at `@ingcreators/annot-product-docs`; update product-docs-astro internals that consumed the moved helpers | ~1.5 hours |
| 4 | Docs (playwright-fixture.mdx update, product-docs README, product-docs-astro README migration note), CLAUDE.md section adjustments, plan archive | ~1 hour |

## Phase 0 — Plan doc

This PR. Adds the doc, gets sign-off on the layering decision and
the hook-registry shape before code moves.

## Phase 1 — `annot-playwright` gains the generic patch

### Files added in `packages/playwright/src/`

- `screenshot-hooks.ts` — `AnnotScreenshotOptions` base interface;
  `AnnotSourceContext` / `AnnotSourceContribution` /
  `AnnotSourceResolver` types; the `annotSourceResolvers` mutable
  array; the `ANNOT_PATCHED` symbol.
- `screenshot-patch.ts` — `patchScreenshot(proto)`; `runAnnotMode`;
  `composeOutput`; `hasAnnotContribution`; `resolveClip`;
  `readPngDimensions`; `toUint8Array`. Imports from
  `screenshot-hooks.ts` and from
  `@ingcreators/annot-annotator` + `@ingcreators/annot-core/xmp-bytes`
  (the latter is a new explicit dep on `annot-playwright`'s
  `package.json` — currently transitive via `annot-annotator`).
- `rebase.ts` — port of `packages/product-docs-astro/src/playwright/rebase.ts`
  verbatim. The only change is the import path (`BboxAnnotation`
  types come from the existing `@ingcreators/annot-annotator`
  dep already declared in annot-playwright's `package.json`).
- `rebase.test.ts` — port verbatim.
- `screenshot-patch.test.ts` — adapt the page-only tests from
  `packages/product-docs-astro/src/playwright/fixture.test.ts`
  (the `mdx`-related cases stay in product-docs's test file in
  Phase 2).

### Files modified in `packages/playwright/src/`

- `fixture.ts` — `test = base.extend(...)` gains a `page` fixture
  override that calls `patchScreenshot(Object.getPrototypeOf(page))`
  + `patchScreenshot(Object.getPrototypeOf(page.locator("html")))`
  once per worker.
- `index.ts` — re-exports `patchScreenshot`, `annotSourceResolvers`,
  `AnnotScreenshotOptions`, `AnnotSourceContext`,
  `AnnotSourceContribution`, `AnnotSourceResolver`, `Clip`,
  `RebaseResult`, `describeAnnotation`, `rebaseAnnotations`.

### `package.json` changes

- `dependencies`: add `@ingcreators/annot-core` (the `xmp-bytes`
  subpath consumer). `@ingcreators/annot-annotator` already there.
- `version` bump 0.3.1 → 0.4.0 (additive new API surface; minor
  bump per semver convention even though no breakage).

### Tests

The full subset of the parent plan's tests that DON'T touch `mdx`:

- Vanilla pass-through (no `annot` field).
- `annot: true` / `{}` falls through.
- `annot: { overlays }` → editable PNG with inline overlays.
- `annot: { tags }` → plain PNG + iTXt sidecar.
- `annot: { overlays, tags }` → editable PNG with tags.
- `annot: { overlays, editable: false }` → flat PNG.
- `path` semantics — bytes written to disk and returned identically.
- `Locator.screenshot({ annot })` with auto rebase.
- `page.screenshot({ clip, annot })` with explicit clip rebase.
- Out-of-clip overlays dropped with warning.
- Double-patch guard via `ANNOT_PATCHED` symbol.
- **New** — `annotSourceResolvers` registry called for `annot:
  { overlays }` (no resolvers should fire since `overlays` is
  handled directly).
- **New** — `annotSourceResolvers` registry called even with
  empty `annot` if any resolver returns non-null (this validates
  the contract that resolvers can opt themselves in based on
  fields that annot-playwright doesn't know about, like `mdx`).

### Out of scope for Phase 1

- The `mdx` field — annot-playwright doesn't know about MDX.
  Adding it via module augmentation is Phase 2.
- Deprecating `annotator.annotateScreenshot` — that's a follow-up,
  not part of this re-layering.

## Phase 2 — `annot-product-docs` registers the `mdx` resolver

### Files added in `packages/product-docs/src/`

- `mdx-annotations.ts` — moves `resolveMdxAnnotations` +
  `svgFromBboxAnnotations` + `parseSnapshotBoxes` +
  `buildBadgeAnnotations` + `BBOX_MARKER_RE` + `coerceBoxToPxBox`
  + `emptyAnnotationsSvg` from
  `packages/product-docs-astro/src/render.ts`. These helpers are
  pure data per the file's own "no DOM, no Playwright" comment;
  this just corrects the home.
- `mdx-annotations.test.ts` — moves the matching tests from
  `packages/product-docs-astro/src/render.test.ts`.
- `playwright-screenshot-hook.ts` — registers the `mdx` resolver
  into annot-playwright's `annotSourceResolvers`. Side effect
  import in `fixture.ts` (`import "./playwright-screenshot-hook.js";`)
  so consumers of annot-product-docs's `test` get the resolver
  for free without an explicit registration call.

### Files modified in `packages/product-docs/src/`

- `fixture.ts` — adds the side-effect import for
  `playwright-screenshot-hook.ts`. Module augmentation block
  `declare module "@ingcreators/annot-playwright" { interface
  AnnotScreenshotOptions { mdx?: { id, path } } }`. The existing
  `screen.capture(...)` fixture stays unchanged (still useful for
  callers who want to refresh MDX without taking a screenshot).
- `index.ts` — re-exports `resolveMdxAnnotations` +
  `svgFromBboxAnnotations` (for product-docs-astro's
  `renderAnnotatedScreen` to consume).

### `package.json` changes

- `dependencies`: `@ingcreators/annot-playwright` bumped to the
  Phase 1 version.
- `version` bump 0.2.0 → 0.3.0.

### Tests

The `mdx`-related subset of the parent plan's tests, moved from
product-docs-astro:

- `annot: { mdx }` → MDX snapshot refresh + editable PNG with
  resolved overlays.
- `annot: { mdx, overlays }` → both sources composed.
- `annot: { mdx, tags }` → editable PNG with tags.
- `annot: { mdx, editable: false }` → flat PNG with baked overlays.
- `annot: { mdx, overlays, editable: false }` → flat PNG with both
  sources baked.
- MDX with no `<Overlay>` blocks → editable PNG with empty
  annotations layer (Open Question 5 default from parent plan).
- Locator screenshot with `annot: { mdx }` → coordinates rebased
  correctly.

### Migration verification

The docs-tour spec at
[`packages/docs-site/tests/docs/annot-app.spec.ts`](../../packages/docs-site/tests/docs/annot-app.spec.ts)
gets a one-line import swap:

```diff
-import { test } from "@ingcreators/annot-product-docs-astro/playwright";
+import { test } from "@ingcreators/annot-product-docs";
```

The rest of the file is byte-identical. CI run is the canary —
golden PNG bytes shouldn't change at all.

## Phase 3 — `annot-product-docs-astro` becomes Astro-only

### Files deleted in `packages/product-docs-astro/src/`

- `playwright/fixture.ts`
- `playwright/fixture.test.ts`
- `playwright/rebase.ts`
- `playwright/rebase.test.ts`

### Files modified in `packages/product-docs-astro/src/`

- `playwright/index.ts` — becomes a deprecated re-export pointing
  at `@ingcreators/annot-product-docs`. JSDoc deprecation note
  + a `console.warn` at module load time saying "the
  `/playwright` subpath of @ingcreators/annot-product-docs-astro
  is deprecated; import from @ingcreators/annot-product-docs
  instead":

  ```ts
  /**
   * @deprecated Since 0.3.0. Import from
   * `@ingcreators/annot-product-docs` instead. The
   * `page.screenshot({ annot })` patch lives in annot-playwright
   * now; the MDX-aware extension lives in annot-product-docs.
   * This re-export will be removed in 0.5.0.
   */
  export { test, expect, type AnnotScreenshotOptions } from "@ingcreators/annot-product-docs";
  export {
    type Clip,
    type RebaseResult,
    describeAnnotation,
    rebaseAnnotations,
  } from "@ingcreators/annot-playwright";
  ```

- `render.ts` — `resolveMdxAnnotations` + `svgFromBboxAnnotations`
  + the helpers they call are removed from this file. The local
  `renderAnnotatedScreen` implementation imports them from
  `@ingcreators/annot-product-docs` going forward. The
  `RenderResult` / `RenderAnnotatedScreenOptions` types stay
  Astro-side (they're consumed by the Image Service).
- `render.test.ts` — the `resolveMdxAnnotations` /
  `svgFromBboxAnnotations` tests are gone (moved in Phase 2);
  `renderAnnotatedScreen` tests stay and verify the
  import-from-product-docs wiring works.

### `package.json` changes

- `dependencies`: `@ingcreators/annot-product-docs` version bump
  to Phase 2 (already a workspace dep — just refreshes the
  pinned version after the bump).
- `peerDependencies`: `@playwright/test` MAY drop here if the
  package no longer needs it. (Today it's marked optional;
  after the re-layer the only Playwright-touching code is the
  deprecated re-export, which gets its `@playwright/test` type
  graph via annot-product-docs. Decision deferred — see Open
  Question 3.)
- `version` bump 0.2.0 → 0.3.0.

### Tests

- The product-docs-astro test suite shrinks (delete the moved
  files' tests).
- One new test asserts the deprecated `/playwright` subpath
  re-exports the same `test` identity as
  `@ingcreators/annot-product-docs` so existing callers using the
  old import path still pass.

## Phase 4 — Docs + plan archive

### Doc surface updates

- `packages/docs-site/src/content/docs/product-docs/playwright-fixture.mdx`
  — rewrite the recommended import path; add a "Choosing your
  import" section explaining when to use `annot-playwright` vs.
  `annot-product-docs`.
- `packages/docs-site/src/content/docs/api/create-annotator.mdx`
  — the "From a Playwright test" example switches its import.
- `packages/product-docs-astro/README.md` — add a Migration
  section explaining the deprecated `/playwright` subpath and
  the recommended replacements.
- `packages/product-docs/README.md` — add a "Playwright fixture
  for annotated screenshots" section pointing at
  `page.screenshot({ annot: { mdx } })`.
- `packages/playwright/README.md` — add a "`page.screenshot({
  annot })` (recommended)" section above the existing
  `annotator.annotateScreenshot` section.

### CLAUDE.md updates

- The `Monorepo layout` table entry for `playwright/` gains a
  one-line note that it ships the `page.screenshot({ annot })`
  prototype patch.
- The entry for `product-docs/` gains a one-line note that it
  contributes the `mdx` resolver to the patch via the hook
  registry.
- The entry for `product-docs-astro/` removes mention of the
  Playwright fixture; the package becomes "Astro Image Service
  + .astro components" only.

### Plan archive

Move this file to `docs/plans/_done/playwright-screenshot-fixture-relayer.md`,
update the entry in `docs/plans/README.md`.

## Open Questions

### 1. Hook registry vs. configurable fixture

Section "How does the `mdx` extension compose?" picks (B) hook
registry. Open for the user to flip to (C) configurable fixture
if they prefer fixture-scoped configuration over module-level
mutation.

**Recommended:** (B). One prototype patch, tree-shake friendly,
plugin-author extensible.

### 2. Deprecation policy on `@ingcreators/annot-product-docs-astro/playwright`

- **(a) Keep the deprecated re-export indefinitely.** Zero
  breakage for existing callers; the only cost is one extra
  `console.warn` and a one-line JSDoc.
- **(b) Mark deprecated in 0.3.0, schedule removal in 0.5.0.**
  Forces migration on a known timeline. Six-month-ish window
  given current release cadence.
- **(c) Hard-break in 0.3.0.** No re-export; callers MUST
  migrate.

**Recommended:** (b). The package was published 2026-05-21 with
the current `/playwright` subpath; some external callers may
already exist. (a) lets the cruft accumulate; (c) is uncalled-
for breakage. (b) is the middle ground — visible deprecation,
known sunset.

### 3. Does `annot-product-docs-astro` keep `@playwright/test` as a peer dep?

After Phase 3, the package's only Playwright touch-point is the
deprecated re-export. The actual fixture code lives elsewhere.

- **(a) Keep the optional peer dep.** Lower diff churn; same
  `peerDependenciesMeta.optional: true` shape as today.
- **(b) Drop the peer dep.** Cleaner — `annot-product-docs-astro`
  no longer claims any Playwright relationship. Callers using
  the deprecated re-export get `@playwright/test` types
  transitively via `annot-product-docs`.

**Recommended:** (b). The Astro package shouldn't claim a
Playwright relationship it no longer has.

### 4. Should `screen.capture(...)` from annot-product-docs be deprecated?

`screen.capture({ id, mdxPath })` is now achievable via
`page.screenshot({ annot: { mdx } })` (which calls `captureScreen`
internally during the `prepare` hook).

- **(a) Keep `screen.capture` as a first-class API.** It's still
  useful for batched MDX refresh without taking a screenshot
  (the original use case before the `annot:` fixture landed).
- **(b) Deprecate `screen.capture` in favour of `page.screenshot({
  annot: { mdx } })`.** One way to do things; cleaner surface.

**Recommended:** (a). The two have different shapes — one takes
a screenshot, one doesn't. Both are useful. Keep `screen.capture`
as a documented escape hatch for read-only / batched refresh
flows.

### 5. Should the `annotSourceResolvers` registry be exposed publicly?

annot-playwright exports it for annot-product-docs to consume.
Third-party plugin authors (e.g. an `@ingcreators/annot-product-docs-figma`
adapter) could also push into it.

- **(a) Public surface, documented in
  `docs/plugin-api/playwright-screenshot-hook.md`.** Makes the
  extension model first-class.
- **(b) Internal export — consumed by annot-product-docs but
  not documented.** Keep it semi-private until a second adapter
  exists.

**Recommended:** (a). The mechanism IS extensible by design and
documenting it now is free. The `docs/plugin-api/` directory
already houses similar plugin-author guides (`icons.md`,
`themes.md`, `metadata-cache.md`).

## Implementation notes

### Module load order

annot-product-docs's `playwright-screenshot-hook.ts` MUST be
imported BEFORE the first `page.screenshot({ annot })` call.
Side-effect importing from `fixture.ts` (which is what callers
import to get `test`) handles this — anyone who imports `test`
from annot-product-docs has already loaded the hook.

Risk case: a caller imports `test` from annot-playwright AND
`captureScreen` from annot-product-docs (the function, not the
fixture). Without the side-effect import of
`playwright-screenshot-hook.ts`, `annot: { mdx }` would silently
do nothing. Mitigations:

- Export the hook registration function and have annot-product-docs's
  `index.ts` call it at module load (so any import of anything
  from annot-product-docs registers the hook). Robust.
- Document the requirement in the migration guide: "use the
  `test` from annot-product-docs if you want `mdx` support".
  Lower mitigation cost; relies on callers reading docs.

Decision: belt-and-braces — the registration happens both in
`fixture.ts` (side-effect import on `test`) and in `index.ts`
(side-effect import on the package root). The
`annotSourceResolvers.push(...)` body is itself idempotent (the
function reference is unique per module instance; pushing it
twice would double-register, so the implementation uses a
`Symbol.for("@ingcreators/annot-product-docs:mdx-resolver")`
sentinel on the function reference and checks before pushing).

### Build / dist layout

- annot-playwright now has multiple source files —
  `screenshot-hooks.ts`, `screenshot-patch.ts`, `rebase.ts` —
  all bundled by Vite into `dist/index.js` via the existing
  `vite.config.ts`. No build change needed.
- annot-product-docs gains `mdx-annotations.ts` +
  `playwright-screenshot-hook.ts`. Same — bundled into the
  existing `dist/index.js`.

### Verification

Each phase ships with `pnpm -r typecheck`, `pnpm test` pass-count,
`pnpm lint`, and per-package `build` runs in the `Verified:`
trailer of the commit. Phase 3 specifically also verifies the
docs-tour spec at
`packages/docs-site/tests/docs/annot-app.spec.ts` still produces
byte-identical PNG output via the `docs-tour.yml` GitHub
Actions workflow.

## Future work

- **Deprecate `annotator.annotateScreenshot`** once the patched
  `page.screenshot({ annot })` has 1-2 release cycles in the
  field. Out of scope for this plan.
- **Adapter for Figma / Sentry / Linear overlays.** A
  third-party package that registers an `annot.figma?: {
  fileId, nodeIds }` resolver into the hook registry. Out of
  scope; documented as an example use case in the plugin-API
  doc landed by Phase 4.
- **`annot codegen` wrapper CLI** that runs `playwright codegen`
  + rewrites the import line to `@ingcreators/annot-playwright`
  / `@ingcreators/annot-product-docs` depending on user flag.
  Mentioned in the Q&A session that triggered this plan;
  separate small plan / PR if demand surfaces.

## References

- Parent plan that landed the original implementation:
  [`_done/playwright-screenshot-annot-fixture.md`](./_done/playwright-screenshot-annot-fixture.md)
- Underlying annotator: [`_done/annot-annotator-package.md`](./_done/annot-annotator-package.md)
- Existing annot-playwright fixture: [`_done/annot-playwright-fixture.md`](./_done/annot-playwright-fixture.md)
- Living product docs platform (defines annot-product-docs +
  annot-product-docs-astro): [`_done/living-product-docs.md`](./_done/living-product-docs.md)
- Editable PNG (consumed by `editable: true` path):
  [`_done/editable-png-from-annotator.md`](./_done/editable-png-from-annotator.md)
