/**
 * Stories for `<annot-toolbar>` and `<annot-toolbar-button>` —
 * the toolbar shell + per-tool button primitives.
 *
 * The shell (`<annot-toolbar>`) is a thin custom element that
 * just toggles `.toolbar-vertical` based on the `orientation`
 * attribute. The button (`<annot-toolbar-button>`) is a
 * `LitElement` that renders an icon glyph + tooltip + active
 * state.
 *
 * Phase 4 of `docs/plans/litelement-stories-coverage.md`. The
 * stories build a hand-authored children list mirroring what the
 * imperative `Toolbar` class produces in the app — heavier
 * coverage of dynamic flyouts / badges lives in
 * `<annot-tool-flyout>`'s own story.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-toolbar.js";

interface ButtonSpec {
  toolId: string;
  icon: string;
  tooltip: string;
  active?: boolean;
}

interface Args {
  orientation: "horizontal" | "vertical";
  buttons: ButtonSpec[];
}

const SAMPLE_BUTTONS: ButtonSpec[] = [
  { toolId: "select", icon: "near_me", tooltip: "Select (V)", active: true },
  { toolId: "shape", icon: "rectangle", tooltip: "Shape (R)" },
  { toolId: "arrow", icon: "arrow_right_alt", tooltip: "Arrow (A)" },
  { toolId: "text", icon: "text_fields", tooltip: "Text (T)" },
  { toolId: "freehand", icon: "draw", tooltip: "Draw (D)" },
  { toolId: "highlight", icon: "highlight", tooltip: "Highlight (H)" },
  { toolId: "redact", icon: "blur_on", tooltip: "Redact" },
  { toolId: "marker", icon: "counter_1", tooltip: "Counter" },
  { toolId: "crop", icon: "crop", tooltip: "Crop" },
];

const meta: Meta<Args> = {
  title: "Editor / Toolbar",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.padding = "16px";
    wrapper.style.background = "var(--annot-bg-panel, #1e1e2e)";
    wrapper.style.display = "inline-block";
    const toolbar = document.createElement("annot-toolbar");
    toolbar.setAttribute("orientation", args.orientation);
    for (const btn of args.buttons) {
      const wrap = document.createElement("div");
      wrap.className = "tool-btn-wrap";
      const el = document.createElement("annot-toolbar-button");
      el.icon = btn.icon;
      el.tooltip = btn.tooltip;
      el.active = btn.active === true;
      el.dataTool = btn.toolId;
      wrap.appendChild(el);
      toolbar.appendChild(wrap);
    }
    wrapper.appendChild(toolbar);
    return wrapper;
  },
  argTypes: {
    orientation: { control: "radio", options: ["horizontal", "vertical"] },
    buttons: { control: false },
  },
  args: {
    orientation: "horizontal",
    buttons: SAMPLE_BUTTONS,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Horizontal: Story = {
  args: {
    orientation: "horizontal",
    buttons: SAMPLE_BUTTONS,
  },
};

export const Vertical: Story = {
  args: {
    orientation: "vertical",
    buttons: SAMPLE_BUTTONS,
  },
};

export const ShapeActive: Story = {
  args: {
    orientation: "horizontal",
    buttons: SAMPLE_BUTTONS.map((b) => ({ ...b, active: b.toolId === "shape" })),
  },
};

export const FewerTools: Story = {
  args: {
    orientation: "horizontal",
    buttons: SAMPLE_BUTTONS.slice(0, 4),
  },
};
