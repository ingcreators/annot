/**
 * Stories for `<annot-doc-block-menu>` — Phase 4b of
 * `docs/plans/annot-html-document.md`.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-doc-block-menu.js";
import {
  AnnotDocBlockMenuElement,
  type BlockMenuItem,
  type BlockMenuSelectDetail,
  DEFAULT_BLOCK_MENU_ITEMS,
} from "./annot-doc-block-menu.js";

interface Args {
  items: readonly BlockMenuItem[];
}

const meta: Meta<Args> = {
  title: "Doc / DocBlockMenu",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.padding = "32px";
    wrapper.style.height = "480px";
    wrapper.style.background = "var(--annot-doc-bg, #ffffff)";

    const anchor = document.createElement("p");
    anchor.contentEditable = "true";
    anchor.textContent = "Type / here (the trigger anchor)";
    anchor.style.padding = "8px";
    anchor.style.border = "1px dashed var(--annot-doc-muted, #6b7280)";
    anchor.style.borderRadius = "4px";
    anchor.style.maxWidth = "400px";
    wrapper.appendChild(anchor);

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.textContent = "Open block menu";
    trigger.style.marginTop = "16px";
    trigger.style.padding = "8px 12px";
    trigger.addEventListener("click", () => {
      const menu = AnnotDocBlockMenuElement.openFor(anchor, { items: args.items });
      menu.addEventListener("block-menu-select", (e) => {
        console.log("[story] block-menu-select:", (e as CustomEvent<BlockMenuSelectDetail>).detail);
      });
    });
    wrapper.appendChild(trigger);

    return wrapper;
  },
  argTypes: {
    items: { control: false },
  },
  args: {
    items: DEFAULT_BLOCK_MENU_ITEMS,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {};

export const HeadingsOnly: Story = {
  name: "Headings only",
  args: {
    items: DEFAULT_BLOCK_MENU_ITEMS.filter((i) => i.kind === "heading"),
  },
};

export const CalloutsOnly: Story = {
  name: "Callouts only",
  args: {
    items: DEFAULT_BLOCK_MENU_ITEMS.filter((i) => i.kind === "callout"),
  },
};
