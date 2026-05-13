/**
 * Stories for `<annot-capture-toolbar>` — the bottom button bar in
 * the capture workspace's preview area.
 *
 * Phase 2 of `docs/plans/web-capture-redesign.md`.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-capture-toolbar.js";
import type { CaptureMode } from "./types.js";

interface Args {
  mode: CaptureMode;
  canCaptureOnce: boolean;
}

const meta: Meta<Args> = {
  title: "Capture / CaptureToolbar",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.cssText =
      "width:100%;background:var(--bg-canvas, #1e1e1e);padding:16px;box-sizing:border-box;";
    const el = document.createElement("annot-capture-toolbar");
    el.mode = args.mode;
    el.canCaptureOnce = args.canCaptureOnce;
    el.addEventListener("capture-once-click", () => console.log("[story] capture-once-click"));
    el.addEventListener("stop-click", () => console.log("[story] stop-click"));
    wrapper.appendChild(el);
    return wrapper;
  },
  argTypes: {
    mode: { control: "radio", options: ["auto", "once", "area"] },
    canCaptureOnce: { control: "boolean" },
  },
  args: {
    mode: "once",
    canCaptureOnce: true,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {};

export const CaptureDisabled: Story = {
  args: {
    mode: "once",
    canCaptureOnce: false,
  },
};
