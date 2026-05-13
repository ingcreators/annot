/**
 * Stories for `<annot-capture-preview>` — the live video preview
 * that hosts the shared screen plus a status overlay.
 *
 * Phase 2 of `docs/plans/web-capture-redesign.md`. The video itself
 * stays empty in stories (no live `MediaStream`); the surface is
 * useful for visual review of the chrome around it.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-capture-preview.js";

interface Args {
  status: string;
  sourceWidth: number;
  sourceHeight: number;
}

const meta: Meta<Args> = {
  title: "Capture / CapturePreview",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.cssText =
      "width:100%;height:480px;background:var(--bg-canvas, #1e1e1e);padding:16px;box-sizing:border-box;";
    const el = document.createElement("annot-capture-preview");
    el.status = args.status;
    el.sourceWidth = args.sourceWidth;
    el.sourceHeight = args.sourceHeight;
    wrapper.appendChild(el);
    return wrapper;
  },
  argTypes: {
    status: { control: "text" },
    sourceWidth: { control: { type: "number", min: 0 } },
    sourceHeight: { control: { type: "number", min: 0 } },
  },
  args: {
    status: "Waiting for screen share…",
    sourceWidth: 0,
    sourceHeight: 0,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {};

export const Sharing: Story = {
  args: {
    status: "Sharing — click Capture Once below to save the current frame.",
    sourceWidth: 1920,
    sourceHeight: 1080,
  },
};

export const HighDpiSource: Story = {
  args: {
    status: "Sharing — high-resolution source.",
    sourceWidth: 3840,
    sourceHeight: 2160,
  },
};

export const Stopped: Story = {
  args: {
    status: "Screen sharing stopped.",
    sourceWidth: 1920,
    sourceHeight: 1080,
  },
};
