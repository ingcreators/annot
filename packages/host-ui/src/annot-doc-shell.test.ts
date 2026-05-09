/**
 * @vitest-environment happy-dom
 *
 * `<annot-doc-shell>` tests — Phase 3 of
 * `docs/plans/annot-html-document.md`. Covers initial mount,
 * re-mount with a different document, the TOC scroll-into-view
 * behaviour, theme variants (light / dark / auto), and the
 * empty / no-document state.
 */

import type { AnnotDocument } from "@ingcreators/annot-doc";
import { createEmptyDocument, injectDocumentStyles } from "@ingcreators/annot-doc";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "./annot-doc-shell.js";
import type { AnnotDocShellElement, DocHeadingActivatedDetail } from "./annot-doc-shell.js";

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
