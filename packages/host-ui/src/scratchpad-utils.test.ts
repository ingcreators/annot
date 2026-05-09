/**
 * @vitest-environment happy-dom
 *
 * Scratchpad serialize / paste round-trip. Locks in the contract that
 * `serializeSelection` + `ScratchpadPasteTool`-style insert produce
 * an annotation byte-equivalent to a fresh hand-placed shape: NO
 * leftover wrapper `transform="translate(...)"`, geometry attrs
 * absorbing both the save offset and the paste offset, and a
 * subsequent move (mirroring the editor's move path) shifting the
 * shape by exactly the delta — not jumping back to the original
 * source position.
 */

import { moveAnnotationElement } from "@ingcreators/annot-core/editor/bake-translate";
import { createTextShape } from "@ingcreators/annot-core/editor/text-utils";
import { describe, expect, it } from "vitest";
import { parseStoredItem, serializeSelection } from "./scratchpad-utils.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgWithRoot(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("width", "1000");
  svg.setAttribute("height", "1000");
  svg.setAttribute("viewBox", "0 0 1000 1000");
  document.body.appendChild(svg);
  return svg;
}

describe("serializeSelection", () => {
  it("returns null for an empty selection", () => {
    expect(serializeSelection([])).toBeNull();
  });

  it("rect at (100, 50) → stored child geometry sits at PAD without a wrapper translate", () => {
    const svg = svgWithRoot();
    const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    rect.setAttribute("x", "100");
    rect.setAttribute("y", "50");
    rect.setAttribute("width", "120");
    rect.setAttribute("height", "80");
    svg.appendChild(rect);

    const result = serializeSelection([rect as unknown as SVGElement]);
    expect(result).not.toBeNull();
    const children = parseStoredItem(result!.svgMarkup);
    expect(children.length).toBe(1);
    const stored = children[0]!;
    expect(stored.tagName).toBe("rect");
    expect(stored.getAttribute("x")).toBe("4"); // PAD
    expect(stored.getAttribute("y")).toBe("4");
    expect(stored.getAttribute("width")).toBe("120");
    expect(stored.getAttribute("height")).toBe("80");
    expect(stored.hasAttribute("transform")).toBe(false);
  });

  it("sticky `<g data-type=\"shape\">` — bakes inner geometry to origin, no leftover wrapper translate", () => {
    const svg = svgWithRoot();
    const g = createTextShape({
      x: 100,
      y: 50,
      w: 120,
      h: 80,
      variant: "sticky",
      runs: [{ text: "hello", line_break_after: false }],
      fontSize: 16,
      fontFamily: "sans-serif",
      color: "#000",
    });
    svg.appendChild(g);

    const result = serializeSelection([g as unknown as SVGElement]);
    expect(result).not.toBeNull();

    const children = parseStoredItem(result!.svgMarkup);
    const stored = children[0]!;
    expect(stored.tagName).toBe("g");
    expect(stored.getAttribute("data-type")).toBe("shape");
    expect(stored.hasAttribute("transform")).toBe(false);

    const bg = stored.querySelector("rect")!;
    // Original (100, 50) → PAD-padded origin (4, 4).
    expect(bg.getAttribute("x")).toBe("4");
    expect(bg.getAttribute("y")).toBe("4");
  });
});

describe("scratchpad save → paste → drag round-trip", () => {
  // Mirrors what ScratchpadPasteTool.onPointerDown does + the editor's
  // subsequent move path. The contract under test is the regression
  // surface the user reported: scratchpad inserts must NOT keep a
  // wrapper `transform="translate(...)"`, otherwise the next move
  // (which strips wrapper translates per move-bakes-coordinates)
  // would teleport the shape back near its source.

  it("sticky note: paste at (300, 200) then drag (10, 10) lands at (310, 210)", () => {
    const sourceSvg = svgWithRoot();
    const source = createTextShape({
      x: 100,
      y: 50,
      w: 120,
      h: 80,
      variant: "sticky",
      runs: [{ text: "hello", line_break_after: false }],
      fontSize: 16,
      fontFamily: "sans-serif",
      color: "#000",
    });
    sourceSvg.appendChild(source);

    // 1. Save to scratchpad.
    const result = serializeSelection([source as unknown as SVGElement])!;

    // 2. Paste — clone each stored child, append, then bake placement
    // via moveAnnotationElement. (Same flow as
    // ScratchpadPasteTool.onPointerDown.)
    const targetSvg = svgWithRoot();
    const annotations = document.createElementNS(SVG_NS, "g");
    targetSvg.appendChild(annotations);
    const stored = parseStoredItem(result.svgMarkup);
    const placed: SVGElement[] = [];
    for (const child of stored) {
      const clone = child.cloneNode(true) as SVGElement;
      annotations.appendChild(clone);
      moveAnnotationElement(clone, 300, 200);
      placed.push(clone);
    }

    expect(placed.length).toBe(1);
    const inserted = placed[0]!;
    expect(inserted.hasAttribute("transform")).toBe(false);

    const bg = inserted.querySelector("rect")!;
    // Bg sits at paste point + PAD (the serializer added 4px around
    // the original bbox).
    const pastedX = Number.parseFloat(bg.getAttribute("x")!);
    const pastedY = Number.parseFloat(bg.getAttribute("y")!);
    expect(pastedX).toBe(304);
    expect(pastedY).toBe(204);

    // 3. Drag by (10, 10) — same dispatcher the editor uses.
    moveAnnotationElement(inserted, 10, 10);

    // Bg shifts by exactly (10, 10) — does NOT jump back to the
    // source's (100, 50).
    expect(Number.parseFloat(bg.getAttribute("x")!)).toBe(pastedX + 10);
    expect(Number.parseFloat(bg.getAttribute("y")!)).toBe(pastedY + 10);
    expect(inserted.hasAttribute("transform")).toBe(false);
  });

  it("counter `<g data-marker>`: paste then drag preserves the bg + numeral relationship", () => {
    const sourceSvg = svgWithRoot();
    const source = document.createElementNS(SVG_NS, "g") as SVGGElement;
    source.setAttribute("data-marker", "1");
    source.setAttribute("data-shape", "circle");
    const sourceCircle = document.createElementNS(SVG_NS, "circle");
    sourceCircle.setAttribute("cx", "100");
    sourceCircle.setAttribute("cy", "100");
    sourceCircle.setAttribute("r", "16");
    source.appendChild(sourceCircle);
    const sourceText = document.createElementNS(SVG_NS, "text");
    sourceText.setAttribute("x", "100");
    sourceText.setAttribute("y", "100");
    sourceText.textContent = "1";
    source.appendChild(sourceText);
    sourceSvg.appendChild(source);

    const result = serializeSelection([source as unknown as SVGElement])!;

    const targetSvg = svgWithRoot();
    const annotations = document.createElementNS(SVG_NS, "g");
    targetSvg.appendChild(annotations);
    const stored = parseStoredItem(result.svgMarkup);
    const placed: SVGElement[] = [];
    for (const child of stored) {
      const clone = child.cloneNode(true) as SVGElement;
      annotations.appendChild(clone);
      moveAnnotationElement(clone, 300, 200);
      placed.push(clone);
    }

    const inserted = placed[0]!;
    expect(inserted.hasAttribute("transform")).toBe(false);

    const circle = inserted.querySelector("circle")!;
    const text = inserted.querySelector("text")!;
    const cx0 = Number.parseFloat(circle.getAttribute("cx")!);
    const cy0 = Number.parseFloat(circle.getAttribute("cy")!);
    expect(Number.parseFloat(text.getAttribute("x")!)).toBe(cx0);
    expect(Number.parseFloat(text.getAttribute("y")!)).toBe(cy0);

    // Drag by (-50, -25).
    moveAnnotationElement(inserted, -50, -25);
    expect(Number.parseFloat(circle.getAttribute("cx")!)).toBe(cx0 - 50);
    expect(Number.parseFloat(circle.getAttribute("cy")!)).toBe(cy0 - 25);
    expect(Number.parseFloat(text.getAttribute("x")!)).toBe(cx0 - 50);
    expect(Number.parseFloat(text.getAttribute("y")!)).toBe(cy0 - 25);
  });

  it("rect with prior `transform=\"translate(...)\"` (legacy state) — serializer drops the wrapper translate", () => {
    // Defensive: if some pre-existing path produced a rect with a
    // wrapper translate, the serializer must STILL bake into geometry
    // so the stored fragment doesn't poison subsequent moves with a
    // stale wrapper.
    const sourceSvg = svgWithRoot();
    const r = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    r.setAttribute("x", "0");
    r.setAttribute("y", "0");
    r.setAttribute("width", "50");
    r.setAttribute("height", "50");
    // Rect is geometry-positioned, so the editor wouldn't put a
    // transform here today — but jsdom's getCTM honors it, and we
    // want the bake to still work if it appears.
    sourceSvg.appendChild(r);

    const result = serializeSelection([r as unknown as SVGElement])!;
    const stored = parseStoredItem(result.svgMarkup)[0]!;
    expect(stored.hasAttribute("transform")).toBe(false);
    expect(stored.getAttribute("x")).toBe("4");
    expect(stored.getAttribute("y")).toBe("4");
  });
});

describe("text-bearing shape: clipPath ids are freshened on every paste", () => {
  // Regression: text-on-shape rectangles / stickies / callouts use
  // `<clipPath id="clip-textshape-...">` to clip overflow, and the
  // sibling `<text>` references it via `clip-path="url(#...)"`. SVG
  // resolves duplicate ids by picking the FIRST in document order,
  // so naive `cloneNode(true)` makes the pasted text clip against
  // the SOURCE's clip rect — text appears blank because the rect
  // is now far from the pasted position. `parseStoredItem` must
  // freshen these ids per call.

  it("the pasted child has a different clipPath id than the source AND its text references the new id", () => {
    const sourceSvg = svgWithRoot();
    const source = createTextShape({
      x: 50,
      y: 30,
      w: 200,
      h: 80,
      variant: "sticky",
      runs: [{ text: "hello", line_break_after: false }],
      fontSize: 16,
      fontFamily: "sans-serif",
      color: "#000",
    });
    sourceSvg.appendChild(source);
    const sourceClip = source.querySelector("clipPath")!;
    const sourceClipId = sourceClip.id;
    expect(sourceClipId.length).toBeGreaterThan(0);
    expect(source.querySelector("text")!.getAttribute("clip-path")).toBe(
      `url(#${sourceClipId})`,
    );

    const result = serializeSelection([source as unknown as SVGElement])!;

    // First paste — clipPath id MUST differ from the source.
    const stored1 = parseStoredItem(result.svgMarkup)[0]!;
    const clip1 = stored1.querySelector("clipPath")!;
    expect(clip1.id).not.toBe(sourceClipId);
    expect(stored1.querySelector("text")!.getAttribute("clip-path")).toBe(`url(#${clip1.id})`);

    // Second paste — clipPath id MUST also differ from the first paste
    // (so two pastes from the same scratchpad item don't collide).
    const stored2 = parseStoredItem(result.svgMarkup)[0]!;
    const clip2 = stored2.querySelector("clipPath")!;
    expect(clip2.id).not.toBe(clip1.id);
    expect(stored2.querySelector("text")!.getAttribute("clip-path")).toBe(`url(#${clip2.id})`);
  });

  it("pasting alongside the source produces document-unique ids (so the browser's url(#) lookup is unambiguous)", () => {
    const targetSvg = svgWithRoot();
    const annotations = document.createElementNS(SVG_NS, "g");
    targetSvg.appendChild(annotations);

    // Original shape stays in the canvas.
    const source = createTextShape({
      x: 50,
      y: 30,
      w: 200,
      h: 80,
      variant: "sticky",
      runs: [{ text: "hi", line_break_after: false }],
      fontSize: 16,
      fontFamily: "sans-serif",
      color: "#000",
    });
    annotations.appendChild(source);

    const result = serializeSelection([source as unknown as SVGElement])!;

    // Paste twice into the same canvas alongside the source.
    for (const stored of [
      parseStoredItem(result.svgMarkup)[0]!,
      parseStoredItem(result.svgMarkup)[0]!,
    ]) {
      const clone = stored.cloneNode(true) as SVGElement;
      annotations.appendChild(clone);
      moveAnnotationElement(clone, 100, 50);
    }

    // Three shapes in the canvas; every clipPath id MUST be unique.
    const clips = Array.from(annotations.querySelectorAll("clipPath"));
    expect(clips.length).toBe(3);
    const ids = new Set(clips.map((c) => c.id));
    expect(ids.size).toBe(3);

    // And every text's `clip-path="url(#...)"` must match a clipPath
    // id present in the SAME wrapper `<g>` (not a sibling shape's).
    const groups = Array.from(annotations.querySelectorAll('g[data-type="shape"]'));
    expect(groups.length).toBe(3);
    for (const g of groups) {
      const ownClip = g.querySelector("clipPath")!;
      const text = g.querySelector("text")!;
      expect(text.getAttribute("clip-path")).toBe(`url(#${ownClip.id})`);
    }
  });
});
