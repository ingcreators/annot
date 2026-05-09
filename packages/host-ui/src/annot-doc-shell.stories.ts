/**
 * Stories for `<annot-doc-shell>` — read-only document renderer.
 * Phase 3 of `docs/plans/annot-html-document.md`.
 *
 * The stories below exercise:
 *
 *   - **Default** — a mixed document covering every v1 block kind.
 *   - **Empty** — single-paragraph minimum-viable document.
 *   - **Long** — many headings to demonstrate the TOC scrolling.
 *   - **Dark theme** — `meta.theme: "dark"` swaps the color
 *     palette without depending on `prefers-color-scheme`.
 *   - **Light theme** — same shape, light vars only.
 *   - **No TOC** — `show-toc` attribute toggled off.
 */

import type { AnnotDocument, Block } from "@ingcreators/annot-doc";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-doc-shell.js";
import type { AnnotDocShellElement, DocHeadingActivatedDetail } from "./annot-doc-shell.js";

interface Args {
  document: AnnotDocument;
  showToc: boolean;
  editing: boolean;
}

function makeMixedDoc(theme: AnnotDocument["meta"]["theme"] = "auto"): AnnotDocument {
  const blocks: Block[] = [
    { kind: "heading", level: 1, inlineHtml: "Format showcase" },
    {
      kind: "paragraph",
      inlineHtml:
        "This document exercises every v1 block kind. It is the most complete golden fixture, covering canonical attribute order, whitespace, and inline rich-text rules.",
    },
    { kind: "heading", level: 2, inlineHtml: "Lists" },
    { kind: "paragraph", inlineHtml: "An unordered list:" },
    {
      kind: "list",
      ordered: false,
      listStyle: "disc",
      items: ["First bullet", "Second bullet with <strong>bold</strong> and <em>italic</em>"],
    },
    { kind: "paragraph", inlineHtml: "An ordered list:" },
    {
      kind: "list",
      ordered: true,
      listStyle: "decimal",
      items: ["Step one", "Step two"],
    },
    { kind: "heading", level: 2, inlineHtml: "Code" },
    { kind: "code", lang: "bash", text: "echo hello\necho world" },
    { kind: "heading", level: 2, inlineHtml: "Quote and callouts" },
    {
      kind: "quote",
      paragraphs: ["A quoted paragraph.", "A second paragraph in the same quotation."],
    },
    {
      kind: "callout",
      tone: "info",
      paragraphs: ["Informational callout. Inline <code>code</code> renders as a monospace run."],
    },
    {
      kind: "callout",
      tone: "warn",
      paragraphs: ["Warning callout for prerequisites or destructive actions."],
    },
    {
      kind: "callout",
      tone: "note",
      paragraphs: ["A neutral note. Use sparingly."],
    },
    { kind: "divider" },
    { kind: "heading", level: 2, inlineHtml: "Image" },
    {
      kind: "image",
      id: "img-placeholder",
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" width="800" height="300">
  <rect x="10" y="10" width="780" height="280" fill="#f3f4f6" stroke="#9ca3af" stroke-dasharray="6 6"/>
  <text x="400" y="160" text-anchor="middle" fill="#6b7280" font-family="sans-serif" font-size="24">Drop screenshot here</text>
</svg>`,
      caption: "Figure 1: Placeholder.",
    },
  ];
  return {
    version: 1,
    lang: "en",
    title: "Format showcase",
    meta: { title: "Format showcase", theme },
    styleBlock: null,
    blocks,
  };
}

function makeEmptyDoc(): AnnotDocument {
  return {
    version: 1,
    lang: "en",
    title: "Untitled",
    meta: { title: "Untitled" },
    styleBlock: null,
    blocks: [{ kind: "paragraph", inlineHtml: "[Add your content here.]" }],
  };
}

function makeLongDoc(): AnnotDocument {
  const blocks: Block[] = [];
  blocks.push({ kind: "heading", level: 1, inlineHtml: "Long manual" });
  blocks.push({
    kind: "paragraph",
    inlineHtml: "Demonstrates TOC scrolling across many sections.",
  });
  for (let s = 1; s <= 8; s++) {
    blocks.push({ kind: "heading", level: 2, inlineHtml: `Section ${s}` });
    blocks.push({
      kind: "paragraph",
      inlineHtml: `This is the body of section ${s}. ${"Lorem ipsum dolor sit amet. ".repeat(10)}`,
    });
    if (s % 2 === 0) {
      blocks.push({ kind: "heading", level: 3, inlineHtml: `Subsection ${s}.1` });
      blocks.push({
        kind: "paragraph",
        inlineHtml: `Subsection prose for ${s}.1.`,
      });
    }
  }
  return {
    version: 1,
    lang: "en",
    title: "Long manual",
    meta: { title: "Long manual" },
    styleBlock: null,
    blocks,
  };
}

const meta: Meta<Args> = {
  title: "Doc / DocShell",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.height = "640px";
    wrapper.style.overflow = "auto";
    wrapper.style.background = "var(--annot-doc-bg, #ffffff)";
    const shell = document.createElement("annot-doc-shell") as AnnotDocShellElement;
    shell.document = args.document;
    shell.showToc = args.showToc;
    shell.editing = args.editing;
    shell.addEventListener("doc-heading-activated", (e) => {
      console.log(
        "[story] doc-heading-activated:",
        (e as CustomEvent<DocHeadingActivatedDetail>).detail,
      );
    });
    shell.addEventListener("doc-changed", (e) => {
      console.log("[story] doc-changed:", (e as CustomEvent).detail);
    });
    wrapper.appendChild(shell);
    return wrapper;
  },
  argTypes: {
    document: { control: false },
    showToc: { control: "boolean" },
    editing: { control: "boolean" },
  },
  args: {
    document: makeMixedDoc(),
    showToc: true,
    editing: false,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {
  args: { document: makeMixedDoc(), showToc: true, editing: false },
};

export const Empty: Story = {
  args: { document: makeEmptyDoc(), showToc: true, editing: false },
};

export const Long: Story = {
  args: { document: makeLongDoc(), showToc: true, editing: false },
};

export const DarkTheme: Story = {
  name: "Dark theme",
  args: { document: makeMixedDoc("dark"), showToc: true, editing: false },
};

export const LightTheme: Story = {
  name: "Light theme",
  args: { document: makeMixedDoc("light"), showToc: true, editing: false },
};

export const NoToc: Story = {
  name: "No TOC",
  args: { document: makeMixedDoc(), showToc: false, editing: false },
};

export const Editing: Story = {
  name: "Editing mode",
  args: { document: makeMixedDoc(), showToc: true, editing: true },
};
