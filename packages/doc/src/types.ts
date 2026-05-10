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
  /** Phase 13 of `docs/plans/annot-html-document.md` —
   *  opt-in auto-numbering for headings and figure captions.
   *  Implemented via CSS counters in `injectDocumentStyles`,
   *  so the numbering shows up identically in the editor and
   *  in standalone browser-view rendering. */
  readonly numbering?: NumberingMeta;
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

/** Auto-numbering toggles. All three fields are independent —
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
  | UnknownBlock;

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

/** Forward-compat preservation: any `<… data-annot-block="…">`
 *  whose value isn't in the v1 enumeration is captured here so
 *  the serializer can re-emit it byte-for-byte. */
export interface UnknownBlock {
  readonly kind: "unknown";
  readonly rawHtml: string;
}
