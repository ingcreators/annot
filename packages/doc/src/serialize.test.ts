// @vitest-environment happy-dom
//
// Targeted coverage for `serializeStandaloneDocument`. The raw
// `serializeDocument` is the byte-perfect round-trip path tested
// elsewhere (round-trip.test.ts, step-block.test.ts); this file
// pins the "saved file is browser-renderable" contract on the
// save-side wrapper. The wrapper is the single chokepoint every
// host save site (web autosave, vscode webview, vscode template
// clone, save-as-template, …) reaches for so the emitted bytes
// always carry a `<style>` block populated from current `meta`.

import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "./create-empty.js";
import { parseDocument } from "./parse.js";
import { serializeDocument, serializeStandaloneDocument } from "./serialize.js";
import type { AnnotDocument } from "./types.js";

describe("serializeStandaloneDocument", () => {
  it("emits a populated <style> block even when doc.styleBlock is null", () => {
    const doc = createEmptyDocument({ title: "Brand new" });
    expect(doc.styleBlock).toBeNull();
    const bytes = serializeStandaloneDocument(doc);
    // The `<style>` tag is present AND its content is non-empty.
    // (`serializeDocument` skips emitting the tag entirely when
    // styleBlock is null — the bug this helper fixes.)
    expect(bytes).toContain("<style>");
    expect(bytes).toContain("</style>");
    // A handful of canonical selectors prove the style block
    // carries the doc's CSS, not just an empty `<style></style>`.
    expect(bytes).toContain('[data-annot-block="step"]');
    expect(bytes).toContain('[data-font-family="Annot Sans"]');
  });

  it("refreshes a stale styleBlock against the current meta", () => {
    const doc: AnnotDocument = {
      version: 1,
      lang: "en",
      title: "Stale style",
      meta: { title: "Stale style", maxWidth: "narrow" },
      styleBlock: "/* stale leftover from a previous load */",
      blocks: [],
    };
    const bytes = serializeStandaloneDocument(doc);
    // Stale comment is gone; canonical CSS is in.
    expect(bytes).not.toContain("/* stale leftover from a previous load */");
    expect(bytes).toContain('[data-annot-block="heading"]');
  });

  it("round-trips through parse → serializeStandaloneDocument idempotently", () => {
    // Two consecutive saves of an unchanged loaded doc produce
    // the same bytes (the inject step is idempotent).
    const doc = createEmptyDocument({ title: "Idempotent save" });
    const first = serializeStandaloneDocument(doc);
    const reparsed = parseDocument(first);
    const second = serializeStandaloneDocument(reparsed);
    expect(second).toBe(first);
  });

  it("matches serializeDocument(injectDocumentStyles(doc)) byte-for-byte", async () => {
    // Equivalence with the longhand form — the helper is a
    // straight composition.
    const { injectDocumentStyles } = await import("./inject-styles.js");
    const doc = createEmptyDocument({ title: "Equivalence" });
    expect(serializeStandaloneDocument(doc)).toBe(serializeDocument(injectDocumentStyles(doc)));
  });
});
