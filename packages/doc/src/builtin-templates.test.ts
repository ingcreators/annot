// @vitest-environment happy-dom
//
// Coverage for the three package-resident starter templates
// that fill the picker's "Built-in" section. Phase 9a of
// `docs/plans/annot-html-document.md`.
//
// happy-dom is needed because the round-trip checks call
// `parseDocument`, which lazily resolves `globalThis.DOMParser`.
// The pure-Node side (template structure, marker presence,
// `getBuiltinTemplate` lookup) doesn't strictly need it, but
// running the whole file under happy-dom keeps the lifecycle
// uniform.

import { describe, expect, it } from "vitest";
import {
  BUILTIN_TEMPLATES,
  type BuiltinTemplateId,
  cloneBuiltinTemplate,
  getBuiltinTemplate,
} from "./builtin-templates.js";
import { isTemplateFromHead } from "./is-template-head.js";
import { parseDocument } from "./parse.js";
import { serializeDocument } from "./serialize.js";

const EXPECTED_IDS: readonly BuiltinTemplateId[] = ["manual", "feature-guide", "procedure"];

describe("BUILTIN_TEMPLATES: presence + lookup", () => {
  it("exports exactly three starters in the documented order", () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.id)).toEqual(EXPECTED_IDS);
  });

  it("each entry carries title + description + non-empty source", () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.source.length).toBeGreaterThan(0);
    }
  });

  it("getBuiltinTemplate returns the matching summary by id", () => {
    for (const id of EXPECTED_IDS) {
      const t = getBuiltinTemplate(id);
      expect(t).toBeDefined();
      expect(t?.id).toBe(id);
    }
  });

  it("getBuiltinTemplate returns undefined for unknown ids", () => {
    expect(getBuiltinTemplate("does-not-exist")).toBeUndefined();
    expect(getBuiltinTemplate("")).toBeUndefined();
  });
});

describe("cloneBuiltinTemplate (Phase 10)", () => {
  it("returns undefined for unknown ids", () => {
    expect(cloneBuiltinTemplate("does-not-exist")).toBeUndefined();
    expect(cloneBuiltinTemplate("")).toBeUndefined();
  });

  it.each(EXPECTED_IDS)("%s returns a fresh AnnotDocument with markers stripped", (id) => {
    const cloned = cloneBuiltinTemplate(id);
    expect(cloned).toBeDefined();
    if (!cloned) return;
    // The marker is gone from `meta.template` — the serialiser
    // then drops `data-annot-doc-template` + the `<meta>` tag
    // automatically.
    expect(cloned.meta.template).toBeUndefined();
    // Title + structure preserved (the bracketed-placeholder
    // copy stays in place; only the markers + image IDs change).
    const sourceDoc = getBuiltinTemplate(id);
    expect(cloned.title).toBe(sourceDoc?.title);
    expect(cloned.lang).toBe("en");
  });

  it.each(EXPECTED_IDS)("%s mints fresh image-block IDs (no img-placeholder leftovers)", (id) => {
    const cloned = cloneBuiltinTemplate(id);
    if (!cloned) throw new Error("cloneBuiltinTemplate returned undefined");
    for (const block of cloned.blocks) {
      if (block.kind !== "image") continue;
      // The starter source carries `img-placeholder` as the
      // image-block id; after `cloneTemplate` it's reminted
      // via `newIdB58` → `img-` + 8–32 base58 chars.
      expect(block.id).not.toBe("img-placeholder");
      expect(block.id).toMatch(/^img-[A-Za-z0-9_-]+$/);
    }
  });
});

describe("BUILTIN_TEMPLATES: format + markers", () => {
  it.each(EXPECTED_IDS)("%s passes the head-only template detection", (id) => {
    const t = getBuiltinTemplate(id)!;
    expect(isTemplateFromHead(t.source)).toBe(true);
  });

  it.each(EXPECTED_IDS)("%s contains the three template-marker substrings", (id) => {
    const t = getBuiltinTemplate(id)!;
    expect(t.source).toContain('data-annot-doc-template="1"');
    expect(t.source).toContain('<meta name="annot-template" content="1">');
    expect(t.source).toContain('"template":');
  });

  it.each(EXPECTED_IDS)("%s parses cleanly via parseDocument", (id) => {
    const t = getBuiltinTemplate(id)!;
    const doc = parseDocument(t.source);
    expect(doc.version).toBe(1);
    expect(doc.lang).toBe("en");
    expect(doc.meta.template).toBeDefined();
    expect(doc.meta.template?.name).toBe(t.title);
    expect(doc.meta.template?.description).toBe(t.description);
  });

  it.each(EXPECTED_IDS)("%s round-trips byte-for-byte (parse → serialize)", (id) => {
    const t = getBuiltinTemplate(id)!;
    const doc = parseDocument(t.source);
    const reSerialised = serializeDocument(doc);
    expect(reSerialised).toBe(t.source);
  });
});

describe("BUILTIN_TEMPLATES: structural shape", () => {
  it("each starter ships at least one heading + one paragraph + one image block", () => {
    for (const t of BUILTIN_TEMPLATES) {
      const doc = parseDocument(t.source);
      const kinds = doc.blocks.map((b) => b.kind);
      expect(kinds).toContain("heading");
      expect(kinds).toContain("paragraph");
      expect(kinds).toContain("image");
    }
  });

  it("each starter starts with an H1 placeholder so the inline-edit affordance lands on a real header", () => {
    for (const t of BUILTIN_TEMPLATES) {
      const doc = parseDocument(t.source);
      const first = doc.blocks[0];
      expect(first?.kind).toBe("heading");
      if (first?.kind === "heading") {
        expect(first.level).toBe(1);
        // The bracketed-placeholder convention — Phase 9 plan
        // calls this out as the discoverability hook.
        expect(first.inlineHtml).toMatch(/\[.+\]/);
      }
    }
  });

  it("each starter's image blocks reference image-meta entries with non-empty alt text", () => {
    for (const t of BUILTIN_TEMPLATES) {
      const doc = parseDocument(t.source);
      const imageBlocks = doc.blocks.filter((b) => b.kind === "image");
      expect(imageBlocks.length).toBeGreaterThan(0);
      const imageMeta = doc.meta.imageMeta ?? {};
      for (const block of imageBlocks) {
        if (block.kind !== "image") continue;
        const meta = imageMeta[block.id];
        expect(meta).toBeDefined();
        expect((meta?.alt ?? "").length).toBeGreaterThan(0);
      }
    }
  });

  it("each image block's SVG carries the canonical placeholder marker text", () => {
    for (const t of BUILTIN_TEMPLATES) {
      const doc = parseDocument(t.source);
      for (const block of doc.blocks) {
        if (block.kind !== "image") continue;
        // The same placeholder SVG is shared across all three
        // starters — verify the user-visible marker text is
        // present so a future regression in the SVG bytes is
        // visible.
        expect(block.svg).toContain("Drop screenshot here");
      }
    }
  });

  it("manual starter contains a Step-1 / Step-2 progression", () => {
    const doc = parseDocument(getBuiltinTemplate("manual")!.source);
    const headings = doc.blocks
      .filter((b) => b.kind === "heading")
      .map((b) => (b.kind === "heading" ? b.inlineHtml : ""));
    expect(headings.some((h) => h.includes("Step 1"))).toBe(true);
    expect(headings.some((h) => h.includes("Step 2"))).toBe(true);
  });

  it("feature-guide starter contains a 'How it works' section + a Try-it list", () => {
    const doc = parseDocument(getBuiltinTemplate("feature-guide")!.source);
    const headings = doc.blocks
      .filter((b) => b.kind === "heading")
      .map((b) => (b.kind === "heading" ? b.inlineHtml : ""));
    expect(headings).toContain("How it works");
    const lists = doc.blocks.filter((b) => b.kind === "list");
    expect(lists.length).toBeGreaterThan(0);
  });

  it("procedure starter contains an info callout + an ordered list", () => {
    const doc = parseDocument(getBuiltinTemplate("procedure")!.source);
    const callouts = doc.blocks.filter((b) => b.kind === "callout");
    expect(callouts.length).toBeGreaterThan(0);
    if (callouts[0]?.kind === "callout") {
      expect(callouts[0].tone).toBe("info");
    }
    const orderedLists = doc.blocks.filter((b) => b.kind === "list" && b.ordered);
    expect(orderedLists.length).toBeGreaterThan(0);
  });
});
