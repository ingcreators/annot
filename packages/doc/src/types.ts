/**
 * Core types for the `.annot.html` document format.
 *
 * See `docs/annot-html-format.md` for the canonical format spec.
 * This file is the runtime ABI for that spec; field renames or
 * shape changes here require a `data-annot-doc-version` bump per
 * `CLAUDE.md` guardrail #1's spirit.
 */

/** Current version of the document format. */
export const ANNOT_DOC_VERSION = 1 as const;
export type AnnotDocVersion = typeof ANNOT_DOC_VERSION;

/** Top-level document model. */
export interface AnnotDocument {
  readonly version: AnnotDocVersion;
  /** BCP-47 language tag, e.g. `"en"`, `"ja"`. */
  readonly lang: string;
  /** Mirrors the JSON sidecar's `title` field; the serializer
   *  enforces `<title>` ↔ `meta.title` equality on save. */
  readonly title: string;
  /** Document-level metadata (sidecar JSON). */
  readonly meta: DocMeta;
  /** Opaque content of the in-`<head>` `<style>` block, or `null`
   *  when no style block is present. Phase 2's
   *  `injectDocumentStyles` populates this; Phase 1 preserves
   *  whatever the input had verbatim. */
  readonly styleBlock: string | null;
  /** Block tree under `<article data-annot-doc>`. */
  readonly blocks: readonly Block[];
}

/** Metadata sidecar — serialised as compact JSON in
 *  `<script type="application/annot+json" data-annot-doc-meta>`.
 *  Keys serialise alphabetically per the canonicalisation rules. */
export interface DocMeta {
  readonly title: string;
  readonly author?: string;
  readonly theme?: "light" | "dark" | "auto";
  readonly maxWidth?: "narrow" | "medium" | "wide" | "full";
  readonly template?: TemplateMeta;
  readonly imageMeta?: Readonly<Record<string, ImageMeta>>;
  /** Phase 13 of `docs/plans/_done/annot-html-document.md` —
   *  opt-in auto-numbering for headings and figure captions.
   *  Implemented via CSS counters in `injectDocumentStyles`,
   *  so the numbering shows up identically in the editor and
   *  in standalone browser-view rendering. */
  readonly numbering?: NumberingMeta;
  /** Phase 1 of `docs/plans/_done/card-procedure-template.md` —
   *  card-grid + default-step-layout settings for documents that
   *  carry `step` blocks. Both nested fields are optional; an
   *  unset cardLayout means the implicit defaults (single-column
   *  stack, `image-top` for new steps). */
  readonly cardLayout?: CardLayoutMeta;
  /** Phase 7c of `docs/plans/_done/card-procedure-template.md` —
   *  Scribe-style document header (icon + description). The
   *  `title` field above already covers the heading text; the
   *  `author` field above is shown in the header metadata row;
   *  the step count is derived from the block walk. Setting
   *  this field opts the document into the rendered header
   *  treatment AND into the matching PPTX cover slide. */
  readonly header?: DocHeaderMeta;
}

/** Scribe-style document header — icon + free-form description
 *  shown above the article body and on the PPTX cover slide.
 *  Both fields are optional; setting one without the other is
 *  valid (icon-only or description-only headers both render). */
export interface DocHeaderMeta {
  /** Optional icon, stored as a `data:` URL (PNG / JPEG / SVG)
   *  so the document stays self-contained. Empty / absent →
   *  the header renders without an icon column. */
  readonly icon?: string;
  /** Optional plain-text description shown below the title.
   *  Authored as plain text rather than inline HTML so the
   *  PPTX cover slide can re-render it without an HTML→OOXML
   *  conversion step. */
  readonly description?: string;
}

export interface TemplateMeta {
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly string[];
}

export interface ImageMeta {
  readonly alt?: string;
  readonly sourceUrl?: string;
  readonly capturedAt?: string;
}

/** Auto-numbering toggles. All fields are independent —
 *  a doc can number headings without numbering figures, and
 *  vice versa. Absent / `false` means no numbering for that
 *  category. */
export interface NumberingMeta {
  /** Number h1 / h2 / h3 with hierarchical "1.", "1.1", "1.1.1"
   *  prefixes. The numeric values come from CSS counters reset
   *  on the article element so the numbering matches the
   *  block order in the document tree. */
  readonly headings?: boolean;
  /** Number `<figure>` blocks with a "Figure N: " prefix in
   *  the figcaption. Counter increments on every image block
   *  in document order, regardless of section nesting. */
  readonly figures?: boolean;
  /** Override the figure-number prefix label. Default:
   *  `"Figure "`. Set to `"図 "` for Japanese-localised docs,
   *  `"Abbildung "` for German, etc. The trailing space is
   *  authored explicitly so multi-byte locales that don't use
   *  spaces can elide it. */
  readonly figureLabel?: string;
  /** Phase 1 of `docs/plans/card-step-auto-numbering.md` — number
   *  every `[data-annot-block="step"]` in document order. The
   *  numeric value comes from a CSS counter (`annot-step`) so
   *  reordering steps via the editor's drag-handle updates the
   *  rendered numbers automatically. The CSS counter content is
   *  rendered on the step section's `::before` pseudo-element,
   *  styled as a Scribe-style numbered badge. Phase 2 emits the
   *  matching CSS. */
  readonly steps?: boolean;
  /** Phase 1 of `docs/plans/card-step-auto-numbering.md` — badge
   *  content template. `%n` is required and gets replaced by the
   *  CSS counter at render time; everything else is literal CSS
   *  `content` text. Default: `"%n"` (just the number). Common
   *  alternatives: `"Step %n"`, `"%n."`, `"%n /"`. Only meaningful
   *  when `steps` is true; ignored otherwise. */
  readonly stepLabel?: string;
}

/** Discriminated union over every v1 block kind plus a passthrough
 *  for forward-compat preservation of unknown blocks. */
export type Block =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | CodeBlock
  | QuoteBlock
  | CalloutBlock
  | DividerBlock
  | ImageBlock
  | StepBlock
  | UnknownBlock;

/** Visual layout of a `StepBlock`. The five enum values mirror
 *  PowerPoint slide layouts that `exportDocumentPptx` will pick
 *  per-block in Phase 6 of `docs/plans/_done/card-procedure-template.md`. */
export type StepLayout = "image-top" | "image-bottom" | "image-left" | "image-right" | "image-fill";

/** Card-grid + default-step-layout settings carried in the JSON
 *  sidecar. Both fields are optional. */
export interface CardLayoutMeta {
  /** Cards-per-row in standalone view at the document's
   *  max-width. `"auto"` uses `repeat(auto-fill, …)` with a
   *  card-min-width breakpoint. Default `1` (vertical stack). */
  readonly columns?: 1 | 2 | 3 | "auto";
  /** Default `data-step-layout` for newly-inserted step blocks
   *  in the editor. Per-block `data-step-layout` always wins on
   *  render. Default `"image-top"`. */
  readonly defaultStepLayout?: StepLayout;
}

export interface HeadingBlock {
  readonly kind: "heading";
  readonly level: 1 | 2 | 3;
  /** Inline HTML content (canonical form). Stored as a string
   *  rather than a richer AST in Phase 1 — Phase 4's editor work
   *  introduces inline parsing when block-level edit operations
   *  need it. */
  readonly inlineHtml: string;
}

export interface ParagraphBlock {
  readonly kind: "paragraph";
  readonly inlineHtml: string;
}

export interface ListBlock {
  readonly kind: "list";
  readonly ordered: boolean;
  /** CSS `list-style-type` value: `disc` / `circle` / `square` for
   *  unordered; `decimal` / `lower-alpha` / `upper-alpha` /
   *  `lower-roman` / `upper-roman` for ordered. */
  readonly listStyle: string;
  /** Ordered lists only — non-1 starting number. Omitted = 1. */
  readonly start?: number;
  /** Each item is canonical inline HTML. */
  readonly items: readonly string[];
}

export interface CodeBlock {
  readonly kind: "code";
  readonly lang?: string;
  /** Plain text — preserved verbatim, including newlines. */
  readonly text: string;
}

export interface QuoteBlock {
  readonly kind: "quote";
  /** Each paragraph is canonical inline HTML. */
  readonly paragraphs: readonly string[];
}

export interface CalloutBlock {
  readonly kind: "callout";
  readonly tone: "info" | "warn" | "note";
  readonly paragraphs: readonly string[];
}

export interface DividerBlock {
  readonly kind: "divider";
}

export interface ImageBlock {
  readonly kind: "image";
  /** Stable per-image identifier. Format: `img-` prefix + 8 to 32
   *  chars from `[a-zA-Z0-9_-]`. */
  readonly id: string;
  /** Canonical inner-form `<svg>…</svg>` bytes (no leading
   *  whitespace; lines indented relative to the SVG root). The
   *  serializer prefixes each line with the figure-child indent
   *  on emit. */
  readonly svg: string;
  /** Optional figcaption inline HTML. */
  readonly caption?: string;
}

/** Card-style procedure step: image + title + body in a single
 *  block. The three slots have fixed DOM order (svg → title →
 *  body) regardless of `layout`; the visual rearrangement is
 *  pure CSS Grid in `injectDocumentStyles` (Phase 2 of
 *  `docs/plans/_done/card-procedure-template.md`). */
export interface StepBlock {
  readonly kind: "step";
  /** Stable per-image identifier. Shares the `data-annot-image-id`
   *  namespace with `ImageBlock` — IDs MUST be unique within the
   *  document regardless of which block kind uses them. Same
   *  format as `ImageBlock.id`. */
  readonly id: string;
  /** Canonical inner-form `<svg>…</svg>` bytes — same shape as
   *  `ImageBlock.svg`. The empty string `""` is valid and indicates
   *  an **image-less step**: a text-only narrative card with title +
   *  body only (Phase 7a of the plan). The serializer omits the
   *  `<svg>` child entirely when this field is empty; the parser
   *  accepts both forms. */
  readonly svg: string;
  /** Title inline HTML. Empty string is a valid placeholder
   *  rendered by the editor as a "type to start" affordance. */
  readonly title: string;
  /** Body inline HTML. Same placeholder semantics as `title`. */
  readonly body: string;
  /** Per-block layout. Defaults to `"image-top"` on parse / clone
   *  / new-block construction. The serializer always emits the
   *  attribute explicitly even for the default. */
  readonly layout: StepLayout;
  /** Phase 7b of `docs/plans/_done/card-procedure-template.md` —
   *  optional URL chip (Scribe-style "Navigate to …" affordance).
   *  When present, the standalone view and editor render a clickable
   *  chip below the step title; the PPTX export emits the chip
   *  with a `<a:hlinkClick>` so PowerPoint opens the URL on click.
   *  `label` defaults to the URL string when absent.
   *
   *  The URL is restricted to `http://`, `https://`, and `mailto:`
   *  schemes — anything else is dropped on parse to defang
   *  `javascript:` / `data:` payloads from hostile input. */
  readonly link?: StepLink;
  /** Phase 7d of `docs/plans/_done/card-procedure-template.md` —
   *  Scribe-style image viewport. A sub-rectangle of the SVG
   *  coordinate space defining the **initial view** of the
   *  screenshot inside the card's fixed display area. Interactive
   *  pan / zoom in standalone view stays ephemeral; the saved
   *  `viewport` is what new readers see on first open and what
   *  the PPTX export uses to crop the bitmap.
   *
   *  Coordinates are in SVG-native pixel space — same coord system
   *  as `<g id="annotations">` children. Missing field → display
   *  the full SVG viewBox (pre-Phase-7d behaviour). */
  readonly viewport?: StepViewport;
}

/** URL chip carried on a step block. See `StepBlock.link`. */
export interface StepLink {
  /** Validated URL (http / https / mailto only). */
  readonly url: string;
  /** Optional human-friendly label. When absent the renderer
   *  falls back to the URL string itself. */
  readonly label?: string;
}

/** Phase 7d — initial-view viewport for the step's screenshot.
 *  All four fields are in SVG-native pixel coordinates and MUST
 *  satisfy `w > 0 && h > 0`. The values are NOT clamped to the
 *  SVG's viewBox here — the renderer / PPTX export silently
 *  clip when the user pans beyond the bitmap. */
export interface StepViewport {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Forward-compat preservation: any `<… data-annot-block="…">`
 *  whose value isn't in the v1 enumeration is captured here so
 *  the serializer can re-emit it byte-for-byte. */
export interface UnknownBlock {
  readonly kind: "unknown";
  readonly rawHtml: string;
}
