// @vitest-environment happy-dom
//
// `createCardDocumentFromImages` tests — Phase 4 of
// `docs/plans/card-procedure-template.md`. Pure / Tier B-ish:
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
    // Titles default to "Step 1", "Step 2", "Step 3" (numbering: step-n).
    const titles = doc.blocks.map((b) => (b.kind === "step" ? b.title : ""));
    expect(titles).toEqual(["Step 1", "Step 2", "Step 3"]);
  });

  it("uses title verbatim, falling back to 'Untitled' on empty", () => {
    const doc = createCardDocumentFromImages([makeImage("a.png")], { title: "  My doc  " });
    expect(doc.title).toBe("My doc");
    expect(doc.meta.title).toBe("My doc");
    const empty = createCardDocumentFromImages([makeImage("a.png")], { title: "" });
    expect(empty.title).toBe("Untitled");
  });

  it('defaults numbering to "step-n"', () => {
    const doc = createCardDocumentFromImages([makeImage("a.png"), makeImage("b.png")], {
      title: "X",
    });
    const titles = doc.blocks.map((b) => (b.kind === "step" ? b.title : ""));
    expect(titles).toEqual(["Step 1", "Step 2"]);
  });

  it('honours numbering: "image-n"', () => {
    const doc = createCardDocumentFromImages([makeImage("a.png"), makeImage("b.png")], {
      title: "X",
      numbering: "image-n",
    });
    expect(doc.blocks.map((b) => (b.kind === "step" ? b.title : ""))).toEqual([
      "Image 1",
      "Image 2",
    ]);
  });

  it('honours numbering: "none"', () => {
    const doc = createCardDocumentFromImages([makeImage("a.png"), makeImage("b.png")], {
      title: "X",
      numbering: "none",
    });
    expect(doc.blocks.map((b) => (b.kind === "step" ? b.title : ""))).toEqual(["", ""]);
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
