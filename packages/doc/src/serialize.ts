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

import type { AnnotDocument, Block, CodeBlock, DocMeta, ImageBlock, ListBlock } from "./types.js";

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
  for (const block of doc.blocks) {
    out.push(serializeBlock(block, /* depth */ 3));
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

function serializeBlock(block: Block, depth: number): string {
  const indent = INDENT.repeat(depth);
  switch (block.kind) {
    case "heading":
      return `${indent}<h${block.level} data-annot-block="heading" data-level="${block.level}">${block.inlineHtml}</h${block.level}>${LF}`;
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
