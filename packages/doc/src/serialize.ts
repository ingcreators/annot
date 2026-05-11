/**
 * `serializeDocument(doc) → string` — emits canonical bytes per
 * `docs/annot-html-format.md`.
 *
 * Pure: no DOM dependency. Walks the `AnnotDocument` model and
 * produces UTF-8 string output following the canonicalisation rules
 * (2-space indent, LF, alphabetical attribute order with the
 * documented exceptions, double-quote attribute values, HTML5 void
 * elements without trailing slash, opaque preservation of `<style>`,
 * `<script type="application/annot+json">`, and `<svg>` content).
 */

import type {
  AnnotDocument,
  Block,
  CodeBlock,
  DocMeta,
  HeadingBlock,
  ImageBlock,
  ListBlock,
  StepBlock,
} from "./types.js";

const INDENT = "  ";
const LF = "\n";

export function serializeDocument(doc: AnnotDocument): string {
  const out: string[] = [];

  out.push("<!doctype html>", LF);

  // <html>
  out.push("<html ", htmlRootAttrs(doc), ">", LF);

  // <head>
  out.push(INDENT, "<head>", LF);
  out.push(INDENT.repeat(2), '<meta charset="utf-8">', LF);
  out.push(INDENT.repeat(2), '<meta name="annot-document" content="1">', LF);
  if (doc.meta.template) {
    out.push(INDENT.repeat(2), '<meta name="annot-template" content="1">', LF);
  }
  out.push(INDENT.repeat(2), "<title>", escapeText(doc.title), "</title>", LF);
  if (doc.styleBlock !== null) {
    out.push(INDENT.repeat(2), "<style>", doc.styleBlock, "</style>", LF);
  }
  out.push(INDENT, "</head>", LF);

  // <body>
  out.push(INDENT, "<body>", LF);
  out.push(INDENT.repeat(2), "<article data-annot-doc>", LF);
  // Build the heading → anchor-id map once so heading
  // serialisation + TOC generation use the same ids.
  const anchorMap = buildHeadingAnchorMap(doc.blocks);
  // Standalone-view TOC. Skipped when the doc has fewer than
  // two headings (a single-heading TOC is just noise). The
  // `<nav data-annot-toc>` chrome is regenerated on every save
  // — the parser treats elements with `data-annot-toc` as
  // skipped, so the model never round-trips through a stale
  // TOC.
  const tocHtml = buildTocHtml(doc.blocks, anchorMap, /* depth */ 3);
  if (tocHtml) out.push(tocHtml);
  for (const block of doc.blocks) {
    out.push(serializeBlock(block, /* depth */ 3, anchorMap));
  }
  out.push(INDENT.repeat(2), "</article>", LF);
  out.push(
    INDENT.repeat(2),
    '<script type="application/annot+json" data-annot-doc-meta>',
    serializeMetaJson(doc.meta),
    "</script>",
    LF,
  );
  out.push(INDENT, "</body>", LF);
  out.push("</html>", LF);

  return out.join("");
}

/** Root `<html>` attributes in canonical order:
 *  `data-annot-doc-version`, `data-annot-doc-template?`, `lang`. */
function htmlRootAttrs(doc: AnnotDocument): string {
  const parts: string[] = [];
  parts.push(`data-annot-doc-version="${doc.version}"`);
  if (doc.meta.template) {
    parts.push(`data-annot-doc-template="1"`);
  }
  parts.push(`lang="${escapeAttr(doc.lang)}"`);
  return parts.join(" ");
}

function serializeBlock(
  block: Block,
  depth: number,
  anchorMap?: ReadonlyMap<HeadingBlock, string>,
): string {
  const indent = INDENT.repeat(depth);
  switch (block.kind) {
    case "heading": {
      // Standalone-view TOC needs anchor targets — emit a
      // deterministic positional id so the TOC `<a href>`
      // resolves when the file is opened directly in a browser.
      // The id is derived from the heading-block's index among
      // headings in the doc; resilient to title edits, breaks
      // only on heading-block reorder (the next save
      // regenerates both sides). Per-heading id is optional
      // (omitted when no map is supplied — keeps the existing
      // function callable from focused tests).
      const id = anchorMap?.get(block);
      const idAttr = id ? ` id="${id}"` : "";
      return `${indent}<h${block.level} data-annot-block="heading" data-level="${block.level}"${idAttr}>${block.inlineHtml}</h${block.level}>${LF}`;
    }
    case "paragraph":
      return `${indent}<p data-annot-block="paragraph">${block.inlineHtml}</p>${LF}`;
    case "list":
      return serializeList(block, depth);
    case "code":
      return serializeCode(block, depth);
    case "quote":
      return serializeMultiPara("blockquote", "quote", undefined, block.paragraphs, depth);
    case "callout":
      return serializeMultiPara(
        "aside",
        "callout",
        `data-tone="${escapeAttr(block.tone)}"`,
        block.paragraphs,
        depth,
      );
    case "divider":
      return `${indent}<hr data-annot-block="divider">${LF}`;
    case "image":
      return serializeImage(block, depth);
    case "step":
      return serializeStep(block, depth);
    case "unknown":
      return `${indent}${block.rawHtml}${LF}`;
  }
}

function serializeList(block: ListBlock, depth: number): string {
  const indent = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);
  const tag = block.ordered ? "ol" : "ul";
  let head = `${indent}<${tag} data-annot-block="list" data-list-style="${escapeAttr(block.listStyle)}"`;
  if (block.ordered && block.start !== undefined && block.start !== 1) {
    head += ` data-start="${block.start}"`;
  }
  head += ">";
  const items = block.items.map((item) => `${inner}<li>${item}</li>`).join(LF);
  return `${head}${LF}${items}${LF}${indent}</${tag}>${LF}`;
}

function serializeCode(block: CodeBlock, depth: number): string {
  const indent = INDENT.repeat(depth);
  let head = `${indent}<pre data-annot-block="code"`;
  if (block.lang !== undefined) {
    head += ` data-lang="${escapeAttr(block.lang)}"`;
  }
  head += `><code>${escapeText(block.text)}</code></pre>${LF}`;
  return head;
}

function serializeMultiPara(
  outerTag: "blockquote" | "aside",
  blockKind: "quote" | "callout",
  extraAttrs: string | undefined,
  paragraphs: readonly string[],
  depth: number,
): string {
  const indent = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);
  let head = `${indent}<${outerTag} data-annot-block="${blockKind}"`;
  if (extraAttrs) head += ` ${extraAttrs}`;
  head += ">";
  const ps = paragraphs.map((p) => `${inner}<p>${p}</p>`).join(LF);
  return `${head}${LF}${ps}${LF}${indent}</${outerTag}>${LF}`;
}

function serializeImage(block: ImageBlock, depth: number): string {
  const indent = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);
  let result = `${indent}<figure data-annot-block="image" data-annot-image-id="${escapeAttr(block.id)}">${LF}`;
  // SVG is opaque — re-indent each line with the figure-child indent.
  const svgLines = block.svg.split(LF);
  for (const line of svgLines) {
    if (line.length === 0) {
      // Preserve internal blank lines as bare newlines (no
      // trailing whitespace).
      result += LF;
    } else {
      result += `${inner}${line}${LF}`;
    }
  }
  if (block.caption !== undefined) {
    result += `${inner}<figcaption>${block.caption}</figcaption>${LF}`;
  }
  result += `${indent}</figure>${LF}`;
  return result;
}

function serializeStep(block: StepBlock, depth: number): string {
  const indent = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);
  // Attribute order per docs/annot-html-format.md canonicalisation:
  // data-annot-block → data-annot-image-id → other data-* alpha.
  // The step block carries only `data-step-layout` in the
  // last slot, always emitted explicitly (byte-stability over
  // byte-economy — see Phase 0 spec freeze).
  // Phase 7a of `docs/plans/card-procedure-template.md`: an empty
  // `svg` field marks an image-less step block. We carry the state
  // out-of-band via `data-step-image-less="1"` so the standalone-
  // view CSS can collapse the grid without `:not(:has(...))`
  // gymnastics. The attribute order is: data-annot-block →
  // data-annot-image-id → data-step-image-less → data-step-layout
  // (alphabetical among data-*, per Phase 0 spec).
  const imageLessAttr = block.svg.length === 0 ? ` data-step-image-less="1"` : "";
  let result = `${indent}<section data-annot-block="step" data-annot-image-id="${escapeAttr(block.id)}"${imageLessAttr} data-step-layout="${escapeAttr(block.layout)}">${LF}`;
  // SVG is opaque — re-indent each line with the section-child
  // indent. Same machinery as image-block. Image-less step blocks
  // emit no `<svg>` child at all (parser side accepts both forms).
  if (block.svg.length > 0) {
    const svgLines = block.svg.split(LF);
    for (const line of svgLines) {
      if (line.length === 0) {
        result += LF;
      } else {
        result += `${inner}${line}${LF}`;
      }
    }
  }
  // Child slots: title + body, in that fixed order. Always emit
  // both even when their inline HTML is empty (the editor's
  // placeholder affordance lives on the empty form).
  result += `${inner}<h3 data-step-title>${block.title}</h3>${LF}`;
  result += `${inner}<p data-step-body>${block.body}</p>${LF}`;
  result += `${indent}</section>${LF}`;
  return result;
}

// ---------------------------------------------------------------------------
// JSON sidecar
// ---------------------------------------------------------------------------

/** Compact, key-sorted JSON. */
export function serializeMetaJson(meta: DocMeta): string {
  return JSON.stringify(sortKeysDeep(meta));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[key];
      // Drop explicit `undefined` so `{ a: undefined }` round-trips
      // through `JSON.stringify` cleanly.
      if (v !== undefined) {
        sorted[key] = sortKeysDeep(v);
      }
    }
    return sorted;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/** Escape `<`, `>`, `&` for text content. Non-ASCII passes through
 *  as raw UTF-8 (the document declares utf-8 in `<meta charset>`). */
export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape `&`, `<`, `>`, `"` for attribute values. Single quotes
 *  pass through (we always emit attribute values in double
 *  quotes). */
export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Standalone-view TOC
// ---------------------------------------------------------------------------

/** Build a stable heading → anchor-id map. Ids are positional
 *  (`annot-h-0`, `annot-h-1`, …) so a title rename doesn't
 *  invalidate existing in-document fragment links. The TOC
 *  always regenerates from this map on every save. */
function buildHeadingAnchorMap(blocks: readonly Block[]): Map<HeadingBlock, string> {
  const map = new Map<HeadingBlock, string>();
  let i = 0;
  for (const block of blocks) {
    if (block.kind === "heading") {
      map.set(block, `annot-h-${i}`);
      i += 1;
    }
  }
  return map;
}

/** Build the standalone-view TOC navigation. Returns the empty
 *  string when the doc has fewer than two headings (a single-
 *  heading TOC is just visual noise). The output is a `<nav
 *  data-annot-toc>` block scoped to the article — the parser
 *  recognises `data-annot-toc` and skips it, so re-saving never
 *  round-trips through stale TOC bytes. */
function buildTocHtml(
  blocks: readonly Block[],
  anchorMap: ReadonlyMap<HeadingBlock, string>,
  depth: number,
): string {
  const headings: HeadingBlock[] = [];
  for (const block of blocks) {
    if (block.kind === "heading") headings.push(block);
  }
  if (headings.length < 2) return "";
  const indent = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);
  const itemIndent = INDENT.repeat(depth + 2);
  const lines: string[] = [];
  lines.push(`${indent}<nav data-annot-toc aria-label="Contents">`);
  lines.push(`${inner}<h2 data-annot-toc-title>Contents</h2>`);
  lines.push(`${inner}<ul>`);
  for (const h of headings) {
    const id = anchorMap.get(h);
    if (!id) continue;
    // The label is the heading's plain text — strip inline tags
    // so the TOC isn't full of `<strong>` etc. Falls back to
    // "(untitled)" when the heading is empty.
    const label = stripInlineTagsForToc(h.inlineHtml) || "(untitled)";
    lines.push(
      `${itemIndent}<li data-annot-toc-level="${h.level}"><a href="#${id}">${escapeText(label)}</a></li>`,
    );
  }
  lines.push(`${inner}</ul>`);
  lines.push(`${indent}</nav>`);
  return lines.join(LF) + LF;
}

/** Strip every inline tag from an inline-HTML fragment so the
 *  TOC label reads as plain text. Decodes the four entities the
 *  format produces (`&lt;`, `&gt;`, `&quot;`, `&amp;`) so the
 *  caller's `escapeText` doesn't double-escape (`&amp;amp;`). */
function stripInlineTagsForToc(inlineHtml: string): string {
  const stripped = inlineHtml.replace(/<[^>]+>/g, "").trim();
  return stripped
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}
