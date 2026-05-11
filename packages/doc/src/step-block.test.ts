// @vitest-environment happy-dom
//
// Targeted coverage for the `step` block kind landed in Phase 1
// of `docs/plans/card-procedure-template.md`. The fixture-driven
// round-trip is in `round-trip.test.ts` (the three Phase 0
// fixtures join the existing FIXTURES array). This file covers
// the model edges the fixtures can't easily hit:
//
//   - `data-step-layout` enum coverage + missing-attribute
//     defaulting (image-top).
//   - Missing required child slots throw a `AnnotDocParseError`
//     with a useful message — not a silent UnknownBlock fallback.
//   - `data-annot-image-id` is required.
//   - `cloneTemplate` remints step-block IDs alongside image-block
//     IDs and remaps `meta.imageMeta` keys for both.
//   - `meta.cardLayout` round-trips through parse → serialize and
//     survives the `cloneTemplate` strip-template pass.

import { describe, expect, it } from "vitest";
import { cloneTemplate } from "./clone-template.js";
import { parseDocument } from "./parse.js";
import { serializeDocument, serializeMetaJson } from "./serialize.js";
import type { AnnotDocument, StepBlock, StepLayout } from "./types.js";
import { ANNOT_DOC_VERSION } from "./types.js";

const CANONICAL_SVG = [
  '<svg data-annot-version="1" viewBox="0 0 10 10" width="10" height="10" xmlns="http://www.w3.org/2000/svg">',
  '  <image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/>',
  '  <g id="annotations"/>',
  "</svg>",
].join("\n");

function wrap(articleChildren: string, metaJson = '{"title":"Test"}'): string {
  return `<!doctype html>
<html data-annot-doc-version="1" lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="annot-document" content="1">
    <title>Test</title>
  </head>
  <body>
    <article data-annot-doc>
${articleChildren}
    </article>
    <script type="application/annot+json" data-annot-doc-meta>${metaJson}</script>
  </body>
</html>
`;
}

function buildStepHtml(layout: string, id = "img-step-01"): string {
  return `      <section data-annot-block="step" data-annot-image-id="${id}" data-step-layout="${layout}">
        <svg data-annot-version="1" viewBox="0 0 10 10" width="10" height="10" xmlns="http://www.w3.org/2000/svg">
          <image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/>
          <g id="annotations"/>
        </svg>
        <h3 data-step-title>Title</h3>
        <p data-step-body>Body.</p>
      </section>`;
}

describe("step block: parser", () => {
  it("recognises every layout enum value", () => {
    const layouts: StepLayout[] = [
      "image-top",
      "image-bottom",
      "image-left",
      "image-right",
      "image-fill",
    ];
    for (const layout of layouts) {
      const doc = parseDocument(wrap(buildStepHtml(layout)));
      const step = doc.blocks.find((b) => b.kind === "step");
      if (step?.kind !== "step") throw new Error(`expected step for layout=${layout}`);
      expect(step.layout).toBe(layout);
    }
  });

  it("defaults `data-step-layout` to image-top when the attribute is absent", () => {
    const html = wrap(`      <section data-annot-block="step" data-annot-image-id="img-step-01">
        <svg data-annot-version="1" viewBox="0 0 10 10" width="10" height="10" xmlns="http://www.w3.org/2000/svg">
          <image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/>
          <g id="annotations"/>
        </svg>
        <h3 data-step-title>Title</h3>
        <p data-step-body>Body.</p>
      </section>`);
    const doc = parseDocument(html);
    const step = doc.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.layout).toBe("image-top");
  });

  it("defaults an unrecognised `data-step-layout` value to image-top", () => {
    const doc = parseDocument(wrap(buildStepHtml("image-diagonal")));
    const step = doc.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.layout).toBe("image-top");
  });

  it("preserves title + body inline HTML verbatim", () => {
    const html =
      wrap(`      <section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-top">
        <svg data-annot-version="1" viewBox="0 0 10 10" width="10" height="10" xmlns="http://www.w3.org/2000/svg">
          <image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/>
          <g id="annotations"/>
        </svg>
        <h3 data-step-title>Open <strong>Settings</strong></h3>
        <p data-step-body>Click <em>here</em>.</p>
      </section>`);
    const doc = parseDocument(html);
    const step = doc.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.title).toBe("Open <strong>Settings</strong>");
    expect(step.body).toBe("Click <em>here</em>.");
  });

  it("throws when data-annot-image-id is missing", () => {
    const html = wrap(`      <section data-annot-block="step" data-step-layout="image-top">
        <svg data-annot-version="1" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><g id="annotations"/></svg>
        <h3 data-step-title>T</h3>
        <p data-step-body>B</p>
      </section>`);
    expect(() => parseDocument(html)).toThrow(/data-annot-image-id/);
  });

  it("throws when the title slot is missing", () => {
    const html =
      wrap(`      <section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-top">
        <svg data-annot-version="1" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><g id="annotations"/></svg>
        <p data-step-body>B</p>
      </section>`);
    expect(() => parseDocument(html)).toThrow(/data-step-title/);
  });

  it("throws when the body slot is missing", () => {
    const html =
      wrap(`      <section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-top">
        <svg data-annot-version="1" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><g id="annotations"/></svg>
        <h3 data-step-title>T</h3>
      </section>`);
    expect(() => parseDocument(html)).toThrow(/data-step-body/);
  });

  it("throws when the SVG child is missing", () => {
    const html =
      wrap(`      <section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-top">
        <h3 data-step-title>T</h3>
        <p data-step-body>B</p>
      </section>`);
    expect(() => parseDocument(html)).toThrow(/svg/i);
  });
});

describe("step block: serializer", () => {
  function buildStep(layout: StepLayout, id = "img-step-01"): StepBlock {
    return { kind: "step", id, svg: CANONICAL_SVG, title: "Title", body: "Body.", layout };
  }

  it("always emits data-step-layout explicitly even for image-top", () => {
    const doc: AnnotDocument = {
      version: ANNOT_DOC_VERSION,
      lang: "en",
      title: "T",
      meta: { title: "T" },
      styleBlock: null,
      blocks: [buildStep("image-top")],
    };
    const bytes = serializeDocument(doc);
    expect(bytes).toContain('data-step-layout="image-top"');
  });

  it("emits the canonical attribute order on <section>", () => {
    const doc: AnnotDocument = {
      version: ANNOT_DOC_VERSION,
      lang: "en",
      title: "T",
      meta: { title: "T" },
      styleBlock: null,
      blocks: [buildStep("image-left")],
    };
    const bytes = serializeDocument(doc);
    // data-annot-block → data-annot-image-id → data-step-layout.
    expect(bytes).toContain(
      '<section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-left">',
    );
  });

  it("emits the three children in fixed order: svg → title → body", () => {
    const doc: AnnotDocument = {
      version: ANNOT_DOC_VERSION,
      lang: "en",
      title: "T",
      meta: { title: "T" },
      styleBlock: null,
      blocks: [buildStep("image-top")],
    };
    const bytes = serializeDocument(doc);
    const svgIdx = bytes.indexOf("<svg ");
    const titleIdx = bytes.indexOf("<h3 data-step-title>");
    const bodyIdx = bytes.indexOf("<p data-step-body>");
    expect(svgIdx).toBeGreaterThan(0);
    expect(titleIdx).toBeGreaterThan(svgIdx);
    expect(bodyIdx).toBeGreaterThan(titleIdx);
  });

  it("emits empty title + body slots when the strings are empty", () => {
    const doc: AnnotDocument = {
      version: ANNOT_DOC_VERSION,
      lang: "en",
      title: "T",
      meta: { title: "T" },
      styleBlock: null,
      blocks: [
        {
          kind: "step",
          id: "img-step-01",
          svg: CANONICAL_SVG,
          title: "",
          body: "",
          layout: "image-top",
        },
      ],
    };
    const bytes = serializeDocument(doc);
    expect(bytes).toContain("<h3 data-step-title></h3>");
    expect(bytes).toContain("<p data-step-body></p>");
  });
});

describe("step block: cardLayout meta", () => {
  it("serialises cardLayout in the JSON sidecar with alphabetical keys", () => {
    const meta = serializeMetaJson({
      title: "T",
      cardLayout: { columns: 2, defaultStepLayout: "image-left" },
    });
    // Alphabetical at every level: cardLayout < title; inside
    // cardLayout, columns < defaultStepLayout.
    expect(meta).toBe('{"cardLayout":{"columns":2,"defaultStepLayout":"image-left"},"title":"T"}');
  });

  it("round-trips a cardLayout with only columns set", () => {
    const html = wrap(buildStepHtml("image-top"), '{"cardLayout":{"columns":3},"title":"Test"}');
    const doc = parseDocument(html);
    expect(doc.meta.cardLayout).toEqual({ columns: 3 });
    expect(serializeDocument(doc)).toBe(html);
  });

  it("round-trips a cardLayout with only defaultStepLayout set", () => {
    const html = wrap(
      buildStepHtml("image-top"),
      '{"cardLayout":{"defaultStepLayout":"image-fill"},"title":"Test"}',
    );
    const doc = parseDocument(html);
    expect(doc.meta.cardLayout).toEqual({ defaultStepLayout: "image-fill" });
    expect(serializeDocument(doc)).toBe(html);
  });

  it("treats an empty cardLayout object as absent (no field round-trip)", () => {
    // {"cardLayout": {}} parses as `undefined` so the round-trip
    // serializer doesn't emit a no-op key.
    const html = wrap(buildStepHtml("image-top"), '{"cardLayout":{},"title":"Test"}');
    const doc = parseDocument(html);
    expect(doc.meta.cardLayout).toBeUndefined();
  });

  it('accepts columns="auto"', () => {
    const html = wrap(
      buildStepHtml("image-top"),
      '{"cardLayout":{"columns":"auto"},"title":"Test"}',
    );
    const doc = parseDocument(html);
    expect(doc.meta.cardLayout).toEqual({ columns: "auto" });
  });
});

describe("step block: cloneTemplate integration", () => {
  function buildTemplateWithSteps(): AnnotDocument {
    return {
      version: ANNOT_DOC_VERSION,
      lang: "en",
      title: "Card procedure",
      meta: {
        title: "Card procedure",
        cardLayout: { columns: 2, defaultStepLayout: "image-top" },
        template: { name: "card-procedure" },
        imageMeta: {
          "img-step-source-1": { alt: "Step one screenshot" },
          "img-step-source-2": { alt: "Step two screenshot" },
        },
      },
      styleBlock: null,
      blocks: [
        { kind: "heading", level: 1, inlineHtml: "[Title]" },
        {
          kind: "step",
          id: "img-step-source-1",
          svg: CANONICAL_SVG,
          title: "First step",
          body: "Do the first thing.",
          layout: "image-top",
        },
        {
          kind: "step",
          id: "img-step-source-2",
          svg: CANONICAL_SVG,
          title: "Second step",
          body: "Do the second thing.",
          layout: "image-left",
        },
      ],
    };
  }

  it("mints fresh ids for every step block alongside any image blocks", () => {
    let counter = 0;
    const template = buildTemplateWithSteps();
    const clone = cloneTemplate(template, { makeId: () => `img-fresh-${++counter}` });
    const stepIds = clone.blocks.filter((b) => b.kind === "step").map((b) => b.id);
    expect(stepIds).toEqual(["img-fresh-1", "img-fresh-2"]);
  });

  it("preserves step title / body / layout / svg across the clone", () => {
    let counter = 0;
    const template = buildTemplateWithSteps();
    const clone = cloneTemplate(template, { makeId: () => `img-fresh-${++counter}` });
    const sources = template.blocks.filter((b) => b.kind === "step");
    const clones = clone.blocks.filter((b) => b.kind === "step");
    expect(sources.length).toBe(clones.length);
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i]!;
      const dst = clones[i]!;
      if (src.kind !== "step" || dst.kind !== "step") throw new Error("expected step");
      expect(dst.id).not.toBe(src.id);
      expect(dst.svg).toBe(src.svg);
      expect(dst.title).toBe(src.title);
      expect(dst.body).toBe(src.body);
      expect(dst.layout).toBe(src.layout);
    }
  });

  it("remaps imageMeta keys for step blocks the same way as image blocks", () => {
    let counter = 0;
    const template = buildTemplateWithSteps();
    const clone = cloneTemplate(template, { makeId: () => `img-fresh-${++counter}` });
    const meta = clone.meta.imageMeta;
    if (!meta) throw new Error("imageMeta was dropped");
    expect(meta["img-fresh-1"]).toEqual({ alt: "Step one screenshot" });
    expect(meta["img-fresh-2"]).toEqual({ alt: "Step two screenshot" });
    expect(meta["img-step-source-1"]).toBeUndefined();
    expect(meta["img-step-source-2"]).toBeUndefined();
  });

  it("preserves meta.cardLayout while stripping meta.template", () => {
    const template = buildTemplateWithSteps();
    const clone = cloneTemplate(template);
    expect(clone.meta.cardLayout).toEqual({ columns: 2, defaultStepLayout: "image-top" });
    expect(clone.meta.template).toBeUndefined();
  });

  it("the cloned document survives serialize → parse byte-for-byte", () => {
    let counter = 0;
    const template = buildTemplateWithSteps();
    const clone = cloneTemplate(template, { makeId: () => `img-fresh-${++counter}` });
    const bytes = serializeDocument(clone);
    const reparsed = parseDocument(bytes);
    expect(serializeDocument(reparsed)).toBe(bytes);
  });
});
