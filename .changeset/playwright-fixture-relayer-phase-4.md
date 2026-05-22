---
"@ingcreators/annot-product-docs-astro": minor
---

**`@ingcreators/annot-product-docs-astro/playwright` becomes a
deprecated re-export** — Phase 4 of
`docs/plans/playwright-screenshot-fixture-relayer.md`. The fixture
that originally lived here moved to `@ingcreators/annot-playwright`
(generic patch) + `@ingcreators/annot-product-docs` (MDX resolver)
in Phases 1–3 of the plan. Phase 4 deletes the duplicate code
from this package and converts the `/playwright` subpath into a
shim that re-exports the canonical surface so existing callers
keep compiling.

```ts
// Was:
import { test } from "@ingcreators/annot-product-docs-astro/playwright";

// Now (recommended):
import { test } from "@ingcreators/annot-product-docs"; // with MDX
// or
import { test } from "@ingcreators/annot-playwright";   // without MDX
```

The deprecated subpath emits a one-time
`process.emitWarning("DeprecationWarning", …)` at import time so
the migration prompt shows up in CI logs. **Reference equality
preserved** — `test`, `expect`, `patchScreenshot`,
`rebaseAnnotations`, `describeAnnotation` are reference-equal to
their canonical homes; a new
`packages/product-docs-astro/src/playwright/index.test.ts`
asserts this.

**Removal target**: `@ingcreators/annot-product-docs-astro@0.5.0`,
matching the OQ-2 decision (b) in the parent plan — visible
deprecation, known sunset.

## render.ts switches to the canonical helpers

`renderAnnotatedScreen()` previously carried its own copies of
`resolveMdxAnnotations` / `parseSnapshotBoxes` /
`buildBadgeAnnotations` / `svgFromBadges` / `svgFromBboxAnnotations`
/ `emptyAnnotationsSvg`. Phase 2 of the plan moved the canonical
home into `@ingcreators/annot-product-docs`; this PR deletes the
duplicates from `product-docs-astro/render.ts` and consumes the
ones in product-docs going forward.

`resolveMdxAnnotations` + `svgFromBboxAnnotations` are re-exported
from `render.ts` for one deprecation cycle so existing callers
that imported them from `@ingcreators/annot-product-docs-astro`
keep compiling. `parseSnapshotBoxes` is dropped from the public
surface — new code should import it from
`@ingcreators/annot-product-docs` directly.

## peerDependencies cleanup

`@playwright/test` is removed from `peerDependencies` (and from
`peerDependenciesMeta`). The package no longer has a Playwright
relationship to advertise — the `/playwright` subpath is purely
a re-export shim, and its types flow through the
`@ingcreators/annot-product-docs` workspace dep transitively.
This matches the OQ-3 decision (b) in the parent plan.

## Verified

- `pnpm -r typecheck` — 20 packages, all pass.
- `pnpm test` — 252 files, 3641 tests, 0 failures. New
  `playwright/index.test.ts` (5 reference-equality assertions)
  passes; the deprecation `process.emitWarning` fires on
  import (visible in vitest output) but does not break anything.
- `pnpm lint` — exit 0; 29 pre-existing warnings unchanged.
- `pnpm --filter @ingcreators/annot-product-docs-astro build` —
  emits `dist/index.js` (3.96 kB / 1.71 kB gzip) +
  `dist/playwright/index.js` (0.85 kB / 0.39 kB gzip) — the
  shrunken subpath bundle reflects the re-export-only shape.
