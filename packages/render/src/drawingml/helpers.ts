/**
 * Pure-string helpers for building OOXML DrawingML output. Ported
 * from the Rust GVML emitter
 * ([`packages/desktop/src-tauri/src/commands/clipboard.rs`](../../../desktop/src-tauri/src/commands/clipboard.rs))
 * so both the PPTX export path and the Office-clipboard path can
 * share a single TS implementation.
 *
 * Tier C-render per the three-package model: takes
 * data-driven `AnnotationShape` inputs, emits strings, no
 * `<canvas>` / live-DOM dependence.
 */

import type { AnnotationShape } from "@ingcreators/annot-core/desktop-bridge";

/** EMU per pixel (96 DPI). */
export const PX_EMU = 9525;
/** EMU per point. Used for OOXML line widths (`<a:ln w="…"/>`). */
export const PT_EMU = 12700;

export function px(v: number): number {
  return Math.round(v * PX_EMU);
}

export function pt(v: number): number {
  return Math.round(v * PT_EMU);
}

/** Normalise a CSS color (`#rrggbb` / `#rgb` / `rgb(...)` / named)
 *  into the 6-uppercase-hex form OOXML's `<a:srgbClr val="..."/>`
 *  expects. Falls back to "000000" for anything we can't parse —
 *  PowerPoint refuses to open files with malformed `srgbClr`
 *  values, so emitting black-but-valid is the safer option. */
export function chex(c: string | undefined | null): string {
  if (!c) return "000000";
  const trimmed = c.trim();
  if (!trimmed || trimmed === "none" || trimmed.startsWith("url(")) return "000000";
  const stripped = trimmed.replace(/^#/, "").toUpperCase();
  if (/^[0-9A-F]{6}$/.test(stripped)) return stripped;
  if (/^[0-9A-F]{3}$/.test(stripped)) {
    return stripped
      .split("")
      .map((c2) => c2 + c2)
      .join("");
  }
  if (stripped.length >= 6 && /^[0-9A-F]+$/.test(stripped)) {
    return stripped.slice(0, 6);
  }
  return "000000";
}

/** XML-escape free text inside `<a:t>...</a:t>` / attribute values. */
export function exml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Map an SVG arrow-shape name + dimensions onto an OOXML
 *  `<a:headEnd>` / `<a:tailEnd>` element. The SVG shape set is
 *  one-to-one with OOXML's six preset types. Returns `""` when
 *  no head should be emitted. */
export function endXml(
  which: "headEnd" | "tailEnd",
  shape: string | undefined | null,
  width: string | undefined | null,
  length: string | undefined | null,
): string {
  if (!shape || shape === "none") return "";
  const ooxmlType =
    shape === "arrow" || shape === "triangle" || shape === "stealth" || shape === "diamond" || shape === "oval"
      ? shape
      : "triangle";
  const sizeMap = (s: string | undefined | null): "sm" | "med" | "lg" => {
    if (s === "sm") return "sm";
    if (s === "lg") return "lg";
    return "med";
  };
  return `<a:${which} type="${ooxmlType}" w="${sizeMap(width)}" len="${sizeMap(length)}"/>`;
}

/** Map an SVG `stroke-linecap` value to the OOXML `cap=""`
 *  attribute (with leading space — appended onto `<a:ln>` open
 *  tag inline). */
export function capAttr(cap: string | undefined | null): string {
  if (cap === "butt") return ' cap="flat"';
  if (cap === "square") return ' cap="sq"';
  if (cap === "round") return ' cap="rnd"';
  return "";
}

/** Map an SVG `stroke-linejoin` value to the matching OOXML
 *  child element of `<a:ln>`. */
export function joinXml(join: string | undefined | null): string {
  if (join === "round") return "<a:round/>";
  if (join === "bevel") return "<a:bevel/>";
  if (join === "miter") return '<a:miter lim="800000"/>';
  return "";
}

/** Translate a TS-side `dasharray` field (key name OR computed
 *  comma-separated lengths) into the matching `<a:prstDash val=…/>`. */
export function dashToDrawingml(dasharray: string | undefined | null): string {
  if (!dasharray) return "";
  const trimmed = dasharray.trim();
  if (!trimmed) return "";
  if (trimmed === "dash") return '<a:prstDash val="dash"/>';
  if (trimmed === "dot") return '<a:prstDash val="dot"/>';
  if (trimmed === "dashDot") return '<a:prstDash val="dashDot"/>';
  if (trimmed === "lgDash") return '<a:prstDash val="lgDash"/>';
  const parts = trimmed.split(",").map((p) => p.trim());
  if (parts.length === 4) return '<a:prstDash val="dashDot"/>';
  if (parts.length === 2) {
    const d = Number.parseFloat(parts[0]!) || 0;
    const g = Number.parseFloat(parts[1]!) || 0;
    if (d <= g) return '<a:prstDash val="dot"/>';
    if (d > g * 4) return '<a:prstDash val="lgDash"/>';
    return '<a:prstDash val="dash"/>';
  }
  return '<a:prstDash val="dash"/>';
}

interface GradientStop {
  color: string;
  offset: number;
  opacity?: number;
}

interface GradientSpec {
  angle: number;
  stops: GradientStop[];
}

/** Build an `<a:gradFill>` element from a serialized gradient spec. */
export function gradFillXml(g: GradientSpec): string {
  const rotNorm = ((g.angle % 360) + 360) % 360;
  const ang = Math.round(rotNorm * 60_000);
  const stops = g.stops
    .map((s) => {
      const pos = Math.round(Math.max(0, Math.min(1, s.offset)) * 100_000);
      const alpha =
        s.opacity != null && s.opacity < 0.999
          ? `<a:alpha val="${Math.round(s.opacity * 100_000)}"/>`
          : "";
      return `<a:gs pos="${pos}"><a:srgbClr val="${chex(s.color)}">${alpha}</a:srgbClr></a:gs>`;
    })
    .join("");
  return `<a:gradFill flip="none" rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:lin ang="${ang}" scaled="1"/></a:gradFill>`;
}

/** Build the stroke-side paint element (`<a:solidFill>` or
 *  `<a:gradFill>`) honoring `stroke_opacity_value` and
 *  `stroke_gradient`. */
export function strokePaintXml(s: AnnotationShape, strokeHex: string): string {
  if (s.stroke_gradient) return gradFillXml(s.stroke_gradient);
  const opacity = s.stroke_opacity_value ?? 1;
  if (opacity < 0.999) {
    const alpha = Math.round(opacity * 100_000);
    return `<a:solidFill><a:srgbClr val="${strokeHex}"><a:alpha val="${alpha}"/></a:srgbClr></a:solidFill>`;
  }
  return `<a:solidFill><a:srgbClr val="${strokeHex}"/></a:solidFill>`;
}

/** Build the rotation / flip attribute string for an `<a:xfrm>`
 *  open tag. Pass `excludeFlip = true` for line / connector
 *  shapes whose own endpoint logic already populates flipH /
 *  flipV — combining them would double-mirror. */
export function xfrmAttrs(s: AnnotationShape, excludeFlip = false): string {
  let out = "";
  if (s.rotation_deg && s.rotation_deg !== 0) {
    const normalized = ((s.rotation_deg % 360) + 360) % 360;
    const rot = Math.round(normalized * 60_000);
    out += ` rot="${rot}"`;
  }
  if (!excludeFlip) {
    if (s.flip_h) out += ` flipH="1"`;
    if (s.flip_v) out += ` flipV="1"`;
  }
  return out;
}

/** Build the fill-side paint XML (or `<a:noFill/>`). Honors a
 *  `none` literal and an optional opacity (`fill_opacity` field). */
export function buildFillXml(fill: string | undefined | null, opacity: number): string {
  if (!fill || fill === "none") return "<a:noFill/>";
  const hex = chex(fill);
  if (opacity < 0.999) {
    const alpha = Math.round(opacity * 100_000);
    return `<a:solidFill><a:srgbClr val="${hex}"><a:alpha val="${alpha}"/></a:srgbClr></a:solidFill>`;
  }
  return `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
}

/** Parse `rgba(r,g,b,a)` or `#rrggbb` into a (r,g,b,a) 0-255
 *  tuple. Default for unparsable inputs is the legacy yellow
 *  sticky color so a missing bg fill still renders something
 *  reasonable in PowerPoint. */
export function parseRgba(s: string | undefined | null): [number, number, number, number] {
  if (!s) return [255, 255, 200, 235];
  const rgbaMatch = s.match(/^rgba\((.*)\)$/);
  if (rgbaMatch) {
    const parts = rgbaMatch[1]!.split(",").map((p) => p.trim());
    if (parts.length === 4) {
      const r = clamp255(Number.parseFloat(parts[0]!));
      const g = clamp255(Number.parseFloat(parts[1]!));
      const b = clamp255(Number.parseFloat(parts[2]!));
      const a = Math.round((Number.parseFloat(parts[3]!) || 0.92) * 255);
      return [r, g, b, clamp255(a)];
    }
  }
  if (s.startsWith("#") && s.length >= 7) {
    const r = Number.parseInt(s.slice(1, 3), 16);
    const g = Number.parseInt(s.slice(3, 5), 16);
    const b = Number.parseInt(s.slice(5, 7), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return [r, g, b, 255];
    }
  }
  return [255, 255, 200, 235];
}

function clamp255(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 255) return 255;
  return Math.round(v);
}

/** Parse the `M`/`L` points out of an SVG path d-string. Mirrors
 *  the regex-based parser used on the Rust side; ignores any
 *  cubic/quadratic Bezier segments (treats them as line-to). */
export function parseSvgPath(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /[ML]\s*([\d.-]+)[,\s]+([\d.-]+)/g;
  for (const match of d.matchAll(re)) {
    const x = Number.parseFloat(match[1]!);
    const y = Number.parseFloat(match[2]!);
    if (!Number.isNaN(x) && !Number.isNaN(y)) out.push([x, y]);
  }
  return out;
}
