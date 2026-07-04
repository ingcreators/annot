/**
 * Stories for `<annot-snapshot-overlay>` — the hover-pickable
 * snapshot region overlay that Phase 4d's OverlayTool uses to
 * collect element picks.
 *
 * Each story mounts the element absolutely over a faux
 * screenshot panel so reviewers can see how the rects compose on
 * top of a captured image. Picks log to the console for visual
 * tracing.
 */

import type { ElementTree } from "@ingcreators/annot-core/element-tree";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./snapshot-overlay.js";
import type { OverlayRegionPickDetail } from "./snapshot-overlay.js";

interface Args {
  elementTree: ElementTree | undefined;
  highlightedRef: string | undefined;
}

const EMPTY_TREE: ElementTree = {
  version: 1,
  source: { kind: "playwright", capturedAt: "2026-05-23T10:00:00Z" },
  viewport: { width: 800, height: 600, scale: 1 },
  root: { ref: "e1", role: "main", bbox: { x: 0, y: 0, width: 800, height: 600 } },
};

const LOGIN_TREE: ElementTree = {
  version: 1,
  source: { kind: "playwright", capturedAt: "2026-05-23T10:00:00Z" },
  viewport: { width: 800, height: 600, scale: 1 },
  root: {
    ref: "e1",
    role: "main",
    bbox: { x: 0, y: 0, width: 800, height: 600 },
    children: [
      {
        ref: "e2",
        role: "heading",
        name: "Sign in",
        bbox: { x: 280, y: 80, width: 240, height: 48 },
      },
      {
        ref: "e3",
        role: "textbox",
        name: "Email",
        bbox: { x: 200, y: 200, width: 400, height: 48 },
      },
      {
        ref: "e4",
        role: "textbox",
        name: "Password",
        bbox: { x: 200, y: 280, width: 400, height: 48 },
      },
      {
        ref: "e5",
        role: "button",
        name: "Sign in",
        bbox: { x: 200, y: 380, width: 400, height: 48 },
      },
    ],
  },
};

const NESTED_TREE: ElementTree = {
  version: 1,
  source: { kind: "playwright", capturedAt: "2026-05-23T10:00:00Z" },
  viewport: { width: 800, height: 600, scale: 1 },
  root: {
    ref: "e1",
    role: "main",
    bbox: { x: 0, y: 0, width: 800, height: 600 },
    children: [
      {
        ref: "e2",
        role: "form",
        bbox: { x: 100, y: 150, width: 600, height: 350 },
        children: [
          {
            ref: "e3",
            role: "textbox",
            name: "Email",
            bbox: { x: 200, y: 200, width: 400, height: 48 },
          },
          {
            ref: "e4",
            role: "button",
            name: "Submit",
            bbox: { x: 200, y: 380, width: 400, height: 48 },
          },
        ],
      },
    ],
  },
};

const meta: Meta<Args> = {
  title: "Editor / SnapshotOverlay",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.width = "800px";
    wrapper.style.height = "600px";
    wrapper.style.background = "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)";
    wrapper.style.border = "1px solid var(--annot-border, #444)";
    wrapper.style.borderRadius = "8px";
    wrapper.style.overflow = "hidden";
    const caption = document.createElement("div");
    caption.style.position = "absolute";
    caption.style.top = "8px";
    caption.style.left = "8px";
    caption.style.color = "rgba(255,255,255,0.5)";
    caption.style.fontFamily = "system-ui, sans-serif";
    caption.style.fontSize = "12px";
    caption.textContent = "Hover regions to highlight; click to pick (see console).";
    wrapper.appendChild(caption);
    const overlay = document.createElement("annot-snapshot-overlay");
    overlay.elementTree = args.elementTree;
    overlay.highlightedRef = args.highlightedRef;
    overlay.addEventListener("overlay-region-pick", (e) => {
      const detail = (e as CustomEvent<OverlayRegionPickDetail>).detail;
      console.log("[story] overlay-region-pick:", detail);
    });
    wrapper.appendChild(overlay);
    return wrapper;
  },
  argTypes: {
    elementTree: { control: false },
    highlightedRef: { control: "text" },
  },
  args: {
    elementTree: LOGIN_TREE,
    highlightedRef: undefined,
  },
};

export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {
  args: {
    elementTree: LOGIN_TREE,
  },
};

export const Empty: Story = {
  name: "Empty (root only, no inner regions)",
  args: {
    elementTree: EMPTY_TREE,
  },
};

export const NoTree: Story = {
  name: "No ElementTree (renders empty SVG)",
  args: {
    elementTree: undefined,
  },
};

export const HighlightedFromOutside: Story = {
  name: "Highlight 'Password' via highlightedRef",
  args: {
    elementTree: LOGIN_TREE,
    highlightedRef: "e4",
  },
};

export const NestedRegions: Story = {
  name: "Nested form + children (parent + leaves both clickable)",
  args: {
    elementTree: NESTED_TREE,
  },
};
