import type { AnnotationShape } from "@ingcreators/annot-core/tauri-bridge";
import { chex, exml, parseRgba, px, xfrmAttrs } from "../helpers.js";
import type { NamespaceOpts } from "../namespace.js";

/** Build a `<{ns}:sp>` for a `type === "text"` AnnotationShape.
 *  Branches on `text_variant === "callout"` plus populated tail
 *  coords for the `wedgeRoundRectCallout` preset; otherwise emits
 *  `roundRect adj=5000` (the standard sticky/plain textbox). */
export function buildText(s: AnnotationShape, id: number, ns: NamespaceOpts): string {
  const x = px(s.x ?? 0);
  const y = px(s.y ?? 0);
  const fs = s.font_size ?? 24;
  const fill = chex(s.fill ?? "#ff0000");
  const text = s.text ?? "";
  const ptVal = Math.round(fs * 75);
  const bw =
    s.width != null
      ? px(s.width)
      : px(Math.max(text.length * fs * 0.6, 200));
  const bh =
    s.height != null
      ? px(s.height)
      : px(fs * 1.5 * Math.max(text.split("\n").length, 1));

  // Background fill from `text_bg_color`. Plain-variant textboxes
  // (no bg) render as `<a:noFill/>`.
  const bgCarrier = s.text_bg_color;
  const bgFill = bgCarrier
    ? buildBgFill(bgCarrier)
    : "<a:noFill/>";

  // Per-line `<a:p><a:r>...` runs. Newlines split into separate
  // paragraphs.
  const paragraphs = text
    .split("\n")
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="ja-JP" sz="${ptVal}" dirty="0"><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:rPr><a:t>${exml(line)}</a:t></a:r></a:p>`,
    )
    .join("");
  const xf = xfrmAttrs(s);

  // Callouts with a populated tail tip switch from `roundRect` to
  // `wedgeRoundRectCallout`. adj1/adj2 express the tail tip as a
  // signed percentage offset from the bbox center; values can
  // exceed ±50% when the tail tip lands outside the bbox (the
  // typical case for callouts). adj3 keeps the same corner-rounding
  // constant as the non-callout `roundRect` form.
  let geom = '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 5000"/></a:avLst></a:prstGeom>';
  if (
    s.text_variant === "callout" &&
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

  return `<${ns.shape}><${ns.nvShape}><${ns.cnvPr} id="${id}" name="T${id}"/><${ns.cnvSp} txBox="1"/></${ns.nvShape}><a:spPr><a:xfrm${xf}><a:off x="${x}" y="${y}"/><a:ext cx="${bw}" cy="${bh}"/></a:xfrm>${geom}${bgFill}<a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></a:spPr>${ns.txBodyOpen}<a:bodyPr wrap="square" rtlCol="0" lIns="91440" tIns="45720" rIns="91440" bIns="45720"/><a:lstStyle/>${paragraphs}${ns.txBodyClose}</${ns.shape}>`;
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
