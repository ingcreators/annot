/**
 * Stories for `<annot-split-editor>` — the full-screen page-break
 * editor for Scroll Capture / per-page Capture sessions.
 *
 * Phase 3 of `docs/plans/lit-migration-completion.md` introduced
 * the Lit element. The stories synthesise placeholder frames so
 * the chrome (header, hint, count, handles, slice labels) renders
 * without an actual session in storage.
 */

import type { ImageRecord } from "@ingcreators/annot-core/storage";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-split-editor.js";

interface Args {
  frameCount: number;
  frameHeight: number;
}

function makePlaceholderRecord(index: number, width: number, height: number): ImageRecord {
  // 10x10 canvas filled with a band colour so the frame edges are
  // visible in the stack.
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  const hue = (index * 73) % 360;
  ctx.fillStyle = `hsl(${hue} 30% 35%)`;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#fff";
  ctx.font = "48px sans-serif";
  ctx.fillText(`Frame ${index + 1}`, 32, 64);
  return {
    path: `Captures/frame-${index + 1}.png`,
    originalDataUrl: c.toDataURL("image/png"),
    thumbnailDataUrl: "",
    annotationsSvg: "",
    width,
    height,
    sourceUrl: "",
    tags: { session: "story-session" },
    folderPath: "Captures",
    createdAt: "2026-04-25T00:00:00Z",
    updatedAt: "2026-04-25T00:00:00Z",
  };
}

const meta: Meta<Args> = {
  title: "Editor / SplitEditor",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.width = "100%";
    wrapper.style.height = "640px";
    wrapper.style.background = "#0e0e16";
    const records: ImageRecord[] = [];
    for (let i = 0; i < args.frameCount; i++) {
      records.push(makePlaceholderRecord(i, 800, args.frameHeight));
    }
    const el = document.createElement("annot-split-editor");
    el.records = records;
    // Storybook arg-flow trace — intentional `console.log`.
    el.onApply = async (slices) => {
      console.log("[story] onApply", slices.length, "slices");
    };
    el.onCancel = () => {
      console.log("[story] onCancel");
    };
    wrapper.appendChild(el);
    queueMicrotask(() => {
      void el.mount().catch((e) => console.error("[story] mount failed", e));
    });
    return wrapper;
  },
  argTypes: {
    frameCount: { control: { type: "number", min: 1, max: 6 } },
    frameHeight: { control: { type: "number", min: 200, max: 2400 } },
  },
  args: {
    frameCount: 3,
    frameHeight: 600,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const PerPageCapture: Story = {
  args: {
    frameCount: 3,
    frameHeight: 600,
  },
};

export const SingleScrollCapture: Story = {
  args: {
    frameCount: 1,
    frameHeight: 2400,
  },
};

export const ManyFrames: Story = {
  args: {
    frameCount: 6,
    frameHeight: 480,
  },
};
