/**
 * `resolveFigureRefs(doc)` — Phase 13b of
 * `docs/plans/_done/annot-html-document.md`. Walks the document's
 * inline HTML and re-writes every
 * `<span data-annot-figref="img-…">…</span>` element with the
 * current "Figure N" label so cross-references stay consistent
 * with the live block order.
 *
 * The contract: cross-references are stored on disk as
 *
 *     <span data-annot-figref="img-foo">Figure 3</span>
 *
 * The visible text inside the span IS the rendered label.
 * `resolveFigureRefs` is the maintenance pass that keeps the
 * label in sync with the current image-block order — the
 * editor / save pipeline runs it before serialise so users
 * never see "Figure 3" pointing at what's now image block #2.
 *
 * Standalone browser view doesn't run JS, so the bytes on disk
 * have to be self-consistent at save time. CSS counters
 * (Phase 13a) handle the figcaption side automatically because
 * they refer to "the current count at this DOM position" —
 * cross-references are a different problem because they
 * reference ANOTHER position in the tree.
 *
 * Tier B: needs `globalThis.DOMParser` to parse / re-serialise
 * inline HTML fragments. Pure-Node callers without happy-dom
 * get a clear `AnnotDocResolveError` instead of a `TypeError`.
 *
 * Idempotent. Stable image-block IDs mean re-running
 * `resolveFigureRefs` on its own output is a no-op when the
 * block order hasn't changed.
 */

import type { AnnotDocument, Block, ImageBlock } from "./types.js";

export class AnnotDocResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnotDocResolveError";
  }
}

export interface ResolveFigureRefsOptions {
  /** DOMParser constructor. Defaults to `globalThis.DOMParser`. */
  DOMParser?: typeof DOMParser;
  /** Override the figure-number prefix label. Defaults to
   *  `meta.numbering.figureLabel` if set, else `"Figure "`.
   *  Trailing whitespace is the caller's concern. */
  figureLabel?: string;
  /** Text to render for an `<span data-annot-figref="img-X">`
   *  whose `img-X` doesn't match any image block in the
   *  document. Defaults to `"?"`. The placeholder makes the
   *  stale-reference visible without crashing the export — the
   *  user can find + fix it via search. */
  staleLabel?: string;
}

/**
 * Walk every block's inline HTML, re-resolve every
 * `<span data-annot-figref="…">` to the current label, and
 * return a new document with the updated bytes. The original
 * document is not mutated.
 *
 * Block kinds touched: `heading`, `paragraph`, `quote`
 * (per-paragraph), `callout` (per-paragraph), `list` (per-
 * item), and `image` (caption). `code` and `divider` are
 * inert — code text is rendered in `<pre>` verbatim and
 * `<hr>` carries no inline content.
 */
export function resolveFigureRefs(
  doc: AnnotDocument,
  opts: ResolveFigureRefsOptions = {},
): AnnotDocument {
  const Parser = opts.DOMParser ?? (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (!Parser) {
    throw new AnnotDocResolveError(
      "resolveFigureRefs: DOMParser is not available; pass `opts.DOMParser` or run in a browser-like environment.",
    );
  }

  // Build the figure-number map in document order. Image
  // blocks without a usable id (defensive — every shipped
  // ImageBlock carries one) are skipped.
  const figureNumberById = computeFigureNumberMap(doc.blocks);

  const figureLabel = opts.figureLabel ?? doc.meta.numbering?.figureLabel ?? "Figure ";
  const staleLabel = opts.staleLabel ?? "?";

  /** Resolve cross-refs in one inline-HTML fragment. Returns
   *  the unchanged input when the fragment carries no figref
   *  spans (most common case — saves an allocation). */
  const resolveInline = (html: string): string => {
    if (!html.includes("data-annot-figref")) return html;
    return rewriteFigrefs(Parser, html, figureNumberById, figureLabel, staleLabel);
  };

  const blocks: Block[] = doc.blocks.map((block) => rewriteBlock(block, resolveInline));

  return { ...doc, blocks };
}

// ---- Internals --------------------------------------------------------

function computeFigureNumberMap(blocks: readonly Block[]): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const b of blocks) {
    if (b.kind !== "image") continue;
    n += 1;
    if (b.id) out.set(b.id, n);
  }
  return out;
}

function rewriteBlock(block: Block, resolveInline: (html: string) => string): Block {
  switch (block.kind) {
    case "heading":
      return rewriteHtmlField(block, "inlineHtml", resolveInline);
    case "paragraph":
      return rewriteHtmlField(block, "inlineHtml", resolveInline);
    case "list":
      return { ...block, items: block.items.map(resolveInline) };
    case "quote":
      return { ...block, paragraphs: block.paragraphs.map(resolveInline) };
    case "callout":
      return { ...block, paragraphs: block.paragraphs.map(resolveInline) };
    case "image": {
      const out: ImageBlock = { kind: "image", id: block.id, svg: block.svg };
      if (block.caption !== undefined) {
        (out as { caption?: string }).caption = resolveInline(block.caption);
      }
      return out;
    }
    // `code` text is verbatim plain text; `divider` has no
    // inline content; `unknown` is opaque passthrough.
    default:
      return block;
  }
}

function rewriteHtmlField<B extends Block, K extends keyof B>(
  block: B,
  key: K,
  resolveInline: (html: string) => string,
): B {
  const value = block[key];
  if (typeof value !== "string") return block;
  return { ...block, [key]: resolveInline(value) };
}

function rewriteFigrefs(
  Parser: typeof DOMParser,
  html: string,
  figureNumberById: Map<string, number>,
  figureLabel: string,
  staleLabel: string,
): string {
  // Wrap in a synthetic body so the parser walks the fragment
  // as content rather than as a full document. happy-dom and
  // Chromium DOMParser both accept partial fragments under
  // `text/html` mode and surface them in `<body>`.
  const synthetic = `<body>${html}</body>`;
  const dom = new Parser().parseFromString(synthetic, "text/html");
  const body = dom.body;
  if (!body) return html;

  const targets = body.querySelectorAll("span[data-annot-figref]");
  if (targets.length === 0) return html;

  let changed = false;
  for (const span of Array.from(targets)) {
    const id = span.getAttribute("data-annot-figref") ?? "";
    const number = figureNumberById.get(id);
    const newLabel =
      number !== undefined ? `${figureLabel}${number}` : `${figureLabel}${staleLabel}`;
    if (span.textContent !== newLabel) {
      span.textContent = newLabel;
      changed = true;
    }
  }
  if (!changed) return html;
  return body.innerHTML;
}
