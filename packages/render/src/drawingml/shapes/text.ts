import type { AnnotationShape, TextRun } from "@ingcreators/annot-core/desktop-bridge";
import { isLogicalFamily, ooxmlTypefacesFor } from "@ingcreators/annot-core/headless";
import {
  capAttr,
  chex,
  dashToDrawingml,
  exml,
  joinXml,
  parseRgba,
  pt,
  px,
  strokePaintXml,
  xfrmAttrs,
} from "../helpers.js";
import type { NamespaceOpts } from "../namespace.js";

/** Build a `<{ns}:sp>` for a `type === "text"` AnnotationShape.
 *  Branches on `shape_kind` for the geometry preset:
 *    plain / sticky → roundRect adj=5000 (auto-bg variants)
 *    callout (with tail) → wedgeRoundRectCallout
 *    rect → rect (sharp corners — text-on-shape)
 *    rounded → roundRect (rounded text-on-shape)
 *    ellipse → ellipse (elliptical text-on-shape)
 *
 *  Walks `runs[]` to emit one `<a:r>` per text run and starts a
 *  fresh `<a:p>` after each run with `line_break_after === true`.
 *  Per-run formatting (bold / italic / underline / size / family /
 *  color) lifts onto the `<a:rPr>` block so PowerPoint receives
 *  the matching mixed formatting. Run-level overrides fall back
 *  to the shape-level `font_size` / `font_family` / `fill`.
 *
 *  Text alignment (`text_anchor` / `text_vertical_anchor`) flows
 *  to OOXML as `<a:pPr algn>` per paragraph and `<a:bodyPr
 *  anchor>` on the body container. */
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

  const algnAttr = pPrAlgnAttr(s.text_anchor);
  const paragraphs = buildParagraphs(runs, fs, defaultFill, defaultFamily, algnAttr);
  const xf = xfrmAttrs(s);

  // Geometry preset per shape_kind. Text-on-shape kinds (rect /
  // rounded / ellipse) reflect the user's drawn primitive; auto-bg
  // variants (plain / sticky) keep the historical `roundRect` look
  // that PowerPoint users expect for sticky-note text. Callouts
  // with a populated tail tip override to `wedgeRoundRectCallout`;
  // adj1 / adj2 express the tail tip as a signed percentage offset
  // from the bbox center (values can exceed ±50% when the tip
  // lands outside the bbox).
  const isTextOnShape =
    s.shape_kind === "rect" || s.shape_kind === "rounded" || s.shape_kind === "ellipse";
  let geom: string;
  if (s.shape_kind === "rect") {
    geom = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  } else if (s.shape_kind === "ellipse") {
    geom = '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>';
  } else if (s.shape_kind === "rounded") {
    geom =
      '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 5000"/></a:avLst></a:prstGeom>';
  } else {
    geom =
      '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 5000"/></a:avLst></a:prstGeom>';
  }
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

  // Stroke: text-on-shape reflects the user-drawn primitive; the
  // auto-bg variants (plain / sticky / callout) keep the historical
  // light-gray border that defines their PowerPoint identity.
  const line = isTextOnShape && s.stroke ? buildTextOnShapeLine(s) : AUTO_BG_TEXT_LINE;

  // Vertical anchor on the body container — top is the OOXML
  // default, so omit the attribute for top to keep existing
  // snapshots stable.
  const vAttr = bodyPrAnchorAttr(s.text_vertical_anchor);

  // Zero `lIns` / `tIns` / `rIns` / `bIns` on the text body so the
  // OOXML rendering matches the SVG layout pixel-for-pixel. The
  // SVG side already positions tspans inside the bg-primitive
  // (rect / wedgeRoundRect / etc) with the padding the annotation
  // kind needs (sticky / callout get their visual padding from the
  // bg-primitive's geometry, not from a text inset). PowerPoint's
  // default insets (0.25 cm / 0.13 cm) would add a SECOND layer of
  // padding on top of that, pushing the text inward and overflowing
  // the user-drawn frame — user-reported regression in card-
  // procedure PPTX exports.
  return `<${ns.shape}><${ns.nvShape}><${ns.cnvPr} id="${id}" name="T${id}"/><${ns.cnvSp} txBox="1"/>${ns.nvPrSuffix}</${ns.nvShape}><${ns.spPr}><a:xfrm${xf}><a:off x="${x}" y="${y}"/><a:ext cx="${bw}" cy="${bh}"/></a:xfrm>${geom}${bgFill}${line}</${ns.spPr}>${ns.txBodyOpen}<a:bodyPr wrap="square" rtlCol="0" lIns="0" tIns="0" rIns="0" bIns="0"${vAttr}/><a:lstStyle/>${paragraphs}${ns.txBodyClose}</${ns.shape}>`;
}

/** The historical light-gray hairline border the auto-bg text
 *  variants (plain / sticky / callout) ship with — defines their
 *  PowerPoint identity, so text-on-shape overrides this only
 *  when it has a real stroke from the user's drawn primitive. */
const AUTO_BG_TEXT_LINE =
  '<a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln>';

function buildTextOnShapeLine(s: AnnotationShape): string {
  const stroke = chex(s.stroke ?? "#000000");
  const sw = pt(s.stroke_width ?? 1);
  const cap = capAttr(s.stroke_linecap);
  const join = joinXml(s.stroke_linejoin);
  const dash = dashToDrawingml(s.stroke_dasharray);
  return `<a:ln w="${sw}"${cap}>${strokePaintXml(s, stroke)}${join}${dash}</a:ln>`;
}

/** Map `text_vertical_anchor` to an OOXML `<a:bodyPr anchor>`
 *  attribute fragment. Top (default) is omitted to keep existing
 *  snapshot fixtures stable. */
function bodyPrAnchorAttr(v: AnnotationShape["text_vertical_anchor"]): string {
  if (v === "middle") return ' anchor="ctr"';
  if (v === "bottom") return ' anchor="b"';
  return "";
}

/** Map `text_anchor` to an OOXML `<a:pPr algn>` attribute fragment.
 *  Empty when unset / "start" so paragraphs that don't need an
 *  override don't carry a redundant `algn="l"` (also matches the
 *  pre-Phase-3 fixtures). */
function pPrAlgnAttr(h: AnnotationShape["text_anchor"]): string {
  if (h === "middle") return ' algn="ctr"';
  if (h === "end") return ' algn="r"';
  return "";
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
  algnAttr: string,
): string {
  const pPr = algnAttr ? `<a:pPr${algnAttr}/>` : "";
  if (runs.length === 0) {
    return `<a:p>${pPr}${renderRun({ text: "" }, defaultSize, defaultFillHex, defaultFamily)}</a:p>`;
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
      paragraphs.push(`<a:p>${pPr}${current}</a:p>`);
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
  // Phase 4 of `docs/plans/multilingual-fonts-os-stack.md`: when
  // the family is one of the three Annot logical tokens
  // (`Annot Sans` / `Annot Serif` / `Annot Mono`) we expand it
  // to the full OOXML triple so PowerPoint applies per-script
  // fallback (`<a:latin>` for Latin / `<a:ea>` for East Asian /
  // `<a:cs>` for complex script — Arabic / Hebrew / Indic /
  // Thai). Non-token raw families (legacy stored values, plugin-
  // author overrides) emit only `<a:latin>` so the legacy
  // single-typeface output stays unchanged.
  const familyAttr = familyTypefaceXml(family);
  const flags = [
    run.bold ? ` b="1"` : "",
    run.italic ? ` i="1"` : "",
    run.underline ? ` u="sng"` : "",
  ].join("");
  return `<a:r><a:rPr lang="ja-JP" sz="${sizeVal}"${flags} dirty="0"><a:solidFill><a:srgbClr val="${fillHex}"/></a:solidFill>${familyAttr}</a:rPr><a:t>${exml(run.text)}</a:t></a:r>`;
}

/** Resolve a font-family value to OOXML typeface XML. Logical
 *  Annot tokens expand to the latin / ea / cs triple so
 *  PowerPoint's per-script fallback applies; other values emit
 *  the single legacy `<a:latin>` attribute. */
function familyTypefaceXml(family: string | undefined): string {
  if (!family) return "";
  if (isLogicalFamily(family)) {
    const t = ooxmlTypefacesFor(family);
    return [
      `<a:latin typeface="${exml(t.latin)}"/>`,
      `<a:ea typeface="${exml(t.ea)}"/>`,
      `<a:cs typeface="${exml(t.cs)}"/>`,
    ].join("");
  }
  return `<a:latin typeface="${exml(family)}"/>`;
}

function buildBgFill(bgCarrier: string): string {
  if (!bgCarrier) return "<a:noFill/>";
  // `fill="none"` on the geometry primitive (text-on-shape) means
  // the shape is transparent — `parseRgba("none")` would otherwise
  // fall through to the sticky-yellow default and paint a tinted
  // background in PowerPoint that Annot never showed.
  if (bgCarrier === "none" || bgCarrier === "transparent") return "<a:noFill/>";
  const [r, g, b, a] = parseRgba(bgCarrier);
  if (a <= 0) return "<a:noFill/>";
  const hex = `${pad2(r)}${pad2(g)}${pad2(b)}`;
  const alphaPct = Math.round((a / 255) * 100_000);
  return `<a:solidFill><a:srgbClr val="${hex}"><a:alpha val="${alphaPct}"/></a:srgbClr></a:solidFill>`;
}

function pad2(v: number): string {
  return v.toString(16).toUpperCase().padStart(2, "0");
}
