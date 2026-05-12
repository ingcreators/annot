// @vitest-environment happy-dom
//
// Structural-clone coverage for `cloneTemplate`. Phase 8a of
// `docs/plans/_done/annot-html-document.md`.
//
// The contract: given a template document, the clone has
// (a) every template marker absent, (b) every image-block ID
// reminted, (c) every other byte preserved. happy-dom is needed
// because the fixture-driven "round-trip the cloned bytes"
// portion calls `parseDocument` (which lazily resolves
// `globalThis.DOMParser`).

import { describe, expect, it } from "vitest";
import { cloneTemplate } from "./clone-template.js";
import { parseDocument } from "./parse.js";
import { serializeDocument } from "./serialize.js";
import type { AnnotDocument, ImageBlock } from "./types.js";
import { ANNOT_DOC_VERSION } from "./types.js";

/** Build a deterministic id-factory for tests so we can assert
 *  exact substituted values. */
function counterIdFactory(prefix = "img-test"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/** Hand-build a template document with two image blocks + a
 *  template sub-object + per-image alt metadata. Tests can clone
 *  it without going through the parser. */
function buildTemplate(): AnnotDocument {
  // Use the canonical SVG form (multi-line, dedented to column
  // 0) the parser produces so fixtures survive round-trip
  // through serialize → parse → serialize. The serializer
  // re-indents each line with the figure-child indent on emit.
  const svg1 = [
    '<svg data-annot-version="1" viewBox="0 0 10 10" width="10" height="10" xmlns="http://www.w3.org/2000/svg">',
    '  <image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/>',
    '  <g id="annotations"/>',
    "</svg>",
  ].join("\n");
  const svg2 = [
    '<svg data-annot-version="1" viewBox="0 0 20 20" width="20" height="20" xmlns="http://www.w3.org/2000/svg">',
    '  <image href="data:image/png;base64,iVBORw0KGgo=" width="20" height="20"/>',
    '  <g id="annotations"/>',
    "</svg>",
  ].join("\n");
  const img1: ImageBlock = {
    kind: "image",
    id: "img-original-1",
    svg: svg1,
    caption: "First step",
  };
  const img2: ImageBlock = {
    kind: "image",
    id: "img-original-2",
    svg: svg2,
  };
  return {
    version: ANNOT_DOC_VERSION,
    lang: "en",
    title: "Manual template",
    meta: {
      title: "Manual template",
      author: "Annot",
      theme: "light",
      maxWidth: "medium",
      template: {
        name: "manual",
        description: "Step-by-step manual",
        tags: ["bundled", "manual"],
      },
      imageMeta: {
        "img-original-1": { alt: "Login form" },
        "img-original-2": { alt: "Dashboard", capturedAt: "2026-04-01" },
      },
    },
    styleBlock: "/* template style */",
    blocks: [
      { kind: "heading", level: 1, inlineHtml: "[Title]" },
      { kind: "paragraph", inlineHtml: "[Add an overview here]" },
      img1,
      { kind: "divider" },
      img2,
    ],
  };
}

describe("cloneTemplate: marker stripping", () => {
  it("removes meta.template from the cloned document", () => {
    const template = buildTemplate();
    const clone = cloneTemplate(template, { makeId: counterIdFactory() });
    expect(template.meta.template).toBeDefined();
    expect(clone.meta.template).toBeUndefined();
  });

  it("the cloned bytes contain no template-marker substring", () => {
    const template = buildTemplate();
    const clone = cloneTemplate(template, { makeId: counterIdFactory() });
    const bytes = serializeDocument(clone);
    expect(bytes).not.toContain('data-annot-doc-template="1"');
    expect(bytes).not.toContain('<meta name="annot-template"');
    expect(bytes).not.toContain('"template"');
  });

  it("is a no-op on the marker side for non-template input", () => {
    // Build a document with no template marker — meta.template
    // already absent. Clone should still succeed and still leave
    // the field unset.
    const plain: AnnotDocument = {
      version: ANNOT_DOC_VERSION,
      lang: "en",
      title: "Plain doc",
      meta: { title: "Plain doc" },
      styleBlock: null,
      blocks: [{ kind: "paragraph", inlineHtml: "Hello" }],
    };
    const clone = cloneTemplate(plain);
    expect(clone.meta.template).toBeUndefined();
  });
});

describe("cloneTemplate: image-block ID minting", () => {
  it("mints a fresh id for every image block", () => {
    const template = buildTemplate();
    const clone = cloneTemplate(template, { makeId: counterIdFactory() });
    const cloneIds = clone.blocks.filter((b) => b.kind === "image").map((b) => b.id);
    expect(cloneIds).toEqual(["img-test-1", "img-test-2"]);
  });

  it("does not reuse any of the source image ids", () => {
    const template = buildTemplate();
    // Use the real default factory so we exercise the production
    // path. newIdB58 is collision-resistant in practice.
    const clone = cloneTemplate(template);
    const sourceIds = new Set(template.blocks.filter((b) => b.kind === "image").map((b) => b.id));
    for (const block of clone.blocks) {
      if (block.kind === "image") {
        expect(sourceIds.has(block.id)).toBe(false);
        expect(block.id.startsWith("img-")).toBe(true);
      }
    }
  });

  it("remaps imageMeta keys to track the new ids", () => {
    const template = buildTemplate();
    const clone = cloneTemplate(template, { makeId: counterIdFactory() });
    const meta = clone.meta.imageMeta;
    if (!meta) throw new Error("imageMeta was dropped — should be remapped");
    // New keys present, original alt values preserved.
    expect(meta["img-test-1"]).toEqual({ alt: "Login form" });
    expect(meta["img-test-2"]).toEqual({ alt: "Dashboard", capturedAt: "2026-04-01" });
    // Old keys gone.
    expect(meta["img-original-1"]).toBeUndefined();
    expect(meta["img-original-2"]).toBeUndefined();
  });

  it("preserves orphaned imageMeta entries that don't match any image block", () => {
    // Defensive: if the document is internally inconsistent
    // (imageMeta mentions an id that no image block uses), we
    // pass the entry through unchanged rather than silently
    // dropping it.
    const orphaned: AnnotDocument = {
      version: ANNOT_DOC_VERSION,
      lang: "en",
      title: "Orphaned",
      meta: {
        title: "Orphaned",
        imageMeta: { "img-ghost": { alt: "no block carries this id" } },
      },
      styleBlock: null,
      blocks: [{ kind: "paragraph", inlineHtml: "no images" }],
    };
    const clone = cloneTemplate(orphaned);
    expect(clone.meta.imageMeta).toEqual({
      "img-ghost": { alt: "no block carries this id" },
    });
  });
});

describe("cloneTemplate: content preservation", () => {
  it("preserves title / lang / version / styleBlock / non-image meta fields", () => {
    const template = buildTemplate();
    const clone = cloneTemplate(template, { makeId: counterIdFactory() });
    expect(clone.title).toBe(template.title);
    expect(clone.lang).toBe(template.lang);
    expect(clone.version).toBe(template.version);
    expect(clone.styleBlock).toBe(template.styleBlock);
    expect(clone.meta.author).toBe(template.meta.author);
    expect(clone.meta.theme).toBe(template.meta.theme);
    expect(clone.meta.maxWidth).toBe(template.meta.maxWidth);
  });

  it("preserves block structure outside of image-block IDs", () => {
    const template = buildTemplate();
    const clone = cloneTemplate(template, { makeId: counterIdFactory() });
    expect(clone.blocks.length).toBe(template.blocks.length);
    for (let i = 0; i < template.blocks.length; i++) {
      const src = template.blocks[i]!;
      const dst = clone.blocks[i]!;
      expect(dst.kind).toBe(src.kind);
      if (src.kind === "image" && dst.kind === "image") {
        // Same SVG bytes + same caption, only the id changes.
        expect(dst.svg).toBe(src.svg);
        expect(dst.caption).toBe(src.caption);
      } else {
        // Non-image blocks: structurally identical.
        expect(dst).toEqual(src);
      }
    }
  });

  it("clones round-trip cleanly through serialize → parse", () => {
    const template = buildTemplate();
    const clone = cloneTemplate(template, { makeId: counterIdFactory() });
    const bytes = serializeDocument(clone);
    const reparsed = parseDocument(bytes);
    // Re-parsed clone must be byte-identical when re-serialised
    // (the format's round-trip contract). This catches any
    // serializer oddity introduced by the marker strip.
    const reSerialised = serializeDocument(reparsed);
    expect(reSerialised).toBe(bytes);
  });
});

describe("cloneTemplate: idempotence under repeated cloning", () => {
  it("cloning a clone still mints fresh image ids", () => {
    const template = buildTemplate();
    const first = cloneTemplate(template, { makeId: counterIdFactory("img-first") });
    const second = cloneTemplate(first, { makeId: counterIdFactory("img-second") });
    const firstIds = first.blocks.filter((b) => b.kind === "image").map((b) => b.id);
    const secondIds = second.blocks.filter((b) => b.kind === "image").map((b) => b.id);
    expect(firstIds).toEqual(["img-first-1", "img-first-2"]);
    expect(secondIds).toEqual(["img-second-1", "img-second-2"]);
  });
});
