import type { AnnotationShape, TextRun } from "@ingcreators/annot-core/tauri-bridge";
import { chex, exml, parseRgba, px, xfrmAttrs } from "../helpers.js";
import type { NamespaceOpts } from "../namespace.js";

/** Build a `<{ns}:sp>` for a `type === "text"` AnnotationShape.
 *  Branches on `shape_kind === "callout"` plus populated tail
 *  coords for the `wedgeRoundRectCallout` preset; otherwise emits
 *  `roundRect adj=5000` (the standard sticky/plain textbox).
 *
 *  Walks `runs[]` to emit one `<a:r>` per text run and starts a
 *  fresh `<a:p>` after each run with `line_break_after === true`.
 *  Per-run formatting (bold / italic / underline / size / family /
 *  color) lifts onto the `<a:rPr>` block so PowerPoint receives
 *  the matching mixed formatting. Run-level overrides fall back
 *  to the shape-level `font_size` / `font_family` / `fill`. */
export function buildText(s: AnnotationShape, id: number, ns: NamespaceOpts): string {
  const x = px(s.x ?? 0);
  const y = px(s.y ?? 0);
  const fs = s.font_size ?? 24;
  const defaultFill = chex(s.fill ?? "#ff0000");
  const defaultFamily = s.font_family;

  const runs: readonly TextRun[] = s.runs ?? [];
  // Bbox fallback when the AnnotationShape was synthesized without
  // explicit width / height (e.g. a top-level `<text>` element).
  // Estimate from the longest run + paragraph count.
  const flatText = runs.map((r) => r.text).join("");
  const paragraphCount = countParagraphs(runs);
  const bw = s.width != null ? px(s.width) : px(Math.max(flatText.length * fs * 0.6, 200));
  const bh = s.height != null ? px(s.height) : px(fs * 1.5 * Math.max(paragraphCount, 1));

  // Background fill from `text_bg_color`. Plain-variant textboxes
  // (no bg) render as `<a:noFill/>`.
  const bgCarrier = s.text_bg_color;
  const bgFill = bgCarrier ? buildBgFill(bgCarrier) : "<a:noFill/>";

  const paragraphs = buildParagraphs(runs, fs, defaultFill, defaultFamily);
  const xf = xfrmAttrs(s);

  // Callouts with a populated tail tip switch from `roundRect` to
  // `wedgeRoundRectCallout`. adj1/adj2 express the tail tip as a
  // signed percentage offset from the bbox center; values can
  // exceed ±50% when the tail tip lands outside the bbox (the
  // typical case for callouts). adj3 keeps the same corner-rounding
  // constant as the non-callout `roundRect` form.
  let geom =
    '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 5000"/></a:avLst></a:prstGeom>';
  if (
    s.shape_kind === "callout" &&
    s.tail_x != null &&
    s.tail_y != null &&
    s.x != null &&
    s.y != null &&
    s.width != null &&
    s.height != null &&
    s.width > 0 &&
    s.height > 0
  ) {
    const dx = s.tail_x - (s.x + s.width / 2);
    const dy = s.tail_y - (s.y + s.height / 2);
    const adj1 = Math.round((dx / s.width) * 100_000);
    const adj2 = Math.round((dy / s.height) * 100_000);
    geom = `<a:prstGeom prst="wedgeRoundRectCallout"><a:avLst><a:gd name="adj1" fmla="val ${adj1}"/><a:gd name="adj2" fmla="val ${adj2}"/><a:gd name="adj3" fmla="val 5000"/></a:avLst></a:prstGeom>`;
  }

  return `<${ns.shape}><${ns.nvShape}><${ns.cnvPr} id="${id}" name="T${id}"/><${ns.cnvSp} txBox="1"/>${ns.nvPrSuffix}</${ns.nvShape}><${ns.spPr}><a:xfrm${xf}><a:off x="${x}" y="${y}"/><a:ext cx="${bw}" cy="${bh}"/></a:xfrm>${geom}${bgFill}<a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></${ns.spPr}>${ns.txBodyOpen}<a:bodyPr wrap="square" rtlCol="0" lIns="91440" tIns="45720" rIns="91440" bIns="45720"/><a:lstStyle/>${paragraphs}${ns.txBodyClose}</${ns.shape}>`;
}

/** Count distinct paragraphs in the run array — every
 *  `line_break_after` opens a new paragraph, plus the implicit
 *  starting paragraph when there's at least one run. */
function countParagraphs(runs: readonly TextRun[]): number {
  if (runs.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < runs.length - 1; i++) {
    if (runs[i]!.line_break_after) count += 1;
  }
  return count;
}

/** Group runs into paragraphs and emit `<a:p><a:r>...</a:r></a:p>`
 *  per OOXML. An empty run array still emits one paragraph with
 *  one empty run so PowerPoint reserves the body slot and the
 *  default formatting is preserved (matches the legacy
 *  `text + line-split` shape's empty-text output). */
function buildParagraphs(
  runs: readonly TextRun[],
  defaultSize: number,
  defaultFillHex: string,
  defaultFamily: string | undefined,
): string {
  if (runs.length === 0) {
    return `<a:p>${renderRun({ text: "" }, defaultSize, defaultFillHex, defaultFamily)}</a:p>`;
  }

  // Walk runs accumulating into paragraphs. A run with
  // `line_break_after === true` ends its paragraph; the subsequent
  // run starts a fresh `<a:p>`.
  const paragraphs: string[] = [];
  let current = "";
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    current += renderRun(run, defaultSize, defaultFillHex, defaultFamily);
    if (run.line_break_after || i === runs.length - 1) {
      paragraphs.push(`<a:p>${current}</a:p>`);
      current = "";
    }
  }
  return paragraphs.join("");
}

function renderRun(
  run: TextRun,
  defaultSize: number,
  defaultFillHex: string,
  defaultFamily: string | undefined,
): string {
  const sizeVal = Math.round((run.font_size ?? defaultSize) * 75);
  const fillHex = run.color ? chex(run.color) : defaultFillHex;
  const family = run.font_family ?? defaultFamily;
  const familyAttr = family ? `<a:latin typeface="${exml(family)}"/>` : "";
  const flags = [
    run.bold ? ` b="1"` : "",
    run.italic ? ` i="1"` : "",
    run.underline ? ` u="sng"` : "",
  ].join("");
  return `<a:r><a:rPr lang="ja-JP" sz="${sizeVal}"${flags} dirty="0"><a:solidFill><a:srgbClr val="${fillHex}"/></a:solidFill>${familyAttr}</a:rPr><a:t>${exml(run.text)}</a:t></a:r>`;
}

function buildBgFill(bgCarrier: string): string {
  if (!bgCarrier) return "<a:noFill/>";
  const [r, g, b, a] = parseRgba(bgCarrier);
  if (a <= 0) return "<a:noFill/>";
  const hex = `${pad2(r)}${pad2(g)}${pad2(b)}`;
  const alphaPct = Math.round((a / 255) * 100_000);
  return `<a:solidFill><a:srgbClr val="${hex}"><a:alpha val="${alphaPct}"/></a:srgbClr></a:solidFill>`;
}

function pad2(v: number): string {
  return v.toString(16).toUpperCase().padStart(2, "0");
}
