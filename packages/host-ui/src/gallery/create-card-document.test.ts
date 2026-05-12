// @vitest-environment happy-dom
//
// `createCardDocumentFromImages` tests — Phase 4 of
// `docs/plans/_done/card-procedure-template.md`. Pure / Tier B-ish:
// the function takes `ImageRecord[]` and an options bag, returns
// an `AnnotDocument`. happy-dom is needed because the round-trip
// assertion below calls `parseDocument` (which lazily resolves
// `globalThis.DOMParser`).

import type { ImageRecord } from "@ingcreators/annot-core/storage";
import { parseDocument, serializeDocument } from "@ingcreators/annot-doc";
import { describe, expect, it } from "vitest";
import { createCardDocumentFromImages } from "./create-card-document.js";

function makeImage(path: string, opts: Partial<ImageRecord> = {}): ImageRecord {
  return {
    path,
    folderPath: "",
    originalDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    thumbnailDataUrl: "data:image/png;base64,thumb",
    annotationsSvg: '<g id="annotations"/>',
    width: 800,
    height: 600,
    sourceUrl: "",
    tags: {},
    createdAt: "2026-05-11T00:00:00Z",
    updatedAt: "2026-05-11T00:00:00Z",
    ...opts,
  };
}

describe("createCardDocumentFromImages: basics", () => {
  it("returns one step block per input image, in input order", () => {
    const images = [makeImage("a.png"), makeImage("b.png"), makeImage("c.png")];
    const doc = createCardDocumentFromImages(images, { title: "Procedure" });
    expect(doc.blocks.length).toBe(3);
    for (const block of doc.blocks) {
      expect(block.kind).toBe("step");
    }
  });

  it("uses title verbatim, falling back to 'Untitled' on empty", () => {
    const doc = createCardDocumentFromImages([makeImage("a.png")], { title: "  My doc  " });
    expect(doc.title).toBe("My doc");
    expect(doc.meta.title).toBe("My doc");
    const empty = createCardDocumentFromImages([makeImage("a.png")], { title: "" });
    expect(empty.title).toBe("Untitled");
  });

  // Phase 4 of `docs/plans/card-step-auto-numbering.md` — step
  // titles are empty by default. The auto-numbering badge
  // carries the step index; users author the editorial title
  // themselves.
  it("emits empty step titles by default (auto-numbering carries the index)", () => {
    const doc = createCardDocumentFromImages([makeImage("a.png"), makeImage("b.png")], {
      title: "X",
    });
    const titles = doc.blocks.map((b) => (b.kind === "step" ? b.title : ""));
    expect(titles).toEqual(["", ""]);
  });

  it("opts new card documents into step numbering via meta.numbering.steps", () => {
    const doc = createCardDocumentFromImages([makeImage("a.png")], { title: "X" });
    expect(doc.meta.numbering?.steps).toBe(true);
    // No stepLabel — the badge renders the bare numeral by default.
    expect(doc.meta.numbering?.stepLabel).toBeUndefined();
  });

  it("stamps the chosen layout on every step + as the doc default when non-default", () => {
    const doc = createCardDocumentFromImages([makeImage("a.png"), makeImage("b.png")], {
      title: "X",
      layout: "image-left",
    });
    for (const b of doc.blocks) {
      if (b.kind === "step") expect(b.layout).toBe("image-left");
    }
    expect(doc.meta.cardLayout?.defaultStepLayout).toBe("image-left");
  });

  it("leaves cardLayout.defaultStepLayout absent when the layout is image-top (the implicit default)", () => {
    const doc = createCardDocumentFromImages([makeImage("a.png")], {
      title: "X",
      layout: "image-top",
    });
    expect(doc.meta.cardLayout?.defaultStepLayout).toBeUndefined();
    // cardLayout itself is absent because both nested settings
    // are at their implicit defaults.
    expect(doc.meta.cardLayout).toBeUndefined();
  });

  it("emits cardLayout.columns when set to 2 / 3 / auto", () => {
    for (const cols of [2, 3, "auto"] as const) {
      const doc = createCardDocumentFromImages([makeImage("a.png")], {
        title: "X",
        columns: cols,
      });
      expect(doc.meta.cardLayout?.columns).toBe(cols);
    }
  });

  it("leaves cardLayout absent when columns: 1 + layout: image-top", () => {
    const doc = createCardDocumentFromImages([makeImage("a.png")], {
      title: "X",
      columns: 1,
      layout: "image-top",
    });
    expect(doc.meta.cardLayout).toBeUndefined();
  });
});

describe("createCardDocumentFromImages: SVG body", () => {
  it("wraps the source image's bytes in a self-contained <svg> with viewBox = image dims", () => {
    const images = [
      makeImage("a.png", { width: 1280, height: 720, originalDataUrl: "data:image/png;base64,A" }),
    ];
    const doc = createCardDocumentFromImages(images, { title: "X" });
    const step = doc.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step");
    expect(step.svg).toContain('viewBox="0 0 1280 720"');
    expect(step.svg).toContain('width="1280"');
    expect(step.svg).toContain('height="720"');
    expect(step.svg).toContain('href="data:image/png;base64,A"');
    // The image's annotationsSvg is passed through verbatim — the
    // default fixture uses the self-closing form, so the
    // generator emits the same.
    expect(step.svg).toContain('<g id="annotations"/>');
  });

  it("preserves the image's existing annotationsSvg fragment", () => {
    const images = [
      makeImage("a.png", {
        annotationsSvg: '<g id="annotations"><rect x="5" y="5" width="20" height="20"/></g>',
      }),
    ];
    const doc = createCardDocumentFromImages(images, { title: "X" });
    const step = doc.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step");
    expect(step.svg).toContain('<rect x="5" y="5" width="20" height="20"/>');
  });

  // Phase 7d-polish: `img.annotationsSvg` produced by the editor's
  // `exportAnnotationsSVGString` is a FULL `<svg>...</svg>` document
  // with flattened annotation children (no `<g id="annotations">`
  // wrapper). The generator must extract the children and re-wrap
  // them — otherwise the step SVG gets a NESTED `<svg>` inside,
  // breaking PPTX annotation export and giving annotated cards a
  // structurally different shape from unannotated ones.
  it("extracts children from a full-svg annotationsSvg (flat form)", () => {
    const flatSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" width="1000" height="600">' +
      '<rect data-type="rect" x="10" y="10" width="100" height="50" fill="#ff0000"/>' +
      '<text data-type="text" x="50" y="100">hi</text>' +
      "</svg>";
    const images = [makeImage("a.png", { annotationsSvg: flatSvg, width: 1000, height: 600 })];
    const doc = createCardDocumentFromImages(images, { title: "X" });
    const step = doc.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step");
    // No nested <svg> inside the outer step SVG.
    expect(step.svg.match(/<svg /g)?.length).toBe(1);
    // Annotations end up inside a fresh <g id="annotations">.
    expect(step.svg).toContain('<g id="annotations">');
    expect(step.svg).toContain('data-type="rect"');
    expect(step.svg).toContain('data-type="text"');
  });

  it("skips defs, base image, and ui-overlay when extracting flat annotations", () => {
    const flatSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" width="1000" height="600">' +
      "<defs><style>.foo {}</style></defs>" +
      '<image href="data:image/png;base64,X" width="1000" height="600"/>' +
      '<rect data-type="rect" x="10" y="10" width="100" height="50"/>' +
      '<g id="ui-overlay"><circle cx="0" cy="0" r="5"/></g>' +
      "</svg>";
    const images = [makeImage("a.png", { annotationsSvg: flatSvg })];
    const doc = createCardDocumentFromImages(images, { title: "X" });
    const step = doc.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step");
    // The base image is the OUTER svg's image (from the generator),
    // not the one from annotationsSvg. The defs / ui-overlay /
    // duplicate image are stripped.
    const innerImageCount = step.svg.match(/<image /g)?.length ?? 0;
    expect(innerImageCount).toBe(1);
    expect(step.svg).not.toContain("<defs");
    expect(step.svg).not.toContain('id="ui-overlay"');
    // The actual annotation survives.
    expect(step.svg).toContain('data-type="rect"');
  });

  it("preserves mosaic / blur redact <image data-redact-style> as annotations", () => {
    const flatSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" width="1000" height="600">' +
      '<image href="data:image/png;base64,SOURCE" width="1000" height="600"/>' +
      '<image data-redact-style="mosaic" href="data:image/png;base64,MOSAIC" x="100" y="100" width="200" height="100"/>' +
      "</svg>";
    const images = [makeImage("a.png", { annotationsSvg: flatSvg })];
    const doc = createCardDocumentFromImages(images, { title: "X" });
    const step = doc.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step");
    expect(step.svg).toContain('data-redact-style="mosaic"');
    expect(step.svg).toContain("MOSAIC");
  });

  it('falls back to empty <g id="annotations"> on unparseable input', () => {
    const images = [makeImage("a.png", { annotationsSvg: "<<<not xml" })];
    const doc = createCardDocumentFromImages(images, { title: "X" });
    const step = doc.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step");
    expect(step.svg).toContain('<g id="annotations"></g>');
  });

  it("annotated and unannotated cards have structurally identical outer SVGs (Phase 7d-polish)", () => {
    // The user-reported bug: a card with annotations had a
    // different pan range / starting position from a card
    // without, because the annotated version embedded a NESTED
    // <svg>. Verify the outer SVG's structural shape (viewBox,
    // width, height, top-level child count) is identical now.
    const unannotated = makeImage("u.png", {
      width: 1000,
      height: 600,
      annotationsSvg: "",
    });
    const annotated = makeImage("a.png", {
      width: 1000,
      height: 600,
      annotationsSvg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" width="1000" height="600">' +
        '<rect data-type="rect" x="10" y="10" width="100" height="50"/></svg>',
    });
    const doc = createCardDocumentFromImages([unannotated, annotated], { title: "X" });
    const a = doc.blocks[0]?.kind === "step" ? doc.blocks[0].svg : "";
    const b = doc.blocks[1]?.kind === "step" ? doc.blocks[1].svg : "";
    // Both start with the same outer-svg opening tag.
    const openTag =
      '<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 1000 600" width="1000" height="600">';
    expect(a.startsWith(openTag)).toBe(true);
    expect(b.startsWith(openTag)).toBe(true);
    // Each has exactly ONE <svg> element (no nested SVG).
    expect(a.match(/<svg/g)?.length).toBe(1);
    expect(b.match(/<svg/g)?.length).toBe(1);
    // Each has exactly ONE <g id="annotations"> wrapper.
    expect(a.match(/<g id="annotations"/g)?.length).toBe(1);
    expect(b.match(/<g id="annotations"/g)?.length).toBe(1);
  });

  it("rounds non-integer image dimensions", () => {
    const images = [makeImage("a.png", { width: 100.4, height: 200.6 })];
    const doc = createCardDocumentFromImages(images, { title: "X" });
    const step = doc.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step");
    expect(step.svg).toContain('viewBox="0 0 100 201"');
  });

  it("clamps zero / negative dimensions to 1", () => {
    const images = [makeImage("a.png", { width: 0, height: -50 })];
    const doc = createCardDocumentFromImages(images, { title: "X" });
    const step = doc.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step");
    expect(step.svg).toContain('viewBox="0 0 1 1"');
  });

  it("escapes special chars in the originalDataUrl when emitting as an attribute", () => {
    const images = [makeImage("a.png", { originalDataUrl: 'data:image/png;base64,"<&>' })];
    const doc = createCardDocumentFromImages(images, { title: "X" });
    const step = doc.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step");
    // Quote / angle-bracket / ampersand entity-escaped.
    expect(step.svg).toContain("&quot;");
    expect(step.svg).toContain("&lt;");
    expect(step.svg).toContain("&amp;");
    expect(step.svg).toContain("&gt;");
  });

  it("mints fresh IDs each call (no collisions across runs)", () => {
    const docA = createCardDocumentFromImages([makeImage("a.png")], { title: "X" });
    const docB = createCardDocumentFromImages([makeImage("a.png")], { title: "X" });
    const idA = docA.blocks[0]?.kind === "step" ? docA.blocks[0].id : "";
    const idB = docB.blocks[0]?.kind === "step" ? docB.blocks[0].id : "";
    expect(idA).not.toBe(idB);
    expect(idA.startsWith("img-")).toBe(true);
    expect(idB.startsWith("img-")).toBe(true);
  });
});

describe("createCardDocumentFromImages: serialisation round-trip", () => {
  it("the generated doc parses cleanly and reaches a stable canonical form after one save+reload", () => {
    // The generator emits inline (single-line) SVG for ergonomic
    // construction; the parser canonicalises that to multi-line
    // indented form on read. Byte equivalence kicks in after the
    // first parse + serialise — that's what the format's round-
    // trip contract actually pins (see `round-trip.test.ts`).
    const doc = createCardDocumentFromImages(
      [makeImage("a.png"), makeImage("b.png", { width: 200, height: 100 })],
      { title: "Round trip", layout: "image-left", columns: 2 },
    );
    const initialBytes = serializeDocument(doc);
    const reparsed = parseDocument(initialBytes);
    expect(reparsed.title).toBe("Round trip");
    expect(reparsed.blocks.length).toBe(2);
    expect(reparsed.blocks[0]?.kind).toBe("step");
    expect(reparsed.blocks[1]?.kind).toBe("step");
    // Re-serialise the parsed form and assert it round-trips
    // through one more cycle (this IS what the format spec
    // promises — canonical bytes stay canonical).
    const canonicalBytes = serializeDocument(reparsed);
    const reparsed2 = parseDocument(canonicalBytes);
    expect(serializeDocument(reparsed2)).toBe(canonicalBytes);
  });

  it("the empty-input case is a no-op shaped doc (zero blocks)", () => {
    const doc = createCardDocumentFromImages([], { title: "Empty" });
    expect(doc.blocks).toEqual([]);
    // Still produces a valid document — title set + no cardLayout
    // (no step blocks → no need for defaults).
    expect(doc.title).toBe("Empty");
    expect(doc.meta.cardLayout).toBeUndefined();
  });
});
