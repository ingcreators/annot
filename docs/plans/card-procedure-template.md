# Card-style step documents from gallery selection

> **Status:** Draft
> **Compatibility:** Extends the `.annot.html` v1 format from
> [`_done/annot-html-document.md`](./_done/annot-html-document.md). Adds
> one new block kind (`step`) as an **additive** change under the
> unchanged `data-annot-doc-version="1"` stamp — `.annot.html` is
> pre-release with no shipped users, so no migration / forward-compat
> work is needed. Touches `@ingcreators/annot-doc` (Tier A),
> `@ingcreators/annot-host-ui` (Tier C — gallery + doc shell),
> `@ingcreators/annot-render` (PPTX export), `@ingcreators/annot-web`
> (file-manager action wiring). Adds one built-in starter template
> (`card-procedure`).
> **Risk:** Phased, additive throughout. Each phase is independently
> revertable. The block-taxonomy change is the only schema delta;
> everything else (CSS, generator action, PPTX mapping, starter
> template) builds on existing infrastructure.

## Context

Annot today has the `.annot.html` document format ([Phases 0–13
shipped](./_done/annot-html-document.md)). It models a free-form prose
document with image blocks interleaved between paragraphs / headings /
lists / callouts. The bundled `procedure` starter template uses an
ordered list of inline steps with one image block per "verification"
section.

What this plan adds: a **second shape of document** purpose-built for
screenshot-driven step-by-step guides — the style popularised by
[Scribe](https://scribehow.com) where each step is a self-contained
**card** carrying a screenshot, a title, and a short description.

The gap that motivates this:

- **Prose-flow documents read top-to-bottom.** That's the right shape
  for manuals, feature guides, runbooks. It's the wrong shape for
  "here are the 8 clicks you need to make, with screenshots" — the
  user is doing one step at a time and wants the card boundary to
  match the action boundary.
- **The capture → manual flow today involves manual stitching.** A
  user captures 8 screenshots in the gallery, then opens a fresh doc
  and inserts each one through the slash-menu, then writes one
  caption per image. The first step (capture) is already in the
  product; the last step (write description) is unavoidable; the
  middle step (stitch them into a doc in order) is friction we can
  remove.
- **PowerPoint output already maps cleanly to "one image per slide"**
  ([Phase 11 of `_done/annot-html-document.md`](./_done/annot-html-document.md) —
  `exportDocumentPptx` walks `ImageBlock`s and emits one slide each).
  A step block IS one image plus its caption — the existing PPTX
  pipeline gains a richer slide layout source for free.

User framing: "カードスタイルの手順書を簡単に、file-managerから画像を
選択した順で作成する、カードの上下左右をどう利用するかが
テンプレートになる" — three things at once: a card-shape block, a
gallery-driven generator, and per-card image / text layout variants
as the template axis.

This plan slots between the shipped `.annot.html` foundation and the
existing `procedure` starter template — it's a new shape of document,
not a re-skin of the old one. Both shapes coexist: prose-flow procedure
for "here's the runbook narrative", card-stack procedure for "here are
the 8 clicks".

## Design

### A new `step` block type

The block taxonomy gains one entry:

| Block type | Storage | Editable representation |
|---|---|---|
| `step` | `<section data-annot-block="step" data-step-layout="...">` with three child slots (image, title, body) | image (embedded `.annot.svg`) + title (`TextRun[]`) + body (`TextRun[]`) + layout |

Concretely:

```html
<section data-annot-block="step" data-step-id="step_01" data-step-layout="image-top">
  <figure data-annot-step-image-id="img_01">
    <svg data-annot-version="1" viewBox="0 0 1280 720" …>
      <image href="data:image/png;base64,…"/>
      <g id="annotations">…</g>
    </svg>
  </figure>
  <h3 data-annot-step-title>Open the settings dialog</h3>
  <p data-annot-step-body>Click the gear icon in the top-right corner.</p>
</section>
```

Properties of the step block:

1. **Self-contained.** A step always carries image + title + body. No
   "optional" slots; the editor renders empty placeholders for any
   missing slot. This matters because:
   - The standalone view's CSS grid can size cards uniformly.
   - The slash-menu's "insert step" action has a single, predictable
     output.
   - PPTX export can assume each step block produces a complete
     slide.
2. **Per-card layout variant lives on the block.** `data-step-layout`
   takes one of: `image-top` (default), `image-bottom`, `image-left`,
   `image-right`, `image-fill` (image covers card, title + body as
   bottom overlay). The user can change layout per step via an
   inline switcher; absence means `image-top`.
3. **Image carries its own stable id.** `data-annot-step-image-id`
   (separate namespace from `data-annot-image-id` used by standalone
   image blocks) so the picker / clone-template machinery can mint
   fresh ids without colliding across the two block kinds.
4. **Round-trip preserved.** The serialiser pins child order
   (image → title → body) and attribute order, the same way the
   current image block does. Adding a step block doesn't change any
   existing block's bytes.

Why a new block type instead of CSS-styling a `figure + h3 + p` triple:

- **Structural guarantee.** A step block is a unit; the editor
  drag-reorder + delete operate on the unit. A "pattern of three
  sibling blocks" would break the moment a user adds a stray
  paragraph or removes the heading.
- **PPTX mapping is unambiguous.** "One slide per step block" is a
  property of the schema, not a heuristic. The renderer doesn't have
  to pattern-match.
- **The block taxonomy was always going to grow.** The v1 plan's
  forward-looking section ("Plugin block types (v2)") explicitly
  contemplated lifting the closed-union assumption. This is the
  first concrete case where adding a block kind earns its keep.

### Card visual treatment (CSS only)

`injectDocumentStyles` ([Phase 2 of the original plan](./_done/annot-html-document.md))
gains a `<style>` section keyed off the `step` block. The rendered
card has:

- Outer container: rounded corners (radius from
  `--annot-card-radius`, default `8px`), 1px border, subtle drop
  shadow. Dark-mode variant flips the border + background.
- Internal layout via CSS Grid templates, one per
  `data-step-layout` value:
  - `image-top`: 2-row grid (image / text), image fills row 1.
  - `image-bottom`: 2-row grid, image fills row 2.
  - `image-left`: 2-column grid (image / text), image fills column 1.
  - `image-right`: 2-column grid (text / image), image fills column 2.
  - `image-fill`: 1-cell grid, image fills, title + body absolute-
    positioned with a translucent backdrop ("bottom caption bar").
- Image element max-height clamped per layout so a tall screenshot
  doesn't blow the card; preserves aspect ratio via CSS
  `object-fit: contain`.
- Title typography matches `h3`; body typography matches `p` — the
  block's `<h3>` and `<p>` children participate in the existing
  heading / paragraph styles, no per-block override needed.
- Print mode: each card sticks together (`break-inside: avoid`).
- All variables fall back to the document-level theme palette
  established in `_done/annot-html-document-ux-polish.md` Phase 11
  (the document settings dialog).

### Document-level grid columns

A new optional `DocMeta` field:

```ts
export interface DocMeta {
  // …existing fields…
  readonly cardLayout?: CardLayoutMeta;
}

export interface CardLayoutMeta {
  /** Cards per row in standalone / editor view at the document's
   *  max-width. `1` = vertical stack (Scribe-style); `2` / `3` =
   *  multi-column grid. `auto` uses `repeat(auto-fill, …)` with a
   *  card-min-width breakpoint (~320px). Default: `1`. */
  readonly columns?: 1 | 2 | 3 | "auto";
  /** Default `data-step-layout` for newly-inserted step blocks.
   *  Per-block overrides via `data-step-layout` always win.
   *  Default: `"image-top"`. */
  readonly defaultStepLayout?: "image-top" | "image-bottom" |
    "image-left" | "image-right" | "image-fill";
}
```

Standalone view honours `cardLayout.columns` via the injected style
block (`display: grid; grid-template-columns: …`). Editor view
respects the same setting so what-you-see-is-what-you-get holds.

The default-step-layout setting drives both the gallery generator's
default output and the slash-menu's "insert step" action.

### Gallery → card document generator

A new gallery action: **"Create card document from selection"**. It
sits in:

- The right-click context menu over a gallery selection (entry
  added to [`gallery/context-menu.ts`](../../packages/host-ui/src/gallery/context-menu.ts)
  via the existing `<annot-context-menu>` infrastructure).
- The file-manager toolbar's existing "New" split button flyout
  (added next to the "From template…" entry that
  [Phase 8 of `_done/annot-html-document.md`](./_done/annot-html-document.md)
  shipped).

Both surface the action only when the current gallery selection has
≥ 1 image (no folders).

The action opens a dialog (reuses `<annot-dialog>`) with four fields:

| Field | Default | Note |
|---|---|---|
| Title | "" (required) | Doc `<title>` + `meta.title`. |
| Step layout | `image-top` | Applied to every generated step block. |
| Columns | `1` (vertical stack) | Doc-level `cardLayout.columns`. |
| Numbering | "Step 1 / Step 2 / …" | Pre-fills each step title with the index; users edit per-step. |

Confirm → the generator builds an `AnnotDocument` with one
`StepBlock` per selected image (in selection order), each carrying:

- `id`: freshly minted via `newIdB58`.
- `imageId`: freshly minted.
- `svg`: the image's existing `annotationsSvg` (an editable
  `.annot.svg` — same source the editor opens). Falls back to a
  wrapper `<svg>` around the raw bitmap if the image has no
  annotations.
- `title`: `TextRun[]` carrying the numbering prefill (e.g.
  `"Step 1"`) if numbering is on, otherwise empty.
- `body`: empty `TextRun[]`.
- `layout`: from the dialog selection (or omitted to inherit the
  doc default).

The generated document opens in the doc shell as **unsaved**, same
behaviour as "New from template" — the user picks the destination on
first save. No filesystem write happens at generator-confirm time.

#### Selection-order capture

The existing `<annot-gallery-page>` tracks selection as
`Set<string>` ([`selectedImagePaths` at gallery-page.ts:91](../../packages/host-ui/src/gallery/annot-gallery-page.ts:91)),
which preserves insertion order in modern JS engines but doesn't
expose "order of user clicks" as a stable concept. Two viable
approaches:

1. **Rely on `Set` insertion order.** Works today because
   `toggleSelection` adds on first click and removes on second
   click — re-selecting an item moves it to the end. Simple.
   Edge case: Shift-click range-selection inserts in DOM order, not
   click order; users doing a Shift-select from item 5 → item 1
   get the wrong order.
2. **Track an explicit ordered selection list.** Add a parallel
   `selectedImagePathOrder: string[]` that tracks the precise click
   sequence. Survives Shift-click as the user expects (anchor-first,
   then DOM order to the click target, matching every other gallery
   on the planet). This is the recommended approach.

Phase 0 (spec freeze) confirms which model the existing gallery
matches and locks in the ordering rule the user sees. If we adopt
the explicit-list approach, the new field is purely additive — every
existing selection-consumer call site (`onClearSelection` /
`onDeleteSelection` / etc.) continues to work via the `Set`.

### Built-in starter template

V1 ships one new entry in `BUILTIN_TEMPLATES`:

| ID | Name | Shape |
|---|---|---|
| `card-procedure` | Card procedure | H1 title + intro paragraph + 3 placeholder step blocks (image-top layout, "Step 1 / 2 / 3" titles, lorem-ish body) + closing wrap-up paragraph. |

Same authoring pattern as the existing starters
([`packages/doc/src/builtin-templates.ts`](../../packages/doc/src/builtin-templates.ts)):
TypeScript literal, serialised at module load via
`serializeDocument`, byte-for-byte regression-tested by
`builtin-templates.test.ts`.

Picker integration: a new entry in `BUILTIN_TEMPLATES` is enough —
[`<annot-template-picker-dialog>`](../../packages/host-ui/src/ui/template-picker-dialog.ts)
walks the array and renders one card per entry. The picker doesn't
care that the template uses a v2 block kind; the parse → clone →
mount path is identical to the v1 starters.

### PPTX export mapping

[`exportDocumentPptx` at `packages/render/src/pptx/document-pptx.ts`](../../packages/render/src/pptx/document-pptx.ts)
walks `doc.blocks` and emits one slide per `ImageBlock`. The same
function gains:

- **Recognise `StepBlock` as a slide source.** A step block produces
  one slide whose source SVG is the step's embedded `.annot.svg`.
- **Slide layout per `data-step-layout`.** The PPTX slide layout
  picks one of five existing PowerPoint layouts:
  - `image-top` → "Title and Content" (title on top, content below).
  - `image-bottom` → "Content with Caption" (content top, title /
    caption bottom).
  - `image-left` → "Two Content" left-image variant.
  - `image-right` → "Two Content" right-image variant.
  - `image-fill` → "Title Slide" variant with title overlay on the
    full-bleed image background.
- **Step title → `<p:sp>` title placeholder.** The step's
  `<h3 data-annot-step-title>` content becomes the slide title,
  honoring the rich-text `TextRun[]` formatting (existing
  text-run-to-OOXML path already supports bold / italic / underline
  / fonts / colours).
- **Step body → `<p:sp>` body placeholder.** Same translation as
  the title.

Existing standalone `ImageBlock` slides keep working unchanged —
the dispatch widens from `if (block.kind === "image")` to
`if (block.kind === "image" || block.kind === "step")`, with each
arm building the slide its own way.

### Schema decision

- **No version bump, no migration, no forward-compat work.**
  `.annot.html` is pre-release; no users to consider, no
  existing-document compatibility burden. `ANNOT_DOC_VERSION` in
  [`packages/doc/src/types.ts`](../../packages/doc/src/types.ts)
  stays at `1` and the `step` block joins the v1 taxonomy as a
  plain additive expansion. The first real version bump waits for
  a post-release schema change that breaks an existing reader.

### Tier alignment

| Tier | Code | Package |
|---|---|---|
| A | `StepBlock` in types, parser/serialiser/clone for step blocks, `CardLayoutMeta` | `@ingcreators/annot-doc` |
| B | step-block CSS in `injectDocumentStyles`, grid templates | `@ingcreators/annot-doc/editor` subpath |
| C | `<annot-step-block>`, slash-menu "Insert step" entry, layout switcher, gallery generator dialog | `@ingcreators/annot-host-ui` |
| C-render | step-block slide emission in `exportDocumentPptx` | `@ingcreators/annot-render` |

Headless boundary test (the existing
[`packages/doc/src/headless.test.ts`](../../packages/doc/src/headless.test.ts))
automatically covers the new Tier A code — every documented
subpath is re-imported and `require.cache` is walked for leaks.

## Phased plan

Each phase is a standalone PR per the
[`docs/plans/README.md`](./README.md) "one PR per phase" convention.

### Phase 0 — Spec freeze + golden fixtures

- Amend [`docs/annot-html-format.md`](../annot-html-format.md) with
  the `step` block schema, `data-step-layout` enum, and child-order
  rules. No version-bump notes — the addition is a plain v1
  expansion per the Schema-decision section above.
- Add 3 golden `.annot.html` fixtures under
  `packages/doc/test/fixtures/`:
  - One pure step-only doc (3 steps, default layout).
  - One mixed doc (heading + paragraph + step + step + callout).
  - One full-bleed step (`image-fill` layout).
- Lock in: child slot order, attribute names, allowed
  `data-step-layout` values, `meta.cardLayout` shape.
- Resolve the gallery-selection-order question (Set insertion order
  vs explicit ordered list) — document the chosen approach in the
  plan for Phase 4.

### Phase 1 — Tier A: `step` block model

- `StepBlock` added to the `Block` discriminated union in
  [`types.ts`](../../packages/doc/src/types.ts).
- `ANNOT_DOC_VERSION` stays at `1` (pre-release additive expansion;
  see "Schema decision" above).
- Parser recognises `<section data-annot-block="step">` and yields a
  `StepBlock` with the parsed image / title / body / layout.
- Serialiser emits canonical child order + attribute order; the
  round-trip test corpus extended with the Phase 0 fixtures.
- `cloneTemplate` mints fresh `id` + `imageId` for every step.
- `CardLayoutMeta` added to `DocMeta`; parser / serialiser pick up
  the `card-layout` keys in the JSON sidecar.
- No editor / host work yet — Phase 1 is pure data model.

### Phase 2 — Tier B: card grid + layout CSS

- `injectDocumentStyles` extended with the step-block style section
  (grid templates per layout, dark-mode + print variants).
- Document-level CSS variables: `--annot-card-radius`,
  `--annot-card-border`, `--annot-card-shadow`,
  `--annot-card-gap`, `--annot-card-columns` (driven by
  `meta.cardLayout.columns`).
- Storybook visual goldens for the 5 layouts × light / dark /
  print.
- Round-trip property test: a step block survives serialize →
  parse → serialize across every layout enum value.

### Phase 3 — Tier C: `<annot-step-block>` editor + slash-menu

- New `<annot-step-block>` Lit element in
  [`packages/host-ui/src/`](../../packages/host-ui/src/).
- Three child slots rendered with `contentEditable` (title + body)
  + image-click-to-edit (reuses the existing
  [`EditorShell.mountFromRecord`](../../packages/host-ui/src/editor-shell.ts:210)
  modal — same path as standalone image blocks).
- Per-block layout switcher: small pulldown next to the block
  toolbar, lists the 5 layouts with icons.
- Slash-menu entry: "Insert step". Default layout from
  `meta.cardLayout.defaultStepLayout`.
- Document settings dialog gains a "Card layout" section
  (columns + default layout), wired through
  [`<annot-doc-settings-dialog>`](../../packages/host-ui/src/ui/doc-settings-dialog.test.ts).
- Co-located `*.stories.ts` covering empty / populated / each
  layout / dark-mode variant.

### Phase 4 — Gallery: ordered selection + generator

- `<annot-gallery-page>` adopts the chosen selection-order rule
  from Phase 0 (recommended: parallel `selectedImagePathOrder:
  string[]`). Existing `selectedImagePaths` stays as the membership
  check; the new array drives ordering for downstream consumers.
- `selection-change` event payload extended with the ordered list
  (additive — existing listeners continue to work).
- New right-click menu entry "Create card document from
  selection" — visible when ≥ 1 image is selected, 0 folders.
- New "New" split-button flyout entry next to "From template…":
  "Card document from selection".
- New `<annot-create-card-document-dialog>` (Lit) collecting
  title / layout / columns / numbering.
- Generator function in `@ingcreators/annot-host-ui`:
  `createCardDocumentFromImages(images: ImageRecord[],
  options: CardDocOptions): AnnotDocument`. Pure (Tier B-ish —
  uses `@ingcreators/annot-doc` only; no live DOM). Unit-tested
  with fixture `ImageRecord[]` against fixture `AnnotDocument`
  goldens.
- Wired to open the generated document in the doc shell as
  unsaved (same path as "New from template").

### Phase 5 — Built-in `card-procedure` starter

- New entry in
  [`BUILTIN_TEMPLATES`](../../packages/doc/src/builtin-templates.ts):
  `card-procedure` — H1 + intro paragraph + 3 step-block
  placeholders (image-top, "Step 1 / 2 / 3", placeholder body) +
  closing wrap-up paragraph.
- Reuses the existing `PLACEHOLDER_SVG` / `PLACEHOLDER_ALT`
  constants — same dashed-border "Drop screenshot here" placeholder.
- Storybook story for the starter rendered in light / dark / print.
- `builtin-templates.test.ts` extended to cover the new entry
  (parse → clone → re-serialise byte-equivalence + marker round-trip).
- Picker shows it alongside the existing three starters; no picker
  code changes needed.

### Phase 6 — PPTX export: step blocks → slides

- `collectSlides` in
  [`packages/render/src/pptx/document-pptx.ts`](../../packages/render/src/pptx/document-pptx.ts)
  recognises `StepBlock` as a slide source.
- Per-slide layout picked from `data-step-layout`:
  - `image-top` → Title and Content
  - `image-bottom` → Content with Caption
  - `image-left` / `image-right` → Two Content variants
  - `image-fill` → Title Slide variant
- Title placeholder populated from step title; body placeholder
  populated from step body (existing `TextRun` → OOXML path).
- Golden PPTX fixture: a 3-step document round-trips through
  `exportDocumentPptx` → byte-stable output. Reviewer manually
  opens in PowerPoint at PR time to confirm slide layout matches.
- The standalone image-block slide path stays unchanged — the
  dispatch widens, the per-arm code is independent.

### Phase 7 — Polish + plugin docs

- VSCode custom editor + `Annot: New document` command continue
  working unchanged (the doc shell is host-neutral; step blocks
  ride along automatically).
- `docs/annot-html-format.md` gains a "Step block" section with
  the schema + layout grid.
- `docs/plugin-api/documents.md` (the v1 forward-looking doc from
  the original plan's Phase 13) gains a note: step blocks
  illustrate the "additive block-kind extension" pattern plugins
  may eventually use in v3.
- This plan moves to `_done/`; the README's table gains a row.

### Phase 7a — Image-less step blocks

Inserted ahead of Phase 7 (polish) once the picture-bearing path
proved out. User framing: "画像なしのカードも必要そう" — narrative
steps that only need a heading + paragraph without a screenshot.

Schema delta:

- `StepBlock.svg` field's domain expands from "canonical
  `<svg>...</svg>` bytes" to "canonical `<svg>` bytes OR the
  empty string." The empty string marks an image-less step
  block.
- Serializer skips the `<svg>` child entirely when `svg === ""`
  and emits `data-step-image-less="1"` on the `<section>`
  (alphabetical between `data-annot-image-id` and
  `data-step-layout`, per the canonicalisation rules).
- Parser accepts both shapes: an image-bearing step block has
  a `<svg>` child and `data-step-image-less` is absent; an
  image-less step block has no `<svg>` child and (canonically)
  carries `data-step-image-less="1"`. The parser is defensive:
  a step with no `<svg>` child but no decorator parses as
  image-less anyway (hand-authored input tolerance).
- No `data-annot-doc-version` bump. Pre-release additive change.

UX delta:

- The slash menu gains a "Step (text only)" entry that splices
  an image-less step block synchronously — no file picker.
- The block-host's click handler short-circuits for image-less
  step blocks (no image slot to click → no modal).
- CSS for image-less step blocks collapses the grid to a single
  text column regardless of `data-step-layout`; the
  layout-switcher UI still works (the user may add an image
  later, at which point the layout choice becomes load-bearing
  again).

PPTX delta:

- `buildSlideFromStepBlock` short-circuits when `svg === ""`
  and emits a text-only slide via `buildImagelessStepSlide`:
  no image group, no annotation shapes, just title / body
  text shapes centred on the slide.
- An entirely empty image-less step (no title, no body) yields
  no slide.

### Phase 7b — URL link embedding (Scribe-style)

User framing: "URLリンクの埋め込みも必要そう" — Scribe shows a
"Navigate to https://example.com" chip on steps where the
action is "open this URL." Landed:

- New OPTIONAL field on `StepBlock`: `link?: { url: string;
  label?: string }`. The URL is required; label defaults to
  the URL string. Stored on the `<section>` as
  `data-step-url="..."` plus an optional
  `data-step-url-label="..."` (alphabetical canonical order,
  after `data-step-layout`).
- URL allowlist: `http://`, `https://`, `mailto:` only. The
  parser drops anything else (e.g. `javascript:`, `data:`); the
  shell's URL input sanitiser mirrors the same allowlist so
  pasted hostile URLs never enter the model.
- Renderer adds an `<a data-step-link>` chip below the step
  title — anchor pill with the document accent colour, an
  external-link glyph via CSS `mask-image`. In editing mode an
  inline `<input type="url">` row appears below the title for
  the user to edit / clear the URL; commit fires on `change`
  (blur / Enter).
- PPTX export emits the chip as a `<p:sp>` rounded-rectangle
  text shape with `<a:hlinkClick r:id="...">` on the text run.
  The matching slide-rels relationship uses
  `Type=".../relationships/hyperlink"` with
  `TargetMode="External"`.
- `cloneTemplate` preserves `block.link` verbatim across
  clones (the URL is content, not an id-bearing reference).
- An image-less step block carrying only a `link` (no title /
  body) IS exportable to PPTX — the chip alone counts as
  visible content.

### Phase 7c — Document header / PPTX cover slide

User framing: "ヘッダー部にアイコン、タイトル、説明がある。
PowerPointでは表紙としてレイアウトできたらよさそう" — Scribe-style
doc-level header (icon + title + description + author + step
count) and a matching PPTX cover slide. Landed:

- New OPTIONAL `DocMeta` field: `header?: { icon?: string;
  description?: string }`. `title` is already on `DocMeta`;
  `author` already exists; step count is derived from the
  block walk via `countStepBlocks`. `icon` carries a `data:`
  URL (PNG / JPEG / SVG); cross-host icon registries are
  out of scope for v1 (the URL approach keeps the doc
  self-contained).
- The serializer prepends a `<section data-annot-doc-header>`
  to the article body **only when** `meta.header` is set with
  non-empty content (opt-in). Children are emitted in fixed
  order: icon → title → description → metadata row (author +
  step count). Plain docs without a header retain their
  pre-Phase-7c bytes exactly.
- The parser skips elements carrying `data-annot-doc-header`
  on read (mirrors the TOC pattern); the model never round-
  trips through stale header bytes.
- `injectDocumentStyles` adds CSS for the header section: a
  2-column grid (icon | content) when an icon is present, a
  single-column variant otherwise, with the title styled as a
  large h1 and the description / metadata row in muted
  secondary text.
- The `<annot-doc-shell>` editor surfaces the header fields
  via the `<annot-doc-settings-dialog>` — two new fields
  ("Header description" + "Header icon"). Clearing both
  fields drops the `meta.header` sidecar entry so the
  serializer reverts to the pre-Phase-7c byte stream.
- PPTX export prepends a cover slide (index 1) before the
  per-block slides when `meta.header` is set. Layout:
  centred icon (160×160 px), centred title (44pt bold),
  centred description (20pt), centred footer joining
  "By {author}" and "{N} step(s)" with " · ". Cover slides
  carry a `coverSlide: true` discriminator on `SlideData`
  so `buildSlideXml` emits the icon as a top-level
  `<p:pic>` (no SVG-coord group wrap).
- Tests: 17 new in `doc-header.test.ts` + 14 new in
  `document-pptx.test.ts` covering serializer / parser /
  cover-slide / step-count / opt-in semantics.

### Out of scope for v1 (deferred)

- **Per-card colour theming.** All cards share the document-level
  palette. Per-card accent colour candidates for v2 (e.g. "this
  step is the destructive one — make its border red").
- **Step grouping into sub-procedures.** A `step-group` container
  that holds N steps with a shared subheading. v2.
- **Auto-numbering of step titles independent of headings.** v1
  numbers via the user typing "Step N" into the title. The existing
  `NumberingMeta` covers headings + figures; extending it for
  steps is a small addition for v2.
- **Drag step-block from gallery thumbnail into open doc.**
  v1 generator creates a new document only. v2 candidate.
- **Inline image editing (no modal) for step images.** Same trade-off
  as the v1 image block — modal-first, inline-later if the workflow
  demands it.
- **Custom card layouts beyond the five enumerated.** Plugin-supplied
  layouts (`data-step-layout="custom:foo"` resolving to plugin CSS)
  are a v2 candidate; v1 fixes the enum.

## Verification

- **Round-trip byte equivalence.** Golden corpus extended with
  step-block fixtures; CI test asserts
  `serialize(parse(bytes)) === bytes` for every fixture (including
  every layout enum value).
- **`cloneTemplate` integrity.** Clone the `card-procedure`
  starter, save the result, parse it back, assert: template
  markers gone, every step `id` + `imageId` reminted, every other
  byte preserved.
- **Generator output stability.** Unit test:
  `createCardDocumentFromImages([img1, img2, img3], { title:
  "Test", layout: "image-top", columns: 1, numbering: "step-n"})`
  → matches a checked-in `AnnotDocument` JSON snapshot.
- **Standalone view rendering.** Storybook visual goldens per
  layout × theme × column-count combination. Reviewer signs off
  on the visual change in each phase PR.
- **PPTX export structural test.** A document with one step per
  layout exports to a PPTX whose `slideN.xml` payloads match a
  golden corpus (similar to the existing PPTX export goldens in
  `packages/editor/src/`). Manual smoke against PowerPoint at PR
  time.
- **Gallery selection-order parity.** Multi-select test in
  `<annot-gallery-page>`: click image 3, then 1, then 2 →
  `selectedImagePathOrder` reflects `[3, 1, 2]`; Shift-click
  range honours the anchor-first DOM-order rule.
- **Picker integration.** The `card-procedure` entry appears in
  the built-in section of the picker; clicking it clones + opens
  an editable document with 3 step blocks present.

## Migration notes

- **None.** Pre-release format; no shipped users; no existing
  documents to consider. The `step` block joins the schema as a
  plain additive expansion under the unchanged
  `data-annot-doc-version="1"` stamp.
- **`@ingcreators/annot-doc` consumers** (annot-cloud's pointer-
  commit store, future Playwright integration) pick up the new
  block kind via the `Block` discriminated union; switch statements
  that exhaustively match on `Block.kind` will fail TypeScript
  build until they add a `case "step":` arm. This is a deliberate
  type-safety prompt, not a migration.

## Forward-looking notes

- **Step-group container (v2).** A `<section data-annot-block="step-group">`
  that holds N steps with a shared subheading + collapsible
  toggle. Natural extension once we see how users organise multi-
  procedure documents. The container becomes one PPTX section
  separator + N slides.
- **Per-step numbering metadata (v2).** Extend `NumberingMeta`
  with `steps?: boolean` + `stepLabel?: string` ("Step " / "Étape "
  / "ステップ "); CSS counters drive both editor + standalone view.
  Users still type the step title; the prefix renders automatically.
- **Plugin-supplied step layouts (v2).** Once plugin block types
  (the original v1 plan's forward-looking v2 item) ship, allow
  plugin CSS to register additional `data-step-layout` values
  (e.g. `"custom:plugin-id:layout-id"`).
- **Drag step block from gallery (v2).** Drag a gallery thumbnail
  into an open doc → insert a step block at the drop position with
  the image preloaded. Pairs nicely with the existing image-block
  drop-zone overlay shipped in
  [`_done/annot-html-document-ux-polish.md`](./_done/annot-html-document-ux-polish.md)
  Phase 6.
- **annot-cloud touchpoints** ([`oss-cloud-split.md`](./oss-cloud-split.md)):
  the format + the editor + the generator + the starter template
  all live in OSS. Commercial-only candidates above the format:
  hosted team card-layouts, branded card themes, "publish this
  card procedure to Confluence/Notion" sync. None touch the file
  format or the editor surface.
