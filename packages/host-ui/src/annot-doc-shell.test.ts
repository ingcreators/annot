/**
 * @vitest-environment happy-dom
 *
 * `<annot-doc-shell>` tests — Phases 3 + 4a of
 * `docs/plans/annot-html-document.md`. Covers initial mount,
 * re-mount with a different document, the TOC scroll-into-view
 * behaviour, theme variants (light / dark / auto), the
 * empty / no-document state, and Phase 4a's editing-mode
 * surface (contentEditable on heading / paragraph, block
 * toolbar actions, undo / redo via DocumentHistory).
 */

import type { AnnotDocument } from "@ingcreators/annot-doc";
import { createEmptyDocument, injectDocumentStyles } from "@ingcreators/annot-doc";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    expect(article.querySelector('figure[data-annot-image-id="img-test"] > svg')).not.toBeNull();
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
    const svg = el.querySelector('figure[data-annot-image-id="img-test"] > svg');
    expect(svg?.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 100 100");
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
    // Heading + paragraph blocks are contentEditable in Phase 4a.
    const editable = el.querySelectorAll('[contenteditable="true"]');
    // 3 headings + 2 paragraphs in the mixed doc.
    expect(editable.length).toBe(5);
    // Toolbars rendered for each wrapper.
    expect(el.querySelectorAll("annot-doc-block-toolbar").length).toBe(wrappers.length);
  });

  it("does not mark non-text blocks as contentEditable in Phase 4a", async () => {
    const el = mount(makeMixedDoc());
    el.editing = true;
    await el.updateComplete;
    // Quote / callout / code / list / image / divider must NOT be
    // contentEditable in Phase 4a (Phase 4b adds those).
    const ce = (sel: string) =>
      (el.querySelector(sel) as HTMLElement | null)?.getAttribute("contenteditable");
    expect(ce('blockquote[data-annot-block="quote"]')).toBeNull();
    expect(ce('aside[data-annot-block="callout"]')).toBeNull();
    expect(ce('pre[data-annot-block="code"]')).toBeNull();
    expect(ce('ul[data-annot-block="list"]')).toBeNull();
    expect(ce('hr[data-annot-block="divider"]')).toBeNull();
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
    const para = el.querySelector(
      '.annot-doc-block-host:nth-child(2) p[data-annot-block="paragraph"]',
    ) as HTMLElement;
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
