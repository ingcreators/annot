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

// ---------------------------------------------------------------------------
// Phase 2 of docs/plans/card-procedure-template.md — step block
// card chrome + 5 per-layout grid templates. The stories below
// each render a single-step doc with a different `data-step-layout`
// value so the Storybook canvas surfaces the visual difference.
// ---------------------------------------------------------------------------

import type { StepLayout } from "@ingcreators/annot-doc";

const STEP_PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">
  <rect x="0" y="0" width="800" height="450" fill="#cbd5e1"/>
  <rect x="80" y="60" width="640" height="330" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2"/>
  <text x="400" y="225" text-anchor="middle" fill="#475569" font-family="sans-serif" font-size="32" font-weight="600">Screenshot 1</text>
  <text x="400" y="265" text-anchor="middle" fill="#64748b" font-family="sans-serif" font-size="18">Annotation overlay would sit here</text>
</svg>`;

function makeStepLayoutDoc(
  layout: StepLayout,
  theme: AnnotDocument["meta"]["theme"] = "auto",
): AnnotDocument {
  return {
    version: 1,
    lang: "en",
    title: `Step layout: ${layout}`,
    meta: { title: `Step layout: ${layout}`, theme },
    styleBlock: null,
    blocks: [
      { kind: "heading", level: 1, inlineHtml: `Step layout: <code>${layout}</code>` },
      {
        kind: "paragraph",
        inlineHtml:
          "The card below renders with the labelled layout variant. The same DOM (svg → h3 → p) renders differently per <code>data-step-layout</code>.",
      },
      {
        kind: "step",
        id: "img-step-demo",
        svg: STEP_PLACEHOLDER_SVG,
        title: "Open the settings dialog",
        body: "Click the gear icon in the top-right corner. The settings dialog opens centred on the screen and dims the surrounding canvas.",
        layout,
      },
    ],
  };
}

/** Renders three step blocks with mixed layouts and a multi-column
 *  card grid. Exercises `meta.cardLayout` against a populated doc. */
function makeCardGridDoc(
  columns: 1 | 2 | 3 | "auto",
  theme: AnnotDocument["meta"]["theme"] = "auto",
): AnnotDocument {
  return {
    version: 1,
    lang: "en",
    title: `Card grid: ${columns}-column`,
    meta: {
      title: `Card grid: ${columns}-column`,
      theme,
      cardLayout: { columns, defaultStepLayout: "image-top" },
    },
    styleBlock: null,
    blocks: [
      { kind: "heading", level: 1, inlineHtml: "Card-style procedure" },
      {
        kind: "paragraph",
        inlineHtml: "The intro paragraph sits full-width above the card grid.",
      },
      {
        kind: "step",
        id: "img-step-grid-01",
        svg: STEP_PLACEHOLDER_SVG,
        title: "Step 1: Open settings",
        body: "Click the gear icon.",
        layout: "image-top",
      },
      {
        kind: "step",
        id: "img-step-grid-02",
        svg: STEP_PLACEHOLDER_SVG,
        title: "Step 2: Configure",
        body: "Pick the option you want.",
        layout: "image-top",
      },
      {
        kind: "step",
        id: "img-step-grid-03",
        svg: STEP_PLACEHOLDER_SVG,
        title: "Step 3: Apply",
        body: "Click Apply to confirm.",
        layout: "image-top",
      },
    ],
  };
}

export const StepImageTop: Story = {
  name: "Step / image-top",
  args: { document: makeStepLayoutDoc("image-top"), showToc: false, editing: false },
};

export const StepImageBottom: Story = {
  name: "Step / image-bottom",
  args: { document: makeStepLayoutDoc("image-bottom"), showToc: false, editing: false },
};

export const StepImageLeft: Story = {
  name: "Step / image-left",
  args: { document: makeStepLayoutDoc("image-left"), showToc: false, editing: false },
};

export const StepImageRight: Story = {
  name: "Step / image-right",
  args: { document: makeStepLayoutDoc("image-right"), showToc: false, editing: false },
};

export const StepImageFill: Story = {
  name: "Step / image-fill",
  args: { document: makeStepLayoutDoc("image-fill"), showToc: false, editing: false },
};

export const StepImageTopDark: Story = {
  name: "Step / image-top (dark)",
  args: { document: makeStepLayoutDoc("image-top", "dark"), showToc: false, editing: false },
};

export const StepImageFillDark: Story = {
  name: "Step / image-fill (dark)",
  args: { document: makeStepLayoutDoc("image-fill", "dark"), showToc: false, editing: false },
};

export const CardGridTwoColumn: Story = {
  name: "Card grid / 2-column",
  args: { document: makeCardGridDoc(2), showToc: false, editing: false },
};

export const CardGridThreeColumn: Story = {
  name: "Card grid / 3-column",
  args: { document: makeCardGridDoc(3), showToc: false, editing: false },
};

export const CardGridAuto: Story = {
  name: "Card grid / auto-fill",
  args: { document: makeCardGridDoc("auto"), showToc: false, editing: false },
};

// ---------------------------------------------------------------------------
// Phase 3 of docs/plans/card-procedure-template.md — editing mode
// for step blocks (contentEditable title + body, click-to-edit
// modal on the SVG slot). The slash-menu / insert-bar Step entry
// is exercised through interactive use; the static stories below
// just verify the rendered editing affordances.
// ---------------------------------------------------------------------------

export const StepImageTopEditing: Story = {
  name: "Step / image-top (editing)",
  args: { document: makeStepLayoutDoc("image-top"), showToc: false, editing: true },
};

export const StepImageLeftEditing: Story = {
  name: "Step / image-left (editing)",
  args: { document: makeStepLayoutDoc("image-left"), showToc: false, editing: true },
};

export const StepImageFillEditing: Story = {
  name: "Step / image-fill (editing)",
  args: { document: makeStepLayoutDoc("image-fill"), showToc: false, editing: true },
};

export const CardGridTwoColumnEditing: Story = {
  name: "Card grid / 2-column (editing)",
  args: { document: makeCardGridDoc(2), showToc: false, editing: true },
};

// ---------------------------------------------------------------------------
// Phase 7b of docs/plans/card-procedure-template.md — URL chip
// embedded in step blocks (Scribe-style "Navigate to ..."
// affordance). The chip appears below the step title in both
// read and editing modes; editing mode also shows the URL
// input row underneath.
// ---------------------------------------------------------------------------

function makeStepWithLinkDoc(
  layout: StepLayout,
  theme: AnnotDocument["meta"]["theme"] = "auto",
): AnnotDocument {
  return {
    version: 1,
    lang: "en",
    title: `Step with link: ${layout}`,
    meta: { title: `Step with link: ${layout}`, theme },
    styleBlock: null,
    blocks: [
      { kind: "heading", level: 1, inlineHtml: "Card with navigation chip" },
      {
        kind: "step",
        id: "img-step-link-01",
        svg: STEP_PLACEHOLDER_SVG,
        title: "Open the documentation",
        body: "Read the API reference for the full list of options.",
        layout,
        link: { url: "https://example.com/docs", label: "Docs" },
      },
      {
        kind: "step",
        id: "img-step-link-02",
        svg: "",
        title: "Visit the dashboard",
        body: "Open the dashboard to see your data.",
        layout: "image-top",
        link: { url: "https://example.com/dashboard" },
      },
    ],
  };
}

export const StepWithLink: Story = {
  name: "Step / with URL chip",
  args: { document: makeStepWithLinkDoc("image-top"), showToc: false, editing: false },
};

export const StepWithLinkEditing: Story = {
  name: "Step / with URL chip (editing)",
  args: { document: makeStepWithLinkDoc("image-top"), showToc: false, editing: true },
};

export const StepWithLinkImageFill: Story = {
  name: "Step / with URL chip (image-fill)",
  args: { document: makeStepWithLinkDoc("image-fill"), showToc: false, editing: false },
};

export const StepWithLinkDark: Story = {
  name: "Step / with URL chip (dark)",
  args: { document: makeStepWithLinkDoc("image-top", "dark"), showToc: false, editing: false },
};

// ---------------------------------------------------------------------------
// Phase 7c of docs/plans/card-procedure-template.md — Scribe-
// style document header (icon + title + description + author +
// step count). Setting `meta.header` opts the doc into the
// header chrome above the article body + a matching PPTX cover
// slide.
// ---------------------------------------------------------------------------

// 1×1 transparent PNG used as a placeholder header icon. Keeps
// the doc self-contained in the story without dragging in a
// real bitmap. Real-world docs would carry a brand logo at
// 256×256 or larger.
const HEADER_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function makeHeadedDoc(
  options: {
    withIcon?: boolean;
    withAuthor?: boolean;
    theme?: AnnotDocument["meta"]["theme"];
  } = {},
): AnnotDocument {
  return {
    version: 1,
    lang: "en",
    title: "Quick start guide",
    meta: {
      title: "Quick start guide",
      theme: options.theme ?? "auto",
      ...(options.withAuthor ? { author: "Naoki Ichimura" } : {}),
      header: {
        ...(options.withIcon ? { icon: HEADER_ICON_DATA_URL } : {}),
        description: "Get up and running in five steps. This walkthrough takes about 3 minutes.",
      },
    },
    styleBlock: null,
    blocks: [
      {
        kind: "step",
        id: "img-step-head-01",
        svg: STEP_PLACEHOLDER_SVG,
        title: "Open the dashboard",
        body: "Navigate to the dashboard URL.",
        layout: "image-top",
      },
      {
        kind: "step",
        id: "img-step-head-02",
        svg: STEP_PLACEHOLDER_SVG,
        title: "Pick a plan",
        body: "Select the plan that fits your team.",
        layout: "image-top",
      },
      {
        kind: "step",
        id: "img-step-head-03",
        svg: STEP_PLACEHOLDER_SVG,
        title: "Invite teammates",
        body: "Send an invite link to your collaborators.",
        layout: "image-top",
      },
    ],
  };
}

export const DocHeaderWithIcon: Story = {
  name: "Doc header / with icon",
  args: {
    document: makeHeadedDoc({ withIcon: true, withAuthor: true }),
    showToc: false,
    editing: false,
  },
};

export const DocHeaderNoIcon: Story = {
  name: "Doc header / no icon",
  args: {
    document: makeHeadedDoc({ withIcon: false, withAuthor: true }),
    showToc: false,
    editing: false,
  },
};

export const DocHeaderNoAuthor: Story = {
  name: "Doc header / no author",
  args: {
    document: makeHeadedDoc({ withIcon: true, withAuthor: false }),
    showToc: false,
    editing: false,
  },
};

export const DocHeaderDark: Story = {
  name: "Doc header / dark theme",
  args: {
    document: makeHeadedDoc({ withIcon: true, withAuthor: true, theme: "dark" }),
    showToc: false,
    editing: false,
  },
};

// ---------------------------------------------------------------------------
// Phase 7d of docs/plans/card-procedure-template.md — image
// viewport (pan / zoom + initial-view crop). The placeholder SVG
// has a viewBox of 0..400, 0..240; the viewport rect crops to a
// sub-rect so the rendered card shows the zoomed-in view.
// Wheel / drag interactivity is wired live — try it in the
// rendered story.
// ---------------------------------------------------------------------------

function makeViewportDoc(
  options: { viewport?: { x: number; y: number; w: number; h: number }; editing?: boolean } = {},
): AnnotDocument {
  return {
    version: 1,
    lang: "en",
    title: "Image viewport demo",
    meta: { title: "Image viewport demo" },
    styleBlock: null,
    blocks: [
      {
        kind: "step",
        id: "img-step-vp-01",
        svg: STEP_PLACEHOLDER_SVG,
        title: "Zoom into a button",
        body: "The card shows only the saved viewport. Wheel to zoom, drag to pan; click Save view to capture.",
        layout: "image-top",
        ...(options.viewport ? { viewport: options.viewport } : {}),
      },
    ],
  };
}

export const ViewportCropped: Story = {
  name: "Viewport / cropped initial view",
  args: {
    document: makeViewportDoc({ viewport: { x: 80, y: 50, w: 160, h: 100 } }),
    showToc: false,
    editing: false,
  },
};

export const ViewportCroppedEditing: Story = {
  name: "Viewport / cropped (editing)",
  args: {
    document: makeViewportDoc({ viewport: { x: 80, y: 50, w: 160, h: 100 } }),
    showToc: false,
    editing: true,
  },
};

export const ViewportFullEditing: Story = {
  name: "Viewport / full image (editing — Save view to create)",
  args: {
    document: makeViewportDoc({}),
    showToc: false,
    editing: true,
  },
};

// ---------------------------------------------------------------------------
// Phase 5 of docs/plans/card-procedure-template.md — bundled
// `card-procedure` starter rendered in light + dark themes. The
// starter ships in @ingcreators/annot-doc/BUILTIN_TEMPLATES.
// ---------------------------------------------------------------------------

import { cloneBuiltinTemplate } from "@ingcreators/annot-doc";

function makeCardProcedureStarter(theme: AnnotDocument["meta"]["theme"] = "auto"): AnnotDocument {
  // Clone (markers stripped, fresh IDs minted) — same path the
  // PWA's template-picker flow uses, so the stories preview the
  // exact bytes the user sees after "New from template".
  const cloned = cloneBuiltinTemplate("card-procedure");
  if (!cloned) throw new Error("card-procedure starter missing");
  return { ...cloned, meta: { ...cloned.meta, theme } };
}

export const CardProcedureStarter: Story = {
  name: "Bundled starter / card-procedure",
  args: { document: makeCardProcedureStarter(), showToc: false, editing: false },
};

export const CardProcedureStarterDark: Story = {
  name: "Bundled starter / card-procedure (dark)",
  args: { document: makeCardProcedureStarter("dark"), showToc: false, editing: false },
};

export const CardProcedureStarterEditing: Story = {
  name: "Bundled starter / card-procedure (editing)",
  args: { document: makeCardProcedureStarter(), showToc: false, editing: true },
};
