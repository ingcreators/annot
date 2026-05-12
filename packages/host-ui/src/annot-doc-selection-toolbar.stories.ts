/**
 * Stories for `<annot-doc-selection-toolbar>` — the inline
 * format toolbar Phase 3 of
 * `docs/plans/annot-html-document-ux-polish.md` adds. The
 * toolbar normally floats above the text selection via
 * `openFor` from the doc-shell; the stories here mount it
 * statically so reviewers can see each visible state without
 * having to manually drag a selection in a paragraph block.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-doc-selection-toolbar.js";
import type {
  AnnotDocSelectionToolbarElement,
  SelectionFormatState,
} from "./annot-doc-selection-toolbar.js";

interface Args {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  link: boolean;
  currentBlockKindId: string;
}

const meta: Meta<Args> = {
  title: "Editor / DocSelectionToolbar",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.justifyContent = "center";
    wrapper.style.padding = "2rem";
    wrapper.style.minHeight = "120px";
    wrapper.style.background = "var(--annot-doc-bg, #ffffff)";
    wrapper.style.color = "var(--annot-doc-fg, #1f2937)";

    const tb = document.createElement(
      "annot-doc-selection-toolbar",
    ) as AnnotDocSelectionToolbarElement;
    const format: SelectionFormatState = {
      bold: args.bold,
      italic: args.italic,
      underline: args.underline,
      link: args.link,
    };
    tb.format = format;
    tb.currentBlockKindId = args.currentBlockKindId;
    // Override the host's `position: fixed` so the toolbar
    // appears in the Storybook canvas where the wrapper sits
    // rather than at the top-left of the viewport.
    queueMicrotask(() => {
      const host = tb.querySelector(".annot-doc-selection-toolbar-host") as HTMLElement | null;
      if (host) {
        host.style.position = "static";
      }
    });
    tb.addEventListener("format-change", (e) => {
      console.log("[story] format-change", (e as CustomEvent).detail);
    });
    tb.addEventListener("block-kind-change", (e) => {
      console.log("[story] block-kind-change", (e as CustomEvent).detail);
    });
    tb.addEventListener("link-request", (e) => {
      console.log("[story] link-request", (e as CustomEvent).detail);
    });

    wrapper.appendChild(tb);
    return wrapper;
  },
  argTypes: {
    bold: { control: "boolean" },
    italic: { control: "boolean" },
    underline: { control: "boolean" },
    link: { control: "boolean" },
    currentBlockKindId: {
      control: { type: "select" },
      options: [
        "paragraph",
        "h1",
        "h2",
        "h3",
        "ul",
        "ol",
        "quote",
        "callout-info",
        "callout-warn",
        "callout-note",
      ],
    },
  },
  args: {
    bold: false,
    italic: false,
    underline: false,
    link: false,
    currentBlockKindId: "paragraph",
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {};

export const BoldActive: Story = {
  args: { bold: true },
};

export const AllFormatsActive: Story = {
  args: { bold: true, italic: true, underline: true, link: true },
};

export const LinkActive: Story = {
  args: { link: true },
  parameters: {
    docs: {
      description: {
        story:
          'Link button shows the `aria-pressed="true"` state when the cursor sits inside an existing inline `<a>` — clicking opens the dialog in edit mode (Remove + Apply).',
      },
    },
  },
};

export const Heading2Selection: Story = {
  args: { currentBlockKindId: "h2" },
};
