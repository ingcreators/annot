# Playwright `screenshot({ annot: { … } })` fixture

> **Status:** Draft — design only; implementation queued.
> Triggered 2026-05-21 during the [`editable-png-from-annotator`](./_done/editable-png-from-annotator.md)
> Phase 3 review. The new editable-PNG plumbing lifted the
> docs-tour spec from "4 steps coordinated by hand" to "4 steps
> coordinated by hand with one of them swapped" — still verbose,
> still un-Playwright-y. This plan fixes the ergonomics.
> **Compatibility:** Additive at the API level. New
> `@ingcreators/annot-product-docs-astro/playwright` subpath that
> re-exports an extended `test` whose `page.screenshot` /
> `locator.screenshot` intercept calls carrying a new `annot: { … }`
> nested option. Calls WITHOUT `annot` are byte-for-byte vanilla
> Playwright. Existing `screen.capture(...)` from
> `@ingcreators/annot-product-docs` keeps working unchanged.
> **Risk:** Low–medium. The interception is one prototype-patch in
> the fixture init. Locator screenshots add coordinate-rebasing
> complexity for overlays — separated into its own phase so the
> page-screenshot path can land first.

## TL;DR

After the editable-PNG plan landed, the docs-tour spec at
[`packages/docs-site/tests/docs/annot-app.spec.ts`](../../packages/docs-site/tests/docs/annot-app.spec.ts)
still reads like four coordinated steps stitched together:

```ts
const rawBytes = await page.screenshot({ fullPage: false });
await screen.capture({ id, mdxPath });
const result = await renderAnnotatedScreen({
  mdxPath,
  screenId: id,
  basePngBytes: new Uint8Array(rawBytes.buffer, …),
  editable: { tags: { … } },
});
await writeFile(SHOT_PATH, result.bytes);
```

A Playwright user opening this file has to learn three new
concepts (`screen.capture`, `renderAnnotatedScreen`, the
`Uint8Array` cast) before they can take a screenshot. That's
backwards — the closest equivalent in vanilla Playwright is a
one-liner:

```ts
await page.screenshot({ path: "shot.png", fullPage: false });
```

This plan ships a fixture so the docs-tour spec collapses to:

```ts
import { test } from "@ingcreators/annot-product-docs-astro/playwright";

test("app overview", async ({ page }) => {
  await page.goto(ANNOT_APP_URL);
  await page.screenshot({
    path: "public/app/shots/app-overview.png",
    annot: {
      mdx: { id: "app-overview", path: "src/content/docs/app/index.mdx" },
    },
  });
});
```

— the `annot: { … }` nested option opts the call into
"refresh MDX snapshot + bake editable PNG" mode. Plain
`page.screenshot({ path })` still works unchanged.

`locator.screenshot({ annot: { … } })` works the same way for
sub-region captures (Phase 2).

## The `annot` option — compositional fields

```ts
interface AnnotScreenshotOptions {
  // Annotation sources (compositional — any subset, or none)
  mdx?: { id: string; path: string };
  overlays?: BboxAnnotation[];

  // Provenance metadata
  tags?: Record<string, string>;

  // Output mode toggle (only meaningful when annotations present)
  editable?: boolean;
}
```

Each field is an **independent contribution** to the resulting
XMP record. The fixture composes whatever sources you supply:

| Field | Contributes to | Side effect |
|---|---|---|
| `mdx: { id, path }` | `annotationsSvg` (from `<Overlay>` JSX in the MDX, resolved against the current page's aria-snapshot) | MDX file's `annot:snapshot` + `annot:attributes` blocks are rewritten in-place |
| `overlays` | `annotationsSvg` (from the inline `BboxAnnotation[]` — same DSL `@ingcreators/annot-annotator` accepts) | None |
| `tags` | `tags` (merged on top of auto-filled defaults) | None |
| `editable` | switches output between "preserve annotations as SVG layer" (default `true`) vs "bake into visible pixels, flat PNG" (`false`) | n/a |

Both source fields can be present at the same time — the resulting
`annotationsSvg` is the merge of the two SVG fragments wrapped in
a single `<svg>` root.

### Case matrix

| `annot` value | annotationsSvg | originalImage embedded | XMP tags | Visible pixels | Output file |
|---|---|---|---|---|---|
| absent / `true` / `{}` | — | — | — | raw screenshot | plain PNG (= vanilla Playwright) |
| `{ tags }` only | — | — | ✓ (user + auto) | raw screenshot | plain PNG + iTXt sidecar |
| `{ overlays }` | inline | ✓ | ✓ | screenshot + overlays | editable PNG |
| `{ overlays, editable: false }` | — | — | ✓ | screenshot + **baked** overlays | flat PNG + iTXt sidecar |
| `{ mdx }` | MDX | ✓ | ✓ | screenshot + overlays | editable PNG + MDX rewrite |
| `{ mdx, editable: false }` | — | — | ✓ | screenshot + **baked** overlays | flat PNG + MDX rewrite |
| `{ mdx, overlays }` | merged | ✓ | ✓ | screenshot + overlays (both sources) | editable PNG + MDX rewrite |
| `{ mdx, overlays, editable: false }` | — | — | ✓ | screenshot + **baked** (both) | flat PNG + MDX rewrite |
| `{ mdx, overlays, tags }` | merged | ✓ | ✓ (user merged) | screenshot + overlays | editable PNG + MDX rewrite |

Notes:
- `annot: true` / `{}` is a no-op — same byte output as omitting `annot` entirely. We accept it as a shorthand because TypeScript users may type `annot: {}` while exploring auto-complete.
- "iTXt sidecar" = a plain iTXt PNG chunk carrying just the tags. The Annot editor treats files with no `<annot:annotations>` element as ordinary PNGs (opens as fresh canvas).
- `editable: false` always strips the annotation SVG + embedded original from the XMP. Tags survive.

### Example usage

```ts
// docs-tour: MDX-linked
await page.screenshot({
  path: "public/app/shots/app-overview.png",
  annot: {
    mdx: { id: "app-overview", path: "src/content/docs/app/index.mdx" },
  },
});

// AI agent / custom CLI: inline overlays, no MDX
await page.screenshot({
  path: "shot.png",
  annot: {
    overlays: [
      { type: "rect", bbox: { x: 10, y: 10, width: 200, height: 50 }, intent: "warning" },
      { type: "numberedBadge", bbox: { x: 240, y: 12, width: 24, height: 24 }, number: 1 },
    ],
  },
});

// MDX + extra inline overlay for this test run only
await page.screenshot({
  path: "shot.png",
  annot: {
    mdx: { id: "checkout", path: "docs/checkout.mdx" },
    overlays: [
      { type: "rect", bbox: testFailureRegion, intent: "error" },
    ],
    tags: { variant: testInfo.project.name },
  },
});

// VRT failure: just record provenance tags, no overlays
await page.screenshot({
  path: testInfo.outputPath("failure.png"),
  annot: {
    tags: { source: "vrt-failure", testId: testInfo.titlePath.join(" / ") },
  },
});

// Marketing / locked screenshot: bake overlays into pixels, no re-edit
await page.screenshot({
  path: "marketing/feature.png",
  annot: {
    mdx: { id: "feature", path: "marketing/feature.mdx" },
    editable: false,
  },
});
```

## Design decisions captured

### Why the `annot: { … }` nested key

Discussed during plan kick-off — two candidate API shapes:

```ts
// (A) Flat annotId / annotMdxPath / annotEditable / annotTags
await page.screenshot({ path, annotId: "x", annotMdxPath: MDX_PATH });

// (B) Nested `annot: { mdx: { id, path }, overlays, tags, editable }`
await page.screenshot({ path, annot: { mdx: { id: "x", path: MDX_PATH } } });
```

**Decision: (B).** Three reasons:

1. **Playwright-native.** Playwright already uses nested option
   objects (`clip: { x, y, w, h }`) for grouped concerns. Flat
   prefix forces `annot*` namespace on every field; nested is
   one key with structured contents.
2. **Single detection point.** `if ("annot" in opts)` triggers
   annot mode — one condition, easy to reason about.
3. **Extensible.** Adding `annot.crop` / `annot.intent` /
   `annot.mask` later doesn't pollute top-level option auto-
   complete.

### Why intercept `page` instead of adding `screen.screenshot()`

- **`screen.screenshot()` (added next to `screen.capture()`)** — explicit,
  discoverable, but requires the user to remember "screenshots of
  annotated screens use a different fixture method."
- **Intercept `page.screenshot` + `locator.screenshot`** — zero new
  API surface; users keep their Playwright muscle memory. The
  `annot: { … }` nested key signals intent.

**Decision: intercept.** Honest tradeoff: the magic is slightly
higher (a screenshot call does more than the Playwright docs
say). But the `annot` key is opt-in, the import path
(`@ingcreators/annot-product-docs-astro/playwright`) signals the
extended semantics, and codegen tools (Playwright Codegen, Chrome
DevTools Recorder) keep working — their emitted
`page.screenshot({ path })` calls have no `annot` field, so they
fall through to vanilla behaviour. Adding `annot: { mdx: { id, path } }`
by hand to a codegen-generated skeleton is the standard editing
flow.

### Why compositional fields instead of "modes"

An earlier draft of this plan modelled the API as three discrete
modes (MDX-linked / inline overlays / tags-only) with mutually-
exclusive option shapes. Discussion surfaced that:

- Every contribution from `mdx` / `overlays` / `tags` is
  independent — `annotationsSvg` is just the concat of `mdx`-
  derived + `overlays`-derived fragments.
- "Modes" forced the user to pick one, blocking valid
  combinations like "MDX baseline + one inline overlay
  specific to this test run."

The compositional form ("any subset, any combination") falls out
of the natural shape of the underlying XMP record.

### Why `editable` is retained as an explicit field

When the API consolidated into compositional fields, an obvious
question was: "is `editable` redundant? Just inspect whether
annotations are present?"

It's not redundant — `editable` toggles **bake-vs-preserve** for
the overlays:

| `editable` | Overlay handling |
|---|---|
| `true` (default) | Annotations stored as SVG layer in XMP + original capture also embedded → re-editable in Annot. Visible pixels show the rasterised composite. |
| `false` | Annotations baked into the visible pixels, no SVG layer, no embedded original. Flat PNG, no round-trip. |

Real `editable: false` use cases:

- **VRT golden images** — overlays baked into the reference; you don't want anyone to "fix" them and re-save.
- **PR review / Slack uploads** — smaller files (no embedded original).
- **Marketing screenshots** — brand-locked, no re-edit path.
- **Email attachments** — receiver doesn't have Annot editor.

Default is `true` because the fixture's import path signals
"annot-aware" — flat raster is the deliberate opt-out.

When `editable: false` is set with tags-only mode (no overlays),
the field has no observable effect (there's no overlay to
bake either way). The fixture still writes the tags-only iTXt
sidecar.

### `skipRefresh` was considered and dropped

A draft `mdx.skipRefresh?: boolean` field would have let the
caller skip the in-place rewrite of the MDX file. It was
removed because:

- Its only natural partner is calling `screen.capture()`
  separately, which re-introduces the verbose multi-step pattern
  the fixture exists to eliminate.
- "Read-only build" use case is satisfied at the git layer
  (`git diff --exit-code`) — disk writes are idempotent when
  bboxes haven't changed.
- The `screen.capture()` from `@ingcreators/annot-product-docs`
  remains available as an escape hatch for the rare batched-
  refresh pattern.

If concrete demand surfaces later (read-only CI build, batched
refresh) a follow-up plan can integrate `screen.capture()` more
ergonomically.

## Phases

| Phase | Output | Estimate |
|---|---|---|
| 1 | `@ingcreators/annot-product-docs-astro/playwright` subpath; `page.screenshot` interception; tags-only + `overlays` + `mdx` paths; docs-tour spec rewrite | ~4 hours |
| 2 | `locator.screenshot` interception + coordinate rebasing for sub-region overlays | ~3 hours |
| 3 | Documentation + migration guide | ~1 hour |

## Phase 1 — `page.screenshot` interception

### New file: `packages/product-docs-astro/src/playwright/fixture.ts`

```ts
import { writeFile } from "node:fs/promises";
import type { BboxAnnotation } from "@ingcreators/annot-annotator";
import { test as base, captureScreen } from "@ingcreators/annot-product-docs";
import type { Page } from "@playwright/test";
import { renderAnnotatedScreen } from "../render.js";

const ANNOT_PATCHED = Symbol.for("@ingcreators/annot:screenshot-patched");

export interface AnnotScreenshotOptions {
  mdx?: { id: string; path: string };
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

export const test = base.extend({
  page: async ({ page }, use) => {
    patchScreenshot(Object.getPrototypeOf(page));
    // Phase 2 will also patch the Locator prototype here.
    await use(page);
  },
});

function patchScreenshot(proto: any) {
  if (proto[ANNOT_PATCHED]) return;
  const original = proto.screenshot;
  proto.screenshot = async function (opts: any = {}) {
    if (!opts.annot || !hasAnnotContribution(opts.annot)) {
      return original.call(this, opts);
    }
    return runAnnotMode.call(this, original, opts);
  };
  proto[ANNOT_PATCHED] = true;
}

function hasAnnotContribution(annot: AnnotScreenshotOptions): boolean {
  // `annot: true` / `annot: {}` falls through to vanilla — nothing to
  // contribute. Tags-only / overlays-only / mdx all qualify.
  if (annot === (true as any)) return false;
  return Boolean(annot.mdx || annot.overlays?.length || annot.tags);
}
```

The interception body:

```ts
async function runAnnotMode(
  this: Page,            // or Locator (Phase 2)
  original: Function,
  opts: PageScreenshotOptions & { annot: AnnotScreenshotOptions },
) {
  const { annot, path: outputPath, ...screenshotOpts } = opts;
  const editable = annot.editable ?? true;

  // 1. Refresh MDX snapshot if `mdx` source is present.
  if (annot.mdx) {
    await captureScreen(getPageFromContext(this), {
      id: annot.mdx.id,
      mdxPath: annot.mdx.path,
    });
  }

  // 2. Take the raw screenshot (no path — we write later).
  const rawBytes = await original.call(this, { ...screenshotOpts, path: undefined });

  // 3. Build the resulting bytes per case-matrix.
  const bytes = await composeOutput({
    self: this,
    rawBytes,
    annot,
    editable,
  });

  // 4. Write to path if given (mirrors page.screenshot semantics).
  if (outputPath) await writeFile(outputPath, bytes);
  return Buffer.from(bytes);
}
```

The `composeOutput` helper dispatches per case matrix —
tags-only path writes a plain PNG + iTXt sidecar via a new
`writeTagsSidecar` helper that reuses the XMP encoding from
`@ingcreators/annot-core/xmp-bytes` without embedding the
original capture or annotations layer.

### `package.json` export + dep

```jsonc
"./playwright": "./src/playwright/index.ts",
```

`@ingcreators/annot-annotator` moves from internal `devDependencies`
to `dependencies` (already pulled in via `@ingcreators/annot-product-docs`
transitively, but the explicit dep makes the `BboxAnnotation` import
correct). `@playwright/test` goes to `peerDependencies`.

### Tests

`packages/product-docs-astro/src/playwright/fixture.test.ts`:

- **Vanilla pass-through** — `page.screenshot({ path: ... })` (no `annot`) calls the original method with original opts.
- **`annot: true` / `{}` falls through** — same bytes as plain vanilla call.
- **`annot: { mdx }`** — invokes `captureScreen` + `renderAnnotatedScreen` and writes the editable PNG.
- **`annot: { overlays }`** — no MDX touch, inline overlays baked into the editable PNG.
- **`annot: { mdx, overlays }`** — both sources composed; `annotationsSvg` contains primitives from both.
- **`annot: { tags }`** — plain PNG bytes + iTXt sidecar (no annotations element, no embedded original).
- **`annot: { ..., editable: false }`** — flat PNG (no annotations SVG, no embedded original) with overlays baked into visible pixels.
- **`path` semantics** — bytes returned by the fixture round-trip via `readEditablePngBytes`; `path`-given output exists on disk.
- **Auto-filled tags** — without user-supplied tags, the XMP carries `source`, `screen` (when mdx present), `capturedAt`, and (in CI) `commit`.
- **User tags merged on top of auto-fill** — user's `tags.source` overrides the default `"playwright-fixture"`.
- **Multiple test invocations idempotent-patch** — the `Symbol.for` guard prevents double-wrapping when multiple workers / multiple fixture inits run in one process.

The `Page` / `Locator` interception runs against a stub
`Page` (vitest doesn't launch a browser); a separate integration
spec exercises the full path with a real Playwright session.

### Docs-tour spec rewrite

`packages/docs-site/tests/docs/annot-app.spec.ts` becomes:

```ts
import { test } from "@ingcreators/annot-product-docs-astro/playwright";

const ANNOT_APP_URL = process.env.ANNOT_APP_URL || "https://annot.work/app/";

test.describe("Annot web app dogfood tour", () => {
  test("app overview", async ({ page }) => {
    await page.goto(ANNOT_APP_URL);
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: "public/app/shots/app-overview.png",
      annot: {
        mdx: { id: "app-overview", path: "src/content/docs/app/index.mdx" },
        tags: { source: "docs-tour" },
      },
    });
  });
});
```

Down from 4 coordinated steps + a `Uint8Array` cast to one
`page.screenshot()` call. `source: "docs-tour"` overrides the
fixture's `"playwright-fixture"` default; `screen` / `capturedAt`
/ `commit` are auto-filled (Open Question 2).

## Phase 2 — `locator.screenshot` interception + coord rebasing

`locator.screenshot()` returns a PNG cropped to the locator's
bounding box. Overlay coordinates (whether from `mdx` snapshot
or inline `overlays`) are page-space — to overlay correctly on
the cropped image we need to:

1. Read `locator.boundingBox()` → `{ x, y, width, height }` in
   page coords.
2. For each overlay's bbox, compute `(bbox.x - clip.x, bbox.y - clip.y)`.
3. Drop overlays whose bbox doesn't fit entirely inside the clip
   (warning, not error — the test still passes).
4. Pass `clip` to `renderAnnotatedScreen` so it uses the clipped
   dimensions as the base PNG dims.

### `renderAnnotatedScreen` gets a `clip` option

```ts
interface RenderAnnotatedScreenOptions {
  // …existing fields…
  /**
   * Sub-region of the page the base PNG represents, in page
   * coordinates. When set:
   *   - Overlay bboxes are rebased onto the clipped image.
   *   - Overlays that fall outside `clip` are dropped (with a
   *     diagnostic recorded in `RenderResult.droppedOverlays`).
   *   - The `width` / `height` of the embedded XMP record the
   *     clipped dimensions, not the full page.
   * Mirrors `page.screenshot({ clip })` semantics.
   */
  clip?: { x: number; y: number; width: number; height: number };
}

interface RenderResult {
  // …existing fields…
  /**
   * Overlay ids that fell outside `clip` (Phase 2 addition).
   * Undefined when no clipping was applied.
   */
  droppedOverlays?: string[];
}
```

### Locator detection

In the fixture, `this` is either `Page` or `Locator`. Discriminator:

```ts
function isLocator(self: Page | Locator): self is Locator {
  return typeof (self as Locator).boundingBox === "function";
}
```

When `isLocator(this)`, compute the clip via `this.boundingBox()`
and pass it to `renderAnnotatedScreen`. When `Page`, pass through
the user's `clip` (if any) — same behaviour as vanilla
`page.screenshot({ clip })`.

### Tests

- **Locator screenshot writes a cropped editable PNG** — IHDR width matches `boundingBox.width`.
- **Overlays inside the locator survive with rebased coords** — round-trip the result and read `annotationsSvg`; coordinate substrings reflect the rebase.
- **Overlays outside the locator are dropped** — assert `result.droppedOverlays` contains the right overlay ids.
- **Inline `overlays` field works on locators too** — same compositional model as Page; coords get rebased identically.
- **`page.screenshot({ clip, annot })` matches `locator.screenshot({ annot })`** — when the clip and the locator's bounding box are equal, output bytes' XMP records are byte-identical.

## Phase 3 — Docs + migration guide

- Update `packages/docs-site/src/content/docs/api/create-annotator.mdx`'s "Re-editable PNG" example with a new "From a Playwright test" section showing the `page.screenshot({ annot })` form.
- New page: `packages/docs-site/src/content/docs/product-docs/playwright-fixture.mdx` covering the import, the `annot` option shape, the compositional model + case matrix, the codegen→hand-edit workflow, and the locator example.
- Migration note in `@ingcreators/annot-product-docs-astro`'s README on switching from `renderAnnotatedScreen` direct calls to the fixture (the function stays exported, the fixture is the recommended path).
- Plan archive `_done/` move + `docs/plans/README.md` update.

## Open Questions

### 1. `editable` default — `true` or `false`?

- **(a) Default `true`.** The fixture entry point is "I'm doing annot-aware screenshots" — flat raster is the unusual ask. Users who specifically want flat write `annot: { …, editable: false }`.
- **(b) Default `false`.** Matches Phase 3 of `editable-png-from-annotator` — `renderAnnotatedScreen({ editable: undefined })` is flat. Symmetry with the underlying function.

**Default: (a).** Once the user has opted into the fixture
(import path) and into annot mode (any of `mdx` / `overlays` /
`tags`), the value-add of the fixture IS the editable PNG.
Asking them to opt in twice is friction.

### 2. Auto-filled `tags`

The docs-tour spec currently hand-builds:

```ts
tags: {
  source: "docs-tour",
  screen: SCREEN_ID,
  capturedAt: new Date().toISOString(),
  ...(process.env.GITHUB_SHA ? { commit: process.env.GITHUB_SHA } : {}),
}
```

Options:

- **(a) Fixture auto-fills `source: "playwright-fixture"` / `screen: <mdx.id>` (when mdx present) / `capturedAt: now` / `commit: $GITHUB_SHA`; user can override per call.**
- **(b) Fixture writes nothing; user supplies all tags.**
- **(c) Fixture writes ONLY `capturedAt` + `commit` (the obvious "free" metadata); user supplies the rest.**

**Default: (a).** Annot is the producer; it should know to label
itself. Matches the `WELL_KNOWN_TAG_KEYS` convention from
`@ingcreators/annot-core/xmp-bytes`. User overrides any field
just by setting it in `annot.tags`.

`source` default is `"playwright-fixture"` rather than
`"docs-tour"` — the fixture is a general tool, the docs-tour is
one of its callers. The docs-tour spec can override `source` to
`"docs-tour"` if it cares (as shown above).

When `mdx` is absent (inline-overlays / tags-only mode), the
`screen` auto-fill is skipped — there's no canonical screen id
to refer to.

### 3. Coordinate rebasing for sub-region overlays — auto, or explicit?

Phase 2 has two routes for the locator path:

- **(a) Auto** — the fixture calls `this.boundingBox()` internally and passes `clip` to `renderAnnotatedScreen`.
- **(b) Explicit** — user passes `annot.clip: { x, y, w, h }` themselves. No `boundingBox()` call inside the fixture.

**Default: (a).** "Take a screenshot of this locator" is the
common case; the locator's bounding box is the only sensible
clip. Forcing the user to call `boundingBox()` and pass the
result by hand is the pattern this whole plan exists to avoid.

When `boundingBox()` returns `null` (locator not currently
visible), the fixture throws with the diagnostic
`"locator.screenshot({ annot }): locator has no bounding box (probably not visible). Re-test with a stable selector / waitFor()."`

### 4. Overlays outside the clip — warning + skip, or fail?

When an overlay's page-space bbox falls outside the locator's
clip (or the explicit `clip` on a Page screenshot):

- **(a) Warning + skip.** The PNG still bakes, dropped overlays are recorded in `RenderResult.droppedOverlays`, the fixture logs a `test.info().annotations.push({ type: "warning", … })` entry.
- **(b) Fail-fast.** Throw immediately — the spec author probably wired the wrong locator.

**Default: (a).** A spec writer's first instinct is to use a
broad locator (`page.locator("main")`) and let the badges crop
themselves to the visible region. Erroring at the smallest
mismatch breaks that ergonomic. The `droppedOverlays` field +
the Playwright annotation surface make the dropped overlays
visible without failing the test.

A future flag — `annot.strictClip?: boolean` — could opt into
(b) when the user wants strict containment. Out of scope for v1.

### 5. MDX-derived SVG is empty — wrap as editable or fall through to tags-only?

When `annot.mdx` is supplied but the MDX has no `<Overlay>`
blocks (or none of them have matching bbox markers yet — the
snapshot was never captured), the MDX-derived `annotationsSvg`
fragment is empty.

- **(a) Wrap as editable with an empty annotations layer.** The output PNG carries the original capture + an empty `<svg/>` in the XMP. Re-opens cleanly in Annot Cloud as a "no annotations, you can add some" editable session.
- **(b) Fall through to tags-only sidecar.** No annotations element, no embedded original. Treats the case as "you have no overlays, just tag the file."

**Default: (a).** The user supplied `mdx: { id, path }` explicitly
— that's a declaration "this PNG is the canonical render of
screen X." Wrapping as editable matches that intent, regardless
of whether overlays exist yet. The receiver can open it in the
editor and add annotations, then save.

### 6. Future work (out of scope for v1)

The following ideas surfaced during plan kick-off and are NOT
addressed in this plan. Reserved for follow-up plans when
concrete demand appears:

- **Read-only / batched refresh mode.** `mdx.skipRefresh` was
  considered and dropped because its only natural partner is a
  separate `screen.capture()` call, which re-introduces the
  verbose pattern this plan exists to eliminate. Will revisit
  if (a) a CI dry-run workflow surfaces, or (b) batched refresh
  for shared-screen tests proves cost-justified.
- **`locator` form for inline overlays.** Currently
  `annot.overlays` accepts `BboxAnnotation[]` with explicit
  bbox coords. A v2 could accept Playwright `Locator` (or
  locator-flavour strings) and resolve to bboxes inside the
  fixture — mirroring `@ingcreators/annot-mcp`'s resolver. Worth
  it once the locator-resolution layer is shared rather than
  duplicated per package.
- **Failure-screenshot auto-wrapping.** Playwright's built-in
  `testInfo.attach()` failure-screenshot path could be hooked
  by the fixture to auto-wrap failures as editable PNGs. Real
  value but invasive — separate plan.
- **`annot.strictClip: boolean`.** Fail-fast on out-of-clip
  overlays. Default would stay `false` (warn + skip).

## References

- [`packages/product-docs/src/fixture.ts`](../../packages/product-docs/src/fixture.ts) — existing `screen` fixture + `captureScreen` helper; the new fixture extends this.
- [`packages/product-docs-astro/src/render.ts`](../../packages/product-docs-astro/src/render.ts) — `renderAnnotatedScreen` gets a `clip` option in Phase 2.
- [`packages/docs-site/tests/docs/annot-app.spec.ts`](../../packages/docs-site/tests/docs/annot-app.spec.ts) — Phase 1 call-site rewrite (4 steps → 1 line).
- [`packages/annotator/src/dsl/types.ts`](../../packages/annotator/src/dsl/types.ts) — `BboxAnnotation` DSL accepted by `annot.overlays`.
- [`docs/plans/_done/editable-png-from-annotator.md`](./_done/editable-png-from-annotator.md) — the immediate predecessor; this plan picks up where Phase 3 of that one left off.
- [Playwright `page.screenshot()`](https://playwright.dev/docs/api/class-page#page-screenshot) / [`locator.screenshot()`](https://playwright.dev/docs/api/class-locator#locator-screenshot) — the API shapes the fixture mirrors.
