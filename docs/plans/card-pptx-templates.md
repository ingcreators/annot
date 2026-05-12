# PPTX template system for card documents

> **Status:** Draft
> **Compatibility:** Reworks the PPTX export pipeline from
> [`_done/annot-html-document.md`](./_done/annot-html-document.md)
> Phase 11 and [`_done/card-procedure-template.md`](./_done/card-procedure-template.md)
> Phase 6. Splits the currently-monolithic OOXML emission into a
> proper slide master + slide layouts + slide content tier. Adds
> a built-in template registry and a custom-template-upload flow.
> Touches `@ingcreators/annot-render` (Tier C-render — the PPTX
> output package), `@ingcreators/annot-core/zip` (read support
> alongside the existing write support), `@ingcreators/annot-doc`
> (Tier A — `meta.appearance.pptxTemplate` field), `@ingcreators/annot-host-ui`
> (Tier C — Appearance dialog extension, upload UI). Schema delta
> is additive — `data-annot-doc-version` stays at 1.
> **Risk:** Six phases, each independently revertable. The Phase 1
> slide-master refactor is the only invasive change; the existing
> PPTX golden in `document-pptx.test.ts` will regenerate (PR
> description must call out the new bytes). Subsequent phases add
> features without disturbing the foundation.

## Context

The current PPTX export (`document-pptx.ts`) hand-rolls every
OOXML file: `slide1.xml`, `slide2.xml`, ..., plus minimal
boilerplate for `theme1.xml`, `slideMaster1.xml`, and a single
`slideLayout1.xml`. Every visual decision — colours, fonts, badge
shape, image frame size — is hard-coded in TypeScript that
produces XML strings.

Three problems this causes:

1. **Branding requires a code change.** A user wanting their
   corporate template applied to the exported `.pptx` has to
   either edit the file post-export in PowerPoint (one-off,
   error-prone) or fork the exporter.
2. **Design iteration is slow.** Tweaking a colour means
   modifying a string literal in `document-pptx.ts`, rebuilding,
   re-exporting, opening in PowerPoint to check. PowerPoint is
   itself a visual editor — using it to design templates and
   reading the result back is the natural workflow.
3. **The HTML themes work doesn't carry over.** Once
   [`card-document-themes.md`](./card-document-themes.md) lands,
   a user picks "Editorial" in the Appearance dialog and their
   HTML document switches to serif typography and magazine-style
   block treatment — but the PPTX export still looks like the
   default theme. The two surfaces drift.

The OOXML format is built precisely for the templating use case:
slide masters define theme and shared elements, slide layouts
define per-slide-kind placeholder rectangles, slide instances
just fill placeholders with content. This plan moves the export
onto that architecture and then exposes the underlying template
as user-replaceable.

## Design

### OOXML tier model

OOXML PPTX presentations are layered:

| Tier | File(s) | What it carries |
|---|---|---|
| **Theme** | `ppt/theme/theme1.xml` | Colour scheme (12 colours), font scheme (major + minor typeface per script), effect scheme. Referenced by every slide via the master. |
| **Slide master** | `ppt/slideMasters/slideMaster1.xml` | Background, shared elements (page numbers, footers, logos), default placeholder positions, default text styles. One per deck. |
| **Slide layouts** | `ppt/slideLayouts/slideLayout1.xml` ... `slideLayoutN.xml` | Named layouts ("Title Slide", "Step / Image Top", etc.) each defining a set of placeholders. Inherits from the master. |
| **Slides** | `ppt/slides/slide1.xml` ... `slideN.xml` | Per-slide content. Each references one slide layout and fills (or overrides) its placeholders. |

The current export pretends all four tiers are one tier — slide
content carries its own positioning, colours, and text styles
inline. To support templates we have to push appropriate
responsibility into each tier:

- **Theme**: colour scheme (accent → step badge colour, etc.),
  font scheme (Annot Sans / Annot Serif / Annot Mono triples
  per script).
- **Slide master**: nothing yet — Phase 1 leaves it minimal but
  valid. Future enhancement: page-number placeholder shared
  across slides.
- **Slide layouts**: one per (step layout × cover / closing
  variant). Six layouts total in Phase 1:
  - `Annot Cover` — title + description + step count.
  - `Annot Step / Image Top` — badge + title + image + body.
  - `Annot Step / Image Bottom` — image + title + body + badge.
  - `Annot Step / Image Left` — image (left half) + badge +
    title + body (right half).
  - `Annot Step / Image Right` — mirror of above.
  - `Annot Step / Image Fill` — full-bleed image + overlay
    bottom band carrying badge + title + body.
- **Slides**: per-document content. References the right layout
  by name; fills placeholders by `idx` and `type`.

### Placeholder naming convention

Each layout defines named placeholders the exporter recognises:

```xml
<!-- Annot Step / Image Top -->
<p:sp>
  <p:nvSpPr>
    <p:nvPr>
      <p:ph type="body" idx="100" />
      <p:custDataLst><p:tags r:id="rIdAnnotStepBadge" /></p:custDataLst>
    </p:nvPr>
  </p:nvSpPr>
  ...
</p:sp>
```

Or, more simply, naming convention via the `name` attribute:

```xml
<p:nvSpPr>
  <p:cNvPr id="2" name="Annot.StepBadge" />
  ...
</p:nvSpPr>
```

The exporter walks the chosen layout's shapes, identifies
placeholders by their `name` attribute (prefix `Annot.`),
and emits per-slide content into matching `<p:sp>` elements.

Recognised names:

| Name | Role | Content emitted |
|---|---|---|
| `Annot.StepBadge` | The numbered badge (circle/rounded-rect shape). | `index + 1` as the inner text run; counter increment is exporter-side. |
| `Annot.StepTitle` | Step title text. | `TextRun[]` from the block's `title` field. |
| `Annot.StepBody` | Step body text. | `TextRun[]` from the block's `body` field. |
| `Annot.StepImage` | The image group anchor — defines the rect into which the screenshot + annotations get scaled. | A `<p:grpSp>` carrying the SVG-derived OOXML shapes (existing pipeline). |
| `Annot.StepUrlChip` | URL chip (optional, hidden if absent). | The block's `link` content with `<a:hlinkClick>`. |
| `Annot.DocTitle` | Used in cover + footer layouts. | The document's `meta.title`. |
| `Annot.DocAuthor` | Used in cover. | `meta.author`. |
| `Annot.DocDescription` | Used in cover. | `meta.header.description`. |
| `Annot.StepCount` | Used in cover. | The total count of step blocks. |
| `Annot.SlideNumber` | Used in footer (Phase 6). | `slideIndex / totalSlides`. |

Layouts can include or omit any of these. A layout with only
`Annot.StepImage` works (no badge, no text) — the exporter just
doesn't emit content for missing placeholders.

### Theme colour scheme

The OOXML `<a:clrScheme>` defines 12 colours by role (dk1 / lt1
/ dk2 / lt2 / accent1..6 / hlink / folHlink). The default Annot
template will use:

```xml
<a:clrScheme name="Annot Modern">
  <a:dk1><a:srgbClr val="1f2937"/></a:dk1>      <!-- body fg -->
  <a:lt1><a:srgbClr val="ffffff"/></a:lt1>      <!-- body bg -->
  <a:dk2><a:srgbClr val="6b7280"/></a:dk2>      <!-- muted -->
  <a:lt2><a:srgbClr val="f3f4f6"/></a:lt2>      <!-- subtle bg -->
  <a:accent1><a:srgbClr val="2563eb"/></a:accent1> <!-- step badge -->
  <a:accent2><a:srgbClr val="14b8a6"/></a:accent2>
  <a:accent3><a:srgbClr val="f59e0b"/></a:accent3>
  <a:accent4><a:srgbClr val="ef4444"/></a:accent4>
  <a:accent5><a:srgbClr val="8b5cf6"/></a:accent5>
  <a:accent6><a:srgbClr val="ec4899"/></a:accent6>
  ...
</a:clrScheme>
```

Slide layouts and master reference colours via `<a:schemeClr
val="accent1"/>` rather than inlining hex codes. When the user
swaps templates, the entire deck's colour story shifts.

### Built-in templates

Templates ship as **actual `.pptx` files** authored in PowerPoint,
not as TypeScript. The Phase 2 deliverable is:

```
packages/render/src/pptx/templates/
  modern-light.pptx     <- ZIP authored in PowerPoint, committed to repo
  modern-dark.pptx
  minimal.pptx
  editorial.pptx
  playful.pptx
```

Each template contains:

- Required: `Annot Cover`, the five step layouts, valid theme +
  master.
- Optional: a `Annot Closing` layout for an outro slide.
- Authored placeholders carrying the `Annot.*` names listed above.

Authoring workflow (documented in
`docs/pptx-template-authoring.md`):

1. Open `packages/render/src/pptx/templates/modern-light.pptx` in
   PowerPoint.
2. View → Slide Master. Each layout's placeholders are named
   `Annot.StepBadge` etc.
3. Edit visuals: colours via the Theme tab, fonts via the master,
   per-layout tweaks in each layout slide.
4. Save the `.pptx` back. Commit.

The build system loads these as binary assets:

```ts
// packages/render/src/pptx/templates/registry.ts
import modernLightBytes from "./modern-light.pptx?url";
// ... or, with a Vite plugin to inline as Uint8Array:
// import modernLightBytes from "./modern-light.pptx?uint8array";

export const BUILTIN_TEMPLATES: Record<BuiltinTemplateId, () => Promise<Uint8Array>> = {
  "modern-light": async () => (await fetch(modernLightBytes)).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
  // ...
};
```

(The fetch-from-URL form is the safer first cut; tightening to
true binary inlining is a Phase 6 polish.)

### Custom templates

Phase 4 adds a "Upload template..." control to the Appearance
dialog. The user picks a `.pptx`, it's stored in their
`StorageProvider` (alongside HTML document templates from
`_done/annot-html-document.md` Phase 8), and `meta.appearance.pptxTemplate`
records a `{ source: "custom"; id: string }` reference.

Storage contract: custom PPTX templates go into the same
"templates" namespace as HTML templates, distinguished by
extension (`.pptx` vs `.annot.html`). The picker filters by kind
when opening a card document.

### Pairing with HTML themes

Each built-in HTML theme from
[`card-document-themes.md`](./card-document-themes.md) ships with
a matching PPTX template carrying the same colour story and
typography spirit:

| Appearance | HTML theme module | PPTX template file |
|---|---|---|
| Modern Light | `modern-light.ts` | `modern-light.pptx` |
| Modern Dark | `modern-dark.ts` | `modern-dark.pptx` |
| Minimal | `minimal.ts` | `minimal.pptx` |
| Editorial | `editorial.ts` | `editorial.pptx` |
| Playful | `playful.ts` | `playful.pptx` |

When the user picks an Appearance in the dialog, both fields get
set:

```ts
doc.meta.appearance = {
  template: "modern-light",         // HTML theme
  pptxTemplate: { source: "builtin", id: "modern-light" },  // PPTX
};
```

The user can still mix and match — picking "Modern Light" HTML
theme with a custom PPTX template, or vice versa — but the
default behaviour ties them together.

### Data layer

```ts
// In NumberingMeta and DocMeta — extension to AppearanceMeta from
// card-document-themes.md
export interface AppearanceMeta {
  readonly template?: BuiltinThemeId | "custom";
  readonly customCss?: string;
  readonly fontFamily?: { sans?: string; serif?: string; mono?: string };
  // NEW
  readonly pptxTemplate?: PptxTemplateRef;
}

export type PptxTemplateRef =
  | { readonly source: "builtin"; readonly id: BuiltinTemplateId }
  | { readonly source: "custom"; readonly id: string /* StorageProvider key */ };

export type BuiltinTemplateId =
  | "modern-light"
  | "modern-dark"
  | "minimal"
  | "editorial"
  | "playful";
```

### Export pipeline

```ts
async function exportDocumentPptx(
  doc: AnnotDocument,
  resolveTemplate: TemplateResolver,
): Promise<Blob> {
  const templateRef = doc.meta.appearance?.pptxTemplate ?? { source: "builtin", id: "modern-light" };
  const templateBytes = await resolveTemplate(templateRef);
  const template = await loadPptxTemplate(templateBytes);   // unzip + parse layouts

  const fileMap = { ...template.passthroughFiles };          // copy theme / master / layouts / media
  const slides = buildSlides(doc, template);                  // generate slide{N}.xml referencing layouts
  for (const slide of slides) fileMap[slide.path] = slide.bytes;

  // Recompute [Content_Types].xml and _rels/* with the new slide count.
  fileMap["[Content_Types].xml"] = buildContentTypes(template, slides);
  fileMap["ppt/_rels/presentation.xml.rels"] = buildPresentationRels(template, slides);

  return new Blob([buildZip(fileMap)], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}
```

`TemplateResolver` is injected by the host — PWA wires it to
`BUILTIN_TEMPLATES[id]()` for builtins and to `storage.loadTemplate(id)`
for custom ones.

### ZIP read support

The existing `@ingcreators/annot-core/zip` exports a `buildZip()`
function but no reader. This plan adds a `readZip(bytes: Uint8Array): Map<string, Uint8Array>`
function. Implementation: simplest viable inflate (DEFLATE
decompression). Options:

- Add `fflate` as a dependency (~30 KB, well-maintained, dual-license).
- Hand-roll inflate. Higher risk, more code, no payoff.

The plan picks `fflate`. It also subsumes the current `buildZip()`
if we want to consolidate, but that's an optional Phase 6 polish
— not load-bearing.

### Tier placement

PPTX template loading is rendering-only — no editor UI is
touched. Goes into `@ingcreators/annot-render` (Tier C-render).
The template registry + loader + builtin-bytes registration all
live in `packages/render/src/pptx/templates/`.

The host wires up the resolver:

- `packages/web` (PWA): both `BUILTIN_TEMPLATES` and custom
  templates loaded via `storage.loadTemplate(id)`.
- `packages/vscode`: same.
- `packages/desktop`: same.

## Phased plan

One PR per phase, each independently revertable.

### Phase 1 — Refactor to slide master + layouts

- Restructure [`document-pptx.ts`](../../packages/render/src/pptx/document-pptx.ts):
  - Extract slide-layout XML templates into per-layout TypeScript
    files (`packages/render/src/pptx/layouts/image-top.ts` etc.)
    that emit valid `slideLayoutN.xml` with `Annot.*`-named
    placeholders.
  - Slide content emission walks the chosen layout's placeholders
    and fills them — no inline positioning except for the
    `Annot.StepImage` group's `<a:xfrm>` (which still derives from
    the SVG's intrinsic dimensions).
  - Theme XML gains the named `Annot Modern` colour scheme + Annot
    Sans / Serif / Mono in the font scheme.
- Existing `document-pptx.test.ts` golden regenerates; PR
  description must enumerate the new differences.
- No template selection yet — there's exactly one built-in
  template, equivalent to today's output style upgraded to the
  new architecture.

**Verified:** PPTX golden updated, manual open in PowerPoint (one
desktop test each on Mac / Windows), `pnpm --filter
@ingcreators/annot-render typecheck test build`.

### Phase 2 — Built-in template registry + ZIP read

- Add `fflate` to `packages/render`'s dependencies.
- New `readZip` export from `@ingcreators/annot-core/zip` (or a
  local helper in `packages/render/src/pptx/`; the plan picks
  core so the dependency is justified for shared reuse, including
  the eventual custom-template-upload path).
- Author the five built-in `.pptx` files in PowerPoint, place in
  `packages/render/src/pptx/templates/`.
- Template registry as `BUILTIN_TEMPLATES`, loadable via
  `loadPptxTemplate(id)`.
- `exportDocumentPptx` accepts a `templateRef` parameter; absence
  defaults to `"modern-light"`.
- One PPTX golden test per template — confirm each loads + emits
  valid bytes for the same source document.

**Verified:** PPTX goldens for each template; manual open of all
five in PowerPoint; cross-platform sanity (Mac + Windows
PowerPoint both render every template without warnings).

### Phase 3 — Appearance dialog: PPTX template picker

- Extend the Appearance tab from
  [`card-document-themes.md`](./card-document-themes.md) Phase 3
  with a "PowerPoint export template" row.
- Theme picker — radio cards with thumbnail previews of each
  built-in PPTX template (rendered offline via LibreOffice or
  via a pre-rendered PNG committed alongside the `.pptx`).
- Selecting a theme writes `meta.appearance.pptxTemplate`.
- Picking an HTML theme auto-sets the matching PPTX template
  (the pairing); the user can unpair manually.

**Verified:** Storybook story; manual cycle through every
template and export to verify visual correctness.

### Phase 4 — Custom template upload

- `<annot-pptx-template-picker>` Lit component (host-ui Tier C)
  gains an "Upload..." button.
- File input restricted to `.pptx`; on pick, validate the file:
  - Has a `ppt/slideMasters/slideMaster1.xml`.
  - Has at least one `slideLayout` with `name="Annot.Step..."`
    placeholders (recognise either Step layout naming or fall
    back to the first layout if the user wants a one-layout-fits-
    all template).
  - Total size < 20 MB.
- On valid: persist via `storage.saveTemplate(id, kind: "pptx", bytes)`.
  `meta.appearance.pptxTemplate = { source: "custom", id }`.
- On invalid: dialog shows a validation report ("Missing
  Annot.StepBadge placeholder. Required: ..."). Link to the
  authoring guide.

**Verified:** authoring-guide doc; unit tests for the validator;
manual upload of a hand-crafted minimal template + a corporate
template + a deliberately broken template.

### Phase 5 — Template-aware badge / image / text emission

- Walk the chosen layout's placeholders. For each recognised
  `Annot.*` name, emit content into the matching `<p:sp>`:
  - `Annot.StepBadge` — substitute the text run with the numeral
    (or the `meta.numbering.stepLabel` parsed template, replacing
    `%n` with the slide index).
  - `Annot.StepTitle` / `Annot.StepBody` — substitute the
    placeholder's default text with the block's content; preserve
    the placeholder's default text styling (font / size / colour
    inherits from the layout / master / theme).
  - `Annot.StepImage` — replace the placeholder rect's geometry
    with a `<p:grpSp>` carrying the image + annotations group
    sized to the placeholder's `<a:xfrm>`. Annotation OOXML
    emission unchanged.
  - `Annot.StepUrlChip` — emit when `step.link` is set; skip
    placeholder when not.
- Cover slide (Phase 5b within this phase if scoped tight): the
  `Annot Cover` layout's placeholders get filled from `meta.title`
  / `meta.author` / `meta.header.description` / step count.

**Verified:** PPTX goldens regenerate; visual review in PowerPoint
of one document × each built-in template; the badge / title /
body all inherit theme typography correctly.

### Phase 6 — Authoring docs, polish, archival

- [`docs/pptx-template-authoring.md`](../../docs/pptx-template-authoring.md):
  full authoring guide for power users + corporate-template
  authors. Includes:
  - Required layouts + their placeholder name conventions.
  - Recommended colour scheme (`accent1` for badge).
  - How to test a template: open the sample card document, pick
    the template, export, verify.
  - Troubleshooting (missing placeholder, mis-named placeholder).
- Plan moves to `_done/`.
- CLAUDE.md guardrails get a new section #12 — "PPTX templates
  are user-replaceable assets; don't hard-code theme decisions
  in `document-pptx.ts`".

**Verified:** authoring guide reviewed by user; final PPTX
golden round-trip pass.

## Verification

- `pnpm -r typecheck`.
- `pnpm test` — new tests cover the template loader, the
  placeholder walker, the validator (Phase 4), every built-in
  template's golden.
- `pnpm --filter @ingcreators/annot-render build`.
- Manual cross-platform: open the exported `.pptx` from each
  template on PowerPoint Mac + Windows + Google Slides + Keynote.
  All four should render the slides without warnings; minor
  rendering differences (font substitution, shadow rendering)
  are acceptable as long as no shapes are missing.

## Migration notes

- Schema delta is additive. `data-annot-doc-version` stays at 1.
- Documents without `meta.appearance.pptxTemplate` export with
  the default built-in (`modern-light`). This is a deliberate
  visual change from the pre-plan output style; PR description
  for Phase 1 must call it out explicitly.
- No data migration. Old exported `.pptx` files on disk stay
  exactly as they were; the new code only affects future exports.

## Forward-looking notes

- **Plugin-supplied templates.** Same pattern as
  [`card-document-themes.md`](./card-document-themes.md)'s
  plugin-supplied themes — a future plan extends `PluginHost`
  with `addPptxTemplate(template)`.
- **Cover slide design system.** Phase 5's cover handling is
  intentionally minimal; future work could add multiple cover
  layouts (`Annot Cover / Title Only`, `Annot Cover / Title +
  Image`, etc.) and let the user pick per document.
- **HTML → PPTX rendering parity.** When the HTML themes plan
  ships a per-block style, the PPTX template author can mirror
  it. This plan stops short of automated parity (each surface
  is hand-tuned in its own format); reaching full parity is a
  later effort.
- **Theme-shared design tokens.** A future enhancement could
  unify the HTML theme + PPTX template colour story into a
  single Tier A `DesignTokens` object that both consume, so a
  third-party theme author only writes one config. Out of scope
  for v1 — the two formats are different enough (CSS vs OOXML)
  that going through tokens adds complexity without clear payoff
  until concrete themes drive the requirement.
- **Closing slide.** Phase 1's layout list mentions optional
  `Annot Closing`. Currently no Annot UI emits a closing block —
  this becomes relevant when the document model gains a "closing
  paragraph" or "next steps" affordance.
