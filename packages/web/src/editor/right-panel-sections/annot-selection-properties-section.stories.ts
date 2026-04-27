/**
 * Stories for `<annot-right-panel-selection-properties-section>` —
 * the section that surfaces the current selection's properties
 * via the embedded `PropertyPanel` singleton.
 *
 * Phase 3 of `docs/plans/litelement-stories-coverage.md`. The
 * actual `PropertyPanel` lives in `@ingcreators/annot-editor` and
 * needs a live `CanvasManager` + `History`. The story injects a
 * pre-built DOM tree as the `propPanelHost` and stubs `showPropPanel`
 * to log + populate the host so the layout, dynamic title, and
 * teardown are reviewable without a live editor session.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-selection-properties-section.js";

interface Args {
  title: string;
  selectionDescription: string;
  rowCount: number;
}

function makePropPanelHost(rowCount: number): HTMLElement {
  const host = document.createElement("div");
  host.style.display = "flex";
  host.style.flexDirection = "column";
  host.style.gap = "8px";
  host.style.padding = "8px 0";
  for (let i = 0; i < rowCount; i++) {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "92px 1fr";
    row.style.gap = "12px";
    row.style.alignItems = "center";
    const label = document.createElement("span");
    label.style.color = "var(--text-muted, #9097b8)";
    label.style.fontSize = "12px";
    label.textContent = ["Fill", "Stroke", "Width", "Opacity", "Dash"][i % 5] ?? "Property";
    const value = document.createElement("span");
    value.style.fontSize = "12px";
    value.textContent = "[stub]";
    row.appendChild(label);
    row.appendChild(value);
    host.appendChild(row);
  }
  return host;
}

const meta: Meta<Args> = {
  title: "Editor / RightPanelSections / right-panel.selection-properties",
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
      "annot-right-panel-selection-properties-section",
    );
    const stubElements: SVGElement[] = [];
    section.elements = stubElements;
    section.propPanelHost = makePropPanelHost(args.rowCount);
    section.showPropPanel = (els) =>
      console.log("[story] showPropPanel", els.length, "elements:", args.selectionDescription);
    section.hidePropPanel = () => console.log("[story] hidePropPanel");
    section.setTitle = (t) => {
      heading.textContent = t;
    };
    section.computeTitle = () => args.title;
    wrapper.appendChild(section);
    return wrapper;
  },
  argTypes: {
    title: { control: "text" },
    selectionDescription: { control: "text" },
    rowCount: { control: "number" },
  },
  args: {
    title: "Selected Rectangle",
    selectionDescription: "1 rectangle",
    rowCount: 5,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const SingleRectangle: Story = {};

export const SingleArrow: Story = {
  args: {
    title: "Selected Arrow",
    selectionDescription: "1 arrow",
    rowCount: 4,
  },
};

export const MultiSelectionMixed: Story = {
  args: {
    title: "3 selected — 2 rectangles + 1 arrow",
    selectionDescription: "2 rectangles + 1 arrow",
    rowCount: 3,
  },
};
