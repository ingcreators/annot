# `.annot.html` document — UX polish to product-ready quality

> **Status:** Draft
> **Compatibility:**
>   - No SVG schema change. No `data-annot-doc-version` bump.
>   - No `StorageProvider` interface change. No `PageMetadata`
>     change.
>   - `@ingcreators/annot-doc` Tier A package gains zero new
>     types. The format on disk is fully stable from
>     [`annot-html-document.md`](./annot-html-document.md) Phase 0.
>   - `@ingcreators/annot-host-ui` gains a small number of new
>     `<annot-doc-*>` Lit components and rearranges the existing
>     `<annot-doc-shell>` chrome. All consumer wiring is via host
>     properties / events that the PWA, VSCode, and Desktop
>     hosts already speak.
>   - PWA `EditorSession` doc-mode dispatcher gains a header strip
>     mount. VSCode + Desktop hosts mirror the same surface as
>     [`_done/host-convergence.md`](./_done/host-convergence.md)
>     conventions allow.
> **Risk:** Pure UX work — every phase is independently revertable
>     and additive. No data path changes. No format-on-disk
>     changes. Visual goldens (Storybook + DOM-byte tests) pin
>     each phase; later phases edit those goldens explicitly. The
>     largest risk is touch-target regression on mobile + Stop-
>     ship-able accessibility regressions if a phase removes a
>     working keyboard path; a per-phase a11y smoke test guards
>     each landing.

## Context

The `.annot.html` document feature shipped its 13 functional
phases under [`annot-html-document.md`](./annot-html-document.md)
in a single rapid-execution session (PRs #538–#569 over ~36
hours, 2026-05-09 / 2026-05-10). Format, parser, renderer,
editing mode, slash menu, image-block editor modal, multi-
backend storage, templates, VSCode custom editor, multi-slide
PPTX export, auto-numbering, cross-reference resolution — all
present and contract-tested.

**The user has flagged that the feature is not yet at product-
level quality.** The five fix-PRs that landed within hours of
the v1 ship-out tell the story:

| PR | Symptom | Root cause |
|---|---|---|
| [#570](https://github.com/ingcreators/annot/pull/570) | Blank content area below visible toolbar | Doc host mounted inside hidden `#file-manager` |
| [#571](https://github.com/ingcreators/annot/pull/571) | "Image insertion is unclear" (画像挿入の方法などよくわからない) | Zero visual affordance for paste / drop / slash menu |
| [#572](https://github.com/ingcreators/annot/pull/572) | Edit-image modal missing toolbar / right-panel / statusbar | Modal shell not at parity with main editor |
| [#573](https://github.com/ingcreators/annot/pull/573) | Document gallery thumbnails always black | Save path never populated `thumbnailDataUrl` |
| [#574](https://github.com/ingcreators/annot/pull/574) | Document gallery cards stretched full-width | `.gallery-document-grid` had no CSS layout |

Pattern: the phased plan optimised for *functional completeness*
and *contract testing* — every storage backend round-trips,
every block kind parses, every export produces valid output —
but didn't have a dedicated polish pass against a fresh user
opening the document for the first time and trying to do the
common tasks. The five fix-PRs scratch the surface: image
insertion, gallery presentation, modal chrome integration. The
*systemic* polish work is unaddressed.

This plan stages that systemic pass. It does not replan the
feature; it does not add new format capabilities. It treats the
v1 surface as the contract and improves the *experience* against
the same data model.

### What "product-ready" means for the document feature

Targeting the same quality bar the image editor cleared in PRs
#65–#136 (the multi-phase editor decomposition + Lit migration +
schema-driven property panel + storybook coverage). Concretely,
a product-ready document feature:

1. **Discoverable** — every primary action is reachable without
   memorising a gesture or keyboard shortcut. A new user can
   create a non-trivial document (heading + paragraphs + image +
   list) using only what they see on screen.
2. **Predictable** — visual feedback for every state change:
   dirty / saved, dragging, dropping, inserting, deleting,
   editing an image. No silent operations.
3. **Forgiving** — undo covers every mutation including image
   edits and accidental block-kind conversions. Destructive
   actions confirm before they fire.
4. **Touch-capable** — every hover affordance has a tap
   equivalent. The document is editable on iPad / Surface as
   well as on a laptop.
5. **Consistent with the image editor** — header / save status
   / mode toggle / export menu look and behave the same in a
   document as they do in an image. Users only learn the shape
   once.
6. **Accessible** — keyboard-only navigation works for every
   block action; focus rings visible; ARIA labels on every
   icon button.
7. **Performant** — opening a 50-image document is comparable
   to opening a 50-image gallery (within 2× wall clock).
   Editing a paragraph in such a document doesn't drop frames.

## Design

### What stays unchanged

The Tier A `@ingcreators/annot-doc` package is frozen for this
plan. Format constants, block discriminated union, parser,
serializer, round-trip helpers — none of these change. The
plan operates entirely in `@ingcreators/annot-host-ui`'s editor
surface and the PWA / VSCode / Desktop dispatcher layers that
mount it.

The `<annot-doc-shell>` element keeps its current public API
(`document` / `editing` / `showToc` properties + `doc-changed` /
`doc-heading-activated` events). Internal layout is recomposed
to make room for new chrome, but no host code that consumes the
element from outside breaks.

### What changes

The shell gains a top-level header strip. The block-toolbar
becomes a persistent affordance instead of a hover-only one.
The slash menu opens from a visible "+" button at every
between-block gap, in addition to the existing typed-`/` path.
A floating selection toolbar replaces the invisible-only
Ctrl+B/I/U pathway. Touch targets are sized to 44 × 44
guideline. Mobile becomes a first-class layout, not a fallback.

### Layout sketch (post-plan)

```
┌──────────────────────────────────────────────────────────────┐
│ ◀ Back  | Untitled doc · saved 2s ago | ⌫⌦  +Image  ⋯ Export│  ← Phase 1: header strip
├────────┬─────────────────────────────────────────────────────┤
│ TOC    │ ─── + ───  (between-block insert; Phase 2)          │
│        │                                                     │
│ ▸ §1   │   # Heading                                          │
│ ▸ §2   │   ─── + ───                                          │
│        │   Paragraph with *selected text* showing inline     │
│        │   format toolbar [B I U  ¶ ▼  ⇲]  (Phase 3)         │
│        │   ─── + ───                                          │
│        │   ┌─────────┐ ⠿  drag handle (Phase 2)              │
│        │   │ Figure  │ × del  ↑  ↓                            │
│        │   │  image  │ "Click to edit" badge                  │
│        │   └─────────┘                                        │
│        │   ─── + ───                                          │
│        │                                                     │
└────────┴─────────────────────────────────────────────────────┘
```

The shell still owns the article render. The header strip lives
above it (host responsibility today, gets a `<annot-doc-header>`
component in Phase 1 so VSCode + Desktop pick it up
automatically).

## Phasing

Each phase is one PR. Phases land independently in the listed
order; later phases assume the earlier ones have shipped to
`main` but don't block on them — if priorities shift, any phase
can pause without forcing a revert.

### Phase 1 — Document header strip (`<annot-doc-header>`)

**Goal.** Give every document a persistent top-level toolbar
that matches the image editor's `<annot-editor-header>` shape.
This is the single biggest source of discoverability today —
users have nowhere obvious to *start* an action.

**Deliverable.** A new `<annot-doc-header>` Lit element in
`packages/host-ui/src/`, mounted between the gallery's back
button area and the doc shell. Renders:

- ◀ "Back to gallery" button (host-supplied callback)
- Document title (read-only label in v1; editable inline in
  Phase 4)
- Save status pill — "saved", "saving…", "unsaved changes",
  "save failed" (mirrors `<annot-save-status>` shape, takes a
  `status` reactive prop)
- Undo / Redo buttons (icons + Ctrl+Z / Ctrl+Y tooltips)
- "+ Image" primary-action button (top-level; opens the
  existing file picker)
- "⋯" overflow menu (Phase 12 will expand this) — for now
  just "Export to PPTX"
- "View" / "Edit" toggle (matches existing `editing` prop
  semantics)

**Wiring.**
- PWA `EditorSession` doc-mode dispatcher mounts
  `<annot-doc-header>` above `<annot-doc-shell>` in the
  `#annot-doc-host` container and forwards events.
- VSCode webview host renders the same component; "Back" is a
  no-op there or returns to the workspace file picker.
- Desktop host mirrors the PWA mount.

**Tests / acceptance.**
- Storybook story for each save-status state.
- DOM byte-equivalence test pinning the header layout.
- a11y: every button has `aria-label`, the title is `<h1>` or
  carries `role="heading"`.
- Manual: open a doc → header visible → click Edit → editing
  mode toggles → save status updates after 2-3s of debounce.

### Phase 2 — Persistent insertion + drag-handle affordances

**Goal.** Replace the hover-only block toolbar with persistent
chrome and add a between-block "+" button that opens the slash
menu without requiring the user to first type `/` in an empty
block.

**Deliverable.**
- New `<annot-doc-insert-bar>` element rendered between every
  pair of blocks AND at the top + bottom of the article.
  Default state: a thin (8px) hover zone showing a hairline
  + "+ Insert" tooltip. Click → opens the existing
  `<annot-doc-block-menu>` anchored to that gap.
- The current per-block `<annot-doc-block-toolbar>` keeps
  delete / move / image insert but **gains a "⠿" drag handle
  on the left** (Phase 8 wires the actual drag-and-drop
  reorder). Toolbar opacity becomes `1` on touch devices
  (`@media (hover: none)`) and stays `0.4` → `1` on hover for
  pointer devices.
- The current "type `/` in an empty block" path stays — no
  regression to a documented workflow.

**Tests.**
- Storybook for the insert bar at top / bottom / between blocks.
- Inline snapshot for the new toolbar layout (drag handle
  added → existing buttons shift right).
- a11y: insert bar is keyboard-reachable via Tab; pressing
  Enter opens the menu.

### Phase 3 — Inline selection format toolbar

**Goal.** Make text formatting visible. Today Bold / Italic /
Underline are reachable only via Ctrl+B/I/U through the
browser's contentEditable handling — no UI signals their
existence.

**Deliverable.**
- New `<annot-doc-selection-toolbar>` Lit element. Floats
  above the active text selection (same anchored-popover
  pattern the editor's tooltip uses). Buttons:
  - **B** / **I** / **U** — toggle wrapper tags via
    `document.execCommand` (existing browser path)
  - **¶ ▼** — block-kind conversion (paragraph ↔ heading
    1/2/3 ↔ bulleted list ↔ numbered list ↔ quote ↔ callout).
    Internally a `block-kind-changed` event the shell
    interprets, replacing the block in the document model
    and re-rendering. Uses the SAME schema entries as the
    slash menu's `BlockMenuItem` — single source of truth.
  - **🔗** — link insertion (prompts for URL, wraps selection
    in `<a href="...">`). Optional v1; defer if scope tight.
- Toolbar appears on `selectionchange` when the selection is
  non-empty AND inside a contentEditable block.
- Disappears on click-outside, Esc, or selection collapse.

**Tests.**
- Storybook for each toolbar state (selection in heading vs
  paragraph vs list item).
- Selection→Bold→deselect→reselect: toolbar reflects current
  formatting state (B button shows pressed).
- Integration test: typing `# heading` then selecting + clicking
  "B" wraps the heading text in `<strong>`; round-trips
  through serialize / parse.

### Phase 4 — Empty-state onboarding + template surfacing

**Goal.** Give a brand-new (zero-block-or-one-empty-paragraph)
document an actionable starting screen instead of a single
italic placeholder line.

**Deliverable.**
- New `<annot-doc-empty-state>` Lit element rendered when the
  document has zero blocks OR exactly one empty paragraph.
  Replaces the current
  `:empty::before` "Type / for commands…" placeholder for the
  empty-doc case (the placeholder stays for individual empty
  paragraphs in non-trivial docs).
- Renders four large clickable cards:
  - **"Start with a heading"** — inserts an H1 + empty
    paragraph; focuses the heading.
  - **"Insert an image"** — opens the file picker.
  - **"Use a template"** — opens the existing
    `<annot-template-picker>` (Phase 8 of `annot-html-document.md`).
  - **"Paste a screenshot"** — focuses the article and shows
    a hint pointing at the paste affordance ("Press Ctrl+V").
- Editable inline document title appears at the top of the
  empty-state card (replaces the read-only title in
  Phase 1's header during the empty-state period).

**Tests.**
- Storybook story for the empty state.
- Integration: clicking "Start with a heading" results in a
  document with one heading block + one empty paragraph + the
  cursor in the heading.

### Phase 5 — ContentEditable coverage: list items, callout / quote inner paragraphs, figcaption

**Goal.** Close the explicit gap noted in [annot-doc-shell.ts:14-19](packages/host-ui/src/annot-doc-shell.ts:14):
*"Future phase work will extend contentEditable to the
remaining text-bearing block kinds (list items, callout / quote
inner paragraphs, figcaption)."*

**Deliverable.**
- List items become individually contentEditable. Enter at end
  of an item creates a new item. Enter on an empty trailing
  item exits the list (converts to a paragraph).
- Callout / quote inner paragraphs become contentEditable.
  The block wrapper stays read-only (decorative).
- Figcaptions become contentEditable. The image element above
  stays click-to-edit-modal as today.
- Tab / Shift+Tab in list items adjusts indentation level
  (creates nested `<ul>` / `<ol>` per HTML spec).

**Tests.**
- Per-block-kind contentEditable smoke test: type-and-commit
  round-trips through `parseDocument` / `serializeDocument`
  byte-for-byte.
- Tab-indent test: typing items at increasing indent levels
  produces the expected nested-list structure.

### Phase 6 — Image block UX polish

**Goal.** Make the image-insertion flow and the image-editor
modal feel like one continuous experience.

**Deliverable.**
- **Drop zone overlay.** When the user drags any file over the
  document while in editing mode, a translucent overlay appears
  with "Drop image here to insert" copy. Drop outside the
  article boundary cancels (with a subtle bounce animation
  signalling the cancel).
- **Multi-paste / multi-drop sequencing.** Currently each paste
  inserts after the same focused block; multi-paste should
  insert sequentially. Test pasting 3 images → 3 figure blocks
  in order, each properly thumbnailed.
- **Click-to-edit affordance upgrade.** The current
  hover-only "Click to edit" badge becomes always-visible at
  the top-right of every image block in editing mode (lower
  opacity when not hovered).
- **Image editor modal: header strip parity.** Modal renders a
  `<annot-doc-image-modal-header>` with: "Editing image N of M"
  label, save-status pill, "Save & Close" primary, "Save &
  Continue" secondary, "Cancel" with dirty-confirm. Today the
  modal closes on Save / Esc with no explicit Save button.
- **Esc-to-cancel guard.** If the modal is dirty, Esc opens a
  confirm dialog ("Discard changes to image?") before closing.
- **Modal opens with focus on the canvas.** Currently a stray
  blur cycle steals focus.

**Tests.**
- Storybook for the modal header in each state.
- Drag-paste-3-images integration test.
- Esc-with-dirty integration test.

### Phase 7 — Drag-and-drop block reordering

**Goal.** Use the drag handle from Phase 2 to support real
drag-and-drop reorder, replacing the slow up-arrow-many-times
flow for moving a block past several others.

**Deliverable.**
- Drag handle (⠿) becomes a draggable. On drag-start, the
  block's outline lifts; placeholder gaps appear at every
  between-block position. On drop, the block moves to the
  target gap.
- Touch parity: long-press on the handle on touch devices
  initiates the drag.
- Undo / redo covers reorder operations (uses existing
  `DocumentHistory` snapshot path).

**Tests.**
- Drag-from-position-2-to-position-5 integration test against
  jsdom + `@testing-library/user-event` drag simulation.
- Snapshot of the document after reorder + undo + redo round
  trips byte-for-byte.

### Phase 8 — Keyboard shortcuts catalogue + help drawer integration

**Goal.** Document every keyboard shortcut the document mode
supports, AND surface them in the existing keyboard-help drawer
([`packages/host-ui/src/keyboard-help.ts`](packages/host-ui/src/keyboard-help.ts)).

**Deliverable.**
- New shortcuts:
  - `Ctrl+/` — open block menu at current block
  - `Ctrl+Enter` — insert paragraph below
  - `Ctrl+Shift+Enter` — insert paragraph above
  - `Ctrl+Shift+1` / `2` / `3` — convert block to H1 / H2 / H3
  - `Ctrl+Shift+8` — convert to bulleted list
  - `Ctrl+Shift+7` — convert to numbered list
  - `Ctrl+Shift+>` — convert to quote
  - `Ctrl+Shift+K` — insert link (if Phase 3 ships link
    insertion)
- Existing-but-undocumented shortcuts (Ctrl+B/I/U, Ctrl+Z/Y,
  Esc, Tab in lists, slash) added to the help drawer.
- Help drawer learns to render multiple shortcut "groups"
  (today it's image-editor-only); document group appears when
  doc mode is active.

**Tests.**
- Integration test for each new shortcut.
- Snapshot of the help drawer in doc mode pinning the shortcut
  list.

### Phase 9 — Mobile / touch / responsive layout

**Goal.** Make the document feature usable on a 768px-wide
tablet — currently every hover affordance is dead on touch.

**Deliverable.**
- Hover-only opacity transitions (block toolbar, image-edit
  badge) become always-visible under `@media (hover: none)`.
- Touch targets sized to ≥ 44 × 44 px for every clickable
  element in the doc shell (block toolbar buttons, insert
  bar, drag handle, header buttons).
- TOC drawer below 768px: hidden by default behind a "≡ Sections"
  button in the header strip; opens as a slide-out drawer over
  the article. Currently the responsive CSS at
  [annot-doc-shell.ts:263-274](packages/host-ui/src/annot-doc-shell.ts:263)
  just stacks the TOC above the article — fine for tall narrow
  screens, terrible UX on a tablet in landscape.
- Image-edit modal on small screens: full-screen instead of the
  current centered overlay.

**Tests.**
- Storybook viewport stories at 375 / 768 / 1024 widths.
- Manual on iPad-class viewport: every primary action is
  reachable by touch.

### Phase 10 — Performance pass for many-image documents

**Goal.** A 50-image, 100-block document opens in under 2s on a
mid-tier laptop and stays at 60fps while typing in a paragraph
near the bottom.

**Deliverable.**
- Lazy SVG materialisation for image blocks below the viewport.
  Today every image SVG is parsed + rendered eagerly during the
  initial article render. Phase 10 introduces a placeholder
  (data-URL thumbnail or solid-colour box at the right
  aspect ratio) for off-screen image blocks; the full SVG
  mounts when the block enters within 200vh of the viewport
  (`IntersectionObserver`).
- Snapshot history: today every keystroke in editing mode
  produces a new whole-document snapshot in `DocumentHistory`.
  At 100 blocks × 5 paragraphs of text, that's
  multi-MB-per-snapshot × 200-entry stack. Phase 10 introduces
  per-block diffing — the history stores the changed block and
  its index, not the whole document. Replay reconstitutes by
  applying diffs.
- Render benchmarking page in Storybook: synthesises an N-block
  document with M images, measures first-render + edit-keystroke
  latency.

**Tests.**
- Bench fixture: 100-block, 50-image doc renders < 2s on the
  CI machine; first keystroke commits < 100ms.
- Undo / redo round-trip on the diff path produces the same
  document as the snapshot path (existing whole-document tests
  stay green).

### Phase 11 — Document settings & metadata panel

**Goal.** Give the user a place to set document title, language
(`html[lang]`), description, and other top-level metadata that
the parser already understands.

**Deliverable.**
- Editable title field in the header strip (Phase 1 had it
  read-only).
- "⋯" → "Document settings…" opens a small modal with:
  - Title (text)
  - Language (select: ja / en / and a free-input for others)
  - Description (textarea — flows into `<meta name="description">`)
  - Theme: Light / Dark / Auto (matches the doc-mode CSS that
    already supports `prefers-color-scheme: dark` per
    [`inject-styles.ts`](packages/doc/src/inject-styles.ts))
- All edits go through `DocumentHistory` (undoable).

**Tests.**
- Set title + language + description → save → reload from
  storage → settings persisted.
- Storybook for the settings modal.

### Phase 12 — Export menu & save-status feedback

**Goal.** Surface the multi-format export options (PPTX shipped
in Phase 11 of the original plan; copy-as-HTML; future Markdown
when Phase 12 of original plan unfreezes) and finalise the
save-status surface.

**Deliverable.**
- Header strip "⋯" overflow menu populates with:
  - "Export to PPTX…" (calls existing `documentToPptxBlob`)
  - "Copy document HTML to clipboard"
  - "Save as…" (writes to a different store / path; existing
    PWA "save as" pipeline)
  - "Print" — `window.print()` on the doc-shell article
- Save status pill becomes interactive — click to see save
  history (last 5 saves with timestamps; future v2 hook for
  GitHub `commit-as-save` to surface the commit hash).
- "Save failed" state offers "Retry" and "Save to local copy"
  buttons inline.

**Tests.**
- Each menu item Storybook story.
- Save-failed fixture (mock store rejection) → retry succeeds
  → status returns to saved.

### Phase 13 — A11y audit + visual-polish sweep

**Goal.** Final pass before declaring product-ready.

**Deliverable.**
- Run `axe-core` against a Storybook page rendering each major
  doc state; address every violation.
- Confirm focus rings visible on every interactive element.
- Confirm reduced-motion support — every transition / animation
  respects `prefers-reduced-motion: reduce`.
- Visual polish: even spacing, typography hierarchy matches the
  image editor, dark-mode contrast verified.
- Add `aria-live` region for save-status announcements.
- Lighthouse-class audit on a sample document URL: target
  Lighthouse Best Practices ≥ 95, Accessibility ≥ 95.

**Tests.**
- `axe-core` Storybook integration in CI (blocking).
- Visual-regression snapshots in Storybook (existing infra).

## Out of scope for this plan

Explicitly deferred:

- **Markdown export** — owned by Phase 12 of the parent plan;
  ship when demand surfaces.
- **Tables / footnotes / inline image editing / real-time
  collaboration / native PDF / plugin-registered templates /
  template variable substitution** — explicit v2 deferrals
  from the parent plan; no change here.
- **Inline image editing** (i.e. editing the image's
  annotations without opening the modal) — interesting v2
  feature; would require routing every drawing tool through
  the doc shell's selection model, which is a separate plan.
- **Outline / collapsible block tree** — would need a new
  block-grouping concept; the format doesn't have section
  blocks today and adding them is a format change.
- **Inline link previews** — paste a URL → render a card —
  feature creep; no demand evidence.

## Verification per phase

Each phase PR's `Verified:` paragraph must include:

- `pnpm -r typecheck` passes
- `pnpm test` passes (full suite, with the count delta noted —
  most phases will add tests, not modify existing ones)
- `pnpm lint` reports 0 findings
- `pnpm --filter @ingcreators/annot-host-ui build` passes
- `pnpm --filter @ingcreators/annot-web build` passes
- For phases 6 / 9 / 10: manual browser test on Chrome + Firefox
- For phase 9 specifically: manual touch test on a real iPad
  or DevTools touch emulation
- For phase 13: `axe-core` Storybook job green

## Phase ordering rationale

The order trades "highest user impact first" against "later
phases assume earlier ones for visual coherence":

- **Phases 1–4** (header / insertion / inline format / empty
  state) are the four highest-impact discoverability wins and
  can ship in any internal order; the order here is just the
  one that builds visually (header first sets the chrome
  context for the others).
- **Phase 5** (contentEditable extension) is a known-debt
  closeout — explicitly deferred in the v1 source comments.
- **Phase 6** (image flow) builds on the header (modal pulls
  the same header pattern for "Editing image N of M").
- **Phase 7** (drag-drop) needs the drag handle from Phase 2.
- **Phase 8** (keyboard) consolidates the shortcuts that
  Phases 1–7 introduced.
- **Phase 9** (touch / mobile) is the responsive sweep over
  everything Phases 1–8 added.
- **Phases 10–13** are optimisation + polish + audit — they
  could move earlier if a regression demands it, but they
  build on the full surface of Phases 1–9.

## Done state

This plan is complete when:

1. Every phase has shipped to `main`.
2. The five fix-PR symptom classes (#570–#574) have known
   prevention guards in place — touch-test for #570-class
   mount issues, visible affordance for #571-class
   discoverability gaps, modal parity asserted by Phase 6 for
   #572-class chrome gaps, document save flow always
   populating thumbnail for #573-class, gallery layout
   asserted by visual goldens for #574-class.
3. The user reports that the document feature meets their
   "no obvious problems" bar in routine use.
4. This plan moves to `_done/` and a one-line pointer goes in
   the active index.
