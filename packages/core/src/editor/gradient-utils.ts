/**
 * gradient-utils — linear-gradient helpers for stroke and fill.
 *
 * The browser-native way to paint a gradient stroke or fill in SVG is
 * to emit a `<linearGradient>` into `<defs>` and reference it via
 * `stroke="url(#id)"` / `fill="url(#id)"`. We store the original spec
 * (stops + angle) as a JSON blob on `data-stroke-gradient` /
 * `data-fill-gradient` so that:
 *
 *   1. The PropertyPanel can round-trip the user's choice without
 *      fragile parsing of the built <linearGradient>.
 *   2. `rebuildGradients()` (called on load) can recreate any missing
 *      defs, so saved SVG files with `url(#id)` refs keep rendering
 *      even if the defs section was stripped during serialization.
 *   3. The Office / PPTX exporter has a single source of truth to
 *      translate into `<a:gradFill>`.
 */

import type { GradientSpec, GradientStop } from "./tools/tool-base.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Generate a fresh, readable gradient id unique within the document. */
function newGradientId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Find the `<defs>` an element reaches. Falls back to creating one on
 *  the owning `<svg>` if it isn't present yet. */
function ensureDefs(el: SVGElement): SVGDefsElement {
  const svg = el.ownerSVGElement as SVGSVGElement | null;
  if (!svg) throw new Error("gradient-utils: element has no ownerSVGElement");
  let defs = svg.querySelector("defs") as SVGDefsElement | null;
  if (!defs) {
    defs = document.createElementNS(SVG_NS, "defs");
    svg.insertBefore(defs, svg.firstChild);
  }
  return defs;
}

/** Build a `<linearGradient>` DOM node from a spec. Not inserted. */
function buildLinearGradient(id: string, spec: GradientSpec): SVGLinearGradientElement {
  const g = document.createElementNS(SVG_NS, "linearGradient");
  g.id = id;
  g.setAttribute("gradientUnits", "objectBoundingBox");

  // SVG linearGradient uses (x1,y1)-(x2,y2) on the unit box. Convert
  // our angle (0 = left→right, 90 = top→bottom) into those corners.
  const rad = (spec.angle * Math.PI) / 180;
  // Start at the bbox center, push out to the perimeter along ±(cos,sin).
  const cx = 0.5;
  const cy = 0.5;
  const dx = Math.cos(rad) * 0.5;
  const dy = Math.sin(rad) * 0.5;
  g.setAttribute("x1", String(cx - dx));
  g.setAttribute("y1", String(cy - dy));
  g.setAttribute("x2", String(cx + dx));
  g.setAttribute("y2", String(cy + dy));

  for (const stop of spec.stops) {
    const s = document.createElementNS(SVG_NS, "stop");
    s.setAttribute("offset", String(stop.offset));
    s.setAttribute("stop-color", stop.color);
    if (stop.opacity != null && stop.opacity < 1) {
      s.setAttribute("stop-opacity", String(stop.opacity));
    }
    g.appendChild(s);
  }
  return g;
}

/** Apply a gradient as the element's stroke (or fill). `which` selects
 *  which attribute takes the url(...) ref; the spec is also serialized
 *  into `data-{which}-gradient` so it survives round-trips. */
export function applyGradient(el: SVGElement, which: "stroke" | "fill", spec: GradientSpec): void {
  const defs = ensureDefs(el);
  const id = newGradientId(`grad-${which}`);
  defs.appendChild(buildLinearGradient(id, spec));
  el.setAttribute(which, `url(#${id})`);
  el.setAttribute(`data-${which}-gradient`, JSON.stringify(spec));
}

/** Remove the gradient from an element (both the defs node and the
 *  element's url(...) ref). `fallbackColor` restores a solid paint so
 *  the element doesn't suddenly turn invisible. */
export function removeGradient(
  el: SVGElement,
  which: "stroke" | "fill",
  fallbackColor: string,
): void {
  const urlRef = el.getAttribute(which);
  const m = urlRef?.match(/^url\(#([^)]+)\)$/);
  if (m) {
    const grad = el.ownerDocument?.getElementById(m[1]!);
    grad?.remove();
  }
  el.setAttribute(which, fallbackColor);
  el.removeAttribute(`data-${which}-gradient`);
}

/** Read the persisted gradient spec off an element, or null if the
 *  attribute isn't there (i.e. the paint is solid). */
export function detectGradient(el: SVGElement, which: "stroke" | "fill"): GradientSpec | null {
  const raw = el.getAttribute(`data-${which}-gradient`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GradientSpec;
    if (parsed && parsed.type === "linear" && Array.isArray(parsed.stops)) {
      return parsed;
    }
  } catch {
    /* malformed JSON — treat as no gradient */
  }
  return null;
}

/** On load of a saved SVG, reconstruct every `<linearGradient>` that a
 *  `data-*-gradient` attribute references. Saved files may have lost
 *  the defs section if they were serialized by a path that doesn't
 *  include defs (rare but possible), so this provides a self-healing
 *  fallback. */
export function rebuildGradients(svg: SVGSVGElement): void {
  const withStroke = svg.querySelectorAll<SVGElement>("[data-stroke-gradient]");
  const withFill = svg.querySelectorAll<SVGElement>("[data-fill-gradient]");
  const defs = (() => {
    let d = svg.querySelector("defs") as SVGDefsElement | null;
    if (!d) {
      d = document.createElementNS(SVG_NS, "defs");
      svg.insertBefore(d, svg.firstChild);
    }
    return d;
  })();
  const rebuild = (el: SVGElement, which: "stroke" | "fill") => {
    const spec = detectGradient(el, which);
    if (!spec) return;
    const ref = el.getAttribute(which) || "";
    const m = ref.match(/^url\(#([^)]+)\)$/);
    if (m && svg.querySelector(`#${CSS.escape(m[1]!)}`)) return; // still present
    const id = newGradientId(`grad-${which}`);
    defs.appendChild(buildLinearGradient(id, spec));
    el.setAttribute(which, `url(#${id})`);
  };
  for (const el of Array.from(withStroke)) rebuild(el, "stroke");
  for (const el of Array.from(withFill)) rebuild(el, "fill");
}

/** Sample convenience spec for the "just turn gradient on" flow. Two
 *  stops derived from the element's current solid color: the color
 *  itself and a darkened variant. */
export function defaultGradientFrom(color: string): GradientSpec {
  return {
    type: "linear",
    angle: 90,
    stops: [
      { color, offset: 0 },
      { color: darken(color, 0.5), offset: 1 },
    ],
  };
}

function darken(hex: string, amount: number): string {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = Number.parseInt(m[1]!, 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export type { GradientSpec, GradientStop };
