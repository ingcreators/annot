/**
 * Bridge between the live `contentEditable` HTML the TextTool's
 * `<foreignObject>` editor surfaces during text-edit sessions and
 * the canonical `TextRun[]` carrier the rest of the pipeline
 * (text-utils, AnnotationShape, OOXML export) speaks.
 *
 * Tier B: pure DOM-Element manipulation, jsdom-friendly. Reads
 * style attributes via `getPropertyValue` (works under happy-dom)
 * rather than the typed `CSSStyleDeclaration` getters that some
 * browsers populate from inline styles. No `<canvas>` or pointer
 * events, so the mapper is unit-testable in node + happy-dom.
 *
 * `htmlToRuns(div)` — flatten the contentEditable subtree into one
 *   `TextRun` per styled run. Block boundaries (`<div>` / `<p>`)
 *   and explicit `<br>` markers split paragraphs via
 *   `line_break_after`. Inline formatting (`<b>` / `<strong>` /
 *   `<i>` / `<em>` / `<u>`, plus `<span style="...">`) cascade
 *   into per-run flags / overrides.
 *
 * `runsToHtml(runs)` — inverse. Each run becomes a text node when
 *   no formatting is active, or a `<span style="...">` wrapper
 *   when any flag / override is set. `line_break_after` emits a
 *   `<br>` so the contentEditable round-trips paragraph breaks
 *   intact.
 *
 * Phase 2 of `docs/plans/rich-text-and-shape-text.md` (queued for
 * the contentEditable rich-text editor wiring). The mapper is the
 * load-bearing piece of the round-trip; it gets its own phase +
 * its own property test.
 */

import type { TextRun } from "../utils/tauri-bridge.js";

/** Cascading formatting context — accumulated as the walker
 *  descends into nested inline elements (`<b><i><span style="color: red">`).
 *  Once-set values STAY set unless the inverse style explicitly
 *  resets them on a deeper child (which `<span style="font-weight:
 *  normal">` would). */
interface RunContext {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  font_size?: number;
  font_family?: string;
  color?: string;
}

/** Convert a contentEditable subtree into the canonical
 *  `TextRun[]` representation. Empty input → empty array. */
export function htmlToRuns(root: HTMLElement | DocumentFragment): TextRun[] {
  const out: TextRun[] = [];
  walk(root, {}, out);
  // contentEditable always carries an implicit "end of last
  // paragraph" — but TextRun expresses that as the absence of
  // `line_break_after` on the final run. Strip trailing
  // empty-paragraph runs first, then drop the dangling
  // line_break_after on the surviving last run so the canonical
  // form is "no trailing paragraph break".
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    if (last.line_break_after && last.text === "") {
      out.pop();
      continue;
    }
    if (last.line_break_after) delete last.line_break_after;
    break;
  }
  return out;
}

/** Inverse of `htmlToRuns`. Emits an HTML string the
 *  contentEditable can ingest as `innerHTML` or compose into a
 *  document fragment for `appendChild`. */
export function runsToHtml(runs: readonly TextRun[]): string {
  if (runs.length === 0) return "";
  const parts: string[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    parts.push(renderRun(run));
    if (run.line_break_after) parts.push("<br>");
  }
  return parts.join("");
}

function renderRun(run: TextRun): string {
  const text = escapeHtml(run.text);
  const styles: string[] = [];
  if (run.bold) styles.push("font-weight: bold");
  if (run.italic) styles.push("font-style: italic");
  if (run.underline) styles.push("text-decoration: underline");
  if (run.font_size != null) styles.push(`font-size: ${run.font_size}px`);
  if (run.font_family != null) styles.push(`font-family: ${escapeHtml(run.font_family)}`);
  if (run.color != null) styles.push(`color: ${escapeHtml(run.color)}`);
  if (styles.length === 0) return text;
  return `<span style="${styles.join("; ")}">${text}</span>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function walk(node: Node, ctx: RunContext, out: TextRun[]): void {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    const text = node.textContent ?? "";
    if (!text) return;
    out.push(makeRun(ctx, text));
    return;
  }
  if (node.nodeType !== 1 /* ELEMENT_NODE */ && node.nodeType !== 11 /* DOCUMENT_FRAGMENT_NODE */) {
    return;
  }
  const el = node as Element;
  const tag = el.tagName;

  if (tag === "BR") {
    markLineBreak(ctx, out);
    return;
  }

  // Block boundaries — Chrome / Edge wrap each line in `<div>` on
  // Enter; some browsers use `<p>`. Each block element starts a
  // new paragraph BEFORE its content (when there's already
  // preceding content); marking the break AFTER would land it on
  // the wrong run for the common Chrome shape `abc<div>def</div>`
  // (initial bare text node + Enter wraps the rest in a div),
  // because the trailing-flag strip in htmlToRuns would then drop
  // the break entirely.
  if (tag === "DIV" || tag === "P") {
    const lastBefore = out.length > 0 ? out[out.length - 1]! : null;
    if (lastBefore && !lastBefore.line_break_after) {
      lastBefore.line_break_after = true;
    }
    const beforeLen = out.length;
    for (const child of Array.from(el.childNodes)) {
      walk(child, ctx, out);
    }
    // Empty block (`<div></div>` / `<div><br></div>` between
    // siblings) → emit a placeholder so the line gap survives.
    // The check is "no new run was appended"; a `<br>` child
    // appends an empty-run marker via markLineBreak, which counts.
    if (out.length === beforeLen) {
      out.push({ ...makeRun(ctx, ""), line_break_after: true });
    }
    return;
  }

  // Inline formatting — descend with an extended context.
  const childCtx = applyInlineFormatting(el, ctx);
  for (const child of Array.from(el.childNodes)) {
    walk(child, childCtx, out);
  }
}

/** Produce a {@link RunContext} extended by the inline formatting
 *  carried on `el`. */
function applyInlineFormatting(el: Element, ctx: RunContext): RunContext {
  const tag = el.tagName;
  const next: RunContext = { ...ctx };
  if (tag === "B" || tag === "STRONG") next.bold = true;
  else if (tag === "I" || tag === "EM") next.italic = true;
  else if (tag === "U") next.underline = true;

  // Style attribute (used by `<span style="...">` and any element
  // browsers decorate with inline style on selection toggling).
  const styleAttr = el.getAttribute("style");
  if (styleAttr) {
    const styles = parseInlineStyles(styleAttr);
    const fontWeight = styles.get("font-weight");
    if (fontWeight && /^(bold|[6-9]\d{2})$/.test(fontWeight.trim())) {
      next.bold = true;
    }
    const fontStyle = styles.get("font-style");
    if (fontStyle === "italic") next.italic = true;
    const textDecoration = styles.get("text-decoration");
    if (textDecoration?.includes("underline")) next.underline = true;
    const fontSize = styles.get("font-size");
    if (fontSize) {
      const px = parsePx(fontSize);
      if (px != null) next.font_size = px;
    }
    const fontFamily = styles.get("font-family");
    if (fontFamily) next.font_family = fontFamily.replace(/^["']|["']$/g, "").trim();
    const color = styles.get("color");
    if (color) next.color = color.trim();
  }
  return next;
}

function parsePx(value: string): number | null {
  const m = /^([\d.]+)\s*px$/i.exec(value.trim());
  if (m) {
    const n = Number.parseFloat(m[1]!);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Lightweight inline-style parser. The browser's
 *  `CSSStyleDeclaration` would be authoritative but happy-dom's
 *  implementation is incomplete and the tests need a deterministic
 *  reader regardless. */
function parseInlineStyles(style: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const decl of style.split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const key = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (key && val) out.set(key, val);
  }
  return out;
}

function makeRun(ctx: RunContext, text: string): TextRun {
  const run: TextRun = { text };
  if (ctx.bold) run.bold = true;
  if (ctx.italic) run.italic = true;
  if (ctx.underline) run.underline = true;
  if (ctx.font_size != null) run.font_size = ctx.font_size;
  if (ctx.font_family != null) run.font_family = ctx.font_family;
  if (ctx.color != null) run.color = ctx.color;
  return run;
}

function markLineBreak(ctx: RunContext, out: TextRun[]): void {
  if (out.length === 0) {
    // BR / block-end at the very start — emit an empty placeholder
    // so the paragraph gap survives the round-trip.
    out.push({ ...makeRun(ctx, ""), line_break_after: true });
    return;
  }
  const last = out[out.length - 1]!;
  // Coalesce: if the last run already ends a paragraph, don't add
  // another.
  if (last.line_break_after) {
    out.push({ ...makeRun(ctx, ""), line_break_after: true });
    return;
  }
  last.line_break_after = true;
}
