/**
 * Stories for `<annot-dialog>` — the modal-dialog chrome (overlay
 * + panel + title + optional message + body slot + actions row)
 * shared by `showPromptDialog` / `showConfirmDialog` /
 * `showAlertDialog`.
 *
 * Phase 4 of `docs/plans/litelement-stories-coverage.md`.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-dialog.js";

interface Args {
  title: string;
  message: string;
  okLabel: string;
  cancelLabel: string;
  danger: boolean;
  singleButton: boolean;
  closeOnOutsideClick: boolean;
  bodyHTML: string;
}

const meta: Meta<Args> = {
  title: "UI / Dialog",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.width = "100%";
    wrapper.style.minHeight = "320px";
    wrapper.style.background = "var(--bg-canvas, #1e1e1e)";
    const dlg = document.createElement("annot-dialog");
    dlg.title = args.title;
    dlg.message = args.message;
    dlg.okLabel = args.okLabel;
    dlg.cancelLabel = args.cancelLabel;
    dlg.danger = args.danger;
    dlg.singleButton = args.singleButton;
    dlg.closeOnOutsideClick = args.closeOnOutsideClick;
    if (args.bodyHTML) {
      const slot = document.createElement("div");
      slot.innerHTML = args.bodyHTML;
      dlg.appendChild(slot);
    }
    // Storybook arg-flow trace — intentional `console.log`.
    dlg.addEventListener("dialog-ok", () => console.log("[story] dialog-ok"));
    dlg.addEventListener("dialog-cancel", () => console.log("[story] dialog-cancel"));
    wrapper.appendChild(dlg);
    return wrapper;
  },
  argTypes: {
    title: { control: "text" },
    message: { control: "text" },
    okLabel: { control: "text" },
    cancelLabel: { control: "text" },
    danger: { control: "boolean" },
    singleButton: { control: "boolean" },
    closeOnOutsideClick: { control: "boolean" },
    bodyHTML: { control: "text" },
  },
  args: {
    title: "Confirm action",
    message: "Are you sure you want to proceed?",
    okLabel: "OK",
    cancelLabel: "Cancel",
    danger: false,
    singleButton: false,
    closeOnOutsideClick: false,
    bodyHTML: "",
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Confirm: Story = {};

export const DeleteDanger: Story = {
  args: {
    title: 'Delete "screenshot-2026-04-25.png"?',
    message: "This cannot be undone.",
    okLabel: "Delete",
    danger: true,
  },
};

export const Alert: Story = {
  args: {
    title: "Couldn't save file",
    message: "The storage backend is offline. Please try again.",
    okLabel: "OK",
    singleButton: true,
  },
};

export const Prompt: Story = {
  args: {
    title: "Rename folder",
    message: "",
    okLabel: "Rename",
    bodyHTML: `<input type="text" class="app-dialog-input" placeholder="Folder name" value="Screenshots" />`,
  },
};

export const NoMessageBody: Story = {
  args: {
    title: "Tags",
    message: "",
    bodyHTML: `<div style="font-size: 12px; color: #9097b8;">Custom slotted body content goes here.</div>`,
  },
};
