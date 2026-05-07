/**
 * Stories for `<annot-editor-statusbar>` — the editor's footer
 * bar (zoom controls + dimensions + active tool). Phase 2 of
 * `docs/plans/litelement-stories-coverage.md`.
 *
 * The full zoom flow depends on a live `CanvasManager` for
 * `setZoom` / `fitToView`; the stories use a stub that logs the
 * intent and updates the displayed label so the menu state
 * machine renders correctly. The dimensions + active-tool
 * indicators don't depend on the canvas at all.
 */

import type { CanvasManager } from "@ingcreators/annot-editor";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./editor-statusbar.js";

interface Args {
  width: number;
  height: number;
  currentToolName: string;
  initialZoom: number;
  isFitMode: boolean;
}

function makeStubCanvas(args: Args): CanvasManager {
  const listeners: Array<() => void> = [];
  const stub = {
    zoom: args.initialZoom,
    isFitMode: args.isFitMode,
    setZoom(value: number) {
      this.zoom = Math.max(0.1, value);
      this.isFitMode = false;
      console.log("[story] canvas.setZoom", this.zoom);
      for (const l of listeners) l();
    },
    fitToView() {
      this.isFitMode = true;
      console.log("[story] canvas.fitToView");
      for (const l of listeners) l();
    },
    set onZoomChange(cb: () => void) {
      listeners.push(cb);
    },
  };
  return stub as unknown as CanvasManager;
}

const meta: Meta<Args> = {
  title: "Editor / EditorStatusbar",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.id = "statusbar";
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.gap = "16px";
    wrapper.style.padding = "0 16px";
    wrapper.style.height = "32px";
    wrapper.style.background = "var(--annot-bg-panel, #1e1e2e)";
    wrapper.style.borderTop = "1px solid var(--annot-border-color, #2a2a3a)";
    wrapper.style.fontSize = "12px";
    const el = document.createElement("annot-editor-statusbar");
    el.canvas = makeStubCanvas(args);
    el.width = args.width;
    el.height = args.height;
    el.currentToolName = args.currentToolName;
    wrapper.appendChild(el);
    return wrapper;
  },
  argTypes: {
    width: { control: "number" },
    height: { control: "number" },
    currentToolName: { control: "text" },
    initialZoom: { control: "number" },
    isFitMode: { control: "boolean" },
  },
  args: {
    width: 1024,
    height: 768,
    currentToolName: "Select",
    initialZoom: 1,
    isFitMode: false,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {};

export const FitMode: Story = {
  args: {
    isFitMode: true,
  },
};

export const ZoomedIn: Story = {
  args: {
    initialZoom: 2,
  },
};

export const ZoomedOut: Story = {
  args: {
    initialZoom: 0.25,
  },
};

export const ActiveDrawingTool: Story = {
  args: {
    currentToolName: "Arrow (Double arrow)",
  },
};

export const LargeDimensions: Story = {
  args: {
    width: 4096,
    height: 2160,
    currentToolName: "Crop",
  },
};
