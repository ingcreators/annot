/**
 * @vitest-environment happy-dom
 *
 * `<annot-doc-shell>` tests — Phases 3 + 4a of
 * `docs/plans/_done/annot-html-document.md`. Covers initial mount,
 * re-mount with a different document, the TOC scroll-into-view
 * behaviour, theme variants (light / dark / auto), the
 * empty / no-document state, and Phase 4a's editing-mode
 * surface (contentEditable on heading / paragraph, block
 * toolbar actions, undo / redo via DocumentHistory).
 */

import type { AnnotDocument } from "@ingcreators/annot-doc";
import { createEmptyDocument, injectDocumentStyles } from "@ingcreators/annot-doc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./annot-doc-shell.js";
import type {
  AnnotDocShellElement,
  DocChangedDetail,
  DocHeadingActivatedDetail,
} from "./annot-doc-shell.js";

function mount(doc: AnnotDocument | null = null): AnnotDocShellElement {
  const el = document.createElement("annot-doc-shell") as AnnotDocShellElement;
  if (doc) el.document = doc;
  document.body.appendChild(el);
  return el;
}

function makeMixedDoc(): AnnotDocument {
  return {
    version: 1,
    lang: "en",
    title: "Mixed",
    meta: { title: "Mixed" },
    styleBlock: null,
    blocks: [
      { kind: "heading", level: 1, inlineHtml: "Mixed document" },
      { kind: "paragraph", inlineHtml: "Intro paragraph." },
      { kind: "heading", level: 2, inlineHtml: "Section A" },
      { kind: "paragraph", inlineHtml: "Section A body." },
      { kind: "list", ordered: false, listStyle: "disc", items: ["one", "two"] },
      { kind: "code", lang: "js", text: "console.log(1);" },
      { kind: "quote", paragraphs: ["A wise saying."] },
      {
        kind: "callout",
        tone: "info",
        paragraphs: ["Heads up."],
      },
      { kind: "divider" },
      { kind: "heading", level: 3, inlineHtml: "Subsection" },
      {
        kind: "image",
        id: "img-test",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"></svg>',
        caption: "An image.",
      },
    ],
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("annot-doc-shell: empty state", () => {
  it("renders an empty-state message when no document is set", async () => {
    const el = mount();
    await el.updateComplete;
    expect(el.querySelector(".annot-doc-shell-empty")?.textContent ?? "").toContain(
      "No document loaded",
    );
    expect(el.querySelector("article[data-annot-doc]")).toBeNull();
  });

  it("transitions to the rendered document when set later", async () => {
    const el = mount();
    await el.updateComplete;
    expect(el.querySelector("article[data-annot-doc]")).toBeNull();

    el.document = makeMixedDoc();
    await el.updateComplete;
    expect(el.querySelector("article[data-annot-doc]")).not.toBeNull();
    expect(el.querySelector(".annot-doc-shell-empty")).toBeNull();
  });

  it("renders the onboarding empty-state for new docs in editing mode", async () => {
    // Phase 4 of `annot-html-document-ux-polish.md`: an empty
    // doc (zero blocks OR one empty paragraph) shows the four
    // onboarding cards instead of just the italic placeholder.
    const empty: AnnotDocument = {
      version: 1,
      title: "Untitled",
      lang: "en",
      meta: { title: "Untitled" },
      styleBlock: null,
      blocks: [{ kind: "paragraph", inlineHtml: "" }],
    };
    const el = mount(empty);
    el.editing = true;
    await el.updateComplete;
    expect(el.querySelector("annot-doc-empty-state")).not.toBeNull();
    // Read-only mode hides the panel.
    el.editing = false;
    await el.updateComplete;
    expect(el.querySelector("annot-doc-empty-state")).toBeNull();
  });

  it("hides the onboarding empty-state once the doc has real content", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    expect(el.querySelector("annot-doc-empty-state")).toBeNull();
  });

  it("startWithHeading inserts an H1 + paragraph and focuses the heading", async () => {
    const empty: AnnotDocument = {
      version: 1,
      title: "Untitled",
      lang: "en",
      meta: { title: "Untitled" },
      styleBlock: null,
      blocks: [{ kind: "paragraph", inlineHtml: "" }],
    };
    const el = mount(empty);
    el.editing = true;
    await el.updateComplete;
    const card = el.querySelector('[data-empty-action="startWithHeading"]') as HTMLButtonElement;
    card.click();
    await el.updateComplete;
    const blocks = el.document?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe("heading");
    expect(blocks[1]?.kind).toBe("paragraph");
    if (blocks[0]?.kind === "heading") {
      expect(blocks[0].level).toBe(1);
    }
  });
});

describe("annot-doc-shell: block rendering", () => {
  it("renders one DOM node per block kind", async () => {
    const el = mount(makeMixedDoc());
    await el.updateComplete;
    const article = el.querySelector("article[data-annot-doc]");
    expect(article).not.toBeNull();
    if (!article) throw new Error("article missing");

    expect(article.querySelector('h1[data-annot-block="heading"][data-level="1"]')).not.toBeNull();
    expect(article.querySelector('h2[data-annot-block="heading"][data-level="2"]')).not.toBeNull();
    expect(article.querySelector('h3[data-annot-block="heading"][data-level="3"]')).not.toBeNull();
    expect(article.querySelector('p[data-annot-block="paragraph"]')).not.toBeNull();
    expect(
      article.querySelector('ul[data-annot-block="list"][data-list-style="disc"]'),
    ).not.toBeNull();
    expect(article.querySelectorAll('ul[data-annot-block="list"] > li')).toHaveLength(2);
    expect(article.querySelector('pre[data-annot-block="code"][data-lang="js"]')).not.toBeNull();
    expect(article.querySelector('blockquote[data-annot-block="quote"]')).not.toBeNull();
    expect(
      article.querySelector('aside[data-annot-block="callout"][data-tone="info"]'),
    ).not.toBeNull();
    expect(article.querySelector('hr[data-annot-block="divider"]')).not.toBeNull();
    expect(article.querySelector('figure[data-annot-block="image"]')).not.toBeNull();
    // Phase 10 — image SVGs render via a lazy `.annot-doc-image-svg-slot`
    // wrapper; force-materialise so the embedded SVG shows up
    // in the test's selector probe.
    el.materialiseAllImagesNow();
    expect(article.querySelector('figure[data-annot-image-id="img-test"] svg')).not.toBeNull();
    expect(
      article.querySelector('figure[data-annot-block="image"] > figcaption')?.textContent,
    ).toBe("An image.");
  });

  it("respects ordered-list start offset", async () => {
    const doc: AnnotDocument = {
      ...makeMixedDoc(),
      blocks: [
        {
          kind: "list",
          ordered: true,
          listStyle: "decimal",
          start: 5,
          items: ["a", "b"],
        },
      ],
    };
    const el = mount(doc);
    await el.updateComplete;
    const ol = el.querySelector('ol[data-annot-block="list"]');
    expect(ol).not.toBeNull();
    expect(ol?.getAttribute("start")).toBe("5");
  });

  it("preserves embedded SVG verbatim inside image blocks", async () => {
    const el = mount(makeMixedDoc());
    await el.updateComplete;
    el.materialiseAllImagesNow();
    const svg = el.querySelector('figure[data-annot-image-id="img-test"] svg');
    expect(svg?.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 100 100");
  });

  it("Phase 10 — image renders a placeholder slot until materialised", async () => {
    const el = mount(makeMixedDoc());
    await el.updateComplete;
    const slot = el.querySelector(
      'figure[data-annot-image-id="img-test"] .annot-doc-image-svg-slot',
    ) as HTMLElement;
    expect(slot).not.toBeNull();
    // Bytes carried via the data attribute, not yet inlined.
    expect(slot.getAttribute("data-annot-image-svg")).toContain("<svg");
    // Aspect ratio derived from the SVG viewBox.
    expect(slot.style.aspectRatio).toBe("100 / 100");
    // Materialise + verify swap.
    el.materialiseAllImagesNow();
    expect(slot.querySelector("svg")).not.toBeNull();
    expect(slot.getAttribute("data-annot-image-svg")).toBeNull();
    expect(slot.style.aspectRatio).toBe("");
  });

  it("Phase 10 — extracts aspect ratio from width / height when viewBox is missing", async () => {
    const doc: AnnotDocument = {
      version: 1,
      lang: "en",
      title: "T",
      meta: { title: "T" },
      styleBlock: null,
      blocks: [
        {
          kind: "image",
          id: "img-wh",
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"></svg>',
        },
      ],
    };
    const el = mount(doc);
    await el.updateComplete;
    const slot = el.querySelector(
      'figure[data-annot-image-id="img-wh"] .annot-doc-image-svg-slot',
    ) as HTMLElement;
    expect(slot.style.aspectRatio).toBe("320 / 240");
  });
});

describe("annot-doc-shell: TOC", () => {
  it("renders one TOC entry per heading by default", async () => {
    const el = mount(makeMixedDoc());
    await el.updateComplete;
    const links = el.querySelectorAll(".annot-doc-toc a");
    expect(links).toHaveLength(3); // h1 + h2 + h3
    expect(links[0]?.textContent?.trim()).toBe("Mixed document");
    expect(links[1]?.textContent?.trim()).toBe("Section A");
    expect(links[2]?.textContent?.trim()).toBe("Subsection");
  });

  it("hides the TOC when show-toc is false", async () => {
    const el = mount(makeMixedDoc());
    el.showToc = false;
    await el.updateComplete;
    expect(el.querySelector(".annot-doc-toc")).toBeNull();
    expect(el.querySelector(".annot-doc-shell.no-toc")).not.toBeNull();
  });

  it("hides the TOC when no headings are present", async () => {
    const doc: AnnotDocument = {
      ...makeMixedDoc(),
      blocks: [{ kind: "paragraph", inlineHtml: "No headings." }],
    };
    const el = mount(doc);
    await el.updateComplete;
    expect(el.querySelector(".annot-doc-toc")).toBeNull();
  });

  it("scrolls into view + dispatches doc-heading-activated on TOC click", async () => {
    const el = mount(makeMixedDoc());
    await el.updateComplete;

    const captured: DocHeadingActivatedDetail[] = [];
    el.addEventListener("doc-heading-activated", (e) =>
      captured.push((e as CustomEvent<DocHeadingActivatedDetail>).detail),
    );

    const heading = el.querySelector("#annot-doc-heading-1") as HTMLElement | null;
    expect(heading).not.toBeNull();
    const scrollSpy = vi.fn();
    if (heading) heading.scrollIntoView = scrollSpy;

    const link = el.querySelectorAll(".annot-doc-toc a")[1] as HTMLAnchorElement;
    link.click();
    await el.updateComplete;

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.index).toBe(1);
    expect(captured[0]?.text).toBe("Section A");
  });
});

describe("annot-doc-shell: theme + style block", () => {
  it("emits a <style> child carrying the canonical doc CSS", async () => {
    const el = mount(makeMixedDoc());
    await el.updateComplete;
    const style = el.querySelector("style");
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain("--annot-doc-max-width");
    expect(style?.textContent).toContain('[data-annot-block="callout"]');
  });

  it('theme="auto" keeps the prefers-color-scheme branch', async () => {
    const doc: AnnotDocument = {
      ...makeMixedDoc(),
      meta: { title: "Auto", theme: "auto" },
    };
    const el = mount(doc);
    await el.updateComplete;
    expect(el.querySelector("style")?.textContent).toContain("@media (prefers-color-scheme: dark)");
  });

  it('theme="dark" switches to dark vars at top + drops the auto branch', async () => {
    const doc: AnnotDocument = {
      ...makeMixedDoc(),
      meta: { title: "Dark", theme: "dark" },
    };
    const el = mount(doc);
    await el.updateComplete;
    const css = el.querySelector("style")?.textContent ?? "";
    expect(css).toContain("--annot-doc-bg: #111827");
    expect(css).not.toContain("@media (prefers-color-scheme: dark)");
  });

  it("re-emits the style block when document changes", async () => {
    const el = mount(makeMixedDoc());
    await el.updateComplete;
    expect(el.querySelector("style")?.textContent).toContain("--annot-doc-max-width: 720px");

    el.document = {
      ...makeMixedDoc(),
      meta: { title: "Wide", maxWidth: "wide" },
    };
    await el.updateComplete;
    expect(el.querySelector("style")?.textContent).toContain("--annot-doc-max-width: 960px");
  });

  it("renders an already-styled document (idempotent with injectDocumentStyles)", async () => {
    const styled = injectDocumentStyles(createEmptyDocument({ title: "Pre-styled" }));
    const el = mount(styled);
    await el.updateComplete;
    // The shell's <style> is independent of the doc's stored
    // styleBlock — both can co-exist without conflict.
    expect(el.querySelector("style")).not.toBeNull();
    expect(el.querySelector("article[data-annot-doc]")).not.toBeNull();
  });

  it("declares display:block for the custom element so full-width docs claim their space", async () => {
    // User-reported regression: a document with
    // `meta.maxWidth: "full"` rendered as narrow as the step
    // card toolbar's min-content. Root cause: the custom element
    // `<annot-doc-shell>` is `display: inline` by default (HTML
    // spec for unknown elements). The inner `.annot-doc-shell`
    // div's `width: 100%` resolves against an inline parent
    // whose intrinsic width is its content's min-content, so the
    // article never expanded to the host's flex slot. Fix: emit
    // `annot-doc-shell { display: block }` alongside the existing
    // shell chrome CSS so the host element behaves like a block-
    // level container.
    const el = mount(makeMixedDoc());
    await el.updateComplete;
    const css = el.querySelector("style")?.textContent ?? "";
    // Locate the rule and assert its declaration block contains
    // `display: block`. Tolerant of surrounding whitespace.
    const idx = css.indexOf("annot-doc-shell {");
    expect(idx).toBeGreaterThan(-1);
    const end = css.indexOf("}", idx);
    expect(end).toBeGreaterThan(-1);
    expect(css.slice(idx, end)).toContain("display: block");
  });

  it("hides the viewport toolbar by default and shows it on hover / focus (with touch fallback)", async () => {
    // User-reported: the zoom toolbar at the top-left of each step
    // card always covered the underlying screenshot. The fix
    // hides it (opacity: 0, pointer-events: none) by default and
    // brings it back on `.step:hover` / `.step:focus-within`. A
    // `@media (hover: none)` override keeps it visible on touch
    // devices that have no hover state — there's no other
    // affordance to surface the buttons there.
    const el = mount(makeMixedDoc());
    await el.updateComplete;
    const css = el.querySelector("style")?.textContent ?? "";
    const start = css.indexOf(".annot-doc-step-viewport-controls {");
    expect(start).toBeGreaterThan(-1);
    const end = css.indexOf("}", start);
    const baseRule = css.slice(start, end);
    expect(baseRule).toContain("opacity: 0");
    expect(baseRule).toContain("pointer-events: none");
    // Hover / focus-within ramps back to opacity: 1.
    expect(css).toContain('[data-annot-block="step"]:hover .annot-doc-step-viewport-controls,');
    expect(css).toContain(
      '[data-annot-block="step"]:focus-within .annot-doc-step-viewport-controls',
    );
    // Touch fallback — `(hover: none)` keeps it always visible.
    expect(css).toContain("@media (hover: none)");
  });
});

// ---------------------------------------------------------------------------
// Phase 4a — editing mode
// ---------------------------------------------------------------------------

describe("annot-doc-shell: editing mode rendering", () => {
  it("does not wrap blocks or set contenteditable when editing=false", async () => {
    const el = mount(makeMixedDoc());
    el.editing = false;
    await el.updateComplete;
    expect(el.querySelector(".annot-doc-block-host")).toBeNull();
    expect(el.querySelector("annot-doc-block-toolbar")).toBeNull();
    expect(el.querySelectorAll('[contenteditable="true"]')).toHaveLength(0);
  });

  it("wraps each block + sets contenteditable on text blocks when editing=true", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const wrappers = el.querySelectorAll(".annot-doc-block-host");
    // Every block in the mixed doc gets a wrapper.
    expect(wrappers.length).toBe(makeMixedDoc().blocks.length);
    // Phase 4a → 4b → 5 contenteditable coverage:
    //   3 headings + 2 paragraphs (Phase 4a)
    //   + 2 list items + 1 quote paragraph + 1 callout paragraph
    //   + 1 figcaption (Phase 5)
    //   = 10
    const editable = el.querySelectorAll('[contenteditable="true"]');
    expect(editable.length).toBe(10);
    // Toolbars rendered for each wrapper.
    expect(el.querySelectorAll("annot-doc-block-toolbar").length).toBe(wrappers.length);
  });

  it("does not mark non-text blocks as contentEditable in Phase 4a", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    // The block WRAPPERS stay read-only — only the inner
    // text-bearing elements (`<li>`, inner `<p>`, `<figcaption>`)
    // become contentEditable in Phase 5.
    const ce = (sel: string) =>
      (el.querySelector(sel) as HTMLElement | null)?.getAttribute("contenteditable");
    expect(ce('blockquote[data-annot-block="quote"]')).toBeNull();
    expect(ce('aside[data-annot-block="callout"]')).toBeNull();
    expect(ce('pre[data-annot-block="code"]')).toBeNull();
    expect(ce('ul[data-annot-block="list"]')).toBeNull();
    expect(ce('hr[data-annot-block="divider"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — contentEditable coverage extension
// ---------------------------------------------------------------------------

describe("annot-doc-shell: phase 5 contentEditable coverage", () => {
  it("renders list items / quote / callout / figcaption as contentEditable", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    // List items individually contentEditable, indexed.
    const liEditables = el.querySelectorAll('li[contenteditable="true"]');
    expect(liEditables).toHaveLength(2);
    expect(liEditables[0]?.getAttribute("data-list-item-index")).toBe("0");
    expect(liEditables[1]?.getAttribute("data-list-item-index")).toBe("1");
    // Quote / callout inner paragraphs.
    expect(el.querySelectorAll("p[data-quote-paragraph-index]")).toHaveLength(1);
    expect(el.querySelectorAll("p[data-callout-paragraph-index]")).toHaveLength(1);
    // Figcaption.
    expect(el.querySelector('figcaption[contenteditable="true"]')).not.toBeNull();
  });

  it("populates each editable with its block content via #updated", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const li0 = el.querySelector('li[data-list-item-index="0"]') as HTMLElement;
    const li1 = el.querySelector('li[data-list-item-index="1"]') as HTMLElement;
    expect(li0.innerHTML).toBe("one");
    expect(li1.innerHTML).toBe("two");
    const quoteP = el.querySelector("p[data-quote-paragraph-index]") as HTMLElement;
    expect(quoteP.innerHTML).toBe("A wise saying.");
    const calloutP = el.querySelector("p[data-callout-paragraph-index]") as HTMLElement;
    expect(calloutP.innerHTML).toBe("Heads up.");
    const figcaption = el.querySelector('figcaption[contenteditable="true"]') as HTMLElement;
    expect(figcaption.innerHTML).toBe("An image.");
  });

  it("DOM edits to list items round-trip through commit", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const li0 = el.querySelector('li[data-list-item-index="0"]') as HTMLElement;
    li0.innerHTML = "<b>edited</b>";
    el.commit();
    const list = el.document?.blocks.find((b) => b.kind === "list");
    expect(list).toBeDefined();
    if (list?.kind === "list") {
      expect(list.items[0]).toBe("<b>edited</b>");
      expect(list.items[1]).toBe("two");
    }
  });

  it("DOM edits to quote paragraphs round-trip through commit", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const p = el.querySelector('p[data-quote-paragraph-index="0"]') as HTMLElement;
    p.innerHTML = "Edited quote";
    el.commit();
    const quote = el.document?.blocks.find((b) => b.kind === "quote");
    if (quote?.kind === "quote") {
      expect(quote.paragraphs[0]).toBe("Edited quote");
    }
  });

  it("DOM edits to figcaption round-trip through commit (and dropping clears the field)", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const fc = el.querySelector('figcaption[contenteditable="true"]') as HTMLElement;
    fc.innerHTML = "New caption";
    el.commit();
    let image = el.document?.blocks.find((b) => b.kind === "image");
    if (image?.kind === "image") {
      expect(image.caption).toBe("New caption");
    }
    // Empty figcaption drops the caption field entirely.
    const fc2 = el.querySelector('figcaption[contenteditable="true"]') as HTMLElement;
    fc2.innerHTML = "   ";
    el.commit();
    image = el.document?.blocks.find((b) => b.kind === "image");
    if (image?.kind === "image") {
      expect(image.caption).toBeUndefined();
    }
  });

  it("Enter on a list item splits into a new item below the cursor", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const li0 = el.querySelector('li[data-list-item-index="0"]') as HTMLElement;
    li0.focus();
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    li0.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await el.updateComplete;
    const list = el.document?.blocks.find((b) => b.kind === "list");
    if (list?.kind === "list") {
      // Original "one" + "two" plus a new empty item between them.
      expect(list.items).toHaveLength(3);
      expect(list.items[0]).toBe("one");
      expect(list.items[1]).toBe("");
      expect(list.items[2]).toBe("two");
    }
  });

  it("Enter on the empty trailing list item exits the list to a paragraph", async () => {
    const doc: AnnotDocument = {
      version: 1,
      lang: "en",
      title: "T",
      meta: { title: "T" },
      styleBlock: null,
      blocks: [{ kind: "list", ordered: false, listStyle: "disc", items: ["first", ""] }],
    };
    const el = mount(doc);
    el.editing = true;
    await el.updateComplete;
    const li1 = el.querySelector('li[data-list-item-index="1"]') as HTMLElement;
    li1.focus();
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    li1.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await el.updateComplete;
    const blocks = el.document?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe("list");
    expect(blocks[1]?.kind).toBe("paragraph");
    if (blocks[0]?.kind === "list") {
      expect(blocks[0].items).toEqual(["first"]);
    }
  });

  it("Enter on a quote paragraph splits into a new paragraph below", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const p = el.querySelector('p[data-quote-paragraph-index="0"]') as HTMLElement;
    p.focus();
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    p.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await el.updateComplete;
    const quote = el.document?.blocks.find((b) => b.kind === "quote");
    if (quote?.kind === "quote") {
      expect(quote.paragraphs).toHaveLength(2);
      expect(quote.paragraphs[0]).toBe("A wise saying.");
      expect(quote.paragraphs[1]).toBe("");
    }
  });

  it("Shift+Enter on a list item falls through to the browser default", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const li0 = el.querySelector('li[data-list-item-index="0"]') as HTMLElement;
    li0.focus();
    const ev = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    li0.dispatchEvent(ev);
    // Shell does NOT preventDefault — browser default (line break)
    // applies. The list block stays at 2 items.
    expect(ev.defaultPrevented).toBe(false);
    const list = el.document?.blocks.find((b) => b.kind === "list");
    if (list?.kind === "list") {
      expect(list.items).toHaveLength(2);
    }
  });

  it("clicking the figcaption does NOT open the image-edit modal", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const fc = el.querySelector('figcaption[contenteditable="true"]') as HTMLElement;
    fc.click();
    await el.updateComplete;
    expect(document.querySelector("annot-doc-image-editor-modal")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — Image flow polish
// ---------------------------------------------------------------------------

describe("annot-doc-shell: phase 6 image flow", () => {
  function makeFileDragEvent(type: string): DragEvent {
    // happy-dom's DragEvent constructor doesn't reliably store
    // `dataTransfer` from the init dict, so we attach it
    // imperatively. The shell's handler only checks for the
    // "Files" entry in `dataTransfer.types`, so the value here
    // doesn't need real File payloads.
    const ev = new DragEvent(type, { bubbles: true, cancelable: true });
    const dt = { types: ["Files"], items: [], files: [] } as unknown as DataTransfer;
    Object.defineProperty(ev, "dataTransfer", { value: dt });
    return ev;
  }

  it("dragenter shows the drop-zone overlay; dragleave hides it", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    expect(el.querySelector(".annot-doc-shell-dropzone")).toBeNull();
    el.dispatchEvent(makeFileDragEvent("dragenter"));
    await el.updateComplete;
    expect(el.querySelector(".annot-doc-shell-dropzone")).not.toBeNull();
    el.dispatchEvent(makeFileDragEvent("dragleave"));
    await el.updateComplete;
    expect(el.querySelector(".annot-doc-shell-dropzone")).toBeNull();
  });

  it("dragenter has no effect outside editing mode", async () => {
    const el = mount(makeMixedDoc());
    el.editing = false;
    await el.updateComplete;
    el.dispatchEvent(makeFileDragEvent("dragenter"));
    await el.updateComplete;
    expect(el.querySelector(".annot-doc-shell-dropzone")).toBeNull();
  });

  it("dragging block 0 onto the insert-bar after block 2 reorders to the new position", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const beforeKinds = el.document!.blocks.map((b) => b.kind);

    // Block 0 (heading "Mixed document") is the source.
    const handle = el.querySelector(
      '.annot-doc-block-host[data-block-index="0"] .block-action-handle',
    );
    if (!handle) throw new Error("drag handle missing");
    // Synthesise dragstart on the handle
    handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true }));

    // Drop on the insert bar at position 3 (after the third
    // block) — block 0 should land at index 2 after the splice
    // adjustment.
    const insertBar3 = el.querySelector(
      'annot-doc-insert-bar[data-insert-at="3"] .annot-doc-insert-bar-button',
    );
    if (!insertBar3) throw new Error("insert bar at 3 missing");
    insertBar3.dispatchEvent(new DragEvent("drop", { bubbles: true }));
    await el.updateComplete;

    const afterKinds = el.document!.blocks.map((b) => b.kind);
    // The block 0 originally first (heading) should now be at
    // index 2; the surrounding blocks shifted up by one.
    expect(afterKinds[0]).toBe(beforeKinds[1]);
    expect(afterKinds[1]).toBe(beforeKinds[2]);
    expect(afterKinds[2]).toBe(beforeKinds[0]);
  });

  it("dropping on the bar immediately before/after the source is a no-op", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const before = el.document!.blocks.map((b) => b.kind);
    const handle = el.querySelector(
      '.annot-doc-block-host[data-block-index="2"] .block-action-handle',
    );
    if (!handle) throw new Error("drag handle missing");
    handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true }));
    // Drop onto the bar at insertAt=2 (immediately above block
    // 2 — same position) → no-op.
    const sameBar = el.querySelector(
      'annot-doc-insert-bar[data-insert-at="2"] .annot-doc-insert-bar-button',
    );
    if (!sameBar) throw new Error("bar at 2 missing");
    sameBar.dispatchEvent(new DragEvent("drop", { bubbles: true }));
    await el.updateComplete;
    expect(el.document!.blocks.map((b) => b.kind)).toEqual(before);
  });

  it("reorder pushes a history snapshot (undoable)", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const before = el.document!.blocks.map((b) => b.kind);
    const handle = el.querySelector(
      '.annot-doc-block-host[data-block-index="0"] .block-action-handle',
    );
    handle?.dispatchEvent(new DragEvent("dragstart", { bubbles: true }));
    const bar = el.querySelector(
      'annot-doc-insert-bar[data-insert-at="3"] .annot-doc-insert-bar-button',
    );
    bar?.dispatchEvent(new DragEvent("drop", { bubbles: true }));
    await el.updateComplete;
    expect(el.canUndo()).toBe(true);
    el.undo();
    await el.updateComplete;
    expect(el.document!.blocks.map((b) => b.kind)).toEqual(before);
  });

  // Phase 8 — keyboard shortcut catalogue
  it("Ctrl+Shift+1/2/3 converts the focused block to Heading 1/2/3", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    // Focus the second paragraph (index 1) so the conversion
    // resolves to that block.
    const p = el.querySelector(
      '.annot-doc-block-host[data-block-index="1"] [data-annot-block="paragraph"][contenteditable="true"]',
    ) as HTMLElement;
    p.focus();
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "2", ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    await el.updateComplete;
    const block = el.document!.blocks[1];
    expect(block?.kind).toBe("heading");
    if (block?.kind === "heading") {
      expect(block.level).toBe(2);
      // Inline HTML preserved across conversion.
      expect(block.inlineHtml).toBe("Intro paragraph.");
    }
  });

  it("Ctrl+Shift+8 / Ctrl+Shift+7 convert to bulleted / numbered list", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const p = el.querySelector(
      '.annot-doc-block-host[data-block-index="1"] [data-annot-block="paragraph"][contenteditable="true"]',
    ) as HTMLElement;
    p.focus();
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "8", ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    await el.updateComplete;
    let b = el.document!.blocks[1];
    expect(b?.kind).toBe("list");
    if (b?.kind === "list") expect(b.ordered).toBe(false);

    // Now switch to numbered.
    const li0 = el.querySelector(
      '.annot-doc-block-host[data-block-index="1"] li[contenteditable="true"]',
    ) as HTMLElement;
    li0.focus();
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "7", ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    await el.updateComplete;
    b = el.document!.blocks[1];
    expect(b?.kind).toBe("list");
    if (b?.kind === "list") expect(b.ordered).toBe(true);
  });

  it("Ctrl+Shift+> converts to quote", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const p = el.querySelector(
      '.annot-doc-block-host[data-block-index="1"] [data-annot-block="paragraph"][contenteditable="true"]',
    ) as HTMLElement;
    p.focus();
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: ">", ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    await el.updateComplete;
    expect(el.document!.blocks[1]?.kind).toBe("quote");
  });

  it("Ctrl+Enter inserts a paragraph below the focused block", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const before = el.document!.blocks.length;
    const p = el.querySelector(
      '.annot-doc-block-host[data-block-index="1"] [data-annot-block="paragraph"][contenteditable="true"]',
    ) as HTMLElement;
    p.focus();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    await el.updateComplete;
    expect(el.document!.blocks.length).toBe(before + 1);
    // The new paragraph lands at index 2 (after the focused one
    // at index 1).
    expect(el.document!.blocks[2]?.kind).toBe("paragraph");
  });

  it("Ctrl+Shift+Enter inserts a paragraph above the focused block", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const before = el.document!.blocks.length;
    const p = el.querySelector(
      '.annot-doc-block-host[data-block-index="1"] [data-annot-block="paragraph"][contenteditable="true"]',
    ) as HTMLElement;
    p.focus();
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await el.updateComplete;
    expect(el.document!.blocks.length).toBe(before + 1);
    // New paragraph at index 1 (above the previously-focused
    // block, which has shifted to index 2).
    expect(el.document!.blocks[1]?.kind).toBe("paragraph");
  });

  // Phase 9 — mobile / TOC drawer
  it("renders a TOC toggle button when the doc has headings", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const toggle = el.querySelector(".annot-doc-shell-toc-toggle") as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("clicking the TOC toggle flips tocOpen + the toc-open shell modifier class", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const wrapper = el.querySelector(".annot-doc-shell") as HTMLElement;
    expect(wrapper.classList.contains("toc-open")).toBe(false);
    const toggle = el.querySelector(".annot-doc-shell-toc-toggle") as HTMLButtonElement;
    toggle.click();
    await el.updateComplete;
    expect(el.querySelector(".annot-doc-shell")?.classList.contains("toc-open")).toBe(true);
    expect(el.querySelector(".annot-doc-shell-toc-toggle")?.getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("does not render the TOC toggle when there are no headings", async () => {
    const noHeadings: AnnotDocument = {
      version: 1,
      lang: "en",
      title: "No headings",
      meta: { title: "No headings" },
      styleBlock: null,
      blocks: [{ kind: "paragraph", inlineHtml: "Just one paragraph." }],
    };
    const el = mount(noHeadings);
    el.editing = true;
    await el.updateComplete;
    expect(el.querySelector(".annot-doc-shell-toc-toggle")).toBeNull();
  });

  it("openKeyboardHelp opens the modal with the doc-mode group appended", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    el.openKeyboardHelp();
    const modal = document.querySelector(".keyboard-help-panel");
    expect(modal).not.toBeNull();
    const titles = Array.from(
      modal!.querySelectorAll<HTMLElement>(".keyboard-help-group-title"),
    ).map((t) => t.textContent?.trim() ?? "");
    expect(titles).toContain("Document — Editing");
    expect(titles).toContain("Document — Blocks");
    expect(titles).toContain("Document — Block kind");
    // Cleanup so subsequent tests don't see a stray modal.
    document.querySelector(".keyboard-help-backdrop")?.remove();
  });

  it("dragend without a drop clears the dragged-block bookkeeping", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const handle = el.querySelector(
      '.annot-doc-block-host[data-block-index="0"] .block-action-handle',
    );
    handle?.dispatchEvent(new DragEvent("dragstart", { bubbles: true }));
    handle?.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    // A drop now SHOULD NOT reorder anything because the
    // bookkeeping has been cleared.
    const before = el.document!.blocks.map((b) => b.kind);
    const bar = el.querySelector(
      'annot-doc-insert-bar[data-insert-at="3"] .annot-doc-insert-bar-button',
    );
    bar?.dispatchEvent(new DragEvent("drop", { bubbles: true }));
    await el.updateComplete;
    expect(el.document!.blocks.map((b) => b.kind)).toEqual(before);
  });

  it("drop clears the drop-zone overlay even when no editable target", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    el.dispatchEvent(makeFileDragEvent("dragenter"));
    await el.updateComplete;
    expect(el.querySelector(".annot-doc-shell-dropzone")).not.toBeNull();
    el.dispatchEvent(makeFileDragEvent("drop"));
    await el.updateComplete;
    expect(el.querySelector(".annot-doc-shell-dropzone")).toBeNull();
  });
});

describe("annot-doc-shell: block toolbar actions", () => {
  function clickToolbarAction(el: AnnotDocShellElement, blockIndex: number, label: string): void {
    const wrapper = el.querySelectorAll(".annot-doc-block-host")[blockIndex] as HTMLElement;
    const button = wrapper.querySelector(
      `annot-doc-block-toolbar button[aria-label="${label}"]`,
    ) as HTMLButtonElement;
    button.click();
  }

  it("delete removes the block + emits doc-changed", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;

    const events: DocChangedDetail[] = [];
    el.addEventListener("doc-changed", (e) =>
      events.push((e as CustomEvent<DocChangedDetail>).detail),
    );

    const before = el.document!.blocks.length;
    clickToolbarAction(el, 0, "Delete block");
    await el.updateComplete;

    expect(el.document!.blocks.length).toBe(before - 1);
    expect(events).toHaveLength(1);
    expect(events[0]?.reason).toBe("block-action");
  });

  it("delete on the only block keeps an empty placeholder paragraph", async () => {
    const doc: AnnotDocument = {
      version: 1,
      lang: "en",
      title: "Single",
      meta: { title: "Single" },
      styleBlock: null,
      blocks: [{ kind: "heading", level: 1, inlineHtml: "Lonely" }],
    };
    const el = mount(doc);
    el.editing = true;
    await el.updateComplete;

    clickToolbarAction(el, 0, "Delete block");
    await el.updateComplete;

    expect(el.document!.blocks).toHaveLength(1);
    expect(el.document!.blocks[0]?.kind).toBe("paragraph");
  });

  it("moveUp + moveDown reorder blocks", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;

    const blockKindAt = (i: number) => el.document!.blocks[i]?.kind;
    const block1 = blockKindAt(1);
    const block2 = blockKindAt(2);

    clickToolbarAction(el, 2, "Move up");
    await el.updateComplete;
    expect(blockKindAt(1)).toBe(block2);
    expect(blockKindAt(2)).toBe(block1);

    clickToolbarAction(el, 1, "Move down");
    await el.updateComplete;
    expect(blockKindAt(1)).toBe(block1);
    expect(blockKindAt(2)).toBe(block2);
  });

  it("first block has Move Up disabled; last has Move Down disabled", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const wrappers = el.querySelectorAll(".annot-doc-block-host");
    const lastIdx = wrappers.length - 1;
    const firstUp = wrappers[0]?.querySelector('[aria-label="Move up"]') as HTMLButtonElement;
    const lastDown = wrappers[lastIdx]?.querySelector(
      '[aria-label="Move down"]',
    ) as HTMLButtonElement;
    expect(firstUp.disabled).toBe(true);
    expect(lastDown.disabled).toBe(true);
  });
});

describe("annot-doc-shell: undo / redo", () => {
  it("undo + redo walk the history after a delete", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;

    const before = el.document!.blocks.length;
    expect(el.canUndo()).toBe(false);

    // Delete a block via the toolbar.
    const wrapper = el.querySelectorAll(".annot-doc-block-host")[0] as HTMLElement;
    const del = wrapper.querySelector(
      'annot-doc-block-toolbar [aria-label="Delete block"]',
    ) as HTMLButtonElement;
    del.click();
    await el.updateComplete;
    expect(el.document!.blocks.length).toBe(before - 1);
    expect(el.canUndo()).toBe(true);

    expect(el.undo()).toBe(true);
    await el.updateComplete;
    expect(el.document!.blocks.length).toBe(before);
    expect(el.canRedo()).toBe(true);

    expect(el.redo()).toBe(true);
    await el.updateComplete;
    expect(el.document!.blocks.length).toBe(before - 1);
  });

  it("undo on a fresh document returns false", () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    expect(el.canUndo()).toBe(false);
    expect(el.undo()).toBe(false);
  });

  it("Ctrl+Z + Ctrl+Shift+Z keyboard shortcuts trigger undo/redo", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;

    const before = el.document!.blocks.length;

    const wrapper = el.querySelectorAll(".annot-doc-block-host")[0] as HTMLElement;
    const del = wrapper.querySelector(
      'annot-doc-block-toolbar [aria-label="Delete block"]',
    ) as HTMLButtonElement;
    del.click();
    await el.updateComplete;
    expect(el.document!.blocks.length).toBe(before - 1);

    el.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    await el.updateComplete;
    expect(el.document!.blocks.length).toBe(before);

    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    await el.updateComplete;
    expect(el.document!.blocks.length).toBe(before - 1);
  });

  it("setting document property externally resets the history", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    // Trigger a mutation so undo becomes available.
    const wrapper = el.querySelectorAll(".annot-doc-block-host")[0] as HTMLElement;
    (
      wrapper.querySelector(
        'annot-doc-block-toolbar [aria-label="Delete block"]',
      ) as HTMLButtonElement
    ).click();
    await el.updateComplete;
    expect(el.canUndo()).toBe(true);

    // External doc swap → history reset.
    el.document = makeMixedDoc();
    await el.updateComplete;
    expect(el.canUndo()).toBe(false);
  });
});

describe("annot-doc-shell: text editing", () => {
  it("commit() folds DOM edits into the document", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    // Phase 2 of `annot-html-document-ux-polish.md` interleaves
    // `<annot-doc-insert-bar>` between every block-host inside
    // `<article>`, so positional `:nth-child` no longer hits the
    // intended block-host. Query the second host by index over
    // the class-keyed NodeList instead.
    const wrappers = el.querySelectorAll(".annot-doc-block-host");
    const para = wrappers[1]?.querySelector('p[data-annot-block="paragraph"]') as HTMLElement;
    expect(para).not.toBeNull();
    para.innerHTML = "Edited paragraph";
    el.commit();
    expect(el.canUndo()).toBe(true);
    // Paragraph at index 1 in the mixed doc.
    const para1 = el.document!.blocks[1];
    expect(para1?.kind).toBe("paragraph");
    if (para1?.kind === "paragraph") {
      expect(para1.inlineHtml).toBe("Edited paragraph");
    }
  });

  it("commit() dispatches doc-changed when the DOM was dirty (autosave hook-up)", async () => {
    // Regression: inline-link `createLink` + format-toolbar
    // B / I / U mutate the contentEditable then call
    // `this.commit()`, expecting the host's `doc-changed`
    // listener to drive autosave. Pre-fix, `commit()` updated
    // the in-memory document but never fired the event, so
    // reopening the file dropped the link / format wrapper
    // while keeping the visible text behind it.
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const wrappers = el.querySelectorAll(".annot-doc-block-host");
    const para = wrappers[1]?.querySelector('p[data-annot-block="paragraph"]') as HTMLElement;
    para.innerHTML = 'A <a href="https://example.com">link</a> survives.';
    const events: Array<{ reason: string; html: string }> = [];
    el.addEventListener("doc-changed", (e) => {
      const detail = (
        e as CustomEvent<{ document: { blocks: ReadonlyArray<unknown> }; reason: string }>
      ).detail;
      const block = detail.document.blocks[1] as { kind: string; inlineHtml: string } | undefined;
      events.push({
        reason: detail.reason,
        html: block?.kind === "paragraph" ? block.inlineHtml : "",
      });
    });
    el.commit();
    expect(events).toHaveLength(1);
    expect(events[0]?.reason).toBe("commit");
    expect(events[0]?.html).toBe('A <a href="https://example.com">link</a> survives.');
  });

  it("commit() with no DOM changes does NOT dispatch doc-changed", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const events: Event[] = [];
    el.addEventListener("doc-changed", (e) => events.push(e));
    el.commit();
    expect(events).toHaveLength(0);
  });

  it("debounced input commits to history after the configured idle window", async () => {
    vi.useFakeTimers();
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const para = el.querySelector('p[data-annot-block="paragraph"]') as HTMLElement;
    para.innerHTML = "Mid-typing snapshot";
    // Fire input event to start the debounce.
    el.querySelector("article[data-annot-doc]")?.dispatchEvent(
      new InputEvent("input", { bubbles: true }),
    );
    expect(el.canUndo()).toBe(false);
    // Advance past the debounce window.
    vi.advanceTimersByTime(700);
    expect(el.canUndo()).toBe(true);
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Phase 4b — slash menu + insert above/below
// ---------------------------------------------------------------------------

describe("annot-doc-shell: insert above / insert below", () => {
  function clickToolbarAction(el: AnnotDocShellElement, blockIndex: number, label: string): void {
    const wrapper = el.querySelectorAll(".annot-doc-block-host")[blockIndex] as HTMLElement;
    const button = wrapper.querySelector(
      `annot-doc-block-toolbar button[aria-label="${label}"]`,
    ) as HTMLButtonElement;
    button.click();
  }

  it("insert above adds an empty paragraph at the block's index", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const before = el.document!.blocks.length;
    clickToolbarAction(el, 1, "Insert block above");
    await el.updateComplete;
    expect(el.document!.blocks.length).toBe(before + 1);
    expect(el.document!.blocks[1]?.kind).toBe("paragraph");
    if (el.document!.blocks[1]?.kind === "paragraph") {
      expect(el.document!.blocks[1].inlineHtml).toBe("");
    }
  });

  it("insert below adds an empty paragraph at the next slot", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const before = el.document!.blocks.length;
    clickToolbarAction(el, 1, "Insert block below");
    await el.updateComplete;
    expect(el.document!.blocks.length).toBe(before + 1);
    expect(el.document!.blocks[2]?.kind).toBe("paragraph");
  });

  it("inserts contribute a history entry", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    expect(el.canUndo()).toBe(false);
    clickToolbarAction(el, 0, "Insert block below");
    await el.updateComplete;
    expect(el.canUndo()).toBe(true);
  });
});

describe("annot-doc-shell: slash menu", () => {
  it("opens the menu when `/` is the only text in an empty editable block", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    // The first paragraph in the mixed doc is the second block.
    const para = el.querySelector(
      '.annot-doc-block-host[data-block-index="1"] p[contenteditable="true"]',
    ) as HTMLElement;
    expect(para).not.toBeNull();
    para.textContent = "/";
    para.dispatchEvent(new InputEvent("input", { bubbles: true }));
    // The menu mounts to body; querySelector outside the shell.
    const menu = document.querySelector("annot-doc-block-menu");
    expect(menu).not.toBeNull();
    // The trigger char is stripped from the editable block.
    expect(para.textContent).toBe("");
    // Clean up the menu so it doesn't bleed into other tests.
    (menu as { close?: () => void } | null)?.close?.();
  });

  it("does NOT open the menu when text in the block is non-empty", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const para = el.querySelector('p[contenteditable="true"]') as HTMLElement;
    para.textContent = "Hello/";
    para.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(document.querySelector("annot-doc-block-menu")).toBeNull();
  });

  it("selecting a heading replaces the trigger block with the chosen kind", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const para = el.querySelector(
      '.annot-doc-block-host[data-block-index="1"] p[contenteditable="true"]',
    ) as HTMLElement;
    para.textContent = "/";
    para.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const menu = document.querySelector("annot-doc-block-menu") as
      | (HTMLElement & { updateComplete: Promise<unknown> })
      | null;
    expect(menu).not.toBeNull();
    await menu!.updateComplete;

    // Pick "Heading 2" via its data-block-menu-id.
    (menu!.querySelector('[data-block-menu-id="h2"]') as HTMLButtonElement).click();
    await el.updateComplete;

    const replaced = el.document!.blocks[1];
    expect(replaced?.kind).toBe("heading");
    if (replaced?.kind === "heading") {
      expect(replaced.level).toBe(2);
      expect(replaced.inlineHtml).toBe("");
    }
    // Menu cleans itself up on select.
    expect(document.querySelector("annot-doc-block-menu")).toBeNull();
  });

  it("selecting Divider replaces the trigger block with a divider", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const para = el.querySelector(
      '.annot-doc-block-host[data-block-index="1"] p[contenteditable="true"]',
    ) as HTMLElement;
    para.textContent = "/";
    para.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const menu = document.querySelector("annot-doc-block-menu") as
      | (HTMLElement & { updateComplete: Promise<unknown> })
      | null;
    expect(menu).not.toBeNull();
    await menu!.updateComplete;
    (menu!.querySelector('[data-block-menu-id="divider"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.document!.blocks[1]?.kind).toBe("divider");
  });
});

// ---------------------------------------------------------------------------
// Phase 5a — image block click-to-edit modal
// ---------------------------------------------------------------------------

describe("annot-doc-shell: image block click-to-edit", () => {
  it("clicking an image block in editing mode opens the editor modal", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const figure = el.querySelector('figure[data-annot-block="image"]') as HTMLElement;
    expect(figure).not.toBeNull();
    figure.click();
    await el.updateComplete;
    const modal = document.querySelector("annot-doc-image-editor-modal");
    expect(modal).not.toBeNull();
    // Cancel for a clean teardown.
    (
      modal!.querySelector(
        ".annot-doc-image-editor-modal-footer button:not(.primary)",
      ) as HTMLButtonElement
    )?.click();
  });

  it("clicking the block toolbar inside an image block does NOT open the modal", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const wrappers = el.querySelectorAll(".annot-doc-block-host");
    // Find the wrapper containing the image block.
    const imageWrapper = Array.from(wrappers).find(
      (w) => w.querySelector('figure[data-annot-block="image"]') !== null,
    ) as HTMLElement;
    const moveUpBtn = imageWrapper.querySelector(
      'annot-doc-block-toolbar button[aria-label="Move up"]',
    ) as HTMLButtonElement;
    moveUpBtn.click();
    await el.updateComplete;
    expect(document.querySelector("annot-doc-image-editor-modal")).toBeNull();
  });

  it("clicking image blocks in non-editing mode does NOT open the modal", async () => {
    const el = mount(makeMixedDoc());
    el.editing = false;
    await el.updateComplete;
    const figure = el.querySelector('figure[data-annot-block="image"]') as HTMLElement;
    figure.click();
    await el.updateComplete;
    expect(document.querySelector("annot-doc-image-editor-modal")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 5b — capture insertion (paste / drop / file picker)
// ---------------------------------------------------------------------------

const PNG_PIXEL =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function makeImageFile(): File {
  // 1x1 transparent PNG bytes inline.
  const bin = atob(PNG_PIXEL.split(",")[1] ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], "test.png", { type: "image/png" });
}

/** Wait until the doc has the expected number of blocks (the
 *  insertion path is async — file → data url → image decode →
 *  history push). Bails after `maxIterations` ticks to avoid
 *  hanging the suite if the insertion wedges. */
async function waitForBlockCount(
  el: AnnotDocShellElement,
  expectedCount: number,
  maxIterations = 50,
): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    if (el.document?.blocks.length === expectedCount) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Patch `HTMLImageElement.prototype.src` to synchronously fire
 *  `onload` with synthetic `naturalWidth` / `naturalHeight` —
 *  happy-dom doesn't actually decode images, so the helper's
 *  `Image()` would never resolve in the test environment. Same
 *  pattern editor-shell.test.ts uses. */
function installImageLoadStub(): { restore: () => void } {
  const proto = HTMLImageElement.prototype;
  const orig = Object.getOwnPropertyDescriptor(proto, "src");
  Object.defineProperty(proto, "src", {
    configurable: true,
    set(this: HTMLImageElement & { _src?: string }, value: string) {
      this._src = value;
      Object.defineProperty(this, "naturalWidth", { value: 200, configurable: true });
      Object.defineProperty(this, "naturalHeight", { value: 150, configurable: true });
      queueMicrotask(() => {
        this.onload?.(new Event("load"));
      });
    },
    get(this: HTMLImageElement & { _src?: string }) {
      return this._src ?? "";
    },
  });
  return {
    restore: () => {
      if (orig) Object.defineProperty(proto, "src", orig);
      else delete (proto as unknown as { src?: string }).src;
    },
  };
}

describe("annot-doc-shell: paste / drop image insertion", () => {
  let imgStub: { restore: () => void } | null = null;
  beforeEach(() => {
    imgStub = installImageLoadStub();
  });
  afterEach(() => {
    imgStub?.restore();
    imgStub = null;
  });

  it("paste handler inserts an image block when clipboard has an image file", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const before = el.document!.blocks.length;
    const file = makeImageFile();
    const dt = new DataTransfer();
    dt.items.add(file);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    await waitForBlockCount(el, before + 1);
    expect(el.document!.blocks.length).toBe(before + 1);
    const last = el.document!.blocks[el.document!.blocks.length - 1];
    expect(last?.kind).toBe("image");
  });

  it("paste handler ignores non-image clipboard contents", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const before = el.document!.blocks.length;
    const dt = new DataTransfer();
    dt.setData("text/plain", "hello");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(el.document!.blocks.length).toBe(before);
  });

  it("paste handler is a no-op when editing=false", async () => {
    const el = mount(makeMixedDoc());
    el.editing = false;
    await el.updateComplete;
    const before = el.document!.blocks.length;
    const file = makeImageFile();
    const dt = new DataTransfer();
    dt.items.add(file);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    expect(el.document!.blocks.length).toBe(before);
  });

  it("drop handler inserts an image block when an image file is dropped", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const before = el.document!.blocks.length;
    const file = makeImageFile();
    const dt = new DataTransfer();
    dt.items.add(file);
    // happy-dom's DragEvent constructor doesn't reliably store
    // the `dataTransfer` init field on the resulting event, so we
    // attach it imperatively before dispatch.
    const ev = new DragEvent("drop", { bubbles: true });
    Object.defineProperty(ev, "dataTransfer", { value: dt });
    el.dispatchEvent(ev);
    await waitForBlockCount(el, before + 1);
    expect(el.document!.blocks.length).toBe(before + 1);
    expect(el.document!.blocks[el.document!.blocks.length - 1]?.kind).toBe("image");
  });

  it("drop handler is a no-op when editing=false", async () => {
    const el = mount(makeMixedDoc());
    el.editing = false;
    await el.updateComplete;
    const before = el.document!.blocks.length;
    const file = makeImageFile();
    const dt = new DataTransfer();
    dt.items.add(file);
    // happy-dom's DragEvent constructor doesn't reliably store
    // the `dataTransfer` init field on the resulting event, so we
    // attach it imperatively before dispatch.
    const ev = new DragEvent("drop", { bubbles: true });
    Object.defineProperty(ev, "dataTransfer", { value: dt });
    el.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 30));
    expect(el.document!.blocks.length).toBe(before);
  });

  it("an image insertion pushes a history snapshot (undoable)", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const before = el.document!.blocks.length;
    expect(el.canUndo()).toBe(false);
    const file = makeImageFile();
    const dt = new DataTransfer();
    dt.items.add(file);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    await waitForBlockCount(el, before + 1);
    expect(el.canUndo()).toBe(true);
  });

  it("preserves annotations when an .annot.png is pasted (XMP path)", async () => {
    // Reported in production: dragging a `.annot.png` (a re-
    // editable PNG carrying its annotation `<g>` in XMP)
    // produced a flat-pixels image block that couldn't be
    // edited in the modal. This test feeds a synthesised
    // editable PNG through the paste path + asserts the
    // resulting block embeds the original bitmap + the
    // annotation rect.
    const { createEditableImage } = await import("@ingcreators/annot-core/xmp");
    const annotationsSvg = '<g id="annotations"><rect x="5" y="5" width="20" height="20"/></g>';
    const tinyPngBytes = (() => {
      const bin = atob(PNG_PIXEL.split(",")[1] ?? "");
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8;
    })();
    const renderedBlob = new Blob([tinyPngBytes as BlobPart], { type: "image/png" });
    const editableBlob = await createEditableImage({
      renderedBlob,
      originalDataUrl: PNG_PIXEL,
      annotationsSvg,
      width: 64,
      height: 48,
      format: "png",
    });
    const editableBytes = new Uint8Array(await editableBlob.arrayBuffer());
    const file = new File([editableBytes as BlobPart], "screenshot.annot.png", {
      type: "image/png",
    });

    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    const before = el.document!.blocks.length;
    const dt = new DataTransfer();
    dt.items.add(file);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    await waitForBlockCount(el, before + 1);

    const last = el.document!.blocks[el.document!.blocks.length - 1];
    expect(last?.kind).toBe("image");
    if (last?.kind !== "image") return;
    // The block's SVG should carry the ORIGINAL bitmap (from
    // the XMP custom chunk) — same data URL we passed in,
    // re-emitted by the reader.
    expect(last.svg).toContain('<image href="data:image/png;base64,');
    // AND the annotation rect, byte-for-byte from the XMP
    // `<annotations>` tag.
    expect(last.svg).toContain('<rect x="5" y="5" width="20" height="20"/>');
    // viewBox dimensions match the source.
    expect(last.svg).toContain('viewBox="0 0 64 48"');
  });
});

// ---------------------------------------------------------------------------
// Phase 3 of docs/plans/_done/card-procedure-template.md — step block
// editing affordances.
// ---------------------------------------------------------------------------

describe("annot-doc-shell: step block editing", () => {
  function makeStepDoc(): AnnotDocument {
    return {
      version: 1,
      lang: "en",
      title: "Step doc",
      meta: { title: "Step doc" },
      styleBlock: null,
      blocks: [
        {
          kind: "step",
          id: "img-step-test",
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"></svg>',
          title: "First step",
          body: "Click the button.",
          layout: "image-top",
        },
      ],
    };
  }

  it("renders a step block as <section> with svg slot + title + body in read-only mode", async () => {
    const el = mount(makeStepDoc());
    el.editing = false;
    await el.updateComplete;
    const section = el.querySelector('section[data-annot-block="step"]');
    expect(section).not.toBeNull();
    expect(section?.getAttribute("data-step-layout")).toBe("image-top");
    expect(section?.getAttribute("data-annot-image-id")).toBe("img-step-test");
    expect(section?.querySelector(".annot-doc-image-svg-slot")).not.toBeNull();
    const title = section?.querySelector("h3[data-step-title]") as HTMLElement | null;
    const body = section?.querySelector("p[data-step-body]") as HTMLElement | null;
    expect(title?.textContent).toBe("First step");
    expect(body?.textContent).toBe("Click the button.");
    // Read-only mode: no contenteditable attributes.
    expect(title?.getAttribute("contenteditable")).toBeNull();
    expect(body?.getAttribute("contenteditable")).toBeNull();
  });

  it("renders title + body as contentEditable when editing", async () => {
    const el = mount(makeStepDoc());
    el.editing = true;
    await el.updateComplete;
    const title = el.querySelector(
      'section[data-annot-block="step"] [data-step-title]',
    ) as HTMLElement | null;
    const body = el.querySelector(
      'section[data-annot-block="step"] [data-step-body]',
    ) as HTMLElement | null;
    expect(title?.getAttribute("contenteditable")).toBe("true");
    expect(body?.getAttribute("contenteditable")).toBe("true");
    // Initial bodies come from the imperative populate pass.
    expect(title?.innerHTML).toBe("First step");
    expect(body?.innerHTML).toBe("Click the button.");
  });

  it("syncs DOM edits back to the document model on debounced input", async () => {
    vi.useFakeTimers();
    const el = mount(makeStepDoc());
    el.editing = true;
    await el.updateComplete;
    const title = el.querySelector(
      'section[data-annot-block="step"] [data-step-title]',
    ) as HTMLElement;
    const body = el.querySelector(
      'section[data-annot-block="step"] [data-step-body]',
    ) as HTMLElement;
    title.innerHTML = "Updated title";
    body.innerHTML = "Updated body.";
    // Input bubbles through the article-level listener which
    // debounces the sync (COMMIT_DEBOUNCE_MS). Advance past the
    // window so the commit fires.
    title.dispatchEvent(new InputEvent("input", { bubbles: true }));
    vi.advanceTimersByTime(700);
    await el.updateComplete;
    const step = el.document!.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.title).toBe("Updated title");
    expect(step.body).toBe("Updated body.");
    vi.useRealTimers();
  });

  it("preserves cursor by leaving the active editable alone on populate", async () => {
    const el = mount(makeStepDoc());
    el.editing = true;
    await el.updateComplete;
    const title = el.querySelector(
      'section[data-annot-block="step"] [data-step-title]',
    ) as HTMLElement;
    // Simulate the user holding focus on the title while a
    // re-render is triggered (e.g. unrelated block-action).
    title.focus();
    title.innerHTML = "User-typed";
    // Re-apply the same document — the populate pass would
    // overwrite if we weren't focus-aware.
    el.document = { ...el.document! };
    await el.updateComplete;
    expect(title.innerHTML).toBe("User-typed");
  });

  it("opens the image editor modal when the svg slot is clicked", async () => {
    const el = mount(makeStepDoc());
    el.editing = true;
    await el.updateComplete;
    el.materialiseAllImagesNow();
    const openSpy = vi
      .spyOn(
        // biome-ignore lint/suspicious/noExplicitAny: spying on module-level static
        (await import("./annot-doc-image-editor-modal.js")).AnnotDocImageEditorModalElement as any,
        "openFor",
      )
      .mockResolvedValue({ kind: "cancel" });
    const slot = el.querySelector(".annot-doc-image-svg-slot") as HTMLElement;
    slot.click();
    expect(openSpy).toHaveBeenCalledTimes(1);
    const arg = openSpy.mock.calls[0]?.[0] as { id: string; svg: string };
    expect(arg.id).toBe("img-step-test");
    openSpy.mockRestore();
  });

  it("does NOT open the image modal when clicking on the contentEditable slots", async () => {
    const el = mount(makeStepDoc());
    el.editing = true;
    await el.updateComplete;
    const openSpy = vi
      .spyOn(
        // biome-ignore lint/suspicious/noExplicitAny: spying on module-level static
        (await import("./annot-doc-image-editor-modal.js")).AnnotDocImageEditorModalElement as any,
        "openFor",
      )
      .mockResolvedValue({ kind: "cancel" });
    const title = el.querySelector(
      'section[data-annot-block="step"] [data-step-title]',
    ) as HTMLElement;
    title.click();
    expect(openSpy).not.toHaveBeenCalled();
    const body = el.querySelector(
      'section[data-annot-block="step"] [data-step-body]',
    ) as HTMLElement;
    body.click();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("updates step.svg when the image editor modal saves", async () => {
    const el = mount(makeStepDoc());
    el.editing = true;
    await el.updateComplete;
    el.materialiseAllImagesNow();
    const newSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"></svg>';
    const openSpy = vi
      .spyOn(
        // biome-ignore lint/suspicious/noExplicitAny: spying on module-level static
        (await import("./annot-doc-image-editor-modal.js")).AnnotDocImageEditorModalElement as any,
        "openFor",
      )
      .mockResolvedValue({ kind: "save", svg: newSvg });
    const slot = el.querySelector(".annot-doc-image-svg-slot") as HTMLElement;
    slot.click();
    // Modal save is awaited; flush the microtask queue.
    await Promise.resolve();
    await Promise.resolve();
    await el.updateComplete;
    const step = el.document!.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.svg).toBe(newSvg);
    openSpy.mockRestore();
  });
});

describe("annot-doc-shell: step block menu entry", () => {
  it("exposes a 'step' kind in the default block menu catalog", async () => {
    const { DEFAULT_BLOCK_MENU_ITEMS } = await import("./annot-doc-block-menu.js");
    const stepItem = DEFAULT_BLOCK_MENU_ITEMS.find((i) => i.kind === "step");
    expect(stepItem).toBeDefined();
    expect(stepItem?.label).toBe("Step");
  });
});

// ---------------------------------------------------------------------------
// Phase 3b of docs/plans/_done/card-procedure-template.md — in-block
// layout switcher.
// ---------------------------------------------------------------------------

describe("annot-doc-shell: step layout switcher", () => {
  function makeStepDoc(): AnnotDocument {
    return {
      version: 1,
      lang: "en",
      title: "Step doc",
      meta: { title: "Step doc" },
      styleBlock: null,
      blocks: [
        {
          kind: "step",
          id: "img-step-test",
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"></svg>',
          title: "First step",
          body: "Click the button.",
          layout: "image-top",
        },
      ],
    };
  }

  it("renders a layout switcher in editing mode only", async () => {
    const el = mount(makeStepDoc());
    el.editing = false;
    await el.updateComplete;
    expect(el.querySelector("[data-step-layout-switcher]")).toBeNull();
    el.editing = true;
    await el.updateComplete;
    const switcher = el.querySelector("[data-step-layout-switcher]") as HTMLSelectElement | null;
    expect(switcher).not.toBeNull();
    expect(switcher?.value).toBe("image-top");
    // All five enum values are present as options.
    const values = Array.from(switcher?.options ?? []).map((o) => o.value);
    expect(values).toEqual([
      "image-top",
      "image-bottom",
      "image-left",
      "image-right",
      "image-fill",
    ]);
  });

  it("updates step.layout when the switcher fires change", async () => {
    const el = mount(makeStepDoc());
    el.editing = true;
    await el.updateComplete;
    const switcher = el.querySelector("[data-step-layout-switcher]") as HTMLSelectElement;
    switcher.value = "image-left";
    switcher.dispatchEvent(new Event("change", { bubbles: true }));
    await el.updateComplete;
    const step = el.document!.blocks[0];
    if (step?.kind !== "step") throw new Error("expected step block");
    expect(step.layout).toBe("image-left");
  });

  it("pushes a history entry when the switcher changes", async () => {
    const el = mount(makeStepDoc());
    el.editing = true;
    await el.updateComplete;
    const switcher = el.querySelector("[data-step-layout-switcher]") as HTMLSelectElement;
    expect(el.canUndo()).toBe(false);
    switcher.value = "image-fill";
    switcher.dispatchEvent(new Event("change", { bubbles: true }));
    await el.updateComplete;
    expect(el.canUndo()).toBe(true);
  });

  it("clicks on the switcher do NOT open the image modal", async () => {
    const el = mount(makeStepDoc());
    el.editing = true;
    await el.updateComplete;
    const openSpy = vi
      .spyOn(
        // biome-ignore lint/suspicious/noExplicitAny: spying on module-level static
        (await import("./annot-doc-image-editor-modal.js")).AnnotDocImageEditorModalElement as any,
        "openFor",
      )
      .mockResolvedValue({ kind: "cancel" });
    const switcher = el.querySelector("[data-step-layout-switcher]") as HTMLSelectElement;
    // Bubbling click event through the switcher should not reach
    // the block-host's modal-opening handler.
    switcher.click();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Phase 7a of `docs/plans/_done/card-procedure-template.md` —
// image-less step blocks (text-only narrative card).
// ---------------------------------------------------------------------------

// Phase 7d-polish 3: `exportSVGString` prepends a
// `<?xml ?>\n` declaration to its output for standalone-SVG
// callers (file download / clipboard). When that same SVG ends
// up embedded in the doc via the step image slot, the leading
// whitespace becomes a text node above the SVG and the slot's
// line-height pushes the SVG ~20px down — visible as a grey
// strip at the top of cards whose annotations were edited via
// the modal. `materialiseImageSlot` strips the prefix so the
// slot's first (and only) child is the `<svg>` element.
describe("annot-doc-shell: SVG materialisation strips XML decl prefix", () => {
  it("drops a leading <?xml ?> declaration so the slot's only child is the SVG", async () => {
    const annotatedSvg =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 800 450" width="800" height="450">' +
      '<rect data-type="rect" x="10" y="10" width="100" height="50" fill="#ff0000"/>' +
      "</svg>";
    const doc: AnnotDocument = {
      version: 1,
      lang: "en",
      title: "T",
      meta: { title: "T" },
      styleBlock: null,
      blocks: [
        {
          kind: "step",
          id: "img-annotated",
          svg: annotatedSvg,
          title: "T",
          body: "B",
          layout: "image-top",
        },
      ],
    };
    const el = mount(doc);
    el.editing = false;
    await el.updateComplete;
    el.materialiseAllImagesNow();
    const slot = el.querySelector(".annot-doc-image-svg-slot") as HTMLElement;
    // Only ONE child node — the SVG. No text node from the
    // stripped `<?xml ?>\n` prefix.
    expect(slot.childNodes.length).toBe(1);
    expect(slot.firstChild?.nodeName.toLowerCase()).toBe("svg");
  });

  it("leaves an XML-decl-free SVG unchanged", async () => {
    const cleanSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 800 450" width="800" height="450"><rect x="10" y="10" width="100" height="50"/></svg>';
    const doc: AnnotDocument = {
      version: 1,
      lang: "en",
      title: "T",
      meta: { title: "T" },
      styleBlock: null,
      blocks: [
        {
          kind: "step",
          id: "img-clean",
          svg: cleanSvg,
          title: "T",
          body: "B",
          layout: "image-top",
        },
      ],
    };
    const el = mount(doc);
    el.editing = false;
    await el.updateComplete;
    el.materialiseAllImagesNow();
    const slot = el.querySelector(".annot-doc-image-svg-slot") as HTMLElement;
    expect(slot.childNodes.length).toBe(1);
    expect(slot.firstChild?.nodeName.toLowerCase()).toBe("svg");
  });

  it("peels inter-element whitespace / comments off so SVG is the only child", async () => {
    // Live-browser HTML parsing of an XMLSerializer-produced SVG
    // can leave whitespace or comment text nodes BEFORE the
    // `<svg>` element when the markup contains pretty-printed
    // newlines or comments outside the SVG root. The clean-up
    // pass in `materialiseImageSlot` guarantees the slot's only
    // child is the `<svg>` regardless. The user-visible symptom
    // it guards against is the grey strip above annotated step
    // card images.
    const noisySvg =
      "  \n<!-- prettyprint -->\n  " +
      '<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 800 450" width="800" height="450">' +
      "<defs><style>text { font-family: sans-serif; }</style></defs>" +
      '<image href="data:," width="800" height="450"/>' +
      '<rect x="10" y="10" width="100" height="50"/>' +
      "</svg>\n  ";
    const doc: AnnotDocument = {
      version: 1,
      lang: "en",
      title: "T",
      meta: { title: "T" },
      styleBlock: null,
      blocks: [
        {
          kind: "step",
          id: "img-noisy",
          svg: noisySvg,
          title: "T",
          body: "B",
          layout: "image-top",
        },
      ],
    };
    const el = mount(doc);
    el.editing = false;
    await el.updateComplete;
    el.materialiseAllImagesNow();
    const slot = el.querySelector(".annot-doc-image-svg-slot") as HTMLElement;
    expect(slot.childNodes.length).toBe(1);
    expect(slot.firstChild?.nodeName.toLowerCase()).toBe("svg");
  });
});

describe("annot-doc-shell: image-less step blocks", () => {
  function makeImagelessStepDoc(): AnnotDocument {
    return {
      version: 1,
      lang: "en",
      title: "Image-less step doc",
      meta: { title: "Image-less step doc" },
      styleBlock: null,
      blocks: [
        {
          kind: "step",
          id: "img-imageless",
          svg: "",
          title: "Recap",
          body: "Wrap up.",
          layout: "image-top",
        },
      ],
    };
  }

  it("renders an image-less step without the image slot div", async () => {
    const el = mount(makeImagelessStepDoc());
    el.editing = true;
    await el.updateComplete;
    const section = el.querySelector('[data-annot-block="step"]') as HTMLElement | null;
    expect(section).not.toBeNull();
    expect(section?.getAttribute("data-step-image-less")).toBe("1");
    // No image slot — the renderStep imageless branch returns
    // null for that slot.
    expect(section?.querySelector(".annot-doc-image-svg-slot")).toBeNull();
    // The contentEditable title + body slots are still present.
    expect(section?.querySelector("[data-step-title][contenteditable='true']")).not.toBeNull();
    expect(section?.querySelector("[data-step-body][contenteditable='true']")).not.toBeNull();
  });

  it("renders an image-less step in read-only mode without the layout switcher", async () => {
    const el = mount(makeImagelessStepDoc());
    el.editing = false;
    await el.updateComplete;
    const section = el.querySelector('[data-annot-block="step"]') as HTMLElement | null;
    expect(section?.getAttribute("data-step-image-less")).toBe("1");
    expect(section?.querySelector(".annot-doc-image-svg-slot")).toBeNull();
    expect(section?.querySelector("[data-step-layout-switcher]")).toBeNull();
  });

  it("clicks on an image-less step do NOT open the image modal", async () => {
    const el = mount(makeImagelessStepDoc());
    el.editing = true;
    await el.updateComplete;
    const openSpy = vi
      .spyOn(
        // biome-ignore lint/suspicious/noExplicitAny: spying on module-level static
        (await import("./annot-doc-image-editor-modal.js")).AnnotDocImageEditorModalElement as any,
        "openFor",
      )
      .mockResolvedValue({ kind: "cancel" });
    const section = el.querySelector('[data-annot-block="step"]') as HTMLElement;
    // Click on the section background (outside title / body /
    // switcher). For an image-less step there's no image slot to
    // click; the click guard in #onBlockHostClick short-circuits.
    section.click();
    await Promise.resolve();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
