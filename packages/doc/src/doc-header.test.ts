// @vitest-environment happy-dom
//
// Targeted coverage for the Scribe-style document header landed
// in Phase 7c of `docs/plans/card-procedure-template.md`. The
// header is regenerated on every save from `meta.header` +
// `meta.title` + `meta.author` + a step-block walk, matching the
// existing TOC pattern: the parser skips elements carrying
// `data-annot-doc-header` so the model never round-trips through
// stale header bytes.

import { describe, expect, it } from "vitest";
import { parseDocument } from "./parse.js";
import { serializeDocument, serializeMetaJson } from "./serialize.js";
import type { AnnotDocument, StepBlock } from "./types.js";
import { ANNOT_DOC_VERSION } from "./types.js";

const CANONICAL_SVG = [
  '<svg data-annot-version="1" viewBox="0 0 10 10" width="10" height="10" xmlns="http://www.w3.org/2000/svg">',
  '  <image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/>',
  '  <g id="annotations"/>',
  "</svg>",
].join("\n");

function makeStep(id: string): StepBlock {
  return {
    kind: "step",
    id,
    svg: CANONICAL_SVG,
    title: "Step",
    body: "Body.",
    layout: "image-top",
  };
}

function makeHeadedDoc(): AnnotDocument {
  return {
    version: ANNOT_DOC_VERSION,
    lang: "en",
    title: "Quick start",
    meta: {
      title: "Quick start",
      author: "Naoki Ichimura",
      header: {
        icon: "data:image/png;base64,iVBORw0KGgo=",
        description: "Get up and running in five steps.",
      },
    },
    styleBlock: null,
    blocks: [makeStep("img-step-1"), makeStep("img-step-2")],
  };
}

describe("doc header (Phase 7c): serialize", () => {
  it("emits a <section data-annot-doc-header> when meta.header is set", () => {
    const bytes = serializeDocument(makeHeadedDoc());
    expect(bytes).toContain("<section data-annot-doc-header>");
    expect(bytes).toContain("</section>");
  });

  it("emits the icon, title, description, author, and step count", () => {
    const bytes = serializeDocument(makeHeadedDoc());
    expect(bytes).toContain(
      '<img data-annot-doc-header-icon src="data:image/png;base64,iVBORw0KGgo=" alt="">',
    );
    expect(bytes).toContain("<h1 data-annot-doc-header-title>Quick start</h1>");
    expect(bytes).toContain(
      "<p data-annot-doc-header-description>Get up and running in five steps.</p>",
    );
    expect(bytes).toContain("<span data-annot-doc-header-author>Naoki Ichimura</span>");
    expect(bytes).toContain("<span data-annot-doc-header-step-count>2 steps</span>");
  });

  it("uses '1 step' (singular) when the doc has exactly one step block", () => {
    const doc: AnnotDocument = {
      ...makeHeadedDoc(),
      blocks: [makeStep("img-step-1")],
    };
    const bytes = serializeDocument(doc);
    expect(bytes).toContain("<span data-annot-doc-header-step-count>1 step</span>");
    expect(bytes).not.toContain("1 steps");
  });

  it("omits the icon when meta.header.icon is unset", () => {
    const doc: AnnotDocument = {
      ...makeHeadedDoc(),
      meta: {
        ...makeHeadedDoc().meta,
        header: { description: "Plain description, no icon." },
      },
    };
    const bytes = serializeDocument(doc);
    expect(bytes).toContain("<section data-annot-doc-header>");
    expect(bytes).not.toContain("data-annot-doc-header-icon");
    expect(bytes).toContain("data-annot-doc-header-description");
  });

  it("omits the description when meta.header.description is unset", () => {
    const doc: AnnotDocument = {
      ...makeHeadedDoc(),
      meta: {
        ...makeHeadedDoc().meta,
        header: { icon: "data:image/png;base64,iVBORw0KGgo=" },
      },
    };
    const bytes = serializeDocument(doc);
    expect(bytes).toContain("<section data-annot-doc-header>");
    expect(bytes).toContain("data-annot-doc-header-icon");
    expect(bytes).not.toContain("data-annot-doc-header-description");
  });

  it("does NOT emit the header section when meta.header is absent", () => {
    const doc: AnnotDocument = {
      ...makeHeadedDoc(),
      meta: { title: "Quick start" },
    };
    const bytes = serializeDocument(doc);
    expect(bytes).not.toContain("data-annot-doc-header");
  });

  it("does NOT emit the header when meta.header has all-empty fields", () => {
    const doc: AnnotDocument = {
      ...makeHeadedDoc(),
      meta: {
        title: "Quick start",
        header: { icon: "", description: "" },
      },
    };
    const bytes = serializeDocument(doc);
    expect(bytes).not.toContain("data-annot-doc-header");
  });

  it("escapes HTML metachars in description and author", () => {
    const doc: AnnotDocument = {
      version: ANNOT_DOC_VERSION,
      lang: "en",
      title: "T",
      meta: {
        title: "T",
        author: "Foo <bar> & Co",
        header: { description: "Use < & > for comparison." },
      },
      styleBlock: null,
      blocks: [makeStep("img-step-1")],
    };
    const bytes = serializeDocument(doc);
    expect(bytes).toContain("<span data-annot-doc-header-author>Foo &lt;bar&gt; &amp; Co</span>");
    expect(bytes).toContain(
      "<p data-annot-doc-header-description>Use &lt; &amp; &gt; for comparison.</p>",
    );
  });

  it("places the header section BEFORE the TOC (if any) in the article body", () => {
    const doc: AnnotDocument = {
      version: ANNOT_DOC_VERSION,
      lang: "en",
      title: "Headed",
      meta: {
        title: "Headed",
        header: { description: "Has a TOC because two headings." },
      },
      styleBlock: null,
      blocks: [
        { kind: "heading", level: 1, inlineHtml: "First" },
        { kind: "heading", level: 1, inlineHtml: "Second" },
      ],
    };
    const bytes = serializeDocument(doc);
    const headerIdx = bytes.indexOf("data-annot-doc-header");
    const tocIdx = bytes.indexOf("data-annot-toc");
    expect(headerIdx).toBeGreaterThan(0);
    expect(tocIdx).toBeGreaterThan(0);
    expect(headerIdx).toBeLessThan(tocIdx);
  });
});

describe("doc header (Phase 7c): parse", () => {
  it("reads meta.header from the JSON sidecar", () => {
    const bytes = serializeDocument(makeHeadedDoc());
    const reparsed = parseDocument(bytes);
    expect(reparsed.meta.header).toEqual({
      icon: "data:image/png;base64,iVBORw0KGgo=",
      description: "Get up and running in five steps.",
    });
  });

  it("skips the <section data-annot-doc-header> from the block list (regenerated)", () => {
    const bytes = serializeDocument(makeHeadedDoc());
    const reparsed = parseDocument(bytes);
    // The blocks list should NOT contain an `unknown` block
    // capturing the header section bytes.
    for (const b of reparsed.blocks) {
      expect(b.kind).not.toBe("unknown");
    }
  });

  it("round-trips a headed document byte-for-byte", () => {
    const bytes = serializeDocument(makeHeadedDoc());
    const reparsed = parseDocument(bytes);
    expect(serializeDocument(reparsed)).toBe(bytes);
  });

  it("treats an empty meta.header object as absent (no field round-trip)", () => {
    // {"header":{}} parses as `undefined` so serializer never
    // emits a no-op header block / no-op JSON field.
    const html = serializeDocument(makeHeadedDoc()).replace(/"header":\{[^}]+\}/, '"header":{}');
    const reparsed = parseDocument(html);
    expect(reparsed.meta.header).toBeUndefined();
  });
});

describe("doc header (Phase 7c): cardLayout meta sidecar", () => {
  it("serialises the header object alphabetically inside the meta JSON", () => {
    const meta = serializeMetaJson({
      title: "T",
      header: { icon: "data:image/png;base64,X", description: "Desc" },
    });
    // header < title alphabetically; inside header,
    // description < icon.
    expect(meta).toBe(
      '{"header":{"description":"Desc","icon":"data:image/png;base64,X"},"title":"T"}',
    );
  });
});
