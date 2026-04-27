/**
 * Stories for `<annot-capture-progress-toast>` — the floating
 * progress toast shown during interval capture.
 *
 * Phase 4 of `docs/plans/litelement-stories-coverage.md`.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-capture-progress-toast.js";

interface Args {
  current: number;
  total: number;
}

const meta: Meta<Args> = {
  title: "Capture / CaptureProgressToast",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.padding = "32px";
    wrapper.style.background = "var(--bg-canvas, #1e1e1e)";
    wrapper.style.minHeight = "120px";
    const toast = document.createElement("annot-capture-progress-toast");
    toast.current = args.current;
    toast.total = args.total;
    // Storybook arg-flow trace — intentional `console.log`.
    toast.addEventListener("cancel-click", () => {
      console.log("[story] cancel-click");
    });
    wrapper.appendChild(toast);
    return wrapper;
  },
  argTypes: {
    current: { control: { type: "number", min: 0 } },
    total: { control: { type: "number", min: 0 } },
  },
  args: {
    current: 3,
    total: 10,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Started: Story = {
  args: { current: 1, total: 10 },
};

export const Midway: Story = {
  args: { current: 5, total: 10 },
};

export const NearComplete: Story = {
  args: { current: 9, total: 10 },
};

export const LongCapture: Story = {
  args: { current: 47, total: 120 },
};

export const Complete: Story = {
  args: { current: 10, total: 10 },
};
