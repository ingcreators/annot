/**
 * arrow-markers — composed-path arrow rendering, ported from
 * maxGraph's `edge-markers.ts` (Apache 2.0). The port abandons SVG's
 * `<marker>` mechanism in favor of a single `<path>` that encodes
 * both the line and its arrow head(s) as subpaths.
 *
 * Why this approach (vs SVG markers):
 *   SVG markers are rendered on top of the line's endpoint, with
 *   `markerUnits="strokeWidth"` scaling and `refX` positioning. That
 *   makes it nearly impossible to cleanly hide the line's stroke-
 *   linecap extension past the marker body or prevent the line's
 *   perpendicular stroke from poking past a tapering arrow-head tip.
 *
 *   maxGraph's approach (used by draw.io) sidesteps the problem by
 *   SHORTENING the line's geometric endpoint and drawing the arrow
 *   head as a separate path. The endpoint shortening uses precise
 *   trigonometry (1.118 / 0.7071 / 0.9862 multipliers — derived from
 *   1/(2·sin(angle/2)) of each preset's tip angle) so the stroke
 *   ends exactly where the arrow's interior begins.
 *
 * The arrow head and the (shortened) line share a single `<path>`
 * element:
 *   - The line subpath is unclosed ("M x1 y1 L x2 y2")
 *   - Filled arrow heads are closed subpaths (moveTo...lineTo...close)
 *   - Open arrow heads (chevron) are unclosed subpaths
 * With `fill=stroke-color`, closed subpaths fill, unclosed ones
 * remain just stroked — matching each arrow preset's intent.
 *
 * Port notes:
 *   - maxGraph's `AbstractCanvas2D` becomes `SvgPathCanvas`, a
 *     lightweight `d` string accumulator.
 *   - `Point` is `{ x, y }`. `Shape` and `type` args are elided.
 *   - The `pe` in-place mutation is preserved — callers pass a clone
 *     of the line endpoint and read its post-call value to know where
 *     the line should actually end.
 */

import type { ArrowShape, ArrowDim } from "./tools/tool-base.js";

export interface Point { x: number; y: number; }

export interface ArrowSpec {
  shape: ArrowShape;
  /** OOXML `w` — perpendicular-to-stem thickness preset. */
  width: ArrowDim;
  /** OOXML `len` — along-stem length preset. */
  length: ArrowDim;
}

// ---- SvgPathCanvas ------------------------------------------------

/**
 * Minimal adapter that mirrors the subset of `AbstractCanvas2D`
 * maxGraph's marker factories call. Internally it just accumulates
 * SVG path commands into a `d` attribute string.
 */
class SvgPathCanvas {
  #d = "";
  begin(): void { /* no-op — path commands don't need a separate begin */ }
  moveTo(x: number, y: number): void {
    this.#d += `M ${fmt(x)} ${fmt(y)} `;
  }
  lineTo(x: number, y: number): void {
    this.#d += `L ${fmt(x)} ${fmt(y)} `;
  }
  quadTo(cx: number, cy: number, x: number, y: number): void {
    this.#d += `Q ${fmt(cx)} ${fmt(cy)} ${fmt(x)} ${fmt(y)} `;
  }
  close(): void { this.#d += "Z "; }
  /** maxGraph emits `canvas.ellipse(x, y, w, h)` for the oval
   *  marker (box top-left + box dimensions). We render it as two
   *  half-arc commands — SVG A commands can't draw a full ellipse
   *  in a single sweep. */
  ellipse(x: number, y: number, w: number, h: number): void {
    const rx = w / 2;
    const ry = h / 2;
    const cx = x + rx;
    const cy = y + ry;
    this.#d += `M ${fmt(cx - rx)} ${fmt(cy)} `
      + `A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)} `
      + `A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)} Z `;
  }
  stroke(): void { /* stroke / fill toggles are meaningless for an
    offline path string; the final <path> carries stroke + fill attrs. */ }
  fillAndStroke(): void { /* see stroke() */ }

  get d(): string { return this.#d.trim(); }
  clear(): void { this.#d = ""; }
}

function fmt(n: number): string {
  return Math.abs(n) < 1e-9 ? "0" : Number(n.toFixed(3)).toString();
}

// ---- Ported marker factories (maxGraph edge-markers.ts) ----------
//
// Each factory writes arrow-head commands into the given canvas AND
// mutates `pe` to the shortened line endpoint. The parent caller
// then draws the line from start to `pe` (now shortened), ensuring
// the line stops exactly where the arrow's inner body begins.

/**
 * Builds "classic" (triangle-with-notch) and "block" (plain
 * triangle) filled arrows. `widthFactor` controls how wide the base
 * is (2 = wide, 3 = thin). `classic=true` adds a centerline notch.
 */
function drawClassicLike(
  canvas: SvgPathCanvas,
  widthFactor: number,
  classic: boolean,
  pe: Point,
  unitX: number,
  unitY: number,
  size: number,
  sw: number,
): void {
  // 1.118 = 1/(2·sin(26.565°)); half a stroke-width of forward
  // protrusion at a classic arrow tip.
  const endOffsetX = unitX * sw * 1.118;
  const endOffsetY = unitY * sw * 1.118;

  const uX = unitX * (size + sw);
  const uY = unitY * (size + sw);

  const pt: Point = { x: pe.x - endOffsetX, y: pe.y - endOffsetY };
  const f = classic ? 3 / 4 : 1;
  pe.x += -uX * f - endOffsetX;
  pe.y += -uY * f - endOffsetY;

  canvas.moveTo(pt.x, pt.y);
  canvas.lineTo(
    pt.x - uX - uY / widthFactor,
    pt.y - uY + uX / widthFactor,
  );
  if (classic) {
    canvas.lineTo(pt.x - (uX * 3) / 4, pt.y - (uY * 3) / 4);
  }
  canvas.lineTo(
    pt.x + uY / widthFactor - uX,
    pt.y - uY - uX / widthFactor,
  );
  canvas.close();
}

/**
 * Open chevron (>). Two outline strokes meeting at the tip, base
 * stays open. `widthFactor` controls chevron width (2 wide, 3 thin).
 */
function drawOpenArrow(
  canvas: SvgPathCanvas,
  widthFactor: number,
  pe: Point,
  unitX: number,
  unitY: number,
  size: number,
  sw: number,
): void {
  const endOffsetX = unitX * sw * 1.118;
  const endOffsetY = unitY * sw * 1.118;

  const uX = unitX * (size + sw);
  const uY = unitY * (size + sw);

  const pt: Point = { x: pe.x - endOffsetX, y: pe.y - endOffsetY };
  pe.x += -endOffsetX * 2;
  pe.y += -endOffsetY * 2;

  canvas.moveTo(
    pt.x - uX - uY / widthFactor,
    pt.y - uY + uX / widthFactor,
  );
  canvas.lineTo(pt.x, pt.y);
  canvas.lineTo(
    pt.x + uY / widthFactor - uX,
    pt.y - uY - uX / widthFactor,
  );
}

/**
 * Filled diamond (rhombus). `thin=true` for a narrower variant.
 */
function drawDiamond(
  canvas: SvgPathCanvas,
  thin: boolean,
  pe: Point,
  unitX: number,
  unitY: number,
  size: number,
  sw: number,
): void {
  // 0.7071 = 1/(2·sin(45°)); 0.9862 for the thin diamond's 45°/81° tip.
  const swFactor = thin ? 0.9862 : 0.7071;
  const endOffsetX = unitX * sw * swFactor;
  const endOffsetY = unitY * sw * swFactor;

  const uX = unitX * (size + sw);
  const uY = unitY * (size + sw);

  const pt: Point = { x: pe.x - endOffsetX, y: pe.y - endOffsetY };
  pe.x += -uX - endOffsetX;
  pe.y += -uY - endOffsetY;

  // Thickness factor — 2 for standard diamond, 3.4 for thin.
  const tk = thin ? 3.4 : 2;

  canvas.moveTo(pt.x, pt.y);
  canvas.lineTo(pt.x - uX / 2 - uY / tk, pt.y + uX / tk - uY / 2);
  canvas.lineTo(pt.x - uX, pt.y - uY);
  canvas.lineTo(pt.x - uX / 2 + uY / tk, pt.y - uY / 2 - uX / tk);
  canvas.close();
}

/**
 * Filled oval (circle at the tip). `size` is the diameter.
 */
function drawOval(
  canvas: SvgPathCanvas,
  pe: Point,
  unitX: number,
  unitY: number,
  size: number,
): void {
  const a = size / 2;
  const pt: Point = { x: pe.x, y: pe.y };
  pe.x -= unitX * a;
  pe.y -= unitY * a;
  canvas.ellipse(pt.x - a, pt.y - a, size, size);
}

// ---- Annot preset table ------------------------------------------
//
// Maps Annot's (shape × w × len) presets onto maxGraph factory
// invocations. The Annot / OOXML dimensions translate as:
//   length (OOXML `len`) → maxGraph `size`  (arrow's along-stem extent)
//   width  (OOXML `w`)   → maxGraph `widthFactor` (wing spread;
//                                                  NOTE: inverse —
//                                                  larger factor =
//                                                  narrower arrow)
//
// Annot's shape set (6 OOXML presets) is translated to the closest
// maxGraph factory:
//   triangle  → block-like (createArrow, classic=false)
//   arrow     → open chevron
//   stealth   → classic (createArrow, classic=true — triangle w/ notch)
//   diamond   → diamond (standard)
//   oval      → oval
//   none      → skipped (no arrow head)

/** Length (along-stem) in marker units. Tuned to match PowerPoint's
 *  visual w=med / len=med render at a 3pt line (~12pt × 8pt arrow)
 *  for filled shapes (triangle / stealth / diamond / oval). Open
 *  chevrons ("arrow" shape) need their own larger set below. */
const LENGTH_PX: Record<ArrowDim, number> = { sm: 6, md: 10, lg: 14 };

/** Width factor in maxGraph's inverse sense (divider on the wing
 *  offset). Smaller value → wider arrow. Maps OOXML w to the factor
 *  that produces a proportionally wider marker. Used by filled
 *  shapes; open chevrons use the ARROW_* constants for a more
 *  visibly-open V. */
const WIDTH_FACTOR: Record<ArrowDim, number> = { sm: 3.2, md: 2.4, lg: 1.8 };

/** Open-chevron size presets — bumped up from the previous 8/12/16
 *  because the user's PowerPoint comparison shows arrowheads that
 *  are visibly larger overall, with a broader V-angle than what a
 *  subtle modest range produces. */
const ARROW_LENGTH_PX: Record<ArrowDim, number> = { sm: 11, md: 15, lg: 20 };

/** V-angle width factors for open chevrons, tuned to PowerPoint:
 *    sm → 2.4 (≈45° V)
 *    md → 1.8 (≈58° V)
 *    lg → 1.35 (≈73° V)
 *  The progression matches PowerPoint's visible row-to-row angle
 *  widening. `widthFactor = 1 / tan(angle/2)` is the formula used
 *  to pick each value. */
const ARROW_WIDTH_FACTOR: Record<ArrowDim, number> = { sm: 2.4, md: 1.8, lg: 1.35 };

export interface ArrowRenderResult {
  /** Whether the arrow head is a filled (closed) shape. Used by the
   *  caller to decide whether to route this head's path data into
   *  the "filled" head `<path>` (fill=stroke) or the "open" head
   *  `<path>` (fill=none). Splitting is REQUIRED when mixing filled
   *  and open heads on the same arrow — e.g. start=oval + end=arrow
   *  — because a single `<path>` with fill=stroke would auto-close
   *  the open chevron subpath and render it as a filled triangle. */
  filled: boolean;
}

/**
 * Render one arrow head into `canvas` at endpoint `pe`, mutating
 * `pe` to the shortened line endpoint. The returned `filled` flag
 * tells the caller whether to set fill=stroke on the parent path.
 */
export function renderArrowHead(
  canvas: SvgPathCanvas,
  spec: ArrowSpec,
  pe: Point,
  unitX: number,
  unitY: number,
  strokeWidth: number,
): ArrowRenderResult {
  if (spec.shape === "none") return { filled: false };
  // Open chevrons pick from their own larger / wider tables so they
  // visually match PowerPoint's arrow preset (which is drawn about
  // 2× the size of the filled triangle at the same w/len).
  const size = spec.shape === "arrow"
    ? ARROW_LENGTH_PX[spec.length]
    : LENGTH_PX[spec.length];
  const widthFactor = spec.shape === "arrow"
    ? ARROW_WIDTH_FACTOR[spec.width]
    : WIDTH_FACTOR[spec.width];
  switch (spec.shape) {
    case "triangle":
      drawClassicLike(canvas, widthFactor, false, pe, unitX, unitY, size, strokeWidth);
      return { filled: true };
    case "stealth":
      drawClassicLike(canvas, widthFactor, true, pe, unitX, unitY, size, strokeWidth);
      return { filled: true };
    case "arrow":
      // Open polyline — matches the OOXML "arrow" preset (a hollow
      // chevron, not a filled arrow). Earlier experiments switched
      // this to a filled + notch shape to avoid the stem→chevron
      // gap, but the filled version diverged too much from
      // PowerPoint's actual render. Keeping it open and relying on
      // the ARROW_* sizing (wider V, shorter extent) produces a
      // tight-enough join while preserving the genuine V look.
      drawOpenArrow(canvas, widthFactor, pe, unitX, unitY, size, strokeWidth);
      return { filled: false };
    case "diamond":
      drawDiamond(canvas, false, pe, unitX, unitY, size, strokeWidth);
      return { filled: true };
    case "oval":
      drawOval(canvas, pe, unitX, unitY, size);
      return { filled: true };
  }
  return { filled: false };
}

/**
 * Compute the stem and arrow-head path-data strings independently.
 *
 * The heads mutate their respective endpoints inward so the stem
 * stops exactly where the head begins. The two `d` strings are
 * returned separately so the caller can render them in separate
 * `<path>` elements — that lets the stem carry a dash pattern
 * (`stroke-dasharray`) WITHOUT the dashes bleeding into the arrow-
 * head outlines (a single `<path>` would apply its dasharray to
 * every subpath including the closed heads).
 *
 * `anyFilled` signals that at least one head is a filled (closed)
 * shape, so the head `<path>` should use `fill=stroke` to paint
 * the interiors.
 */
export function computeArrowParts(
  x1: number, y1: number,
  x2: number, y2: number,
  specStart: ArrowSpec,
  specEnd: ArrowSpec,
  strokeWidth: number,
  control?: Point | null,
): { stemD: string; headFilledD: string; headOpenD: string } {
  // Separate canvases for filled vs open heads. This lets the caller
  // emit them as TWO `<path>` elements with different `fill` attrs
  // — required when mixing a filled head (e.g. oval at start) with
  // an open chevron (at end) on the same arrow. A single shared
  // path with fill=stroke would implicitly close the open chevron
  // into a filled triangle.
  const filledCanvas = new SvgPathCanvas();
  const openCanvas = new SvgPathCanvas();

  // Tangent vectors at each endpoint. For a straight arrow both
  // tangents are the same overall direction. For a quadratic Bézier
  // (P0=endpointStart, P1=control, P2=endpointEnd) the tangent at
  // t=0 is parallel to (P1-P0) and at t=1 parallel to (P2-P1). If
  // the control coincides with an endpoint (degenerate), we fall
  // back to the straight direction for that side so the arrow head
  // still orients sensibly.
  const straightDx = x2 - x1;
  const straightDy = y2 - y1;
  const straightLen = Math.hypot(straightDx, straightDy) || 1;
  const straightUx = straightDx / straightLen;
  const straightUy = straightDy / straightLen;

  let startUx = straightUx, startUy = straightUy;
  let endUx = straightUx, endUy = straightUy;
  if (control) {
    const sdx = control.x - x1;
    const sdy = control.y - y1;
    const sLen = Math.hypot(sdx, sdy);
    if (sLen > 1e-6) {
      startUx = sdx / sLen;
      startUy = sdy / sLen;
    }
    const edx = x2 - control.x;
    const edy = y2 - control.y;
    const eLen = Math.hypot(edx, edy);
    if (eLen > 1e-6) {
      endUx = edx / eLen;
      endUy = edy / eLen;
    }
  }

  const peStart: Point = { x: x1, y: y1 };
  const peEnd: Point = { x: x2, y: y2 };

  const endFilled = isShapeFilled(specEnd.shape);
  const startFilled = isShapeFilled(specStart.shape);
  renderArrowHead(
    endFilled ? filledCanvas : openCanvas,
    specEnd, peEnd, endUx, endUy, strokeWidth,
  );
  // For the start end, unit vector points OUT of the line (reverse of
  // forward direction at start).
  renderArrowHead(
    startFilled ? filledCanvas : openCanvas,
    specStart, peStart, -startUx, -startUy, strokeWidth,
  );

  const stemCanvas = new SvgPathCanvas();
  stemCanvas.moveTo(peStart.x, peStart.y);
  if (control) {
    // Approximation: we let the Bézier end at the (slightly inward-
    // mutated) peStart/peEnd values renderArrowHead produced, keeping
    // the original control point. Because we only shorten by a few
    // stroke-widths, the resulting curve's tangent at the new endpoint
    // remains almost parallel to the original (P1-P0)/(P2-P1)
    // direction — so the arrow head still appears tangent-aligned and
    // the stem joins seamlessly with the head base.
    stemCanvas.quadTo(control.x, control.y, peEnd.x, peEnd.y);
  } else {
    stemCanvas.lineTo(peEnd.x, peEnd.y);
  }

  return {
    stemD: stemCanvas.d,
    headFilledD: filledCanvas.d,
    headOpenD: openCanvas.d,
  };
}

/** Which preset shapes render as closed (filled) subpaths. Mirror of
 *  the `filled: true` branches in renderArrowHead — kept as a pure
 *  predicate so computeArrowParts can route head data to the correct
 *  canvas without a dry-run render. */
function isShapeFilled(shape: ArrowShape): boolean {
  return shape === "triangle" || shape === "stealth"
    || shape === "diamond" || shape === "oval";
}

/** Read the per-end arrow spec off an existing arrow <path> element.
 *  Mirrors the data-* attribute contract applyArrowPath writes. */
export function detectArrowSpec(el: SVGElement, end: "start" | "end"): ArrowSpec {
  const shape = (el.getAttribute(`data-arrow-${end}-shape`) as ArrowShape | null) || "none";
  const width = (el.getAttribute(`data-arrow-${end}-width`) as ArrowDim | null)
    || (el.getAttribute(`data-arrow-${end}-size`) as ArrowDim | null)
    || "md";
  const length = (el.getAttribute(`data-arrow-${end}-length`) as ArrowDim | null)
    || (el.getAttribute(`data-arrow-${end}-size`) as ArrowDim | null)
    || "md";
  return { shape, width, length };
}

/** Write the arrow spec back onto an element. */
export function writeArrowSpec(
  el: SVGElement,
  end: "start" | "end",
  spec: ArrowSpec,
): void {
  el.setAttribute(`data-arrow-${end}-shape`, spec.shape);
  el.setAttribute(`data-arrow-${end}-width`, spec.width);
  el.setAttribute(`data-arrow-${end}-length`, spec.length);
  // Legacy single-size attr (length is what PowerPoint's "size"
  // dropdown shows).
  el.setAttribute(`data-arrow-${end}-size`, spec.length);
}

/** Read the geometric endpoints of an arrow `<path>` element. The
 *  x1/y1/x2/y2 values are stored as data attrs (the `d` string is
 *  derived from them). */
export function readArrowEndpoints(el: SVGElement): {
  x1: number; y1: number; x2: number; y2: number;
} {
  return {
    x1: parseFloat(el.getAttribute("data-x1") || "0"),
    y1: parseFloat(el.getAttribute("data-y1") || "0"),
    x2: parseFloat(el.getAttribute("data-x2") || "0"),
    y2: parseFloat(el.getAttribute("data-y2") || "0"),
  };
}

export function writeArrowEndpoints(
  el: SVGElement,
  x1: number, y1: number,
  x2: number, y2: number,
): void {
  el.setAttribute("data-x1", String(x1));
  el.setAttribute("data-y1", String(y1));
  el.setAttribute("data-x2", String(x2));
  el.setAttribute("data-y2", String(y2));
}

/** Read the quadratic-bezier control point for a curved arrow, or
 *  null if the arrow is straight (no data-cx/cy set). */
export function readArrowControl(el: SVGElement): Point | null {
  const cxRaw = el.getAttribute("data-cx");
  const cyRaw = el.getAttribute("data-cy");
  if (cxRaw == null || cyRaw == null) return null;
  const cx = parseFloat(cxRaw);
  const cy = parseFloat(cyRaw);
  if (!isFinite(cx) || !isFinite(cy)) return null;
  return { x: cx, y: cy };
}

/** Write the control point (turns the arrow curved) or clear it
 *  (back to straight). Pass null to straighten. */
export function writeArrowControl(el: SVGElement, control: Point | null): void {
  if (control == null) {
    el.removeAttribute("data-cx");
    el.removeAttribute("data-cy");
    return;
  }
  el.setAttribute("data-cx", String(control.x));
  el.setAttribute("data-cy", String(control.y));
}

/**
 * Rebuild the stem and arrow-head `<path>` children of an arrow
 * `<g>` wrapper from its current endpoint and arrow-spec data attrs.
 * Called after any endpoint drag / arrow-head change / stroke-width
 * change so the composed geometry stays in sync.
 *
 * DOM shape expected:
 *   <g data-type="arrow" data-x1=.. data-y1=.. data-x2=.. data-y2=..
 *                        data-arrow-start-* ... data-arrow-end-* ...
 *                        stroke=.. stroke-width=.. stroke-dasharray=.. fill=..>
 *     <path data-role="stem"        d="..."/>
 *     <path data-role="head-filled" d="..." fill=stroke/>
 *     <path data-role="head-open"   d="..." fill="none"/>
 *   </g>
 *
 * Missing children are created on the fly so old DOM upgrades
 * cleanly. We use TWO head paths so mixed configurations (e.g.
 * oval at start + open arrow at end) render correctly — a single
 * head path with fill=stroke would implicitly close the open
 * chevron into a filled triangle.
 */
export function refreshArrowPath(el: SVGElement): void {
  const { x1, y1, x2, y2 } = readArrowEndpoints(el);
  const control = readArrowControl(el);
  const specStart = detectArrowSpec(el, "start");
  const specEnd = detectArrowSpec(el, "end");
  const sw = parseFloat(el.getAttribute("stroke-width") || "3") || 3;
  const { stemD, headFilledD, headOpenD } = computeArrowParts(
    x1, y1, x2, y2, specStart, specEnd, sw, control,
  );

  // Drop any legacy single-head path that older DOM may carry.
  el.querySelector(':scope > [data-role="head"]')?.remove();

  let stem = el.querySelector<SVGPathElement>(':scope > [data-role="stem"]');
  if (!stem) {
    stem = document.createElementNS("http://www.w3.org/2000/svg", "path");
    stem.setAttribute("data-role", "stem");
    el.appendChild(stem);
  }
  // `fill="none"` is a permanent requirement (the stem is a 2-point
  // open subpath and should never accidentally fill). But we do NOT
  // override `stroke-linecap` / `stroke-linejoin` on the stem — let
  // them inherit from the <g>, which reflects the user's Line Cap
  // Type choice. PowerPoint's arrow has a rounded chevron but leaves
  // the line's own caps subject to the Cap setting; we mirror that.
  stem.setAttribute("fill", "none");
  stem.removeAttribute("stroke-linecap");
  stem.removeAttribute("stroke-linejoin");
  stem.setAttribute("d", stemD);

  const stroke = el.getAttribute("stroke") || "#ff0000";
  // Head-path overrides (applied to both filled and open variants):
  //   - `stroke-dasharray="none"` keeps arrow heads crisp even when
  //     the stem is dashed (dasharray cascades from <g>).
  //   - `stroke-linecap="round"` rounds polyline endpoints — on open
  //     chevrons this is the two base corners; on closed shapes it's
  //     a no-op. PowerPoint's arrow has fixed-round base corners
  //     regardless of the user's line Cap Type choice.
  //   - `stroke-linejoin="miter"` keeps V tips POINTED. PowerPoint
  //     renders arrow tips as sharp V vertices, not rounded bumps.
  const applyHeadAttrs = (path: SVGPathElement, fill: string, d: string) => {
    path.setAttribute("stroke-dasharray", "none");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "miter");
    path.setAttribute("fill", fill);
    path.removeAttribute("stroke-width");
    path.setAttribute("d", d);
  };

  let headFilled = el.querySelector<SVGPathElement>(':scope > [data-role="head-filled"]');
  if (!headFilled) {
    headFilled = document.createElementNS("http://www.w3.org/2000/svg", "path");
    headFilled.setAttribute("data-role", "head-filled");
    el.appendChild(headFilled);
  }
  applyHeadAttrs(headFilled, stroke, headFilledD);

  let headOpen = el.querySelector<SVGPathElement>(':scope > [data-role="head-open"]');
  if (!headOpen) {
    headOpen = document.createElementNS("http://www.w3.org/2000/svg", "path");
    headOpen.setAttribute("data-role", "head-open");
    el.appendChild(headOpen);
  }
  applyHeadAttrs(headOpen, "none", headOpenD);
}
