/**
 * Stories for `<annot-interval-capture-dialog>` — the modal
 * asking the user for interval seconds, frame count, and cursor
 * visibility before a timed screen-capture session.
 *
 * Phase 4 of `docs/plans/litelement-stories-coverage.md`.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-interval-capture-dialog.js";
import type { CursorMode } from "./annot-interval-capture-dialog.js";

interface Args {
  intervalSec: number;
  frameCount: number;
  cursor: CursorMode;
}

const meta: Meta<Args> = {
  title: "Capture / IntervalCaptureDialog",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.width = "100%";
    wrapper.style.minHeight = "480px";
    wrapper.style.background = "var(--bg-canvas, #1e1e1e)";
    const dlg = document.createElement("annot-interval-capture-dialog");
    dlg.intervalSec = args.intervalSec;
    dlg.frameCount = args.frameCount;
    dlg.cursor = args.cursor;
    // Storybook arg-flow trace — intentional `console.log`.
    dlg.addEventListener("capture-confirm", (e) => {
      console.log("[story] capture-confirm", (e as CustomEvent).detail);
    });
    dlg.addEventListener("capture-cancel", () => {
      console.log("[story] capture-cancel");
    });
    wrapper.appendChild(dlg);
    return wrapper;
  },
  argTypes: {
    intervalSec: { control: { type: "number", min: 1 } },
    frameCount: { control: { type: "number", min: 1 } },
    cursor: { control: "radio", options: ["always", "motion", "never"] },
  },
  args: {
    intervalSec: 10,
    frameCount: 10,
    cursor: "always",
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {};

export const QuickCapture: Story = {
  args: {
    intervalSec: 2,
    frameCount: 5,
    cursor: "motion",
  },
};

export const LongInterval: Story = {
  args: {
    intervalSec: 60,
    frameCount: 60,
    cursor: "never",
  },
};

export const HiddenCursor: Story = {
  args: {
    intervalSec: 5,
    frameCount: 12,
    cursor: "never",
  },
};
