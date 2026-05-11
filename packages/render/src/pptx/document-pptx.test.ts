// @vitest-environment happy-dom
//
// `exportDocumentPptx` / `buildDocumentPptxFiles` — Phase 11 of
// `docs/plans/annot-html-document.md`. Coverage:
//
//   - Empty document (no image blocks) → empty file map / null
//     blob.
//   - Single image-block document → 1 slide, screenshot embedded.
//   - Multi image-block document → N slides, each with its own
//     screenshot media entry.
//   - Annotations preserved through the parse → buildShapeXml
//     pipeline (smoke test — full per-shape XML correctness is
//     covered by `drawingml.test.ts`).

import type { AnnotDocument, ImageBlock, StepBlock, StepLayout } from "@ingcreators/annot-doc";
import { describe, expect, it } from "vitest";
import { buildDocumentPptxFiles, exportDocumentPptx } from "./document-pptx.js";

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";

function makeImageBlock(
  id: string,
  width: number,
  height: number,
  options: { withRect?: boolean; href?: string } = {},
): ImageBlock {
  const href = options.href ?? TINY_PNG_DATA_URL;
  const annotations = options.withRect
    ? `<rect data-type="rect" x="10" y="10" width="100" height="50" fill="#ff0000"/>`
    : "";
  const svg =
    `<svg data-annot-version="1" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    `<image href="${href}" width="${width}" height="${height}"/>` +
    `<g id="annotations">${annotations}</g>` +
    "</svg>";
  return { kind: "image", id, svg };
}

function makeDocument(blocks: AnnotDocument["blocks"]): AnnotDocument {
  return {
    version: 1,
    lang: "en",
    title: "Test doc",
    meta: { title: "Test doc" },
    styleBlock: null,
    blocks,
  };
}

describe("buildDocumentPptxFiles", () => {
  it("returns an empty file map for a document with no image blocks", () => {
    const doc = makeDocument([{ kind: "paragraph", inlineHtml: "no images" }]);
    const files = buildDocumentPptxFiles(doc);
    expect(Object.keys(files).length).toBe(0);
  });

  it("emits one slide per image block + the shared envelope files", () => {
    const doc = makeDocument([
      { kind: "heading", level: 1, inlineHtml: "Title" },
      makeImageBlock("img-1", 800, 600),
      { kind: "paragraph", inlineHtml: "Between blocks" },
      makeImageBlock("img-2", 1024, 768),
      makeImageBlock("img-3", 640, 480),
    ]);
    const files = buildDocumentPptxFiles(doc);
    // Three slide XML files + three slide rels + three media
    // entries (one per image block).
    expect(files["ppt/slides/slide1.xml"]).toBeDefined();
    expect(files["ppt/slides/slide2.xml"]).toBeDefined();
    expect(files["ppt/slides/slide3.xml"]).toBeDefined();
    expect(files["ppt/slides/_rels/slide1.xml.rels"]).toBeDefined();
    expect(files["ppt/slides/_rels/slide2.xml.rels"]).toBeDefined();
    expect(files["ppt/slides/_rels/slide3.xml.rels"]).toBeDefined();
    expect(files["ppt/media/screenshot1.png"]).toBeDefined();
    expect(files["ppt/media/screenshot2.png"]).toBeDefined();
    expect(files["ppt/media/screenshot3.png"]).toBeDefined();
    // Shared envelope present.
    expect(files["[Content_Types].xml"]).toBeDefined();
    expect(files["_rels/.rels"]).toBeDefined();
    expect(files["ppt/presentation.xml"]).toBeDefined();
    expect(files["ppt/_rels/presentation.xml.rels"]).toBeDefined();
    expect(files["ppt/slideLayouts/slideLayout1.xml"]).toBeDefined();
    expect(files["ppt/slideMasters/slideMaster1.xml"]).toBeDefined();
    expect(files["ppt/theme/theme1.xml"]).toBeDefined();
    expect(files["docProps/core.xml"]).toBeDefined();
    expect(files["docProps/app.xml"]).toBeDefined();
  });

  it("presentation.xml lists the right number of slides + slide IDs", () => {
    const doc = makeDocument([
      makeImageBlock("img-1", 800, 600),
      makeImageBlock("img-2", 800, 600),
    ]);
    const files = buildDocumentPptxFiles(doc);
    const presentationXml = decode(files["ppt/presentation.xml"]!);
    // 1-based slide IDs starting at 256, monotonically.
    expect(presentationXml).toContain('<p:sldId id="256" r:id="rId2"/>');
    expect(presentationXml).toContain('<p:sldId id="257" r:id="rId3"/>');
    expect(presentationXml).not.toContain('id="258"');
  });

  it("[Content_Types].xml emits slide overrides for every slide", () => {
    const doc = makeDocument([
      makeImageBlock("img-1", 800, 600),
      makeImageBlock("img-2", 800, 600),
      makeImageBlock("img-3", 800, 600),
    ]);
    const files = buildDocumentPptxFiles(doc);
    const types = decode(files["[Content_Types].xml"]!);
    expect(types).toContain('PartName="/ppt/slides/slide1.xml"');
    expect(types).toContain('PartName="/ppt/slides/slide2.xml"');
    expect(types).toContain('PartName="/ppt/slides/slide3.xml"');
    expect(types).not.toContain("slide4.xml");
    // PNG default declared because the test image is PNG.
    expect(types).toContain('Extension="png"');
    // JPEG default omitted (no JPEG sources).
    expect(types).not.toContain('Extension="jpeg"');
  });

  it("docProps/app.xml carries the correct slide count", () => {
    const doc = makeDocument([
      makeImageBlock("img-1", 800, 600),
      makeImageBlock("img-2", 800, 600),
    ]);
    const files = buildDocumentPptxFiles(doc);
    const appProps = decode(files["docProps/app.xml"]!);
    expect(appProps).toContain("<Slides>2</Slides>");
  });

  it("each slide rels references its own screenshotN.{ext}", () => {
    const doc = makeDocument([
      makeImageBlock("img-1", 800, 600),
      makeImageBlock("img-2", 800, 600),
    ]);
    const files = buildDocumentPptxFiles(doc);
    const rels1 = decode(files["ppt/slides/_rels/slide1.xml.rels"]!);
    const rels2 = decode(files["ppt/slides/_rels/slide2.xml.rels"]!);
    expect(rels1).toContain("screenshot1.png");
    expect(rels1).not.toContain("screenshot2.png");
    expect(rels2).toContain("screenshot2.png");
    expect(rels2).not.toContain("screenshot1.png");
  });

  it("slide XML contains the screenshot pic + emits annotation shapes", () => {
    const doc = makeDocument([makeImageBlock("img-1", 800, 600, { withRect: true })]);
    const files = buildDocumentPptxFiles(doc);
    const slideXml = decode(files["ppt/slides/slide1.xml"]!);
    // The screenshot is rendered as a `<p:pic>` referencing
    // `rId2` (the screenshot rel).
    expect(slideXml).toContain("<p:pic>");
    expect(slideXml).toContain('r:embed="rId2"');
    // The rect annotation is emitted via buildShapeXml — full
    // verification is in drawingml.test.ts; here we just smoke-
    // test that SOMETHING gets emitted for the rect.
    expect(slideXml).toContain("<p:sp>");
  });

  it("slide XML omits the picture element when the SVG carries no <image>", () => {
    // Build an SVG with no <image> child — annotations only.
    const svg =
      `<svg data-annot-version="1" viewBox="0 0 800 600" width="800" height="600" xmlns="http://www.w3.org/2000/svg">` +
      `<g id="annotations"><rect data-type="rect" x="10" y="10" width="50" height="50"/></g>` +
      "</svg>";
    const doc = makeDocument([{ kind: "image", id: "img-no-bg", svg }]);
    const files = buildDocumentPptxFiles(doc);
    const slideXml = decode(files["ppt/slides/slide1.xml"]!);
    expect(slideXml).not.toContain("<p:pic>");
    // No screenshot media entry for this slide.
    expect(files["ppt/media/screenshot1.png"]).toBeUndefined();
    // Slide rels has no rId2 image relationship.
    const rels = decode(files["ppt/slides/_rels/slide1.xml.rels"]!);
    expect(rels).not.toContain("screenshot");
  });

  it("malformed SVG bytes don't abort the entire export", () => {
    const validBlock = makeImageBlock("img-good", 800, 600);
    const badBlock: ImageBlock = {
      kind: "image",
      id: "img-bad",
      svg: "<not-actually-svg",
    };
    const doc = makeDocument([validBlock, badBlock]);
    const files = buildDocumentPptxFiles(doc);
    // The bad block produces no slide; the valid block still
    // ends up at slide1.
    expect(files["ppt/slides/slide1.xml"]).toBeDefined();
    expect(files["ppt/slides/slide2.xml"]).toBeUndefined();
    // App props reflects only the surviving slide.
    expect(decode(files["docProps/app.xml"]!)).toContain("<Slides>1</Slides>");
  });
});

// ---------------------------------------------------------------------------
// Phase 6 of docs/plans/card-procedure-template.md — step block
// → slide export with per-layout title + body overlay shapes.
// ---------------------------------------------------------------------------

function makeStepBlock(
  id: string,
  width: number,
  height: number,
  options: {
    title?: string;
    body?: string;
    layout?: StepLayout;
    withRect?: boolean;
  } = {},
): StepBlock {
  const annotations = options.withRect
    ? `<rect data-type="rect" x="10" y="10" width="100" height="50" fill="#ff0000"/>`
    : "";
  const svg =
    `<svg data-annot-version="1" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    `<image href="${TINY_PNG_DATA_URL}" width="${width}" height="${height}"/>` +
    `<g id="annotations">${annotations}</g>` +
    "</svg>";
  return {
    kind: "step",
    id,
    svg,
    title: options.title ?? "",
    body: options.body ?? "",
    layout: options.layout ?? "image-top",
  };
}

describe("buildDocumentPptxFiles: step blocks (Phase 6)", () => {
  it("emits one slide per step block alongside image blocks", () => {
    const doc = makeDocument([
      { kind: "heading", level: 1, inlineHtml: "Mixed doc" },
      makeImageBlock("img-1", 800, 600),
      makeStepBlock("step-1", 800, 600, { title: "Step 1", body: "Do A" }),
      makeStepBlock("step-2", 800, 600, { title: "Step 2", body: "Do B" }),
    ]);
    const files = buildDocumentPptxFiles(doc);
    // 1 image block + 2 step blocks = 3 slides.
    expect(files["ppt/slides/slide1.xml"]).toBeDefined();
    expect(files["ppt/slides/slide2.xml"]).toBeDefined();
    expect(files["ppt/slides/slide3.xml"]).toBeDefined();
    expect(files["ppt/slides/slide4.xml"]).toBeUndefined();
  });

  it("embeds the step's image bytes as a separate screenshot media entry per slide", () => {
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600),
      makeStepBlock("step-2", 800, 600),
    ]);
    const files = buildDocumentPptxFiles(doc);
    expect(files["ppt/media/screenshot1.png"]).toBeDefined();
    expect(files["ppt/media/screenshot2.png"]).toBeDefined();
  });

  it("emits a title overlay <p:sp> when the step has a title", () => {
    const doc = makeDocument([makeStepBlock("step-1", 800, 600, { title: "Open the dialog" })]);
    const files = buildDocumentPptxFiles(doc);
    const slide1 = decode(files["ppt/slides/slide1.xml"]!);
    expect(slide1).toContain('name="StepTitle"');
    expect(slide1).toContain("<a:t>Open the dialog</a:t>");
    // Title is bold.
    expect(slide1).toMatch(/<a:rPr[^>]*\bb="1"/);
  });

  it("emits a body overlay <p:sp> when the step has a body", () => {
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600, { body: "Click the gear icon to open settings." }),
    ]);
    const files = buildDocumentPptxFiles(doc);
    const slide1 = decode(files["ppt/slides/slide1.xml"]!);
    expect(slide1).toContain('name="StepBody"');
    expect(slide1).toContain("<a:t>Click the gear icon to open settings.</a:t>");
  });

  it("skips empty title / body slots so the slide doesn't carry empty boxes", () => {
    const doc = makeDocument([makeStepBlock("step-1", 800, 600, { title: "", body: "" })]);
    const files = buildDocumentPptxFiles(doc);
    const slide1 = decode(files["ppt/slides/slide1.xml"]!);
    expect(slide1).not.toContain("StepTitle");
    expect(slide1).not.toContain("StepBody");
  });

  it("strips inline HTML tags from the title / body before emitting", () => {
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600, {
        title: "Open <strong>Settings</strong>",
        body: "Click <em>the icon</em>.",
      }),
    ]);
    const files = buildDocumentPptxFiles(doc);
    const slide1 = decode(files["ppt/slides/slide1.xml"]!);
    // Tags stripped; raw text survives.
    expect(slide1).toContain("<a:t>Open Settings</a:t>");
    expect(slide1).toContain("<a:t>Click the icon.</a:t>");
  });

  it("escapes special chars in title / body for OOXML emit", () => {
    // The HTML-stripper drops anything between `<` and `>`, so
    // we use stand-alone `&` here — that's the canonical case
    // (title text typed by the user is plain text most of the
    // time, and `&` is the only character that needs escaping
    // for OOXML).
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600, { title: "AT&T billing", body: "" }),
    ]);
    const files = buildDocumentPptxFiles(doc);
    const slide1 = decode(files["ppt/slides/slide1.xml"]!);
    expect(slide1).toContain("<a:t>AT&amp;T billing</a:t>");
  });

  it("positions the overlays per layout — image-top puts text near the bottom", () => {
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600, {
        title: "T",
        body: "B",
        layout: "image-top",
      }),
    ]);
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    // Title rect at (4%, 72%, 92%, 8%) of (800, 600) →
    // x = 32px, y = 432px in canvas; in EMU the values are
    // x * 9525, y * 9525.
    expect(slide1).toMatch(/StepTitle[\s\S]*?<a:off x="304800" y="4114800"\/>/);
  });

  it("positions the overlays per layout — image-bottom puts text near the top", () => {
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600, {
        title: "T",
        body: "B",
        layout: "image-bottom",
      }),
    ]);
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    // Title rect at (4%, 4%, 92%, 8%) → y = 24px → 228600 EMU.
    expect(slide1).toMatch(/StepTitle[\s\S]*?<a:off x="304800" y="228600"\/>/);
  });

  it("positions the overlays per layout — image-left puts text on the right half", () => {
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600, {
        title: "T",
        body: "B",
        layout: "image-left",
      }),
    ]);
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    // Title rect at (56%, 6%, 40%, 10%) → x = 448px → 4267200 EMU.
    expect(slide1).toMatch(/StepTitle[\s\S]*?<a:off x="4267200" y="342900"\/>/);
  });

  it("positions the overlays per layout — image-right puts text on the left half", () => {
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600, {
        title: "T",
        body: "B",
        layout: "image-right",
      }),
    ]);
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    // Title rect at (4%, 6%, 40%, 10%) → x = 32px → 304800 EMU.
    expect(slide1).toMatch(/StepTitle[\s\S]*?<a:off x="304800" y="342900"\/>/);
  });

  it("the overlay backdrop uses a translucent dark fill", () => {
    const doc = makeDocument([makeStepBlock("step-1", 800, 600, { title: "T", body: "B" })]);
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    // Black fill with 65% alpha — same on every layout.
    expect(slide1).toContain(
      '<a:solidFill><a:srgbClr val="000000"><a:alpha val="65000"/></a:srgbClr></a:solidFill>',
    );
  });

  it("the overlay text is white", () => {
    const doc = makeDocument([makeStepBlock("step-1", 800, 600, { title: "T", body: "B" })]);
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    expect(slide1).toContain('<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>');
  });

  it("preserves annotation shapes from the step block's SVG (smoke)", () => {
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600, { title: "T", body: "B", withRect: true }),
    ]);
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    // The annotation rect — `buildShapeXml` emits it as a
    // `<p:sp>` with a `prstGeom prst="rect"` (the same shape we
    // already test for in the image-block path).
    expect(slide1).toContain('prst="rect"');
  });

  it("a 3-step golden document produces a stable file map", () => {
    // Phase 6 golden — three step blocks, mixed layouts, every
    // overlay rendered. Re-running buildDocumentPptxFiles on
    // the same input should produce byte-identical bytes
    // (modulo coreProps's `dcterms:created` which uses the
    // current timestamp, see filter below).
    const doc = makeDocument([
      makeStepBlock("s-1", 800, 600, {
        title: "Step 1 — Open",
        body: "Click Settings.",
        layout: "image-top",
      }),
      makeStepBlock("s-2", 800, 600, {
        title: "Step 2 — Configure",
        body: "Pick the right option.",
        layout: "image-left",
      }),
      makeStepBlock("s-3", 800, 600, {
        title: "Step 3 — Apply",
        body: "Click Apply.",
        layout: "image-fill",
      }),
    ]);
    const filesA = buildDocumentPptxFiles(doc);
    const filesB = buildDocumentPptxFiles(doc);
    const stableKeys = Object.keys(filesA).filter((k) => k !== "docProps/core.xml");
    expect(stableKeys.sort()).toEqual(
      Object.keys(filesB)
        .filter((k) => k !== "docProps/core.xml")
        .sort(),
    );
    for (const key of stableKeys) {
      expect(decode(filesA[key]!)).toBe(decode(filesB[key]!));
    }
  });
});

describe("exportDocumentPptx", () => {
  it("returns null for a document with no image blocks", () => {
    const doc = makeDocument([{ kind: "paragraph", inlineHtml: "no images" }]);
    expect(exportDocumentPptx(doc)).toBeNull();
  });

  it("returns a Blob with the expected MIME type for a non-empty document", async () => {
    const doc = makeDocument([makeImageBlock("img-1", 800, 600)]);
    const blob = exportDocumentPptx(doc);
    expect(blob).not.toBeNull();
    expect(blob?.type).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    // Blob should carry a non-trivial number of bytes (the
    // OOXML envelope alone is several kB).
    expect(blob?.size ?? 0).toBeGreaterThan(2_000);
  });
});

// ---- helpers --------------------------------------------------------------

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
