/**
 * Walk an SVG annotation tree and emit one {@link AnnotationShape}
 * per top-level child. Shared between the toolbar's `#copyForOffice`
 * (TS → Tauri Office-paste path) and — once the
 * [`office-paste-shared-drawing-builder` plan](../../../../docs/plans/office-paste-shared-drawing-builder.md)
 * is fully landed — the PPTX export path
 * (`packages/editor/src/pptx-export.ts`).
 *
 * Tier B per the three-package model: this file does element-level
 * attribute reads only, which works under jsdom — no `<canvas>`
 * pixel sampling, no `ResizeObserver`, no live event handling.
 *
 * `AnnotationShape` is type-only-imported from
 * `@ingcreators/annot-core/utils/tauri-bridge` so Tier B keeps a
 * pure-types boundary with the Tauri-flavoured runtime side
 * (`copyAsOffice`, `isTauri`) of the same module.
 */

import type { AnnotationShape, TextRun } from "../utils/tauri-bridge.js";
import { getEffectiveLineEndpoints } from "./transform-utils.js";

/** Apply a group's `transform="translate(tx, ty)"` (or the
 *  canonical `data-tx` / `data-ty`) when pulling out coordinates,
 *  so the resulting shape lands at the same visual position the
 *  user sees in the editor. Reads `data-tx` / `data-ty` first (the
 *  transform-utils layer writes them when the visual transform
 *  attribute has been rewritten as a `matrix(...)` for rotation /
 *  flip support), then falls back to the literal `transform`
 *  attribute. */
export function translateOf(el: SVGElement): { tx: number; ty: number } {
  const dtx = el.getAttribute("data-tx");
  const dty = el.getAttribute("data-ty");
  if (dtx != null || dty != null) {
    return {
      tx: Number.parseFloat(dtx || "0") || 0,
      ty: Number.parseFloat(dty || "0") || 0,
    };
  }
  const t = el.getAttribute("transform") || "";
  const m = t.match(/translate\(([\d.-]+),?\s*([\d.-]+)\)/);
  return m ? { tx: Number.parseFloat(m[1]!), ty: Number.parseFloat(m[2]!) } : { tx: 0, ty: 0 };
}

/** Pull rotation / flip / line-polish state into the AnnotationShape
 *  partial. Returned only when non-default so the JSON payload stays
 *  compact for unstyled shapes. */
export function transformOf(el: SVGElement): Partial<AnnotationShape> {
  const out: Partial<AnnotationShape> = {};
  const rot = Number.parseFloat(el.getAttribute("data-rot") || "0");
  if (rot) out.rotation_deg = rot;
  if (el.getAttribute("data-flip-h") === "1") out.flip_h = true;
  if (el.getAttribute("data-flip-v") === "1") out.flip_v = true;

  // Line polish — arrow shape/size per end, linecap, linejoin,
  // stroke opacity, gradients. Only attached when non-default so
  // the payload stays trim for unstyled shapes.
  const ss = el.getAttribute("data-arrow-start-shape");
  const es = el.getAttribute("data-arrow-end-shape");
  const sw = el.getAttribute("data-arrow-start-width");
  const sl = el.getAttribute("data-arrow-start-length");
  const ew = el.getAttribute("data-arrow-end-width");
  const eL = el.getAttribute("data-arrow-end-length");
  if (ss) out.arrow_shape_start = ss as AnnotationShape["arrow_shape_start"];
  if (es) out.arrow_shape_end = es as AnnotationShape["arrow_shape_end"];
  if (sw) out.arrow_width_start = sw as AnnotationShape["arrow_width_start"];
  if (sl) out.arrow_length_start = sl as AnnotationShape["arrow_length_start"];
  if (ew) out.arrow_width_end = ew as AnnotationShape["arrow_width_end"];
  if (eL) out.arrow_length_end = eL as AnnotationShape["arrow_length_end"];

  const cap = el.getAttribute("stroke-linecap");
  if (cap === "butt" || cap === "round" || cap === "square") {
    out.stroke_linecap = cap;
  }
  const join = el.getAttribute("stroke-linejoin");
  if (join === "miter" || join === "round" || join === "bevel") {
    out.stroke_linejoin = join;
  }
  // Line transparency may live on `opacity` (canonical — lets
  // arrow markers fade with the line) or `stroke-opacity` (legacy
  // SVG attribute). Prefer whichever is present; emit the value
  // only when non-default so solid lines stay unchanged in the
  // payload.
  const opacityRaw = el.getAttribute("opacity") ?? el.getAttribute("stroke-opacity");
  const so = Number.parseFloat(opacityRaw || "");
  if (Number.isFinite(so) && so < 1) out.stroke_opacity_value = so;

  const sgRaw = el.getAttribute("data-stroke-gradient");
  if (sgRaw) {
    try {
      out.stroke_gradient = JSON.parse(sgRaw);
    } catch {
      /* skip malformed gradient JSON */
    }
  }
  const fgRaw = el.getAttribute("data-fill-gradient");
  if (fgRaw) {
    try {
      out.fill_gradient = JSON.parse(fgRaw);
    } catch {
      /* skip malformed gradient JSON */
    }
  }
  return out;
}

/**
 * Convert one annotation `<g>` / leaf element into an
 * `AnnotationShape`, or `null` for elements that have no
 * Office-paste mapping (an unrecognised `<g>` wrapper, etc.).
 *
 * Mirrors the per-tag dispatch the toolbar's `#copyForOffice`
 * historically inlined.
 */
export function svgElementToAnnotationShape(el: SVGElement): AnnotationShape | null {
  const tag = el.tagName;
  const { tx, ty } = translateOf(el);
  const xform = transformOf(el);

  const isArrowGroup = tag === "g" && el.getAttribute("data-type") === "arrow";
  if (isArrowGroup) {
    // ArrowTool's composed `<g data-type="arrow">` — endpoints +
    // per-end shape attrs in `data-*` form, so the shared OOXML
    // builder can emit the matching preset.
    //
    // `getEffectiveLineEndpoints` returns endpoints (and the
    // optional Bezier control point) in world space, with any
    // pending `data-tx` / `data-ty` translation + `data-rot` /
    // `data-flip-*` orientation already baked in. For line-like
    // shapes the OOXML side reads orientation from the endpoints
    // themselves (flipH = `x2 < x1` etc), so we explicitly DROP
    // `rotation_deg` / `flip_h` / `flip_v` from the xform partial
    // — keeping them would double-apply.
    const ep = getEffectiveLineEndpoints(el);
    const startShape = el.getAttribute("data-arrow-start-shape");
    const endShape = el.getAttribute("data-arrow-end-shape");
    const headStart = startShape != null && startShape !== "none";
    const headEnd = endShape != null && endShape !== "none";
    const { rotation_deg: _r, flip_h: _fh, flip_v: _fv, ...lineXform } = xform;
    return {
      type: headEnd || headStart ? "arrow" : "line",
      x1: ep.x1,
      y1: ep.y1,
      x2: ep.x2,
      y2: ep.y2,
      arrow_curve_cx: ep.cx ?? undefined,
      arrow_curve_cy: ep.cy ?? undefined,
      stroke: el.getAttribute("stroke") || "#ff0000",
      stroke_width: Number.parseFloat(el.getAttribute("stroke-width") || "3"),
      stroke_dasharray: el.getAttribute("stroke-dasharray") || "",
      has_arrow: headEnd,
      arrow_head_start: headStart,
      arrow_head_end: headEnd,
      ...lineXform,
    };
  }

  if (tag === "rect") {
    // Rect covers three product-level cases:
    //   1. Shape "rect"     → type="rect", corner_radius=0
    //   2. Shape "rounded"  → type="rect", corner_radius=rx
    //   3. Redact "solid"   → type="rect", redact_style="solid"
    // The Rust side branches on `corner_radius > 0` for the
    // `roundRect` preset and on `redact_style` for the no-outline
    // bar — one type string is enough.
    const rx = Number.parseFloat(el.getAttribute("rx") || "0");
    const isRedactSolid = el.getAttribute("data-redact-style") === "solid";
    return {
      type: "rect",
      x: Number.parseFloat(el.getAttribute("x") || "0") + tx,
      y: Number.parseFloat(el.getAttribute("y") || "0") + ty,
      width: Number.parseFloat(el.getAttribute("width") || "0"),
      height: Number.parseFloat(el.getAttribute("height") || "0"),
      stroke: el.getAttribute("stroke") || "none",
      stroke_width: Number.parseFloat(el.getAttribute("stroke-width") || "0"),
      stroke_dasharray: el.getAttribute("stroke-dasharray") || "",
      fill: el.getAttribute("fill") || "none",
      fill_opacity: Number.parseFloat(el.getAttribute("fill-opacity") || "1"),
      corner_radius: rx,
      redact_style: isRedactSolid ? "solid" : undefined,
      ...xform,
    };
  }

  if (tag === "ellipse") {
    return {
      type: "ellipse",
      cx: Number.parseFloat(el.getAttribute("cx") || "0") + tx,
      cy: Number.parseFloat(el.getAttribute("cy") || "0") + ty,
      rx: Number.parseFloat(el.getAttribute("rx") || "0"),
      ry: Number.parseFloat(el.getAttribute("ry") || "0"),
      stroke: el.getAttribute("stroke") || "#ff0000",
      stroke_width: Number.parseFloat(el.getAttribute("stroke-width") || "3"),
      stroke_dasharray: el.getAttribute("stroke-dasharray") || "",
      fill: el.getAttribute("fill") || "none",
      fill_opacity: Number.parseFloat(el.getAttribute("fill-opacity") || "1"),
      ...xform,
    };
  }

  if (tag === "image") {
    // Redact image — mosaic or blur. Both carry a baked-in PNG in
    // `image_data_url`. The `redact_style` discriminator lets the
    // desktop side pick a different Office picture-effect preset
    // per variant if it wants to.
    const style = el.getAttribute("data-redact-style") as "mosaic" | "blur" | null;
    const href = el.getAttribute("href") || "";
    return {
      type: style === "blur" ? "blur_image" : "mosaic_image",
      x: Number.parseFloat(el.getAttribute("x") || "0") + tx,
      y: Number.parseFloat(el.getAttribute("y") || "0") + ty,
      width: Number.parseFloat(el.getAttribute("width") || "0"),
      height: Number.parseFloat(el.getAttribute("height") || "0"),
      image_data_url: href,
      redact_style: style || "mosaic",
      ...xform,
    };
  }

  if (tag === "path") {
    // Freehand — pen or highlighter. The semi-transparent
    // highlighter alpha rides on `stroke_opacity_value`, populated
    // by `transformOf` above. `path_d` carries the SVG path
    // d-string.
    const drawStyle =
      (el.getAttribute("data-draw-style") as "pen" | "highlighter" | null) ||
      (Number.parseFloat(el.getAttribute("stroke-opacity") || "1") < 0.99 ? "highlighter" : "pen");
    return {
      type: "freehand",
      path_d: el.getAttribute("d") || "",
      stroke: el.getAttribute("stroke") || "#ff0000",
      stroke_width: Number.parseFloat(el.getAttribute("stroke-width") || "3"),
      stroke_dasharray: el.getAttribute("stroke-dasharray") || "",
      draw_style: drawStyle,
      ...xform,
    };
  }

  if (tag === "text") {
    const body = el.textContent || "";
    return {
      type: "text",
      x: Number.parseFloat(el.getAttribute("x") || "0") + tx,
      y: Number.parseFloat(el.getAttribute("y") || "0") + ty,
      runs: body ? [{ text: body }] : [],
      font_size: Number.parseFloat(el.getAttribute("font-size") || "24"),
      font_family: el.getAttribute("font-family") || undefined,
      fill: el.getAttribute("fill") || "#ff0000",
      shape_kind: "plain",
      ...xform,
    };
  }

  if (tag === "g") {
    if (el.getAttribute("data-type") === "shape") {
      // Unified text-bearing shape — plain / sticky / callout
      // (and, in Phase 3, rect / rounded / ellipse for
      // text-on-shape). All variants share the same `<g>`
      // skeleton with a `<rect>` + optional `<path>` tail;
      // `data-shape-kind` is the discriminator for OOXML.
      const shapeKind = el.getAttribute("data-shape-kind") as AnnotationShape["shape_kind"] | null;
      if (!shapeKind) return null;
      const textEl = el.querySelector("text");
      const bgRect = el.querySelector("rect");
      if (!textEl) return null;
      const tspans = Array.from(textEl.querySelectorAll("tspan"));
      const runs: TextRun[] = [];
      if (tspans.length === 0) {
        const body = textEl.textContent || "";
        if (body) runs.push({ text: body });
      } else {
        for (let i = 0; i < tspans.length; i++) {
          const tspan = tspans[i]!;
          const run: TextRun = { text: tspan.textContent ?? "" };
          const fw = tspan.getAttribute("font-weight");
          if (fw === "bold" || fw === "700") run.bold = true;
          const fs = tspan.getAttribute("font-style");
          if (fs === "italic") run.italic = true;
          const td = tspan.getAttribute("text-decoration");
          if (td?.includes("underline")) run.underline = true;
          const sz = tspan.getAttribute("font-size");
          if (sz) {
            const n = Number.parseFloat(sz);
            if (Number.isFinite(n)) run.font_size = n;
          }
          const ff = tspan.getAttribute("font-family");
          if (ff) run.font_family = ff;
          const fill = tspan.getAttribute("fill");
          if (fill) run.color = fill;
          // `line_break_after` flips on whenever the next tspan
          // starts a new line (has its own x or y). Phase 1 emits
          // one tspan per line so every successor qualifies; Phase
          // 2's rich-text mapper packs styled runs into
          // continuation tspans (no x / y) without changing this
          // reader.
          const next = tspans[i + 1];
          if (next != null && (next.hasAttribute("x") || next.hasAttribute("y"))) {
            run.line_break_after = true;
          }
          runs.push(run);
        }
      }
      const bx =
        Number.parseFloat(bgRect?.getAttribute("x") || tspans[0]?.getAttribute("x") || "0") + tx;
      const by = Number.parseFloat(bgRect?.getAttribute("y") || "0") + ty;
      const bw = Number.parseFloat(bgRect?.getAttribute("width") || "200");
      const bh = Number.parseFloat(bgRect?.getAttribute("height") || "40");
      const tailXRaw = el.getAttribute("data-tail-x");
      const tailYRaw = el.getAttribute("data-tail-y");
      // Text-on-shape wrappers (rect / rounded / ellipse — see
      // `isTextOnShape`) carry the user's drawn geometry primitive;
      // preserve its stroke so the OOXML output matches what Annot
      // displays. Auto-bg variants (plain / sticky / callout) keep
      // the builder's hardcoded light-gray border — that's their
      // identity in PowerPoint and changing it would regress the
      // existing snapshot fixtures.
      const isTextOnShapeWrapper =
        shapeKind === "rect" || shapeKind === "rounded" || shapeKind === "ellipse";
      const bgStroke = bgRect?.getAttribute("stroke");
      const bgStrokeWidth = bgRect?.getAttribute("stroke-width");
      const bgStrokeDasharray = bgRect?.getAttribute("stroke-dasharray");
      const textAnchor = el.getAttribute("data-text-anchor") as
        | "start"
        | "middle"
        | "end"
        | null;
      const textVerticalAnchor = el.getAttribute("data-text-vanchor") as
        | "top"
        | "middle"
        | "bottom"
        | null;
      return {
        type: "text",
        x: bx,
        y: by,
        width: bw,
        height: bh,
        runs,
        font_size: Number.parseFloat(
          textEl.getAttribute("font-size") || el.getAttribute("data-font-size") || "24",
        ),
        font_family:
          textEl.getAttribute("font-family") || el.getAttribute("data-font-family") || undefined,
        fill: textEl.getAttribute("fill") || el.getAttribute("data-color") || "#ff0000",
        text_bg_color: shapeKind === "plain" ? undefined : bgRect?.getAttribute("fill") || "",
        shape_kind: shapeKind,
        // Text-on-shape: pass the geometry primitive's actual
        // stroke so the OOXML side's `<a:ln>` matches what the
        // user drew.
        ...(isTextOnShapeWrapper && bgStroke ? { stroke: bgStroke } : {}),
        ...(isTextOnShapeWrapper && bgStrokeWidth
          ? { stroke_width: Number.parseFloat(bgStrokeWidth) }
          : {}),
        ...(isTextOnShapeWrapper && bgStrokeDasharray
          ? { stroke_dasharray: bgStrokeDasharray }
          : {}),
        ...(textAnchor ? { text_anchor: textAnchor } : {}),
        ...(textVerticalAnchor ? { text_vertical_anchor: textVerticalAnchor } : {}),
        tail_x: tailXRaw != null ? Number.parseFloat(tailXRaw) + tx : undefined,
        tail_y: tailYRaw != null ? Number.parseFloat(tailYRaw) + ty : undefined,
        ...xform,
      };
    }

    // Marker / Counter — circle or rect background with a numbered
    // label. The outer `<g>`'s translate() (from user drags) is
    // baked into the resulting (cx, cy) so the Office shape lands
    // at the user-visible position, not the initial drawing
    // coordinate.
    const bgCircle = el.querySelector("circle");
    const bgRect = el.querySelector("rect");
    const bgEl = bgCircle || bgRect;
    if (!bgEl) return null;

    // `data-shape` on the outer `<g>` is the authoritative shape
    // flag (written by MarkerTool): `circle` | `rect` | `rounded`.
    // Falls back to bg `tagName` for legacy content missing the
    // data attr.
    const dataShape = el.getAttribute("data-shape");
    const shapeName: "circle" | "rect" | "rounded" =
      dataShape === "rounded"
        ? "rounded"
        : dataShape === "rect"
          ? "rect"
          : dataShape === "circle"
            ? "circle"
            : bgRect && !bgCircle
              ? "rect"
              : "circle";
    const isRectLike = shapeName === "rect" || shapeName === "rounded";
    let mcx: number;
    let mcy: number;
    if (isRectLike) {
      const rx = Number.parseFloat(bgRect!.getAttribute("x") || "0");
      const ry = Number.parseFloat(bgRect!.getAttribute("y") || "0");
      const rw = Number.parseFloat(bgRect!.getAttribute("width") || "0");
      const rh = Number.parseFloat(bgRect!.getAttribute("height") || "0");
      mcx = rx + rw / 2;
      mcy = ry + rh / 2;
    } else {
      mcx = Number.parseFloat(bgCircle!.getAttribute("cx") || "0");
      mcy = Number.parseFloat(bgCircle!.getAttribute("cy") || "0");
    }
    const textEl = el.querySelector("text");
    const fs = Number.parseFloat(textEl?.getAttribute("font-size") || "13");
    return {
      type: "marker",
      cx: mcx + tx,
      cy: mcy + ty,
      fill: bgEl.getAttribute("fill") || "#ff0000",
      label: textEl?.textContent || "",
      font_size: fs,
      marker_shape: shapeName,
      ...xform,
    };
  }

  return null;
}

/**
 * Convert all top-level annotation elements under
 * `annotationsParent` into `AnnotationShape[]`, skipping any node
 * that doesn't map to a recognised emitter.
 */
export function svgAnnotationsToShapes(annotationsParent: {
  childNodes: ArrayLike<Node>;
}): AnnotationShape[] {
  const out: AnnotationShape[] = [];
  for (const node of Array.from(annotationsParent.childNodes)) {
    if (!isElement(node)) continue;
    const shape = svgElementToAnnotationShape(node as SVGElement);
    if (shape) out.push(shape);
  }
  return out;
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}
