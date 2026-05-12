// @vitest-environment happy-dom
//
// Coverage for the three package-resident starter templates
// that fill the picker's "Built-in" section. Phase 9a of
// `docs/plans/_done/annot-html-document.md`.
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

const EXPECTED_IDS: readonly BuiltinTemplateId[] = [
  "manual",
  "feature-guide",
  "procedure",
  // Phase 5 of `docs/plans/_done/card-procedure-template.md` — adds
  // the Scribe-style screenshot-driven walkthrough starter.
  "card-procedure",
];

describe("BUILTIN_TEMPLATES: presence + lookup", () => {
  it("exports the documented starters in the documented order", () => {
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

  it.each(
    EXPECTED_IDS,
  )("%s mints fresh image-block IDs (no img-placeholder / img-card-step-N leftovers)", (id) => {
    const cloned = cloneBuiltinTemplate(id);
    if (!cloned) throw new Error("cloneBuiltinTemplate returned undefined");
    for (const block of cloned.blocks) {
      // Phase 5 of card-procedure-template — the card-procedure
      // starter carries step blocks; both kinds share the
      // `data-annot-image-id` namespace and both get reminted
      // by `cloneTemplate`.
      if (block.kind !== "image" && block.kind !== "step") continue;
      // The starter source carries `img-placeholder` (image
      // blocks) or `img-card-step-{1,2,3}` (step blocks) as
      // the id; after `cloneTemplate` it's reminted via
      // `newIdB58` → `img-` + 8–32 base58 chars.
      expect(block.id).not.toBe("img-placeholder");
      expect(block.id).not.toMatch(/^img-card-step-\d+$/);
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
  it("each starter ships at least one heading + one paragraph + one image-bearing block", () => {
    // Phase 5 — `card-procedure` carries `step` blocks instead
    // of `image` blocks; both kinds have an inline `<svg>` with
    // a screenshot placeholder. The shared shape is "at least
    // one of either".
    for (const t of BUILTIN_TEMPLATES) {
      const doc = parseDocument(t.source);
      const kinds = doc.blocks.map((b) => b.kind);
      expect(kinds).toContain("heading");
      expect(kinds).toContain("paragraph");
      expect(kinds.some((k) => k === "image" || k === "step")).toBe(true);
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

  it("each starter's image-bearing blocks reference image-meta entries with non-empty alt text", () => {
    for (const t of BUILTIN_TEMPLATES) {
      const doc = parseDocument(t.source);
      // Phase 5 — step blocks share the `data-annot-image-id`
      // namespace with image blocks, so the same `imageMeta`
      // contract holds for both.
      const bearing = doc.blocks.filter((b) => b.kind === "image" || b.kind === "step");
      expect(bearing.length).toBeGreaterThan(0);
      const imageMeta = doc.meta.imageMeta ?? {};
      for (const block of bearing) {
        if (block.kind !== "image" && block.kind !== "step") continue;
        const meta = imageMeta[block.id];
        expect(meta).toBeDefined();
        expect((meta?.alt ?? "").length).toBeGreaterThan(0);
      }
    }
  });

  it("each image-bearing block's SVG carries the canonical placeholder marker text", () => {
    for (const t of BUILTIN_TEMPLATES) {
      const doc = parseDocument(t.source);
      for (const block of doc.blocks) {
        if (block.kind !== "image" && block.kind !== "step") continue;
        // The same placeholder SVG is shared across all four
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

  it("card-procedure starter contains exactly three step blocks in image-top layout", () => {
    const doc = parseDocument(getBuiltinTemplate("card-procedure")!.source);
    const steps = doc.blocks.filter((b) => b.kind === "step");
    expect(steps.length).toBe(3);
    for (const block of steps) {
      if (block.kind !== "step") continue;
      expect(block.layout).toBe("image-top");
      // Bracketed-placeholder convention — same as the heading
      // starter the other built-ins use; gives the user a clear
      // edit affordance on first open.
      expect(block.title).toMatch(/\[.+\]/);
      expect(block.body).toMatch(/\[.+\]/);
    }
  });

  it("card-procedure's step image IDs are distinct from the other starters' img-placeholder", () => {
    const doc = parseDocument(getBuiltinTemplate("card-procedure")!.source);
    const ids = doc.blocks
      .filter((b) => b.kind === "step")
      .map((b) => (b.kind === "step" ? b.id : ""));
    // IDs are unique within the doc — `data-annot-image-id` must
    // be unique per the format spec.
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).not.toBe("img-placeholder");
    }
  });
});
