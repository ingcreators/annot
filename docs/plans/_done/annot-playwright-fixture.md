# `@ingcreators/annot-playwright` fixture — Phase 2

> **Status:** Done — landed [`#752`](https://github.com/ingcreators/annot/pull/752) 2026-05-18
> **Compatibility:** Builds on Phase 1's `@ingcreators/annot-annotator`
>   (landed [`#751`](https://github.com/ingcreators/annot/pull/751)).
>   New workspace package; `@playwright/test` is a peer
>   dependency so the fixture can extend the user's existing
>   Playwright test runner without forcing a particular version.
>   Workspace package stays `private: true`; npm publish is
>   Phase 3.
> **Risk:** New public API on top of the Phase 1 API. Adding new
>   helpers later is easy; renaming the existing ones isn't.
>   Reviewers should optimise for "shape we can live with at v1.0."

## Context

Phase 1 built the headless annotator. This phase wraps it in an
idiomatic Playwright fixture so a test engineer can annotate
screenshots inline:

```ts
import { test, expect } from "@ingcreators/annot-playwright";

test("submit button is enabled", async ({ page, annotator }, testInfo) => {
  await page.goto("/login");
  const submitBtn = page.getByRole("button", { name: "Submit" });
  try {
    await expect(submitBtn).toBeEnabled();
  } catch (err) {
    const bbox = await submitBtn.boundingBox();
    if (bbox) {
      const annotated = await annotator.annotateScreenshot(page, {
        annotationsSvg: rectForBoundingBox(bbox, { stroke: "red" }),
      });
      await testInfo.attach("failure.png", { body: annotated });
    }
    throw err;
  }
});
```

This is the headline use case the strategic Playwright vector in
`PRODUCT_DIRECTION.md` is calibrated against.

## Design

### Public API

```ts
export { test, expect } from "@playwright/test"; // re-exports, with `test` extended

// helpers — pure SVG-string builders, work without Playwright too
export function rectForBoundingBox(
  bbox: { x: number; y: number; width: number; height: number },
  opts?: { stroke?: string; strokeWidth?: number; fill?: string },
): string;

export function arrowBetween(
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts?: { color?: string; strokeWidth?: number },
): string;

export function textAt(
  at: { x: number; y: number },
  content: string,
  opts?: { color?: string; fontSize?: number; anchor?: "start" | "middle" | "end" },
): string;

// fixture-exposed types
export interface PlaywrightAnnotator {
  /** Underlying Phase 1 annotator. */
  raw: Annotator;
  /**
   * Take a screenshot of the page and overlay annotations.
   * Returns PNG bytes ready to `testInfo.attach()` or write to
   * disk.
   */
  annotateScreenshot(
    page: Page,
    opts: { annotationsSvg: string },
  ): Promise<Uint8Array>;
}
```

`test` extends Playwright's base test with an `annotator` fixture:

```ts
export const test = base.extend<{ annotator: PlaywrightAnnotator }>({
  annotator: async ({}, use) => {
    const raw = createAnnotator();
    await use({ raw, annotateScreenshot: ... });
  },
});
```

Callers `import { test, expect } from "@ingcreators/annot-playwright"`
instead of `from "@playwright/test"` — gain the annotator without
having to wire fixtures themselves.

### Helper-function design

Helpers return **SVG fragment strings**, not full documents. They
compose:

```ts
const svg = [
  rectForBoundingBox(bbox, { stroke: "red" }),
  arrowBetween({ x: 100, y: 100 }, { x: bbox.x, y: bbox.y }, { color: "red" }),
  textAt({ x: 100, y: 90 }, "expected enabled", { color: "red" }),
].join("");
```

Strings instead of an AST keep the helper API small and let users
drop in raw SVG for shapes the helpers don't cover. The Phase 1
sanitiser inside the annotator wraps these in the rasterise-ready
SVG.

`arrowBetween` uses a small inline `<marker>` def for the
arrowhead so the helper is self-contained — no shared `<defs>`
required across calls.

### Why an `annotateScreenshot` helper

A naive caller could:

```ts
const png = await page.screenshot();
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
const viewport = page.viewportSize()!;
const annotated = annotator.raw.toPng({
  originalDataUrl: dataUrl,
  annotationsSvg: customSvg,
  width: viewport.width,
  height: viewport.height,
});
```

`annotateScreenshot` collapses that boilerplate. Width / height
come from the screenshot itself (read from the PNG IHDR chunk)
rather than `page.viewportSize()`, so it works for clip-cropped
screenshots and full-page captures too.

### Testing strategy

- **Helpers** (rectForBoundingBox / arrowBetween / textAt) are
  pure functions — tested with vitest directly.
- **Fixture** unit test: a mocked Playwright `Page` (just the
  `screenshot()` method we use) is passed to `annotateScreenshot`,
  asserting it produces a valid PNG.
- **Real Playwright integration test**: out of scope for the
  Phase 2 PR. The fixture's runtime is exercised on every Annot
  release once we wire it into our own E2E suite (separate
  follow-up plan).

### `@playwright/test` as peerDependency

The fixture must `import { test as base } from "@playwright/test"`
so the user's existing Playwright version drives the runner. We
declare `@playwright/test` as `peerDependencies` (no version pin
beyond `*` for the initial v0.1) AND as `devDependencies` so our
own tests resolve it.

### File layout

```
packages/playwright/
├── README.md
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                  (barrel — test + expect + helpers)
    ├── fixture.ts                (test = base.extend({ annotator })
    │                              + PlaywrightAnnotator interface)
    ├── fixture.test.ts           (mocked Page smoke test)
    ├── helpers.ts                (rectForBoundingBox + arrowBetween + textAt)
    └── helpers.test.ts
```

## Phased plan

Single PR.

1. Add `packages/playwright/` workspace package skeleton.
2. Implement `helpers.ts` + `helpers.test.ts` (the pure functions
   — useful even without Playwright).
3. Implement `fixture.ts` + `fixture.test.ts` (mocked Page).
4. Wire `src/index.ts` to re-export `test` (extended) + `expect`
   (passthrough) + the helpers.
5. Author `packages/playwright/README.md` (usage examples,
   `testInfo.attach()` recipe).
6. Move this plan to `_done/` and update `docs/plans/README.md`.

## Verification

- `pnpm --filter @ingcreators/annot-playwright typecheck` green.
- `pnpm test` green; new contract tests are in the count.
- `pnpm lint` exit 0.
- Mocked `Page` smoke test asserts: the fixture's
  `annotateScreenshot` produces a valid PNG byte array from a
  stub screenshot + a one-rect annotation.

## Migration notes

None — package is still private. Phase 3 flips it (and
`@ingcreators/annot-annotator`) to `private: false` and runs
the first npm publish via Changesets.
