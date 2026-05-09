/**
 * `parseDocument(html, opts?) → AnnotDocument` — reads canonical
 * `.annot.html` bytes into the document model.
 *
 * Tier A constraint: the import never reaches for `document` or
 * `window`. The DOMParser is resolved lazily inside the function
 * via `opts.DOMParser ?? globalThis.DOMParser`. Browser hosts use
 * the native one; Node-side callers (test environments via
 * happy-dom, future Playwright integration via linkedom) inject
 * their own.
 */

import type {
  AnnotDocument,
  Block,
  CalloutBlock,
  CodeBlock,
  DocMeta,
  HeadingBlock,
  ImageBlock,
  ImageMeta,
  ListBlock,
  ParagraphBlock,
  QuoteBlock,
  TemplateMeta,
} from "./types.js";
import { ANNOT_DOC_VERSION } from "./types.js";

export interface ParseOptions {
  /** DOMParser constructor. Defaults to `globalThis.DOMParser`. */
  DOMParser?: typeof DOMParser;
}

export class AnnotDocParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnotDocParseError";
  }
}

export function parseDocument(html: string, opts?: ParseOptions): AnnotDocument {
  const Parser = opts?.DOMParser ?? (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (!Parser) {
    throw new AnnotDocParseError(
      "parseDocument: DOMParser is not available; pass `opts.DOMParser` or run in a browser-like environment.",
    );
  }
  const dom = new Parser().parseFromString(html, "text/html");

  const root = dom.documentElement;
  if (!root || root.tagName.toLowerCase() !== "html") {
    throw new AnnotDocParseError("Missing or invalid <html> root.");
  }

  const versionAttr = root.getAttribute("data-annot-doc-version");
  if (versionAttr === null) {
    throw new AnnotDocParseError(
      "Missing data-annot-doc-version on <html> — file is not an Annot document.",
    );
  }
  if (versionAttr !== "1") {
    throw new AnnotDocParseError(
      `Unsupported document version ${JSON.stringify(versionAttr)}; this build understands version "1".`,
    );
  }

  const lang = root.getAttribute("lang") ?? "en";

  // Detection marker
  const head = root.querySelector("head");
  if (!head) throw new AnnotDocParseError("Missing <head>.");
  const markerMeta = head.querySelector('meta[name="annot-document"]');
  if (!markerMeta) {
    throw new AnnotDocParseError(
      'Missing <meta name="annot-document" content="1"> — file is not an Annot document.',
    );
  }

  const titleEl = head.querySelector("title");
  const headTitle = titleEl?.textContent ?? "";

  const styleEl = head.querySelector("style");
  const styleBlock = styleEl ? (styleEl.textContent ?? "") : null;

  // Body / article
  const body = root.querySelector("body");
  if (!body) throw new AnnotDocParseError("Missing <body>.");
  const article = body.querySelector("article[data-annot-doc]");
  if (!article) {
    throw new AnnotDocParseError("Missing <article data-annot-doc>.");
  }

  // Sidecar JSON
  const metaScript = body.querySelector(
    'script[type="application/annot+json"][data-annot-doc-meta]',
  );
  if (!metaScript) {
    throw new AnnotDocParseError(
      'Missing <script type="application/annot+json" data-annot-doc-meta>.',
    );
  }
  const metaJsonRaw = metaScript.textContent ?? "{}";
  const meta = parseDocMeta(metaJsonRaw, headTitle);

  // Blocks
  const blocks: Block[] = [];
  for (const child of Array.from(article.children)) {
    blocks.push(parseBlock(child as Element));
  }

  return {
    version: ANNOT_DOC_VERSION,
    lang,
    title: meta.title,
    meta,
    styleBlock,
    blocks,
  };
}

// ---------------------------------------------------------------------------
// Block parser
// ---------------------------------------------------------------------------

function parseBlock(el: Element): Block {
  const kind = el.getAttribute("data-annot-block");
  switch (kind) {
    case "heading":
      return parseHeading(el);
    case "paragraph":
      return parseParagraph(el);
    case "list":
      return parseList(el);
    case "code":
      return parseCode(el);
    case "quote":
      return parseQuote(el);
    case "callout":
      return parseCallout(el);
    case "divider":
      return { kind: "divider" };
    case "image":
      return parseImage(el);
    default:
      // Forward-compat: preserve unknown blocks verbatim.
      return { kind: "unknown", rawHtml: el.outerHTML };
  }
}

function parseHeading(el: Element): HeadingBlock {
  const tag = el.tagName.toLowerCase();
  const levelAttr = el.getAttribute("data-level");
  const tagLevel = tag === "h1" ? 1 : tag === "h2" ? 2 : tag === "h3" ? 3 : null;
  const attrLevel = levelAttr === "1" ? 1 : levelAttr === "2" ? 2 : levelAttr === "3" ? 3 : null;
  // Per-spec: data-level wins on disagreement.
  const level = attrLevel ?? tagLevel;
  if (level === null) {
    throw new AnnotDocParseError(`Heading block on <${tag}> has no usable level.`);
  }
  return { kind: "heading", level: level as 1 | 2 | 3, inlineHtml: el.innerHTML };
}

function parseParagraph(el: Element): ParagraphBlock {
  return { kind: "paragraph", inlineHtml: el.innerHTML };
}

function parseList(el: Element): ListBlock {
  const tag = el.tagName.toLowerCase();
  const ordered = tag === "ol";
  const listStyle = el.getAttribute("data-list-style") ?? (ordered ? "decimal" : "disc");
  const startAttr = el.getAttribute("data-start");
  const start = startAttr !== null ? Number.parseInt(startAttr, 10) : undefined;
  const items: string[] = [];
  for (const li of Array.from(el.children)) {
    if (li.tagName.toLowerCase() === "li") {
      items.push(li.innerHTML);
    }
  }
  const block: ListBlock = ordered
    ? start !== undefined && start !== 1
      ? { kind: "list", ordered, listStyle, start, items }
      : { kind: "list", ordered, listStyle, items }
    : { kind: "list", ordered, listStyle, items };
  return block;
}

function parseCode(el: Element): CodeBlock {
  const langAttr = el.getAttribute("data-lang");
  const codeEl = el.querySelector("code");
  // Use textContent so HTML entities decode and we get the raw
  // source bytes the original `<pre><code>` carried.
  const text = codeEl?.textContent ?? "";
  return langAttr !== null ? { kind: "code", lang: langAttr, text } : { kind: "code", text };
}

function parseQuote(el: Element): QuoteBlock {
  const paragraphs: string[] = [];
  for (const p of Array.from(el.children)) {
    if (p.tagName.toLowerCase() === "p") {
      paragraphs.push(p.innerHTML);
    }
  }
  return { kind: "quote", paragraphs };
}

function parseCallout(el: Element): CalloutBlock {
  const toneAttr = el.getAttribute("data-tone");
  const tone =
    toneAttr === "info" || toneAttr === "warn" || toneAttr === "note" ? toneAttr : "info";
  const paragraphs: string[] = [];
  for (const p of Array.from(el.children)) {
    if (p.tagName.toLowerCase() === "p") {
      paragraphs.push(p.innerHTML);
    }
  }
  return { kind: "callout", tone, paragraphs };
}

function parseImage(el: Element): ImageBlock {
  const id = el.getAttribute("data-annot-image-id");
  if (id === null) {
    throw new AnnotDocParseError("Image block missing data-annot-image-id.");
  }
  // The svg inside figure is emitted at depth `figure-indent + 2`
  // by the serializer; on parse we extract via outerHTML and
  // dedent uniformly so the stored form starts at column 0.
  const svgEl = el.querySelector("svg");
  if (!svgEl) {
    throw new AnnotDocParseError(`Image block ${id} has no <svg> child.`);
  }
  const svg = canonicaliseSvg(svgEl);
  const figEl = el.querySelector("figcaption");
  const caption = figEl ? figEl.innerHTML : undefined;
  return caption !== undefined ? { kind: "image", id, svg, caption } : { kind: "image", id, svg };
}

/** Walk the SVG element and produce canonical bytes:
 *  no leading whitespace on the root line; inner children
 *  indented by 2 spaces relative to root; closing tag flush-left.
 *  Phase 1 trusts the host's DOM serializer for attribute order
 *  inside SVG (the canonicalisation rules say the SVG is opaque to
 *  the HTML serializer; the SVG serializer is its own concern). */
function canonicaliseSvg(svg: Element): string {
  return formatXmlElement(svg, 0);
}

function formatXmlElement(el: Element, depth: number): string {
  const indent = "  ".repeat(depth);
  const tag = el.tagName.toLowerCase();
  const attrs = formatXmlAttrs(el);
  const children = Array.from(el.children);
  // Self-closing for elements with no children and no text content.
  const text = el.textContent ?? "";
  const hasOnlyChildren = children.length > 0 && text.replace(/\s/g, "") === "";
  const hasTextOnly = children.length === 0 && text.replace(/\s/g, "") !== "";

  if (children.length === 0 && !hasTextOnly) {
    // Self-closing void element form.
    return `${indent}<${tag}${attrs}/>`;
  }
  if (hasTextOnly) {
    return `${indent}<${tag}${attrs}>${escapeXmlText(text)}</${tag}>`;
  }
  if (hasOnlyChildren) {
    const lines: string[] = [];
    lines.push(`${indent}<${tag}${attrs}>`);
    for (const child of children) {
      lines.push(formatXmlElement(child, depth + 1));
    }
    lines.push(`${indent}</${tag}>`);
    return lines.join("\n");
  }
  // Mixed content (text + elements) — serialise with innerHTML
  // intact for now; this branch shouldn't fire on Phase 0
  // fixtures.
  return `${indent}<${tag}${attrs}>${el.innerHTML}</${tag}>`;
}

function formatXmlAttrs(el: Element): string {
  // Preserve attribute order as DOMParser exposes it. SVG
  // canonicalisation isn't this package's concern beyond not
  // corrupting the bytes — the editor / SVG-format spec own it.
  const parts: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    parts.push(`${attr.name}="${escapeXmlAttr(attr.value)}"`);
  }
  return parts.length === 0 ? "" : ` ${parts.join(" ")}`;
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Sidecar JSON
// ---------------------------------------------------------------------------

function parseDocMeta(jsonText: string, headTitle: string): DocMeta {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    throw new AnnotDocParseError(`Sidecar JSON is malformed: ${(err as Error).message}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AnnotDocParseError("Sidecar JSON must be an object.");
  }
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title : headTitle;
  const author = typeof obj.author === "string" ? obj.author : undefined;
  const theme = isTheme(obj.theme) ? obj.theme : undefined;
  const maxWidth = isMaxWidth(obj.maxWidth) ? obj.maxWidth : undefined;
  const template = parseTemplateMeta(obj.template);
  const imageMeta = parseImageMetaMap(obj.imageMeta);
  const meta: DocMeta = { title };
  if (author !== undefined) (meta as { author?: string }).author = author;
  if (theme !== undefined) (meta as { theme?: typeof theme }).theme = theme;
  if (maxWidth !== undefined) (meta as { maxWidth?: typeof maxWidth }).maxWidth = maxWidth;
  if (template !== undefined) (meta as { template?: TemplateMeta }).template = template;
  if (imageMeta !== undefined) {
    (meta as { imageMeta?: Readonly<Record<string, ImageMeta>> }).imageMeta = imageMeta;
  }
  return meta;
}

function isTheme(v: unknown): v is "light" | "dark" | "auto" {
  return v === "light" || v === "dark" || v === "auto";
}

function isMaxWidth(v: unknown): v is "narrow" | "medium" | "wide" | "full" {
  return v === "narrow" || v === "medium" || v === "wide" || v === "full";
}

function parseTemplateMeta(v: unknown): TemplateMeta | undefined {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== "string") return undefined;
  const t: TemplateMeta = { name: o.name };
  if (typeof o.description === "string") {
    (t as { description?: string }).description = o.description;
  }
  if (Array.isArray(o.tags) && o.tags.every((x) => typeof x === "string")) {
    (t as { tags?: readonly string[] }).tags = o.tags as readonly string[];
  }
  return t;
}

function parseImageMetaMap(v: unknown): Readonly<Record<string, ImageMeta>> | undefined {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, ImageMeta> = {};
  for (const [k, value] of Object.entries(v as Record<string, unknown>)) {
    const im = parseImageMeta(value);
    if (im !== undefined) out[k] = im;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseImageMeta(v: unknown): ImageMeta | undefined {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const im: ImageMeta = {};
  if (typeof o.alt === "string") (im as { alt?: string }).alt = o.alt;
  if (typeof o.sourceUrl === "string") (im as { sourceUrl?: string }).sourceUrl = o.sourceUrl;
  if (typeof o.capturedAt === "string") {
    (im as { capturedAt?: string }).capturedAt = o.capturedAt;
  }
  return Object.keys(im).length > 0 ? im : undefined;
}
