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
      id: "app-overview",
      mdxPath: "src/content/docs/app/index.mdx",
    },
  });
});
```

— the `annot: { … }` nested option opts the call into
"refresh MDX snapshot + bake editable PNG" mode. Plain
`page.screenshot({ path })` still works unchanged.

`locator.screenshot({ annot: { … } })` works the same way for
sub-region captures (Phase 2).

## Why the `annot: { … }` nested key

Discussed during plan kick-off — two candidate API shapes:

```ts
// (A) Flat annotId / annotMdxPath / annotEditable / annotTags
await page.screenshot({ path, annotId: "x", annotMdxPath: MDX_PATH });

// (B) Nested `annot: { id, mdxPath, editable, tags }`
await page.screenshot({ path, annot: { id: "x", mdxPath: MDX_PATH } });
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

## Why intercept `page` instead of adding `screen.screenshot()`

Also discussed:

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
fall through to vanilla behaviour. Adding `annot: { id, mdxPath }`
by hand to a codegen-generated skeleton is the standard editing
flow.

## Phases

| Phase | Output | Estimate |
|---|---|---|
| 1 | `@ingcreators/annot-product-docs-astro/playwright` subpath; `page.screenshot` interception; docs-tour spec rewrite | ~3 hours |
| 2 | `locator.screenshot` interception + coordinate rebasing for sub-region overlays | ~3 hours |
| 3 | Documentation + migration guide + Open Question follow-ups | ~1 hour |

## Phase 1 — `page.screenshot` interception

### New file: `packages/product-docs-astro/src/playwright/fixture.ts`

```ts
import { writeFile } from "node:fs/promises";
import type { Page, PageScreenshotOptions } from "@playwright/test";
import { test as base } from "@ingcreators/annot-product-docs";
import { renderAnnotatedScreen } from "../render.js";

const ANNOT_PATCHED = Symbol.for("@ingcreators/annot:screenshot-patched");

export interface AnnotScreenshotOptions {
  /** `<Screen id>` value in the MDX. */
  id: string;
  /** Path to the MDX (absolute or cwd-relative). */
  mdxPath: string;
  /**
   * Emit a re-editable PNG (XMP-embedded original + annotations
   * SVG). Defaults to `true` — flat raster is rarely what you want
   * once you're already running the snapshot-refresh path.
   */
  editable?: boolean | { tags?: Record<string, string> };
  /**
   * Skip the MDX snapshot refresh. Useful when the call site has
   * already invoked `screen.capture()` and just wants the
   * editable PNG. Defaults to `false` (refresh runs by default).
   */
  skipSnapshotRefresh?: boolean;
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
```

The interception body:

```ts
function patchScreenshot(proto: any) {
  if (proto[ANNOT_PATCHED]) return;
  const original = proto.screenshot;
  proto.screenshot = async function (opts: any = {}) {
    if (!opts.annot) return original.call(this, opts);
    return runAnnotMode.call(this, original, opts);
  };
  proto[ANNOT_PATCHED] = true;
}

async function runAnnotMode(
  this: Page,            // or Locator (Phase 2)
  original: Function,
  opts: PageScreenshotOptions & { annot: AnnotScreenshotOptions },
) {
  // 1. Take the raw screenshot (no path — we write later).
  const rawBytes = await original.call(this, { ...opts, path: undefined, annot: undefined });

  // 2. Refresh MDX snapshot (unless opted out).
  if (!opts.annot.skipSnapshotRefresh) {
    await captureScreen(getPageFromContext(this), {
      id: opts.annot.id,
      mdxPath: opts.annot.mdxPath,
    });
  }

  // 3. Bake editable PNG.
  const result = await renderAnnotatedScreen({
    mdxPath: opts.annot.mdxPath,
    screenId: opts.annot.id,
    basePngBytes: rawBytes,
    editable: opts.annot.editable ?? true,
  });

  // 4. Write to path if given (mirrors page.screenshot semantics).
  if (opts.path) await writeFile(opts.path, result.bytes);

  return Buffer.from(result.bytes);
}
```

### `package.json` export

```jsonc
"./playwright": "./src/playwright/index.ts",
```

### Tests

`packages/product-docs-astro/src/playwright/fixture.test.ts`:

- **Vanilla pass-through** — `page.screenshot({ path: ... })` (no `annot`) calls the original method with original opts.
- **annot mode flag** — `page.screenshot({ annot: { id, mdxPath } })` invokes `captureScreen` + `renderAnnotatedScreen` and writes the editable PNG.
- **`path` semantics** — bytes returned by the fixture round-trip via `readEditablePngBytes`; `path`-given output exists on disk.
- **`skipSnapshotRefresh`** — when `true`, no MDX write occurs (assert via temp file mtime).
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
        id: "app-overview",
        mdxPath: "src/content/docs/app/index.mdx",
      },
    });
  });
});
```

Down from 4 coordinated steps + a `Uint8Array` cast to one
`page.screenshot()` call. The `source` / `screen` / `capturedAt`
tags previously hand-built are auto-filled by the fixture (Open
Question 3).

## Phase 2 — `locator.screenshot` interception + coord rebasing

`locator.screenshot()` returns a PNG cropped to the locator's
bounding box. Overlay coordinates in the stored snapshot are
page-space — to overlay correctly on the cropped image we need
to:

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
- **`page.screenshot({ clip, annot })` matches `locator.screenshot({ annot })`** — when the clip and the locator's bounding box are equal, output bytes' XMP records are byte-identical.

## Phase 3 — Docs + migration guide

- Update `packages/docs-site/src/content/docs/api/create-annotator.mdx`'s "Re-editable PNG" example with a new "From a Playwright test" section showing the `page.screenshot({ annot })` form.
- New page: `packages/docs-site/src/content/docs/product-docs/playwright-fixture.mdx` covering the import, the `annot` option shape, the codegen→hand-edit workflow, and the locator example.
- Migration note in `@ingcreators/annot-product-docs-astro`'s README on switching from `renderAnnotatedScreen` direct calls to the fixture (the function stays exported, the fixture is the recommended path).
- Plan archive `_done/` move + `docs/plans/README.md` update.

## Open Questions

### 1. `editable` default — `true` or `false`?

The fixture runs `renderAnnotatedScreen({ editable: opts.annot.editable ?? ??? })`.

- **(a) Default `true`.** The fixture entry point is "I'm doing annot-aware screenshots" — flat raster is the unusual ask. Users who specifically want flat write `annot: { …, editable: false }`.
- **(b) Default `false`.** Matches Phase 3 of `editable-png-from-annotator` — `renderAnnotatedScreen({ editable: undefined })` is flat. Symmetry with the underlying function.

**Default: (a).** Once the user has opted into the fixture
(import path) and into annot mode (`annot: { id, mdxPath }`),
the value-add of the fixture IS the editable PNG. Asking them to
opt in twice is friction.

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

- **(a) Fixture auto-fills `source: "playwright-fixture"` / `screen: id` / `capturedAt: now` / `commit: $GITHUB_SHA`; user can override per call.**
- **(b) Fixture writes nothing; user supplies all tags.**
- **(c) Fixture writes ONLY `capturedAt` + `commit` (the obvious "free" metadata); user supplies the rest.**

**Default: (a).** Annot is the producer; it should know to label
itself. Matches the `WELL_KNOWN_TAG_KEYS` convention from
`@ingcreators/annot-core/xmp-bytes`. User overrides any field
just by setting it in `annot.tags`.

`source` default is `"playwright-fixture"` rather than
`"docs-tour"` — the fixture is a general tool, the docs-tour is
one of its callers. The docs-tour spec can override `source` to
`"docs-tour"` if it cares.

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

When a `<Screen>` declares overlays whose page-space bbox falls
outside the locator's clip:

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

## References

- [`packages/product-docs/src/fixture.ts`](../../packages/product-docs/src/fixture.ts) — existing `screen` fixture + `captureScreen` helper; the new fixture extends this.
- [`packages/product-docs-astro/src/render.ts`](../../packages/product-docs-astro/src/render.ts) — `renderAnnotatedScreen` gets a `clip` option in Phase 2.
- [`packages/docs-site/tests/docs/annot-app.spec.ts`](../../packages/docs-site/tests/docs/annot-app.spec.ts) — Phase 1 call-site rewrite (4 steps → 1 line).
- [`docs/plans/_done/editable-png-from-annotator.md`](./_done/editable-png-from-annotator.md) — the immediate predecessor; this plan picks up where Phase 3 of that one left off.
- [Playwright `page.screenshot()`](https://playwright.dev/docs/api/class-page#page-screenshot) / [`locator.screenshot()`](https://playwright.dev/docs/api/class-locator#locator-screenshot) — the API shapes the fixture mirrors.
