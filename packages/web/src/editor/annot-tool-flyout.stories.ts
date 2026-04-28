/**
 * Stories for `<annot-tool-flyout>` — the chip-row body of the
 * toolbar's variant + Highlight-color flyouts.
 *
 * Phase 4 of `docs/plans/litelement-stories-coverage.md`. The
 * chips render declaratively from `.chips`, with `.layout`
 * driving the row className (icon-glyph chips for "variant",
 * color-swatch chips for "color").
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-tool-flyout.js";
import type { ToolFlyoutChip } from "./annot-tool-flyout.js";

interface Args {
  chips: ToolFlyoutChip[];
  active: string;
  layout: "variant" | "color";
}

const VARIANT_CHIPS: ToolFlyoutChip[] = [
  { value: "rect", icon: "rectangle", label: "Rectangle" },
  { value: "rounded", icon: "rounded_corner", label: "Rounded rectangle" },
  { value: "ellipse", icon: "circle", label: "Ellipse" },
];

const ARROW_CHIPS: ToolFlyoutChip[] = [
  { value: "none", icon: "horizontal_rule", label: "Line" },
  { value: "end", icon: "arrow_right_alt", label: "Arrow" },
  { value: "both", icon: "swap_horiz", label: "Double arrow" },
];

const COLOR_CHIPS: ToolFlyoutChip[] = [
  { value: "#ffd400", color: "#ffd400", label: "Yellow" },
  { value: "#7ef0c5", color: "#7ef0c5", label: "Green" },
  { value: "#7c9cff", color: "#7c9cff", label: "Blue" },
  { value: "#ff7eb6", color: "#ff7eb6", label: "Pink" },
];

const meta: Meta<Args> = {
  title: "Editor / ToolFlyout",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.padding = "12px";
    wrapper.style.background = "var(--annot-bg-panel, #1e1e2e)";
    wrapper.style.border = "1px solid var(--annot-border-color, #2a2a3a)";
    wrapper.style.borderRadius = "6px";
    wrapper.style.display = "inline-block";
    const fly = document.createElement("annot-tool-flyout");
    fly.chips = args.chips;
    fly.active = args.active;
    fly.layout = args.layout;
    // Storybook arg-flow trace — intentional `console.log`.
    fly.addEventListener("chip-select", (e) => {
      console.log("[story] chip-select", (e as CustomEvent).detail.value);
    });
    wrapper.appendChild(fly);
    return wrapper;
  },
  argTypes: {
    chips: { control: false },
    active: { control: "text" },
    layout: { control: "radio", options: ["variant", "color"] },
  },
  args: {
    chips: VARIANT_CHIPS,
    active: "rect",
    layout: "variant",
  },
};
export default meta;

type Story = StoryObj<Args>;

export const ShapeVariants: Story = {
  args: {
    chips: VARIANT_CHIPS,
    active: "rect",
    layout: "variant",
  },
};

export const ArrowVariants: Story = {
  args: {
    chips: ARROW_CHIPS,
    active: "end",
    layout: "variant",
  },
};

export const HighlightColors: Story = {
  args: {
    chips: COLOR_CHIPS,
    active: "#ffd400",
    layout: "color",
  },
};

export const NoActive: Story = {
  args: {
    chips: VARIANT_CHIPS,
    active: "",
    layout: "variant",
  },
};
