// Default `node` environment — no `happy-dom`, no `document`, no `window`.
// This is the entire point of the test: importing
// `@ingcreators/annot-doc/headless` must succeed in pure Node so the
// future Playwright fixture and any GitHub Action can author
// `.annot.html` documents from CI without dragging in a browser
// environment. If a DOM-dependent symbol leaks into the headless
// barrel, the import below throws `ReferenceError: document is not
// defined` at module load time.
//
// Mirrors `packages/core/src/headless.test.ts` — Phase 1 of
// `docs/plans/annot-html-document.md`.

import { describe, expect, it } from "vitest";
import * as headless from "./headless.js";

describe("@ingcreators/annot-doc/headless boundary", () => {
  it("imports cleanly under a pure-Node environment", () => {
    expect(typeof headless).toBe("object");
  });

  it("exports the documented headless surface", () => {
    expect(headless.ANNOT_DOC_VERSION).toBe(1);
    expect(typeof headless.parseDocument).toBe("function");
    expect(typeof headless.serializeDocument).toBe("function");
    expect(typeof headless.createEmptyDocument).toBe("function");
    expect(typeof headless.serializeMetaJson).toBe("function");
    expect(typeof headless.escapeText).toBe("function");
    expect(typeof headless.escapeAttr).toBe("function");
    expect(typeof headless.AnnotDocParseError).toBe("function");
  });

  it("does not leak `document` / `window` into the importing context", () => {
    const g = globalThis as Record<string, unknown>;
    expect(g.document).toBeUndefined();
    expect(g.window).toBeUndefined();
  });

  it("createEmptyDocument runs in pure Node (no DOM needed)", () => {
    const doc = headless.createEmptyDocument({ title: "Headless test" });
    expect(doc.version).toBe(1);
    expect(doc.title).toBe("Headless test");
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]?.kind).toBe("paragraph");
  });

  it("serializeDocument runs in pure Node (no DOM needed)", () => {
    const doc = headless.createEmptyDocument({ title: "Serialise from Node" });
    const html = headless.serializeDocument(doc);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('data-annot-doc-version="1"');
    expect(html).toContain("<title>Serialise from Node</title>");
  });

  it("parseDocument throws a clear error when DOMParser is unavailable", () => {
    const html = headless.serializeDocument(headless.createEmptyDocument({ title: "DOMless" }));
    // Pure-Node has no `globalThis.DOMParser`; the parser must
    // fail with a recognisable error, not a `TypeError: undefined
    // is not a constructor`.
    expect(() => headless.parseDocument(html)).toThrow(headless.AnnotDocParseError);
  });

  it("BUILTIN_TEMPLATES is reachable from pure Node (Phase 9a)", () => {
    // The starter templates are computed at module load via
    // `serializeDocument(<literal>)` — Tier A operation, no
    // DOM needed. This guard ensures a future regression that
    // pulls in `parseDocument` at module load (e.g. for a
    // canonicalisation cycle) gets caught here rather than
    // surfacing as a runtime crash on a CI box that doesn't
    // have happy-dom available.
    expect(Array.isArray(headless.BUILTIN_TEMPLATES)).toBe(true);
    // Phase 5 of `docs/plans/card-procedure-template.md` adds
    // `card-procedure` as the fourth starter alongside the
    // original three (manual / feature-guide / procedure).
    expect(headless.BUILTIN_TEMPLATES.length).toBe(4);
    for (const t of headless.BUILTIN_TEMPLATES) {
      expect(typeof t.id).toBe("string");
      expect(typeof t.source).toBe("string");
      expect(t.source.length).toBeGreaterThan(0);
    }
    expect(typeof headless.getBuiltinTemplate).toBe("function");
    expect(headless.getBuiltinTemplate("manual")?.id).toBe("manual");
  });
});
