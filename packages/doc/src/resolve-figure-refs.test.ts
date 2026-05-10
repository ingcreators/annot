// @vitest-environment happy-dom
//
// `resolveFigureRefs` — Phase 13b of
// `docs/plans/annot-html-document.md`. Coverage:
//
//   - Inline-HTML rewrite across every block kind that
//     carries inline content (heading / paragraph / list
//     items / quote paragraphs / callout paragraphs / image
//     caption).
//   - Figure-number map honours document order.
//   - Stale references (id no longer in the document) get the
//     placeholder label.
//   - Idempotence: re-running on the same document is a no-op
//     (returns byte-identical inline HTML).
//   - Figure label: defaults to "Figure ", overridable via
//     `meta.numbering.figureLabel`, and via the per-call
//     `opts.figureLabel`.
//   - Pure-Node: throws `AnnotDocResolveError` when DOMParser
//     is missing.

import { describe, expect, it } from "vitest";
import { AnnotDocResolveError, resolveFigureRefs } from "./resolve-figure-refs.js";
import type { AnnotDocument, ImageBlock } from "./types.js";

function makeImageBlock(id: string): ImageBlock {
  return {
    kind: "image",
    id,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 10 10" width="10" height="10"><image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/><g id="annotations"></g></svg>',
  };
}

function makeDoc(
  blocks: AnnotDocument["blocks"],
  numbering?: AnnotDocument["meta"]["numbering"],
): AnnotDocument {
  return {
    version: 1,
    lang: "en",
    title: "Refs",
    meta: numbering !== undefined ? { title: "Refs", numbering } : { title: "Refs" },
    styleBlock: null,
    blocks,
  };
}

describe("resolveFigureRefs: figure-number computation", () => {
  it("numbers image blocks in document order", () => {
    const doc = makeDoc([
      { kind: "heading", level: 1, inlineHtml: "Title" },
      makeImageBlock("img-a"),
      { kind: "paragraph", inlineHtml: 'See <span data-annot-figref="img-c">Figure ?</span>.' },
      makeImageBlock("img-b"),
      makeImageBlock("img-c"),
      {
        kind: "paragraph",
        inlineHtml:
          'A=<span data-annot-figref="img-a">?</span>, B=<span data-annot-figref="img-b">?</span>, C=<span data-annot-figref="img-c">?</span>',
      },
    ]);
    const out = resolveFigureRefs(doc);
    const finalParagraph = out.blocks[5];
    if (finalParagraph?.kind !== "paragraph") throw new Error("expected paragraph");
    expect(finalParagraph.inlineHtml).toContain('data-annot-figref="img-a">Figure 1<');
    expect(finalParagraph.inlineHtml).toContain('data-annot-figref="img-b">Figure 2<');
    expect(finalParagraph.inlineHtml).toContain('data-annot-figref="img-c">Figure 3<');
    // Earlier paragraph that referenced img-c also gets resolved
    // — the resolver doesn't care whether the reference comes
    // before or after the target, only the document-order
    // figure number matters.
    const earlyParagraph = out.blocks[2];
    if (earlyParagraph?.kind !== "paragraph") throw new Error("expected paragraph");
    expect(earlyParagraph.inlineHtml).toContain('data-annot-figref="img-c">Figure 3<');
  });

  it("uses meta.numbering.figureLabel when set", () => {
    const doc = makeDoc(
      [
        makeImageBlock("img-a"),
        { kind: "paragraph", inlineHtml: '<span data-annot-figref="img-a">?</span>' },
      ],
      { figures: true, figureLabel: "図 " },
    );
    const out = resolveFigureRefs(doc);
    const p = out.blocks[1];
    if (p?.kind !== "paragraph") throw new Error("expected paragraph");
    expect(p.inlineHtml).toContain('data-annot-figref="img-a">図 1<');
  });

  it("uses opts.figureLabel as the highest-priority override", () => {
    const doc = makeDoc(
      [
        makeImageBlock("img-a"),
        { kind: "paragraph", inlineHtml: '<span data-annot-figref="img-a">?</span>' },
      ],
      { figures: true, figureLabel: "Default " },
    );
    const out = resolveFigureRefs(doc, { figureLabel: "Override " });
    const p = out.blocks[1];
    if (p?.kind !== "paragraph") throw new Error("expected paragraph");
    expect(p.inlineHtml).toContain('data-annot-figref="img-a">Override 1<');
  });

  it("renders the stale label when the referenced id doesn't exist", () => {
    const doc = makeDoc([
      makeImageBlock("img-a"),
      { kind: "paragraph", inlineHtml: '<span data-annot-figref="img-ghost">?</span>' },
    ]);
    const out = resolveFigureRefs(doc);
    const p = out.blocks[1];
    if (p?.kind !== "paragraph") throw new Error("expected paragraph");
    expect(p.inlineHtml).toContain('data-annot-figref="img-ghost">Figure ?<');
  });

  it("custom staleLabel option overrides the default '?'", () => {
    const doc = makeDoc([
      { kind: "paragraph", inlineHtml: '<span data-annot-figref="img-ghost">old</span>' },
    ]);
    const out = resolveFigureRefs(doc, { staleLabel: "deleted" });
    const p = out.blocks[0];
    if (p?.kind !== "paragraph") throw new Error("expected paragraph");
    expect(p.inlineHtml).toContain('data-annot-figref="img-ghost">Figure deleted<');
  });
});

describe("resolveFigureRefs: per-block-kind walk", () => {
  it("rewrites figrefs in heading + paragraph + list items + quote + callout + image caption", () => {
    const doc = makeDoc([
      makeImageBlock("img-a"),
      {
        kind: "heading",
        level: 2,
        inlineHtml: 'See <span data-annot-figref="img-a">?</span>',
      },
      {
        kind: "paragraph",
        inlineHtml: 'See <span data-annot-figref="img-a">?</span>',
      },
      {
        kind: "list",
        ordered: false,
        listStyle: "disc",
        items: ['Ref: <span data-annot-figref="img-a">?</span>', "Plain item"],
      },
      {
        kind: "quote",
        paragraphs: ['Ref: <span data-annot-figref="img-a">?</span>'],
      },
      {
        kind: "callout",
        tone: "info",
        paragraphs: ['Ref: <span data-annot-figref="img-a">?</span>'],
      },
      {
        kind: "image",
        id: "img-b",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 10 10" width="10" height="10"><image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/><g id="annotations"></g></svg>',
        caption: 'Ref: <span data-annot-figref="img-a">?</span>',
      },
    ]);
    const out = resolveFigureRefs(doc);
    const heading = out.blocks[1];
    const paragraph = out.blocks[2];
    const list = out.blocks[3];
    const quote = out.blocks[4];
    const callout = out.blocks[5];
    const image = out.blocks[6];
    if (heading?.kind !== "heading") throw new Error("heading");
    if (paragraph?.kind !== "paragraph") throw new Error("paragraph");
    if (list?.kind !== "list") throw new Error("list");
    if (quote?.kind !== "quote") throw new Error("quote");
    if (callout?.kind !== "callout") throw new Error("callout");
    if (image?.kind !== "image") throw new Error("image");
    expect(heading.inlineHtml).toContain('data-annot-figref="img-a">Figure 1<');
    expect(paragraph.inlineHtml).toContain('data-annot-figref="img-a">Figure 1<');
    expect(list.items[0]).toContain('data-annot-figref="img-a">Figure 1<');
    expect(list.items[1]).toBe("Plain item");
    expect(quote.paragraphs[0]).toContain('data-annot-figref="img-a">Figure 1<');
    expect(callout.paragraphs[0]).toContain('data-annot-figref="img-a">Figure 1<');
    expect(image.caption).toContain('data-annot-figref="img-a">Figure 1<');
  });

  it("preserves the inline-HTML field by reference when there's no figref to rewrite", () => {
    // Optimisation guard: if a fragment has no `data-annot-figref`
    // substring, the resolver must not rebuild the string.
    // Otherwise an N-block document pays N DOMParser allocations
    // on every save even when nothing changed.
    const doc = makeDoc([
      makeImageBlock("img-a"),
      { kind: "paragraph", inlineHtml: "No refs here." },
      { kind: "paragraph", inlineHtml: 'Has a ref: <span data-annot-figref="img-a">?</span>' },
    ]);
    const out = resolveFigureRefs(doc);
    const noRef = out.blocks[1];
    const withRef = out.blocks[2];
    if (noRef?.kind !== "paragraph") throw new Error("paragraph");
    if (withRef?.kind !== "paragraph") throw new Error("paragraph");
    // The unchanged block keeps its inlineHtml string identity.
    expect(noRef.inlineHtml).toBe(
      doc.blocks[1] && doc.blocks[1].kind === "paragraph" ? doc.blocks[1].inlineHtml : "",
    );
    // The rewritten block carries the resolved label.
    expect(withRef.inlineHtml).toContain("Figure 1");
  });

  it("idempotent: running twice returns equal inline HTML", () => {
    const doc = makeDoc([
      makeImageBlock("img-a"),
      { kind: "paragraph", inlineHtml: 'See <span data-annot-figref="img-a">Figure 99</span>' },
    ]);
    const once = resolveFigureRefs(doc);
    const twice = resolveFigureRefs(once);
    const onceP = once.blocks[1];
    const twiceP = twice.blocks[1];
    if (onceP?.kind !== "paragraph") throw new Error("paragraph");
    if (twiceP?.kind !== "paragraph") throw new Error("paragraph");
    // Once → "Figure 1"; twice → still "Figure 1" (no new
    // DOMParser allocation triggered because the text matches
    // the pre-set value before write — see the `if` guard in
    // rewriteFigrefs).
    expect(onceP.inlineHtml).toContain("Figure 1");
    expect(twiceP.inlineHtml).toBe(onceP.inlineHtml);
  });

  it("doesn't touch blocks with no inline content (code / divider)", () => {
    const doc = makeDoc([
      { kind: "code", lang: "ts", text: "See @img-a — but @ in code stays verbatim" },
      { kind: "divider" },
    ]);
    const out = resolveFigureRefs(doc);
    expect(out.blocks[0]).toEqual(doc.blocks[0]);
    expect(out.blocks[1]).toEqual(doc.blocks[1]);
  });
});

describe("resolveFigureRefs: error paths", () => {
  it("throws AnnotDocResolveError when DOMParser is unavailable", () => {
    const doc = makeDoc([
      makeImageBlock("img-a"),
      { kind: "paragraph", inlineHtml: '<span data-annot-figref="img-a">?</span>' },
    ]);
    // Temporarily stash + remove globalThis.DOMParser so the
    // resolver's `opts.DOMParser ?? globalThis.DOMParser` chain
    // produces undefined and trips the error path. Restored in
    // a finally block so neighbouring tests aren't affected.
    const original = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
    delete (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
    try {
      expect(() => resolveFigureRefs(doc)).toThrow(AnnotDocResolveError);
    } finally {
      (globalThis as { DOMParser?: typeof DOMParser }).DOMParser = original;
    }
  });

  it("returns the document unchanged when no inline HTML carries a figref", () => {
    const doc = makeDoc([
      makeImageBlock("img-a"),
      { kind: "paragraph", inlineHtml: "Just text." },
      { kind: "heading", level: 1, inlineHtml: "Title" },
    ]);
    const out = resolveFigureRefs(doc);
    // Block array is structurally equal; the resolver should
    // ideally return the same array reference, but at minimum
    // the contents must match.
    expect(out.blocks.length).toBe(doc.blocks.length);
    for (let i = 0; i < doc.blocks.length; i++) {
      expect(out.blocks[i]).toEqual(doc.blocks[i]);
    }
  });
});
