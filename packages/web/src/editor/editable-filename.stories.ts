/**
 * Stories for `<annot-editable-filename>` — the
 * display-and-edit filename row used in the editor header
 * breadcrumb. Single-click leaves the value selectable;
 * double-click swaps to an input. Phase 2 of
 * `docs/plans/litelement-stories-coverage.md`.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./editable-filename.js";

interface Args {
  filename: string;
  tooltip: string;
}

const meta: Meta<Args> = {
  title: "Editor / EditableFilename",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.padding = "8px 16px";
    wrapper.style.background = "var(--bg-panel, #1e1e2e)";
    // Use the breadcrumb container so the inline-rename styling
    // matches what the user sees in the editor header.
    const nav = document.createElement("nav");
    nav.className = "breadcrumb editor-header-path";
    const el = document.createElement("annot-editable-filename");
    el.filename = args.filename;
    el.tooltip = args.tooltip;
    // Storybook arg-flow trace — intentional `console.log`.
    el.onCommit = async (next) => {
      console.log("[story] onCommit", next);
    };
    nav.appendChild(el);
    wrapper.appendChild(nav);
    return wrapper;
  },
  argTypes: {
    filename: { control: "text" },
    tooltip: { control: "text" },
  },
  args: {
    filename: "screenshot-2026-04-25.png",
    tooltip: "Screenshots/Mobile/screenshot-2026-04-25.png\nDouble-click to rename",
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {};

export const NoTooltip: Story = {
  args: {
    filename: "untitled.png",
    tooltip: "",
  },
};

export const ExtraLong: Story = {
  args: {
    filename: "extremely-long-filename-that-should-still-render-without-clipping.png",
    tooltip:
      "Archive/2026/April/Mobile/iOS/Safari/extremely-long-filename-that-should-still-render-without-clipping.png\nDouble-click to rename",
  },
};
