/**
 * Stories for `<annot-doc-block-toolbar>` — Phase 4a of
 * `docs/plans/_done/annot-html-document.md`.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-doc-block-toolbar.js";
import type { BlockToolbarActionDetail } from "./annot-doc-block-toolbar.js";

interface Args {
  canMoveUp: boolean;
  canMoveDown: boolean;
}

const meta: Meta<Args> = {
  title: "Doc / DocBlockToolbar",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.padding = "32px";
    wrapper.style.background = "#f3f4f6";
    const tb = document.createElement("annot-doc-block-toolbar");
    if ("canMoveUp" in tb) (tb as { canMoveUp: boolean }).canMoveUp = args.canMoveUp;
    if ("canMoveDown" in tb) (tb as { canMoveDown: boolean }).canMoveDown = args.canMoveDown;
    tb.addEventListener("block-action", (e) => {
      console.log("[story] block-action:", (e as CustomEvent<BlockToolbarActionDetail>).detail);
    });
    wrapper.appendChild(tb);
    return wrapper;
  },
  argTypes: {
    canMoveUp: { control: "boolean" },
    canMoveDown: { control: "boolean" },
  },
  args: {
    canMoveUp: true,
    canMoveDown: true,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {};

export const FirstBlock: Story = {
  name: "First block (cannot move up)",
  args: { canMoveUp: false, canMoveDown: true },
};

export const LastBlock: Story = {
  name: "Last block (cannot move down)",
  args: { canMoveUp: true, canMoveDown: false },
};

export const Singleton: Story = {
  name: "Singleton (no move available)",
  args: { canMoveUp: false, canMoveDown: false },
};
