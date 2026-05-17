// @vitest-environment happy-dom
//
// Reproduce the Phase 3 pull-pass flap: a freshly-generated card
// document from a gallery image should compare as "in sync" with
// the originating ImageRecord. If the comparison flags it as
// out-of-sync, every doc-open re-embeds and toasts ("Image X
// updated from gallery"), which is the bug the user reported.

import type { ImageRecord } from "@ingcreators/annot-core/storage";
import { parseDocument, serializeDocument } from "@ingcreators/annot-doc";
import { describe, expect, it } from "vitest";
import { annotationChildrenEqual } from "./build-block-svg.js";
import { decomposeBlockSvg } from "./decompose-block-svg.js";
import { createCardDocumentFromImages } from "./gallery/create-card-document.js";

const PNG_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function makeImage(annotationsSvg: string, width = 800, height = 480): ImageRecord {
  return {
    path: "Screenshots/test.png",
    folderPath: "",
    originalDataUrl: PNG_PIXEL,
    thumbnailDataUrl: "",
    annotationsSvg,
    width,
    height,
    sourceUrl: "",
    tags: {},
    createdAt: "2026-05-11T00:00:00Z",
    updatedAt: "2026-05-11T00:00:00Z",
  };
}

describe("round-trip flap: generator → parse → decompose vs original ImageRecord", () => {
  it("an unannotated image: decompose's parts match the ImageRecord (no flap)", () => {
    const img = makeImage("");
    const doc = createCardDocumentFromImages([img], { title: "X" });
    const bytes = serializeDocument(doc);
    const reparsed = parseDocument(bytes);
    const step = reparsed.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step");
    const parts = decomposeBlockSvg(step.svg);
    expect(parts.originalDataUrl).toBe(img.originalDataUrl);
    expect(parts.width).toBe(img.width);
    expect(parts.height).toBe(img.height);
    expect(annotationChildrenEqual(parts.annotationsSvg, img.annotationsSvg)).toBe(true);
  });

  it("an annotated image (editor-shaped annotationsSvg): no flap", () => {
    // Editor's exportAnnotationsSvgForIdb produces a FULL <svg>
    // with flat children — no `<g id="annotations">` wrapper.
    const annotationsSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 800 480" width="800" height="480">' +
      '<rect data-type="rect" x="10" y="10" width="100" height="50" fill="#ff0000"/>' +
      '<text data-type="text" x="50" y="100">hi</text>' +
      "</svg>";
    const img = makeImage(annotationsSvg);
    const doc = createCardDocumentFromImages([img], { title: "X" });
    const bytes = serializeDocument(doc);
    const reparsed = parseDocument(bytes);
    const step = reparsed.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step");
    const parts = decomposeBlockSvg(step.svg);
    expect(parts.originalDataUrl).toBe(img.originalDataUrl);
    expect(parts.width).toBe(img.width);
    expect(parts.height).toBe(img.height);
    expect(annotationChildrenEqual(parts.annotationsSvg, img.annotationsSvg)).toBe(true);
  });

  it("a redact-style annotation: no flap", () => {
    const annotationsSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 800 480" width="800" height="480">' +
      '<image data-redact-style="mosaic" href="data:image/png;base64,MOSAIC" x="100" y="100" width="200" height="100"/>' +
      "</svg>";
    const img = makeImage(annotationsSvg);
    const doc = createCardDocumentFromImages([img], { title: "X" });
    const bytes = serializeDocument(doc);
    const reparsed = parseDocument(bytes);
    const step = reparsed.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step");
    const parts = decomposeBlockSvg(step.svg);
    expect(parts.originalDataUrl).toBe(img.originalDataUrl);
    expect(annotationChildrenEqual(parts.annotationsSvg, img.annotationsSvg)).toBe(true);
  });

  // This is the user-reported scenario: an annotation with a
  // gradient stroke / fill (or any annotation that has a
  // sibling <defs> in the editor canvas). The doc generator's
  // `normaliseAnnotationsFragment` used to strip ALL <defs>;
  // now it preserves them so url(#…) refs still resolve. The
  // pull-pass comparison ignores <defs> on both sides, so this
  // case stays flap-free.
  it("annotation with <defs> (gradient / marker): no flap AND defs preserved in embed", () => {
    const annotationsSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 800 480" width="800" height="480">' +
      "<defs>" +
      '<linearGradient id="grad-stroke-1" x1="0" y1="0.5" x2="1" y2="0.5">' +
      '<stop offset="0" stop-color="#ff0000"/>' +
      '<stop offset="1" stop-color="#0000ff"/>' +
      "</linearGradient>" +
      "</defs>" +
      '<rect data-type="rect" x="10" y="10" width="100" height="50" stroke="url(#grad-stroke-1)"/>' +
      "</svg>";
    const img = makeImage(annotationsSvg);
    const doc = createCardDocumentFromImages([img], { title: "X" });
    const bytes = serializeDocument(doc);
    // Gradient defs and the matching url() ref both survive
    // the parse / serialise round-trip — the in-doc renderer
    // can now resolve the gradient instead of falling back to
    // black stroke.
    expect(bytes).toContain('id="grad-stroke-1"');
    expect(bytes).toContain('stroke="url(#grad-stroke-1)"');
    const reparsed = parseDocument(bytes);
    const step = reparsed.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step");
    const parts = decomposeBlockSvg(step.svg);
    expect(parts.originalDataUrl).toBe(img.originalDataUrl);
    expect(annotationChildrenEqual(parts.annotationsSvg, img.annotationsSvg)).toBe(true);
  });

  // The gallery's annotationsSvg may carry `<defs>` that the doc
  // generator silently strips (`normaliseAnnotationsFragment`).
  // `annotationChildrenEqual` must filter `<defs>` from both
  // sides before comparing so the strip doesn't cause a forever-
  // flap on doc reopen.
  it("multiple annotations with shared <defs>: no flap", () => {
    const annotationsSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 800 480" width="800" height="480">' +
      "<defs>" +
      '<linearGradient id="grad-fill-1"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>' +
      '<marker id="arrow-1" viewBox="0 0 10 10" refX="5" refY="5"><path d="M0,0 L10,5 L0,10z"/></marker>' +
      "</defs>" +
      '<rect data-type="rect" x="10" y="10" width="100" height="50" fill="url(#grad-fill-1)"/>' +
      '<line data-type="line" x1="0" y1="0" x2="100" y2="0" marker-end="url(#arrow-1)"/>' +
      "</svg>";
    const img = makeImage(annotationsSvg);
    const doc = createCardDocumentFromImages([img], { title: "X" });
    const bytes = serializeDocument(doc);
    const reparsed = parseDocument(bytes);
    const step = reparsed.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step");
    const parts = decomposeBlockSvg(step.svg);
    expect(annotationChildrenEqual(parts.annotationsSvg, img.annotationsSvg)).toBe(true);
  });
});
