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

  // Phase 7a of `docs/plans/card-procedure-template.md` — the
  // `<svg>` child is OPTIONAL. An image-less step block carries
  // text-only content. The parser yields `svg: ""` and accepts
  // both the `data-step-image-less="1"` decorator and its
  // absence (defensive against hand-authored input).
  it("accepts a missing SVG child as an image-less step (Phase 7a)", () => {
    const html =
      wrap(`      <section data-annot-block="step" data-annot-image-id="img-step-01" data-step-image-less="1" data-step-layout="image-top">
        <h3 data-step-title>Recap</h3>
        <p data-step-body>That's it for now.</p>
      </section>`);
    const doc = parseDocument(html);
    const step = doc.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.svg).toBe("");
    expect(step.title).toBe("Recap");
    expect(step.body).toBe("That's it for now.");
  });

  it("treats a step with no <svg> child as image-less even without the decorator", () => {
    const html =
      wrap(`      <section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-top">
        <h3 data-step-title>T</h3>
        <p data-step-body>B</p>
      </section>`);
    const doc = parseDocument(html);
    const step = doc.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.svg).toBe("");
  });

  // Phase 7b of `docs/plans/card-procedure-template.md` —
  // optional URL chip parses out of `data-step-url` +
  // `data-step-url-label`, with allowed-scheme allowlist.
  it("parses a step block's data-step-url + data-step-url-label into block.link (Phase 7b)", () => {
    const html =
      wrap(`      <section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-top" data-step-url="https://example.com/docs" data-step-url-label="Documentation">
        <svg data-annot-version="1" viewBox="0 0 10 10" width="10" height="10" xmlns="http://www.w3.org/2000/svg">
          <image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/>
          <g id="annotations"/>
        </svg>
        <h3 data-step-title>T</h3>
        <p data-step-body>B</p>
      </section>`);
    const doc = parseDocument(html);
    const step = doc.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.link).toEqual({ url: "https://example.com/docs", label: "Documentation" });
  });

  it("parses a URL without a label as a label-less link", () => {
    const html =
      wrap(`      <section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-top" data-step-url="https://example.com">
        <svg data-annot-version="1" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><g id="annotations"/></svg>
        <h3 data-step-title>T</h3>
        <p data-step-body>B</p>
      </section>`);
    const doc = parseDocument(html);
    const step = doc.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.link).toEqual({ url: "https://example.com" });
  });

  it("drops a javascript: URL on parse (security allowlist)", () => {
    const html =
      wrap(`      <section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-top" data-step-url="javascript:alert(1)" data-step-url-label="Click me">
        <svg data-annot-version="1" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><g id="annotations"/></svg>
        <h3 data-step-title>T</h3>
        <p data-step-body>B</p>
      </section>`);
    const doc = parseDocument(html);
    const step = doc.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.link).toBeUndefined();
  });

  it("drops a data: URL on parse (security allowlist)", () => {
    const html =
      wrap(`      <section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-top" data-step-url="data:text/html,<script>alert(1)</script>">
        <svg data-annot-version="1" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><g id="annotations"/></svg>
        <h3 data-step-title>T</h3>
        <p data-step-body>B</p>
      </section>`);
    const doc = parseDocument(html);
    const step = doc.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.link).toBeUndefined();
  });

  it("accepts mailto: URLs", () => {
    const html =
      wrap(`      <section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-top" data-step-url="mailto:hello@example.com">
        <svg data-annot-version="1" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><g id="annotations"/></svg>
        <h3 data-step-title>T</h3>
        <p data-step-body>B</p>
      </section>`);
    const doc = parseDocument(html);
    const step = doc.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.link).toEqual({ url: "mailto:hello@example.com" });
  });

  // Phase 7d of `docs/plans/card-procedure-template.md` —
  // initial-view viewport parses from `data-step-viewport="x,y,w,h"`.
  it("parses data-step-viewport into block.viewport (Phase 7d)", () => {
    const html =
      wrap(`      <section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-top" data-step-viewport="100,200,400,300">
        <svg data-annot-version="1" viewBox="0 0 800 600" width="800" height="600" xmlns="http://www.w3.org/2000/svg"><g id="annotations"/></svg>
        <h3 data-step-title>T</h3>
        <p data-step-body>B</p>
      </section>`);
    const doc = parseDocument(html);
    const step = doc.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.viewport).toEqual({ x: 100, y: 200, w: 400, h: 300 });
  });

  it("drops a malformed data-step-viewport (wrong field count)", () => {
    const html =
      wrap(`      <section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-top" data-step-viewport="100,200,400">
        <svg data-annot-version="1" viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg"><g id="annotations"/></svg>
        <h3 data-step-title>T</h3>
        <p data-step-body>B</p>
      </section>`);
    const doc = parseDocument(html);
    const step = doc.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.viewport).toBeUndefined();
  });

  it("drops a viewport with non-positive w/h", () => {
    const html =
      wrap(`      <section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-top" data-step-viewport="100,200,0,300">
        <svg data-annot-version="1" viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg"><g id="annotations"/></svg>
        <h3 data-step-title>T</h3>
        <p data-step-body>B</p>
      </section>`);
    const doc = parseDocument(html);
    const step = doc.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.viewport).toBeUndefined();
  });

  it("accepts fractional viewport coords", () => {
    const html =
      wrap(`      <section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-top" data-step-viewport="12.5,37.5,123.4,89.6">
        <svg data-annot-version="1" viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg"><g id="annotations"/></svg>
        <h3 data-step-title>T</h3>
        <p data-step-body>B</p>
      </section>`);
    const doc = parseDocument(html);
    const step = doc.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.viewport).toEqual({ x: 12.5, y: 37.5, w: 123.4, h: 89.6 });
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

  // Phase 7a — image-less step blocks: `svg === ""` skips the
  // `<svg>` child emission entirely and stamps the section with
  // `data-step-image-less="1"` so the CSS can collapse the grid.
  it("omits the <svg> child and emits data-step-image-less when svg is empty", () => {
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
          svg: "",
          title: "Recap",
          body: "Wrap up.",
          layout: "image-top",
        },
      ],
    };
    const bytes = serializeDocument(doc);
    expect(bytes).not.toContain("<svg ");
    expect(bytes).toContain(
      '<section data-annot-block="step" data-annot-image-id="img-step-01" data-step-image-less="1" data-step-layout="image-top">',
    );
    expect(bytes).toContain("<h3 data-step-title>Recap</h3>");
    expect(bytes).toContain("<p data-step-body>Wrap up.</p>");
  });

  it("round-trips an image-less step byte-for-byte", () => {
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
          svg: "",
          title: "Recap",
          body: "Wrap up.",
          layout: "image-fill",
        },
      ],
    };
    const bytes = serializeDocument(doc);
    const reparsed = parseDocument(bytes);
    expect(serializeDocument(reparsed)).toBe(bytes);
    const step = reparsed.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step");
    expect(step.svg).toBe("");
    expect(step.layout).toBe("image-fill");
  });

  // Phase 7b — URL chip serialisation. data-step-url and
  // data-step-url-label appear AFTER data-step-layout in
  // canonical alphabetical order.
  it("emits data-step-url + data-step-url-label after data-step-layout (Phase 7b)", () => {
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
          title: "Open Settings",
          body: "Click the gear.",
          layout: "image-top",
          link: { url: "https://example.com", label: "Docs" },
        },
      ],
    };
    const bytes = serializeDocument(doc);
    expect(bytes).toContain(
      '<section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-top" data-step-url="https://example.com" data-step-url-label="Docs">',
    );
  });

  it("omits data-step-url-label when no label is set", () => {
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
          title: "T",
          body: "B",
          layout: "image-top",
          link: { url: "https://example.com" },
        },
      ],
    };
    const bytes = serializeDocument(doc);
    expect(bytes).toContain('data-step-url="https://example.com"');
    expect(bytes).not.toContain("data-step-url-label");
  });

  it("escapes special chars in the URL and label", () => {
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
          title: "T",
          body: "B",
          layout: "image-top",
          link: {
            url: "https://example.com/search?q=a&b=c",
            label: 'AT&T "billing"',
          },
        },
      ],
    };
    const bytes = serializeDocument(doc);
    expect(bytes).toContain('data-step-url="https://example.com/search?q=a&amp;b=c"');
    expect(bytes).toContain('data-step-url-label="AT&amp;T &quot;billing&quot;"');
  });

  it("round-trips a step block with link byte-for-byte", () => {
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
          title: "T",
          body: "B",
          layout: "image-top",
          link: { url: "https://example.com", label: "Docs" },
        },
      ],
    };
    const bytes = serializeDocument(doc);
    const reparsed = parseDocument(bytes);
    expect(serializeDocument(reparsed)).toBe(bytes);
    const step = reparsed.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step");
    expect(step.link).toEqual({ url: "https://example.com", label: "Docs" });
  });

  it("round-trips an image-less step with link byte-for-byte", () => {
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
          svg: "",
          title: "Visit the dashboard",
          body: "",
          layout: "image-top",
          link: { url: "https://example.com/dashboard" },
        },
      ],
    };
    const bytes = serializeDocument(doc);
    const reparsed = parseDocument(bytes);
    expect(serializeDocument(reparsed)).toBe(bytes);
    const step = reparsed.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step");
    expect(step.svg).toBe("");
    expect(step.link).toEqual({ url: "https://example.com/dashboard" });
  });

  // Phase 7d — viewport serialisation. data-step-viewport
  // appears AFTER data-step-url-label in canonical order.
  it("emits data-step-viewport after data-step-url-label (Phase 7d)", () => {
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
          title: "T",
          body: "B",
          layout: "image-top",
          viewport: { x: 100, y: 200, w: 400, h: 300 },
        },
      ],
    };
    const bytes = serializeDocument(doc);
    expect(bytes).toContain(
      '<section data-annot-block="step" data-annot-image-id="img-step-01" data-step-layout="image-top" data-step-viewport="100,200,400,300">',
    );
  });

  it("emits viewport after both URL and viewport when both are set", () => {
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
          title: "T",
          body: "B",
          layout: "image-top",
          link: { url: "https://example.com", label: "Docs" },
          viewport: { x: 50, y: 60, w: 200, h: 150 },
        },
      ],
    };
    const bytes = serializeDocument(doc);
    expect(bytes).toContain(
      'data-step-layout="image-top" data-step-url="https://example.com" data-step-url-label="Docs" data-step-viewport="50,60,200,150">',
    );
  });

  it("round-trips a step block with viewport byte-for-byte", () => {
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
          title: "T",
          body: "B",
          layout: "image-top",
          viewport: { x: 12.5, y: 37.5, w: 123.4, h: 89.6 },
        },
      ],
    };
    const bytes = serializeDocument(doc);
    const reparsed = parseDocument(bytes);
    expect(serializeDocument(reparsed)).toBe(bytes);
    const step = reparsed.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step");
    expect(step.viewport).toEqual({ x: 12.5, y: 37.5, w: 123.4, h: 89.6 });
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

  // Phase 7b — `link` field carries through cloneTemplate unchanged.
  it("preserves step.link across clone (Phase 7b)", () => {
    let counter = 0;
    const template: AnnotDocument = {
      version: ANNOT_DOC_VERSION,
      lang: "en",
      title: "Linked card procedure",
      meta: { title: "Linked card procedure", template: { name: "card-procedure" } },
      styleBlock: null,
      blocks: [
        {
          kind: "step",
          id: "img-step-source-1",
          svg: CANONICAL_SVG,
          title: "Visit the docs",
          body: "Read the API reference.",
          layout: "image-top",
          link: { url: "https://example.com/docs", label: "Docs" },
        },
      ],
    };
    const clone = cloneTemplate(template, { makeId: () => `img-fresh-${++counter}` });
    const step = clone.blocks.find((b) => b.kind === "step");
    if (step?.kind !== "step") throw new Error("expected step");
    expect(step.id).toBe("img-fresh-1");
    expect(step.link).toEqual({ url: "https://example.com/docs", label: "Docs" });
  });
});
