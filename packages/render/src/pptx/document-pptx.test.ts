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

  // Phase 6b: slide canvas is uniformly 1280×720; title /
  // body rects are computed from `LAYOUT_PLACEMENTS` against
  // those dimensions. EMU = px × 9525.
  it("positions the overlays per layout — image-top puts text near the bottom", () => {
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600, { title: "T", body: "B", layout: "image-top" }),
    ]);
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    // Title rect at (4%, 67%, 92%, 8%) of (1280, 720) →
    // x = 51.2 px, y = 482.4 px → EMU = 487680, 4594860.
    expect(slide1).toMatch(/StepTitle[\s\S]*?<a:off x="487680" y="4594860"\/>/);
  });

  it("positions the overlays per layout — image-bottom puts text near the top", () => {
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600, { title: "T", body: "B", layout: "image-bottom" }),
    ]);
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    // Title rect at (4%, 4%, 92%, 8%) → x=51.2, y=28.8 → 487680, 274320 EMU.
    expect(slide1).toMatch(/StepTitle[\s\S]*?<a:off x="487680" y="274320"\/>/);
  });

  it("positions the overlays per layout — image-left puts text on the right half", () => {
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600, { title: "T", body: "B", layout: "image-left" }),
    ]);
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    // Title rect at (58%, 4%, 40%, 10%) → x=742.4, y=28.8 → 7071360, 274320 EMU.
    expect(slide1).toMatch(/StepTitle[\s\S]*?<a:off x="7071360" y="274320"\/>/);
  });

  it("positions the overlays per layout — image-right puts text on the left half", () => {
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600, { title: "T", body: "B", layout: "image-right" }),
    ]);
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    // Title rect at (2%, 4%, 40%, 10%) → x=25.6, y=28.8 → 243840, 274320 EMU.
    expect(slide1).toMatch(/StepTitle[\s\S]*?<a:off x="243840" y="274320"\/>/);
  });

  // Phase 6b: the translucent-backdrop + white-text overlay
  // style is reserved for image-fill (where text and image
  // share slide pixels). The four area-based layouts use a
  // transparent backdrop with dark text instead, since the
  // text sits in its own slide region.
  it("image-fill uses the translucent dark fill + white text overlay", () => {
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600, { title: "T", body: "B", layout: "image-fill" }),
    ]);
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    expect(slide1).toContain(
      '<a:solidFill><a:srgbClr val="000000"><a:alpha val="65000"/></a:srgbClr></a:solidFill>',
    );
    expect(slide1).toContain('<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>');
  });

  it("area-based layouts (image-top etc.) use a transparent backdrop + dark text", () => {
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600, { title: "T", body: "B", layout: "image-top" }),
    ]);
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    // No translucent backdrop on the text shape itself —
    // the `<p:sp>` carries `<a:noFill/>` and dark
    // `srgbClr val="000000"` text.
    const titleStart = slide1.indexOf("StepTitle");
    const titleEnd = slide1.indexOf("</p:sp>", titleStart);
    const titleXml = slide1.slice(titleStart, titleEnd);
    expect(titleXml).toContain("<a:noFill/>");
    expect(titleXml).toContain('<a:solidFill><a:srgbClr val="000000"/></a:solidFill>');
    expect(titleXml).not.toContain('<a:alpha val="65000"/>');
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

// ---------------------------------------------------------------------------
// Phase 6b — globally-uniform 16:9 slide canvas (1280×720 px),
// image `contain`-fit into per-layout sub-rect, annotations
// kept in SVG coord space via the image-group `<a:xfrm>`.
// ---------------------------------------------------------------------------

describe("buildDocumentPptxFiles: 16:9 slide canvas (Phase 6b)", () => {
  it("every slide uses the uniform 1280×720 slide size regardless of source image dimensions", () => {
    const doc = makeDocument([
      // Three image blocks at wildly different aspect ratios —
      // a 1916×1872 (square-ish) capture, a 1920×1080 (16:9),
      // and a 600×1200 (portrait). All three should produce
      // slides with the same `<p:sldSz>`.
      makeImageBlock("img-1", 1916, 1872),
      makeImageBlock("img-2", 1920, 1080),
      makeImageBlock("img-3", 600, 1200),
    ]);
    const files = buildDocumentPptxFiles(doc);
    const presentationXml = decode(files["ppt/presentation.xml"]!);
    // 1280 px → 12,192,000 EMU; 720 px → 6,858,000 EMU. These
    // are PowerPoint's default widescreen slide dimensions.
    expect(presentationXml).toContain('<p:sldSz cx="12192000" cy="6858000" type="custom"/>');
  });

  it("the image lives inside a <p:grpSp> with an xfrm that contains the SVG into the image region", () => {
    // Source dims 1280×720 (matches slide aspect exactly) →
    // image fills the full slide without letterboxing.
    const doc = makeDocument([makeImageBlock("img-1", 1280, 720)]);
    const files = buildDocumentPptxFiles(doc);
    const slideXml = decode(files["ppt/slides/slide1.xml"]!);
    expect(slideXml).toContain("<p:grpSp>");
    expect(slideXml).toContain('name="ImageGroup"');
    // Image group's outer off + ext match the contained image
    // rect (here the full slide).
    expect(slideXml).toContain('<a:off x="0" y="0"/>');
    expect(slideXml).toMatch(
      /ImageGroup[\s\S]*?<a:ext cx="12192000" cy="6858000"\/>[\s\S]*?<a:chOff x="0" y="0"\/>[\s\S]*?<a:chExt cx="12192000" cy="6858000"\/>/,
    );
  });

  it("image-block source narrower than the slide is letterboxed horizontally", () => {
    // Portrait source 600×1200 (aspect 0.5). Slide is 1280×720
    // (aspect ~1.78). Contain: scale = min(1280/600, 720/1200)
    // = min(2.133, 0.6) = 0.6. Scaled image = 360×720.
    // Centered: x = (1280-360)/2 = 460, y = 0. EMU: 460*9525 =
    // 4381500; ext = 360*9525 = 3429000 wide, 720*9525 = 6858000.
    const doc = makeDocument([makeImageBlock("img-portrait", 600, 1200)]);
    const slideXml = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    expect(slideXml).toMatch(
      /ImageGroup[\s\S]*?<a:off x="4381500" y="0"\/>[\s\S]*?<a:ext cx="3429000" cy="6858000"\/>/,
    );
  });

  it("step block image-top puts the image in the upper 65% of the slide", () => {
    // Source 1280×720 (16:9). Region (0..1280, 0..468). Source
    // aspect matches slide aspect (1.78); contained = 832×468
    // centered → x = (1280-832)/2 = 224 px → 2133600 EMU,
    // y = 0. ext = 832 px wide → 7924800 EMU, 468 px tall →
    // 4457700 EMU.
    const doc = makeDocument([
      makeStepBlock("step-1", 1280, 720, { title: "T", body: "B", layout: "image-top" }),
    ]);
    const slideXml = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    expect(slideXml).toMatch(
      /ImageGroup[\s\S]*?<a:off x="2133600" y="0"\/>[\s\S]*?<a:ext cx="7924800" cy="4457700"\/>/,
    );
  });

  it("step block image-fill spans the full slide", () => {
    // image-fill region = full slide; 1280×720 source matches
    // aspect → no letterboxing, image fills 1280×720.
    const doc = makeDocument([
      makeStepBlock("step-1", 1280, 720, { title: "T", body: "B", layout: "image-fill" }),
    ]);
    const slideXml = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    expect(slideXml).toMatch(
      /ImageGroup[\s\S]*?<a:off x="0" y="0"\/>[\s\S]*?<a:ext cx="12192000" cy="6858000"\/>/,
    );
  });

  it("step block image-left puts the image in the left 55%", () => {
    // Region (0..704px, 0..720px). 1280×720 source aspect 1.78.
    // scale = min(704/1280, 720/720) = min(0.55, 1) = 0.55.
    // Scaled = 704×396. Centered in the region:
    //   x = 0, y = (720-396)/2 = 162 px = 1,543,050 EMU.
    //   ext = 704 × 9525 = 6,705,600 wide,
    //         396 × 9525 = 3,771,900 tall.
    const doc = makeDocument([
      makeStepBlock("step-1", 1280, 720, { title: "T", body: "B", layout: "image-left" }),
    ]);
    const slideXml = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    expect(slideXml).toMatch(
      /ImageGroup[\s\S]*?<a:off x="0" y="1543050"\/>[\s\S]*?<a:ext cx="6705600" cy="3771900"\/>/,
    );
  });

  it("annotation shapes stay in SVG coord space inside the image group (no per-shape coord scaling)", () => {
    // The annotation rect was authored at (10, 10, 100, 50)
    // in SVG coords. After Phase 6b the shape XML emits with
    // those raw coordinates (× 9525 for EMU) — the
    // surrounding `<p:grpSp>` xfrm handles the scale.
    const doc = makeDocument([makeImageBlock("img-1", 800, 600, { withRect: true })]);
    const slideXml = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    // 10 px × 9525 = 95250 EMU; 100 px × 9525 = 952500;
    // 50 × 9525 = 476250.
    expect(slideXml).toMatch(
      /<a:off x="95250" y="95250"\/>[\s\S]*?<a:ext cx="952500" cy="476250"\/>/,
    );
  });

  it("top-level text shapes (title/body) sit OUTSIDE the image group", () => {
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600, { title: "T", body: "B", layout: "image-top" }),
    ]);
    const slideXml = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    // The `StepTitle` shape's <p:sp> appears AFTER the closing
    // </p:grpSp> of the image group (i.e. as a sibling in the
    // spTree, not a child of the group).
    const groupEnd = slideXml.indexOf("</p:grpSp>");
    const titlePos = slideXml.indexOf("StepTitle");
    expect(groupEnd).toBeGreaterThan(-1);
    expect(titlePos).toBeGreaterThan(groupEnd);
  });
});

// ---------------------------------------------------------------------------
// Phase 7c — Scribe-style cover slide. When `meta.header` is set
// the deck gains a leading slide carrying icon + title +
// description + author + step-count footer. Per-block slides
// shift to indices 2..N+1.
// ---------------------------------------------------------------------------

describe("buildDocumentPptxFiles: cover slide (Phase 7c)", () => {
  function makeHeadedDoc(): AnnotDocument {
    return {
      version: 1,
      lang: "en",
      title: "Quick start",
      meta: {
        title: "Quick start",
        author: "Naoki Ichimura",
        header: {
          icon: TINY_PNG_DATA_URL,
          description: "Get started in five steps.",
        },
      },
      styleBlock: null,
      blocks: [
        makeStepBlock("step-1", 800, 600, { title: "Step 1", body: "Do A" }),
        makeStepBlock("step-2", 800, 600, { title: "Step 2", body: "Do B" }),
      ],
    };
  }

  it("emits a leading cover slide when meta.header is set", () => {
    const files = buildDocumentPptxFiles(makeHeadedDoc());
    expect(files["ppt/slides/slide1.xml"]).toBeDefined();
    expect(files["ppt/slides/slide2.xml"]).toBeDefined();
    expect(files["ppt/slides/slide3.xml"]).toBeDefined();
    expect(files["ppt/slides/slide4.xml"]).toBeUndefined();
  });

  it("does NOT emit a cover slide when meta.header is absent", () => {
    const doc: AnnotDocument = {
      ...makeHeadedDoc(),
      meta: { title: "Quick start" },
    };
    const files = buildDocumentPptxFiles(doc);
    const slide1 = decode(files["ppt/slides/slide1.xml"]!);
    expect(slide1).not.toContain("CoverTitle");
    expect(slide1).not.toContain("CoverIcon");
  });

  it("cover slide carries title + description + footer text shapes", () => {
    const slide1 = decode(buildDocumentPptxFiles(makeHeadedDoc())["ppt/slides/slide1.xml"]!);
    expect(slide1).toContain('name="CoverTitle"');
    expect(slide1).toContain("<a:t>Quick start</a:t>");
    expect(slide1).toContain('name="CoverDescription"');
    expect(slide1).toContain("<a:t>Get started in five steps.</a:t>");
    expect(slide1).toContain('name="CoverFooter"');
    // Footer joins author + step count with " · ".
    expect(slide1).toContain("<a:t>By Naoki Ichimura · 2 steps</a:t>");
  });

  it("cover slide carries the icon as a top-level <p:pic> (no image group)", () => {
    const slide1 = decode(buildDocumentPptxFiles(makeHeadedDoc())["ppt/slides/slide1.xml"]!);
    expect(slide1).toContain('name="CoverIcon"');
    // Cover slides skip the SVG-space group wrap entirely.
    expect(slide1).not.toContain('name="ImageGroup"');
  });

  it("embeds the icon bytes as ppt/media/screenshot1.png", () => {
    const files = buildDocumentPptxFiles(makeHeadedDoc());
    expect(files["ppt/media/screenshot1.png"]).toBeDefined();
  });

  it("omits the icon <p:pic> when meta.header.icon is unset", () => {
    const doc: AnnotDocument = {
      ...makeHeadedDoc(),
      meta: {
        ...makeHeadedDoc().meta,
        header: { description: "Plain description" },
      },
    };
    const files = buildDocumentPptxFiles(doc);
    const slide1 = decode(files["ppt/slides/slide1.xml"]!);
    expect(slide1).not.toContain("CoverIcon");
    expect(files["ppt/media/screenshot1.png"]).toBeUndefined();
  });

  it("omits the description shape when meta.header.description is unset", () => {
    const doc: AnnotDocument = {
      ...makeHeadedDoc(),
      meta: {
        ...makeHeadedDoc().meta,
        header: { icon: TINY_PNG_DATA_URL },
      },
    };
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    expect(slide1).not.toContain("CoverDescription");
    expect(slide1).toContain("CoverTitle");
  });

  it("footer falls back to step count only when no author", () => {
    const doc: AnnotDocument = {
      ...makeHeadedDoc(),
      meta: {
        title: "Quick start",
        header: { description: "Desc" },
      },
    };
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    expect(slide1).toContain("<a:t>2 steps</a:t>");
    expect(slide1).not.toContain("By ");
  });

  it("uses '1 step' singular in the cover footer", () => {
    const doc: AnnotDocument = {
      ...makeHeadedDoc(),
      meta: {
        title: "Quick start",
        header: { description: "Desc" },
      },
      blocks: [makeStepBlock("step-1", 800, 600, { title: "T" })],
    };
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    expect(slide1).toContain("<a:t>1 step</a:t>");
  });

  it("omits the footer entirely when no author + no step blocks", () => {
    const doc: AnnotDocument = {
      version: 1,
      lang: "en",
      title: "Headed prose",
      meta: { title: "Headed prose", header: { description: "Desc" } },
      styleBlock: null,
      blocks: [{ kind: "paragraph", inlineHtml: "Some prose." }],
    };
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    expect(slide1).not.toContain("CoverFooter");
  });

  it("uses the uniform 1280×720 canvas for the cover slide", () => {
    const files = buildDocumentPptxFiles(makeHeadedDoc());
    const presentationXml = decode(files["ppt/presentation.xml"]!);
    expect(presentationXml).toContain('<p:sldSz cx="12192000" cy="6858000" type="custom"/>');
  });

  it("a prose doc with header but no step blocks still gets a cover + 0 content slides", () => {
    const doc: AnnotDocument = {
      version: 1,
      lang: "en",
      title: "Just a cover",
      meta: { title: "Just a cover", header: { description: "Desc" } },
      styleBlock: null,
      blocks: [{ kind: "paragraph", inlineHtml: "Some prose." }],
    };
    const files = buildDocumentPptxFiles(doc);
    expect(files["ppt/slides/slide1.xml"]).toBeDefined();
    expect(files["ppt/slides/slide2.xml"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 7b — URL chip. Step blocks gain an optional `link` field;
// the slide picks up a hyperlink rel + a chip text shape with
// `<a:hlinkClick>`.
// ---------------------------------------------------------------------------

describe("buildDocumentPptxFiles: step block URL chip (Phase 7b)", () => {
  it("emits a hyperlink relationship in slide rels when block.link is set", () => {
    const block = makeStepBlock("step-1", 800, 600, { title: "T", body: "B" });
    const linkedBlock: StepBlock = {
      ...block,
      link: { url: "https://example.com", label: "Docs" },
    };
    const doc = makeDocument([linkedBlock]);
    const files = buildDocumentPptxFiles(doc);
    const rels = decode(files["ppt/slides/_rels/slide1.xml.rels"]!);
    expect(rels).toContain(
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"',
    );
    expect(rels).toContain('Target="https://example.com"');
    expect(rels).toContain('TargetMode="External"');
  });

  it("emits a StepLink <p:sp> with <a:hlinkClick> referencing the hyperlink rId", () => {
    const block = makeStepBlock("step-1", 800, 600, { title: "T", body: "B" });
    const linkedBlock: StepBlock = {
      ...block,
      link: { url: "https://example.com", label: "Docs" },
    };
    const doc = makeDocument([linkedBlock]);
    const files = buildDocumentPptxFiles(doc);
    const slide1 = decode(files["ppt/slides/slide1.xml"]!);
    expect(slide1).toContain('name="StepLink"');
    // The chip text is the label.
    expect(slide1).toContain("<a:t>Docs</a:t>");
    // hlinkClick references some rId — the slide rels carry it.
    expect(slide1).toMatch(/<a:hlinkClick\s[^>]*r:id="rId\d+"/);
  });

  it("uses the URL as the chip label when no label is set", () => {
    const block = makeStepBlock("step-1", 800, 600, { title: "T", body: "B" });
    const linkedBlock: StepBlock = {
      ...block,
      link: { url: "https://example.com/path" },
    };
    const doc = makeDocument([linkedBlock]);
    const slide1 = decode(buildDocumentPptxFiles(doc)["ppt/slides/slide1.xml"]!);
    expect(slide1).toContain("<a:t>https://example.com/path</a:t>");
  });

  it("escapes XML metachars in the slide-rels URL target", () => {
    const block = makeStepBlock("step-1", 800, 600, { title: "T", body: "B" });
    const linkedBlock: StepBlock = {
      ...block,
      link: { url: "https://example.com/search?q=a&b=c" },
    };
    const doc = makeDocument([linkedBlock]);
    const rels = decode(buildDocumentPptxFiles(doc)["ppt/slides/_rels/slide1.xml.rels"]!);
    expect(rels).toContain('Target="https://example.com/search?q=a&amp;b=c"');
  });

  it("emits a hyperlink for an image-less step too (Phase 7a + 7b combined)", () => {
    const block: StepBlock = {
      kind: "step",
      id: "step-1",
      svg: "",
      title: "Visit",
      body: "",
      layout: "image-top",
      link: { url: "https://example.com" },
    };
    const doc = makeDocument([block]);
    const files = buildDocumentPptxFiles(doc);
    const rels = decode(files["ppt/slides/_rels/slide1.xml.rels"]!);
    expect(rels).toContain(
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"',
    );
    const slide1 = decode(files["ppt/slides/slide1.xml"]!);
    expect(slide1).toContain('name="StepLink"');
  });

  it("an image-less step with ONLY a link (no title, no body) still produces a slide", () => {
    const block: StepBlock = {
      kind: "step",
      id: "step-1",
      svg: "",
      title: "",
      body: "",
      layout: "image-top",
      link: { url: "https://example.com" },
    };
    const doc = makeDocument([block]);
    const files = buildDocumentPptxFiles(doc);
    expect(files["ppt/slides/slide1.xml"]).toBeDefined();
  });

  it("omits the hyperlink rel entirely when no link is set", () => {
    const doc = makeDocument([makeStepBlock("step-1", 800, 600, { title: "T", body: "B" })]);
    const rels = decode(buildDocumentPptxFiles(doc)["ppt/slides/_rels/slide1.xml.rels"]!);
    expect(rels).not.toContain("relationships/hyperlink");
  });
});

// ---------------------------------------------------------------------------
// Phase 7a — image-less step blocks. An empty `svg` field skips
// the image group entirely; the slide carries only the title /
// body text shapes centred on the canvas.
// ---------------------------------------------------------------------------

describe("buildDocumentPptxFiles: image-less step blocks (Phase 7a)", () => {
  function makeImagelessStepBlock(
    id: string,
    options: { title?: string; body?: string; layout?: StepLayout } = {},
  ): StepBlock {
    return {
      kind: "step",
      id,
      svg: "",
      title: options.title ?? "",
      body: options.body ?? "",
      layout: options.layout ?? "image-top",
    };
  }

  it("emits a slide for an image-less step block with title + body", () => {
    const doc = makeDocument([
      makeImagelessStepBlock("step-1", { title: "Wrap up", body: "Save your work." }),
    ]);
    const files = buildDocumentPptxFiles(doc);
    expect(files["ppt/slides/slide1.xml"]).toBeDefined();
    const slide1 = decode(files["ppt/slides/slide1.xml"]!);
    expect(slide1).toContain("<a:t>Wrap up</a:t>");
    expect(slide1).toContain("<a:t>Save your work.</a:t>");
  });

  it("omits the image group entirely (no <p:grpSp>, no media file)", () => {
    const doc = makeDocument([makeImagelessStepBlock("step-1", { title: "T", body: "B" })]);
    const files = buildDocumentPptxFiles(doc);
    const slide1 = decode(files["ppt/slides/slide1.xml"]!);
    expect(slide1).not.toContain("<p:grpSp>");
    expect(slide1).not.toContain("ImageGroup");
    expect(slide1).not.toContain("<p:pic>");
    // No media bytes — image-less slides reference no screenshot.
    expect(files["ppt/media/screenshot1.png"]).toBeUndefined();
    expect(files["ppt/media/screenshot1.jpeg"]).toBeUndefined();
  });

  it("skips an entirely empty step block (no title, no body)", () => {
    const doc = makeDocument([
      makeImagelessStepBlock("step-1", { title: "", body: "" }),
      makeStepBlock("step-2", 800, 600, { title: "Visible" }),
    ]);
    const files = buildDocumentPptxFiles(doc);
    // Only one slide should exist (the image-bearing step); the
    // empty image-less step contributes nothing.
    expect(files["ppt/slides/slide1.xml"]).toBeDefined();
    expect(files["ppt/slides/slide2.xml"]).toBeUndefined();
  });

  it("interleaves image-less step slides with image-bearing slides in document order", () => {
    const doc = makeDocument([
      makeStepBlock("step-1", 800, 600, { title: "With image" }),
      makeImagelessStepBlock("step-2", { title: "Text-only step", body: "Narrative." }),
      makeStepBlock("step-3", 800, 600, { title: "Back to image" }),
    ]);
    const files = buildDocumentPptxFiles(doc);
    expect(files["ppt/slides/slide1.xml"]).toBeDefined();
    expect(files["ppt/slides/slide2.xml"]).toBeDefined();
    expect(files["ppt/slides/slide3.xml"]).toBeDefined();
    const slide2 = decode(files["ppt/slides/slide2.xml"]!);
    // Middle slide is the image-less one — no image group.
    expect(slide2).not.toContain("<p:grpSp>");
    expect(slide2).toContain("<a:t>Text-only step</a:t>");
  });

  it("uses the uniform 1280×720 canvas for image-less step slides too", () => {
    const doc = makeDocument([makeImagelessStepBlock("step-1", { title: "Hi" })]);
    const files = buildDocumentPptxFiles(doc);
    const presentationXml = decode(files["ppt/presentation.xml"]!);
    expect(presentationXml).toContain('<p:sldSz cx="12192000" cy="6858000" type="custom"/>');
  });
});

describe("exportDocumentPptx", () => {
  it("returns null for a document with no image blocks", () => {
    const doc = makeDocument([{ kind: "paragraph", inlineHtml: "no images" }]);
    expect(exportDocumentPptx(doc)).toBeNull();
  });

  it("returns a Blob for a document containing only image-less step blocks (Phase 7a)", () => {
    // Image-less step blocks ARE exportable — they produce a
    // text-only slide. The result blob carries the OOXML
    // envelope plus one slide xml.
    const doc = makeDocument([
      {
        kind: "step",
        id: "step-1",
        svg: "",
        title: "Hello",
        body: "World",
        layout: "image-top",
      },
    ]);
    const blob = exportDocumentPptx(doc);
    expect(blob).not.toBeNull();
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
