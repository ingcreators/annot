# `@ingcreators/annot-annotator` package — Phase 1

> **Status:** Done — landed [`#751`](https://github.com/ingcreators/annot/pull/751) 2026-05-18
> **Compatibility:** Builds on the Phase 0 spike landed in
>   [`#750`](https://github.com/ingcreators/annot/pull/750)
>   (`docs/plans/_done/headless-annotator-spike.md`). Workspace
>   package stays `private: true`; the actual npm publish is
>   Phase 3, gated on Changesets.
> **Risk:** New public API surface — the contract decided here
>   carries through to npm. Reviewers should optimise for "shape
>   we can live with at v1.0", not "smallest diff."

## Context

Phase 0 proved the rasterisation path works (`@resvg/resvg-js`
→ PNG bytes) and the Tier-A invariant holds under plain Node.
The spike's loose `(originalDataUrl, annotationsInnerXml, w, h)`
tuple is not a shippable API — it accepts pre-extracted inner XML
rather than the editor's saved `annotations.svg`, and it has no
font registration, no JPEG path, no sanitisation.

Phase 1 builds the public API on top of the spike's rasterisation
primitive. The package stays `private: true` (Phase 3 flips that
and publishes), but the API surface is the one we ship.

This is the foundation Phase 2's Playwright fixture composes
against.

## Design

### Public API

```ts
import { createAnnotator } from "@ingcreators/annot-annotator";

const annotator = createAnnotator({
  // resvg-js font options (all optional)
  fontFiles: ["./fonts/NotoSans.ttf"],
  fontDirs: ["./fonts/"],
  loadSystemFonts: false,        // default: false (deterministic CI)
  defaultFontFamily: "Noto Sans",
});

// Accepts anything ImageRecord-shaped (a real ImageRecord works).
const png: Uint8Array = annotator.toPng({
  originalDataUrl: "data:image/png;base64,...",
  annotationsSvg: "<svg ...>...</svg>",  // editor's saved output
  width: 1280,
  height: 720,
});

// Or just produce the merged SVG (no rasterisation) — useful for
// callers that want to feed our output into another tool.
const svg: string = annotator.toSvg({ ... });
```

Types:

```ts
export interface AnnotatorInput {
  originalDataUrl: string;
  annotationsSvg: string;
  width: number;
  height: number;
}

export interface AnnotatorOptions {
  fontFiles?: string[];
  fontDirs?: string[];
  loadSystemFonts?: boolean;       // default false
  defaultFontFamily?: string;
}

export interface Annotator {
  toPng(input: AnnotatorInput): Uint8Array;
  toSvg(input: AnnotatorInput): string;
}

export function createAnnotator(options?: AnnotatorOptions): Annotator;
```

`AnnotatorInput` is intentionally a structural subset of
`ImageRecord` (no `path` / `tags` / `createdAt` / etc.). Callers
holding a real `ImageRecord` pass it directly — TypeScript's
structural typing accepts the extra fields. Callers holding a
`page.screenshot()` Buffer + a base64 conversion construct
the input themselves. The Phase 2 Playwright fixture's API is
ergonomic on top of this.

### SVG sanitisation

The editor's `exportAnnotationsSvgForIdb`
([`packages/editor/src/export.ts`](../../packages/editor/src/export.ts))
already pre-processes the saved SVG: removes `#ui-overlay`,
removes the base image direct-child, lifts `#annotations` group
children. But the **defs survive** — including the editor's
`<style data-annot-fonts>` block which resvg-js can't use and
which adds noise.

Phase 1 adds a Tier-A XML walker (using `@xmldom/xmldom` — pure
JS, no global pollution) that:

1. Parses `input.annotationsSvg` with `@xmldom/xmldom`'s
   `DOMParser`.
2. Walks the root's children, building a sanitised inner XML:
   - `<defs>` — kept; child `<style data-annot-fonts>` removed.
   - Top-level `<image>` with no `data-redact-style` — skipped
     (legacy: in case the wrapper still carries the base bitmap).
   - `#ui-overlay` — skipped (legacy: same reason).
   - `#annotations` group — children lifted (legacy: same reason).
   - Anything else — passed through.
3. Returns the sanitised inner XML string.

Then the annotator composes its outer `<svg>` wrapper with the
base image + sanitised inner XML, exactly as the spike did but
with the editor's real output instead of a hand-built fragment.

### Font registration

`@resvg/resvg-js`'s constructor takes a `font` option with
`loadSystemFonts` / `fontFiles` / `fontDirs` / `defaultFontFamily`.
The annotator forwards these from `AnnotatorOptions` directly.

Defaults differ from resvg-js's defaults:

- `loadSystemFonts: false` (resvg-js default is `true`) — CI
  determinism matters more than "looks right on the dev's mac."
  Callers who want system fonts opt in.
- No font files registered by default — callers register their
  own.

When the option set is empty AND `loadSystemFonts: false`, resvg
falls back to its built-in font. Text renders but glyphs may be
boxes for unusual scripts. Documented in the README.

### Out of scope for Phase 1

- **JPEG output.** Resvg-js is PNG-only. JPEG via `sharp` is a
  Phase 1.5 follow-up: optional peer dep, lazy-loaded, falls
  through to PNG if not installed. The Phase 1 API surface
  doesn't preclude this — adding `toJpeg(input, { quality })`
  later is purely additive.
- **Performance benchmarking.** Once the API stabilises.
- **CJK font bundling.** Out-of-the-box JP/CN support is a
  product decision for Phase 1.5+; defaults are deliberately
  conservative.

### File layout after Phase 1

```
packages/annotator/
├── README.md                          (new, replaces SPIKE_REPORT.md role)
├── SPIKE_REPORT.md                    (kept — historical Phase 0 record)
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                       (export createAnnotator + types)
    ├── annotator.ts                   (createAnnotator implementation)
    ├── annotator.test.ts              (contract tests for the public API)
    ├── sanitise-svg.ts                (Tier-A XML walker)
    ├── sanitise-svg.test.ts
    └── headless-coexistence.test.ts   (kept + extended to import the
                                         Phase 1 public surface)
```

The Phase 0 `render.ts` / `render.test.ts` are removed — their
shape (`renderImageRecordToPngBytes` taking a loose
`(dataUrl, innerXml, w, h)` tuple) is superseded by the public
`createAnnotator().toPng()` API; the spike's test coverage
migrates to `annotator.test.ts` + `sanitise-svg.test.ts`.

## Phased plan

Single PR. The Phase 1 work is bounded; splitting it doesn't help
review. Subsections:

1. Add `@xmldom/xmldom` dependency.
2. Implement `src/sanitise-svg.ts` + tests.
3. Implement `src/annotator.ts` with `createAnnotator` + types.
4. Tests for `createAnnotator` covering: round-trip through
   sanitisation, font option forwarding, both `toPng` + `toSvg`
   paths.
5. Update `src/index.ts` to export the public API only.
6. Replace `packages/annotator/SPIKE_REPORT.md` references with
   the new `packages/annotator/README.md` (keep SPIKE_REPORT.md
   itself as historical Phase 0 record).
7. Move this plan to `_done/` and update `docs/plans/README.md`
   in the same PR. (Auto-merge authorisation per
   `feedback_headless_annotator_phase_merge_authorization.md`.)

## Verification

- `pnpm --filter @ingcreators/annot-annotator typecheck` green.
- `pnpm test` green; the new contract tests are in the count.
- `pnpm lint` exit 0.
- New test asserts: feeding a real editor-style `annotationsSvg`
  (with `<defs><style data-annot-fonts>...</style></defs>` plus a
  base image inside the wrapper) through `toSvg` returns a
  sanitised SVG without those elements, and `toPng` returns a
  valid PNG.
- `headless-coexistence.test.ts` continues to pass — adding
  `@xmldom/xmldom` did not pollute `globalThis`.

## Migration notes

None — package is still private. Public-API stability commitments
land in Phase 3 alongside the first npm publish.
