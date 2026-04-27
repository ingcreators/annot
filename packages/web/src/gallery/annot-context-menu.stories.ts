/**
 * Stories for `<annot-context-menu>` — the floating singleton
 * popover used by gallery cards (3-dot button + right-click).
 *
 * Phase 5 of `docs/plans/lit-migration-completion.md` introduced
 * the Lit element. The function-call API
 * (`openContextMenu({ x, y, items })`) is preserved across the
 * migration so callers don't change. Stories trigger that
 * function from a button so the floating menu's positioning,
 * keyboard nav, and outside-click dismiss can be exercised in
 * isolation.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { closeContextMenu, openContextMenu, type MenuItem } from "./annot-context-menu.js";

interface Args {
  items: MenuItem[];
}

const SAMPLE_ITEMS: MenuItem[] = [
  {
    icon: "open_in_new",
    label: "Open",
    action: () => console.log("[story] Open"),
  },
  {
    icon: "drive_file_rename_outline",
    label: "Rename",
    action: () => console.log("[story] Rename"),
  },
  {
    icon: "delete",
    label: "Delete",
    danger: true,
    action: () => console.log("[story] Delete"),
  },
];

const meta: Meta<Args> = {
  title: "Gallery / ContextMenu",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.padding = "16px";
    wrapper.style.height = "320px";
    wrapper.style.background = "var(--bg-canvas, #1e1e1e)";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Open context menu";
    btn.style.padding = "8px 12px";
    btn.addEventListener("click", (e) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openContextMenu({
        x: rect.right,
        y: rect.bottom,
        items: args.items,
      });
    });
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "Close menu programmatically";
    closeBtn.style.marginLeft = "8px";
    closeBtn.style.padding = "8px 12px";
    closeBtn.addEventListener("click", () => closeContextMenu());
    wrapper.appendChild(btn);
    wrapper.appendChild(closeBtn);
    return wrapper;
  },
  argTypes: {
    items: { control: false },
  },
  args: {
    items: SAMPLE_ITEMS,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {
  args: { items: SAMPLE_ITEMS },
};

export const SingleItem: Story = {
  args: {
    items: [
      {
        icon: "delete",
        label: "Delete",
        danger: true,
        action: () => console.log("[story] Delete"),
      },
    ],
  },
};

export const ManyItems: Story = {
  args: {
    items: [
      ...SAMPLE_ITEMS,
      { icon: "share", label: "Share", action: () => {} },
      { icon: "info", label: "Properties", action: () => {} },
      { icon: "download", label: "Download", action: () => {} },
    ],
  },
};
