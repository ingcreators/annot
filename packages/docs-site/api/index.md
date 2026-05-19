# API reference

::: tip Coverage
This reference covers the **public** API surface — every symbol
exported from the package roots. Internal helpers (per-file deep
imports under each package) aren't versioned and can change in
any patch release.
:::

## Modules

- [**`createAnnotator`**](./create-annotator.md) —
  factory for the headless annotator.
- [**Playwright fixture**](./playwright-fixture.md) —
  the `test.extend({ annotator })` surface.
- [**SVG helpers**](./svg-helpers.md) —
  `rectForBoundingBox`, `arrowBetween`, `textAt`.

## Stability commitments

The three published packages — `annot-core`, `annot-annotator`,
`annot-playwright` — follow [semver](https://semver.org).
Pre-1.0, minor bumps may include breaking changes; we'll call
them out in the [CHANGELOG][changelog] of the affected package.

Once any package reaches `1.0.0` it follows strict semver:
breaking changes go to a major version.

[changelog]: https://github.com/ingcreators/annot/blob/main/CHANGELOG.md

## How to consume

```ts
// Highest leverage — drop into your Playwright suite.
import { test, expect, rectForBoundingBox } from "@ingcreators/annot-playwright";

// Headless renderer — Node CLI, build pipeline, custom CI.
import { createAnnotator } from "@ingcreators/annot-annotator";

// Format primitives — building a new host.
import { type ImageRecord, parseAnnotationSvg } from "@ingcreators/annot-core";
```
