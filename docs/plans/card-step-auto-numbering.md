# Auto-numbering for card-style step documents

> **Status:** Draft
> **Compatibility:** Extends the `.annot.html` v1 format from
> [`_done/annot-html-document.md`](./_done/annot-html-document.md) and
> the card document mechanics from
> [`_done/card-procedure-template.md`](./_done/card-procedure-template.md).
> Adds an opt-in `NumberingMeta.steps` flag and a `::before` CSS
> counter on `[data-annot-block="step"]`. The pre-fill that bakes
> `"Step 1"` / `"Image 1"` into step titles at creation time goes
> away. Touches `@ingcreators/annot-doc` (Tier A), `@ingcreators/annot-host-ui`
> (Tier C — dialog + generator), `@ingcreators/annot-render` (PPTX
> export — must emit `index + 1` literally since OOXML has no CSS
> counters). Schema delta is purely additive — `data-annot-doc-version`
> stays at 1.
> **Risk:** Five phases, additive throughout. Each phase lands as an
> independently revertable PR. The only behaviour change visible to
> existing documents is the auto-strip migration in Phase 4 (strips
> the legacy `"Step N "` / `"Image N "` title prefix on parse), and
> only when the user enables `numbering.steps` in the dialog.

## Context

The card-procedure flow ([`_done/card-procedure-template.md`](./_done/card-procedure-template.md))
shipped with a hard-coded numbering scheme: the
`createCardDocumentFromImages` generator pre-fills each step's
title with the string `"Step 1"` / `"Step 2"` / … (or
`"Image 1"` / …) at creation time. The number lives in the title
text itself.

This works for the initial creation flow but breaks down in three
ways:

1. **Reorder doesn't update numbers.** A user drags step 3 to the
   top of the document; the title still says `"Step 3"`. The
   numbers become misleading.
2. **Numbers compete with titles for visual attention.** A title
   like `"Step 1 Open the settings dialog"` reads as one phrase
   with a weird capitalisation pattern; the number is structurally
   part of a different layer than the editorial title, and the
   visual presentation should reflect that.
3. **Editing the title risks deleting the number.** Users select-
   all + retype, the number is gone. No way to restore it without
   manual re-typing.

The annotation tool space has converged on a designed numbered-badge
treatment: Scribe shows a large numeral badge on the corner of each
step card; Notion's "step" callout puts the number in a coloured
circle. The visual treatment makes the number an unmistakable
"this is step N", separate from the editorial content.

This plan brings card documents in line with that convention via
CSS counters — a small data-layer change (one boolean in
`NumberingMeta`) drives a large UX upgrade. Reorder via the
existing drag-handle mechanism automatically updates the numbers
because the counter increments on every `[data-annot-block="step"]`
in document order.

## Design

### Numbering source of truth

The number for step N is **never stored** in the document model
once this plan lands. It's derived at render time from the step
block's position in the document, via:

- CSS counter `annot-step` incrementing on every
  `[data-annot-block="step"]` selector. The counter resets on the
  `<article data-annot-doc>` element so it spans the whole
  document.
- A `::before` pseudo-element on each step block displaying
  `counter(annot-step)`.

This is the same mechanism the existing `NumberingMeta.headings`
and `NumberingMeta.figures` use (added in Phase 13a of
[`_done/annot-html-document.md`](./_done/annot-html-document.md)).
Step numbering is the third counter in the family.

### Data layer: `NumberingMeta.steps`

```ts
export interface NumberingMeta {
  readonly headings?: boolean;
  readonly figures?: boolean;
  readonly figureLabel?: string;
  // NEW
  readonly steps?: boolean;
  /** Optional override for the badge content template.
   *  Defaults to `"%n"` (just the number). Common alternatives:
   *  `"Step %n"`, `"%n."`, `"%n /"`. `%n` is required and gets
   *  replaced by the CSS counter; everything else is literal. */
  readonly stepLabel?: string;
}
```

Both fields are optional. Absent / `false` → no step numbering
(the current behaviour for documents that opt out). Setting
`steps: true` enables the badge; `stepLabel` lets the user
parameterise the content without code changes.

### Visual layer: corner-mounted badge

The badge is positioned by CSS as a child pseudo-element on the
step section. The default placement is **top-left, half-overlapping
the card boundary** — the Scribe pattern from earlier discussion.

```css
[data-annot-block="step"]::before {
  content: counter(annot-step);  /* or counter() with prefix when stepLabel is set */
  counter-increment: annot-step;
  position: absolute;
  top: -0.75rem;
  left: -0.75rem;
  width: 2.5rem;
  height: 2.5rem;
  display: grid;
  place-items: center;
  background: var(--annot-step-badge-bg);
  color: var(--annot-step-badge-fg);
  border-radius: var(--annot-step-badge-radius);
  font-weight: 700;
  font-size: 1.15rem;
  box-shadow: var(--annot-step-badge-shadow);
  /* Make sure the badge sits above the card image overflow clip. */
  z-index: 2;
}
```

Caveat: the current `[data-annot-block="step"]` rule has
`overflow: hidden` (so card-image clipping works). To let the
badge bleed outside the card boundary, we either:

- Add **outer padding** to the section so the badge sits inside
  the card's visual bounds (no `overflow: hidden` conflict).
  Simpler but loses the "bleed across the border" effect.
- Move the `overflow: hidden` from the section to an **inner
  image slot wrapper**. The card section becomes `overflow:
  visible`; the image wrapper inside still clips. This is more
  invasive but preserves the design intent.

The plan picks **option B** (inner wrapper) — the visual payoff
is worth the small structural change. Phase 1 includes the
wrapper rename.

### Layout-specific badge placement

The card has five `data-step-layout` variants. The badge sits in
the top-left in four of them; `image-fill` needs special
treatment because the whole card is the image and a corner badge
would collide with image content:

| Layout | Badge position |
|---|---|
| `image-top` / `image-bottom` / `image-left` / `image-right` | Top-left corner of the card, half-bleeding outside. |
| `image-fill` | Top-left corner **inside** the image, with a semi-transparent dark backdrop blur (`backdrop-filter: blur(8px) saturate(150%)`) so the numeral stays readable. |

The override is a single sub-selector:

```css
[data-annot-block="step"][data-step-layout="image-fill"]::before {
  top: 0.75rem;
  left: 0.75rem;
  background: rgba(0, 0, 0, 0.55);
  color: white;
  backdrop-filter: blur(8px) saturate(150%);
}
```

### Multi-column grid: collision avoidance

The `cardLayout.columns` setting (`1` / `2` / `3` / `"auto"`)
packs cards into a CSS grid. Cards in columns 2+ have their badge
overlapping the previous column's card if `gap` is small. Phase 1
enforces `gap: max(1.5rem, var(--annot-doc-card-gap))` for
multi-column docs so the half-bleed badge has clearance. Single-
column docs keep their current spacing.

### PPTX export

OOXML has no CSS counter. The PPTX side computes `index + 1`
explicitly while walking step blocks, and emits a `<p:sp>` shape
in the slide's top-left corner for each step. The shape is a
circle (`<a:prstGeom prst="ellipse">`) with the numeral as the
text content. Default colours come from
`document-pptx.ts`'s existing theme; later plans
([`card-pptx-templates.md`](./card-pptx-templates.md)) make the
badge style template-driven.

The badge is only emitted when `doc.meta.numbering?.steps === true`.

### Editor view parity

`<annot-doc-shell>` reads `doc.styleBlock` and applies it to its
own DOM (no shadow root — see [CLAUDE.md guardrail #10](../../CLAUDE.md)).
The same `::before` rule that lights up in standalone view also
applies inside the editor. No editor-specific code change is
needed for badge rendering — the existing CSS injection pipeline
handles it.

The doc-settings dialog gains a new "Step numbering" row in the
Numbering section (next to the existing headings / figures
toggles). Setting it on / off rewrites `doc.meta.numbering.steps`,
which triggers a fresh `injectDocumentStyles` call, which updates
the `<style>` block, which re-renders.

### Migration: legacy "Step N" / "Image N" title prefixes

Documents created before this plan lands have their numbers baked
into title text. Two strategies for these:

- **Leave them alone.** Documents that don't opt into
  `numbering.steps` keep their prefilled titles. No migration.
- **Auto-strip on enable.** When the user toggles
  `numbering.steps = true` on a document that has prefilled
  titles, the dialog confirms: "Strip existing 'Step N' / 'Image N'
  prefixes from step titles? You can undo via the editor's undo
  stack." On confirm, the document walks every step block and
  strips the leading `/^(Step|Image) \d+\s*/` from `title`.

Phase 4 picks strategy B (with the confirmation). The auto-strip
is **opt-in** per document; a user who wants both the badge AND
the literal title prefix (unlikely, but valid) can decline the
strip and leave the duplication.

### Default numbering for new card documents

The Create Card Document dialog
([`create-card-document-dialog.ts`](../../packages/host-ui/src/ui/create-card-document-dialog.ts))
has a "Numbering" dropdown with `none` / `step-n` / `image-n`.
After this plan:

- The dropdown becomes a **two-axis control**: a checkbox "Enable
  step numbering" (drives `meta.numbering.steps`) and a label
  format dropdown (drives `meta.numbering.stepLabel`: `%n` /
  `Step %n` / `%n.` / `%n /`).
- The legacy `step-n` / `image-n` options stop pre-filling
  titles. Instead they map to `numbering.steps = true` + the
  appropriate `stepLabel`.

`createCardDocumentFromImages`'s `numbering` option becomes a
no-op for title-prefill purposes (titles are always empty in
generated documents from Phase 4 onward), but stays in the API
to set the `meta.numbering.steps` / `stepLabel` fields on the
generated `AnnotDocument`.

## Phased plan

One PR per phase, each independently revertable.

### Phase 1 — Data layer + structural wrapper

- Add `steps?: boolean` and `stepLabel?: string` to `NumberingMeta`
  in [`packages/doc/src/types.ts`](../../packages/doc/src/types.ts).
- Parser preserves the fields verbatim
  ([`parse.ts`](../../packages/doc/src/parse.ts)).
- Serialiser emits them via the existing canonicalisation order
  ([`serialize.ts`](../../packages/doc/src/serialize.ts)).
- Move the `overflow: hidden` from `[data-annot-block="step"]`
  onto the image slot wrapper (`.annot-doc-image-svg-slot`) in
  [`inject-styles.ts:stepBlockRules`](../../packages/doc/src/inject-styles.ts).
  Verify card-image clipping still works (image-fill in
  particular).
- Goldens updated: round-trip a doc with `numbering: { steps: true,
  stepLabel: "Step %n" }` through parse → serialise → byte-equal.

**Verified:** typecheck + unit tests + visual diff in Storybook.

### Phase 2 — CSS counter + badge styling

- Extend `numberingRules()` in [`inject-styles.ts`](../../packages/doc/src/inject-styles.ts)
  with a `step` branch:
  - `counter-reset: annot-step` on the article when
    `numbering.steps === true`.
  - `[data-annot-block="step"] { counter-increment: annot-step }`.
  - `[data-annot-block="step"]::before { content: <template> }`
    where `<template>` is parsed from `stepLabel` (replace `%n`
    with `counter(annot-step)`, treat the rest as literal CSS
    `content` strings).
- Add new CSS variables — `--annot-step-badge-bg`,
  `--annot-step-badge-fg`, `--annot-step-badge-radius`,
  `--annot-step-badge-shadow` — to both light and dark var sets.
  Defaults: accent-blue background, white foreground, 50% radius
  (circle), soft drop shadow.
- Layout-specific override for `image-fill` (translucent backdrop
  inside the image).
- Multi-column grid: bump `gap` to `max(1.5rem, var(--annot-doc-card-gap))`
  when `cardLayout.columns !== 1`.
- Storybook story `Document / Cards / Step Numbering` showing
  on / off, each layout, single-column / multi-column.

**Verified:** Storybook visual review + unit test for the
`stepLabel` → CSS `content` parser (handles `%n`, escapes
literal quotes).

### Phase 3 — Settings dialog wiring

- Doc Settings dialog gains a "Step numbering" toggle and a label-
  format dropdown in the Numbering section
  ([`doc-settings-dialog.ts`](../../packages/host-ui/src/ui/doc-settings-dialog.ts)).
- Toggling rewrites `doc.meta.numbering` via DocumentHistory.
- Create Card Document dialog's `Numbering` dropdown is refactored
  to drive `meta.numbering.steps` + `stepLabel` (Phase 4 removes
  the title-prefill side effect; this phase keeps both for
  byte-compat with the legacy generator output).

**Verified:** Story for the dialog showing the new control, manual
test toggling on / off in a live document.

### Phase 4 — Drop title pre-fill + migrate legacy titles

- `buildStepTitle` in [`create-card-document.ts`](../../packages/host-ui/src/gallery/create-card-document.ts)
  returns `""` unconditionally — generated documents have empty
  step titles, the badge carries the number.
- The legacy `CardDocumentNumbering` type stays as a deprecated
  alias for back-compat (maps to `meta.numbering` fields).
- One-time auto-strip: when the user toggles
  `numbering.steps = true` in the dialog AND the document has any
  step block whose `title` matches `/^(Step|Image) \d+\s*/`, the
  dialog opens a `showConfirmDialog`:
  > Some step titles already start with "Step N" / "Image N".
  > Strip these prefixes so the badge and title don't duplicate
  > the number?
  > [ Strip prefixes ] [ Keep titles as-is ]
- Confirm → walk all step blocks, regex-strip the leading number,
  push a single DocumentHistory snapshot (undoable).

**Verified:** Unit test for the strip regex (handles `Step 1`,
`Step 10`, `Image 99 `, leading whitespace, multi-byte titles
without prefix).

### Phase 5 — PPTX badge emit + docs

- `document-pptx.ts` adds a per-slide badge shape for step blocks
  when `doc.meta.numbering?.steps === true`. The shape is a
  small circle in the top-left with the numeral; default size
  `~64 px diameter` at the 1280×720 slide canvas.
- Default colours: PPTX theme `<a:accent1>` for fill, white for
  text. Templates from
  [`card-pptx-templates.md`](./card-pptx-templates.md) (TBD)
  will eventually override these.
- Doc format reference page updated to include `numbering.steps`
  and `numbering.stepLabel`
  ([`docs/annot-html-format.md`](../../docs/annot-html-format.md)
  — created if missing per
  [`_done/annot-html-document.md`](./_done/annot-html-document.md)
  Phase 13).
- Plan moves to `_done/`.

**Verified:** PPTX goldens regenerated; manual open in PowerPoint
to confirm the badge renders cleanly. CLAUDE.md guardrail #5 wording
unaffected.

## Verification

- `pnpm -r typecheck`.
- `pnpm test` — new tests cover the `stepLabel` parser, the strip
  regex, the round-trip with `numbering.steps`, and the PPTX
  golden update.
- `pnpm --filter @ingcreators/annot-doc build`,
  `pnpm --filter @ingcreators/annot-host-ui build`,
  `pnpm --filter @ingcreators/annot-render build`,
  `pnpm --filter @ingcreators/annot-web build`.
- Storybook: at least one new story per phase showing the
  feature; existing card-document stories regenerate without
  diff when `numbering.steps` is off.
- Manual: open a 5-step card doc in the editor, toggle numbering
  on, reorder steps via drag-handle, observe the badge numbers
  update without text edits. Export PPTX, open in PowerPoint,
  verify the badge slides through.

## Migration notes

- Schema delta is purely additive. `data-annot-doc-version` stays
  at 1.
- Existing documents with prefilled `"Step N"` titles render
  identically until the user opts into `numbering.steps`. On
  opt-in, the strip-confirmation dialog gives explicit consent
  before mutating titles. No silent rewriting.
- The `CardDocumentNumbering` type stays exported for back-compat
  (plugin authors may have called the generator API). Marked
  `@deprecated`, removed in a future major version when plugins
  catch up.
- The `<annot-step-image-id>` attribute namespace
  (Phase 7 of [`_done/card-procedure-template.md`](./_done/card-procedure-template.md))
  is unaffected.

## Forward-looking notes

- The `--annot-step-badge-*` CSS variables are the natural
  customisation surface for [`card-document-themes.md`](./card-document-themes.md).
  Each theme can override the badge shape (circle / rounded
  square / hexagon), colour, size, and shadow.
- The PPTX badge shape is the natural customisation surface for
  [`card-pptx-templates.md`](./card-pptx-templates.md). Templates
  define a "Step badge" placeholder in their slide layouts; the
  exporter fills in the numeral.
- Future enhancement (not in this plan): per-step `data-step-no-number`
  opt-out so a specific card can skip numbering (e.g. a "before
  you start" intro card in the middle of a procedure). Implemented
  later via `counter-increment: none` on the marked block.
