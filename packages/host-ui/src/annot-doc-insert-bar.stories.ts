/**
 * Stories for `<annot-doc-insert-bar>` — the between-block
 * insertion affordance Phase 2 of
 * `docs/plans/annot-html-document-ux-polish.md` adds.
 *
 * The bar is meant to live as a sibling of every block in the
 * editing-mode article. The wrapper here mirrors that — three
 * paragraph-shaped placeholders sandwich four insert bars so
 * the visual rhythm matches the production mount.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-doc-insert-bar.js";
import type { AnnotDocInsertBarElement } from "./annot-doc-insert-bar.js";

interface Args {
  insertAt: number;
  label: string;
}

const meta: Meta<Args> = {
  title: "Editor / DocInsertBar",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.background = "var(--annot-doc-bg, #ffffff)";
    wrapper.style.color = "var(--annot-doc-fg, #1f2937)";
    wrapper.style.padding = "1rem 2rem";
    wrapper.style.fontFamily = "Annot Sans, system-ui, sans-serif";

    const placeholder = (text: string): HTMLElement => {
      const p = document.createElement("p");
      p.textContent = text;
      p.style.margin = "0";
      p.style.padding = "0.25rem 0.5rem";
      p.style.lineHeight = "1.5";
      return p;
    };

    const makeBar = (insertAt: number): AnnotDocInsertBarElement => {
      const bar = document.createElement("annot-doc-insert-bar") as AnnotDocInsertBarElement;
      bar.insertAt = insertAt;
      bar.label = args.label;
      bar.addEventListener("insert-block", (e) => {
        console.log("[story] insert-block", (e as CustomEvent).detail);
      });
      return bar;
    };

    wrapper.appendChild(makeBar(0));
    wrapper.appendChild(placeholder("First paragraph block."));
    wrapper.appendChild(makeBar(1));
    wrapper.appendChild(placeholder("Middle paragraph block."));
    wrapper.appendChild(makeBar(2));
    wrapper.appendChild(placeholder("Trailing paragraph block."));
    wrapper.appendChild(makeBar(3));
    return wrapper;
  },
  argTypes: {
    insertAt: { control: "number" },
    label: { control: "text" },
  },
  args: {
    insertAt: 0,
    label: "Insert",
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {};

export const CustomLabel: Story = {
  args: {
    label: "Add block",
  },
};
