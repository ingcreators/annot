/**
 * Stories for `<annot-right-panel-tool-properties-section>` — the
 * tool-side property panel rendered in the right panel when a
 * drawing tool is active.
 *
 * Phase 3 of `docs/plans/litelement-stories-coverage.md`. The
 * section delegates to `Toolbar.renderToolProperties` to populate
 * its inner host; the story uses a stub Toolbar that injects a
 * pre-built DOM tree so the layout, dynamic title, and the
 * delegation pattern are all reviewable without a live editor
 * session.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-tool-properties-section.js";
import type { Toolbar } from "../toolbar.js";

interface Args {
  toolId: string;
  title: string;
  body: string;
}

function makeStubToolbar(args: Args): Toolbar {
  return {
    renderToolProperties(toolId: string, host: HTMLElement) {
      const banner = document.createElement("div");
      banner.style.padding = "12px";
      banner.style.background = "var(--bg-panel-deep, #16213e)";
      banner.style.borderRadius = "6px";
      banner.style.fontSize = "12px";
      banner.style.color = "var(--text-muted, #9097b8)";
      banner.textContent = `[story] Toolbar.renderToolProperties("${toolId}") would build the tool's controls here. ${args.body}`;
      host.appendChild(banner);
    },
    getToolDisplayTitle(_toolId: string) {
      return args.title;
    },
  } as unknown as Toolbar;
}

const meta: Meta<Args> = {
  title: "Editor / RightPanelSections / right-panel.tool-properties",
  render: (args) => {
    const wrapper = document.createElement("aside");
    wrapper.id = "editor-right-panel";
    wrapper.style.width = "280px";
    wrapper.style.padding = "12px";
    wrapper.style.background = "var(--bg-panel, #1e1e2e)";
    const heading = document.createElement("h3");
    heading.className = "editor-right-panel-section-title";
    heading.textContent = args.title;
    wrapper.appendChild(heading);
    const section = document.createElement(
      "annot-right-panel-tool-properties-section",
    );
    section.toolId = args.toolId;
    section.toolbar = makeStubToolbar(args);
    section.setTitle = (t: string) => {
      heading.textContent = t;
    };
    wrapper.appendChild(section);
    return wrapper;
  },
  argTypes: {
    toolId: { control: "text" },
    title: { control: "text" },
    body: { control: "text" },
  },
  args: {
    toolId: "shape",
    title: "Rectangle",
    body: "Type / Fill / Line / Label rows would render below.",
  },
};
export default meta;

type Story = StoryObj<Args>;

export const ShapeRectangle: Story = {};

export const ArrowDouble: Story = {
  args: {
    toolId: "arrow",
    title: "Double arrow",
    body: "Type / Line / Label rows would render below.",
  },
};

export const TextSticky: Story = {
  args: {
    toolId: "text",
    title: "Sticky note",
    body: "Type / Fill / Line / Label / Font rows would render below.",
  },
};

export const HighlightYellow: Story = {
  args: {
    toolId: "highlight",
    title: "Highlight (Yellow)",
    body: "Type / Fill rows would render below.",
  },
};
