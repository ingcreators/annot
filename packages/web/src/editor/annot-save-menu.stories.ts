/**
 * Stories for `<annot-save-menu>` — the save / export dropdown
 * opened by the editor toolbar's split-button caret.
 *
 * Phase 6b of `docs/plans/lit-migration-completion.md` pulled
 * the orchestration into the element itself; the stories below
 * exercise the now-self-contained `AnnotSaveMenuElement.openFor`
 * factory so the dropdown's positioning, item rendering, and
 * outside-click dismiss can be reviewed in isolation.
 *
 * The export-format actions are stubbed (the real ones depend on
 * a live `CanvasManager`); selecting an item logs to the console
 * and closes the menu.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-save-menu.js";
import {
  AnnotSaveMenuElement,
  type SaveMenuItem,
} from "./annot-save-menu.js";

interface Args {
  items: SaveMenuItem[];
}

const SAMPLE_ITEMS: SaveMenuItem[] = [
  { id: "svg", label: "Download SVG", description: "Editable vector format" },
  {
    id: "jpg-editable",
    label: "Download JPG (re-editable)",
    description: "JPEG with embedded annotations",
  },
  {
    id: "png-editable",
    label: "Download PNG (re-editable)",
    description: "PNG with embedded annotations",
  },
  {
    id: "pptx",
    label: "Download PPTX (PowerPoint)",
    description: "Editable PowerPoint slide with native shapes",
  },
];

const meta: Meta<Args> = {
  title: "Editor / SaveMenu",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.padding = "16px";
    wrapper.style.height = "320px";
    wrapper.style.background = "var(--bg-canvas, #1e1e1e)";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.textContent = "Open save menu";
    trigger.style.padding = "8px 12px";
    trigger.addEventListener("click", () => {
      // Inline the Lit element with the story's items + a stub
      // action map. We don't go through `openFor` because that
      // path is tested directly in the unit test; the story wants
      // to demonstrate the dropdown's visual behaviour with a
      // controllable item list instead of the production roster.
      const existing = document.querySelector("annot-save-menu");
      if (existing) {
        (existing as AnnotSaveMenuElement).close();
        return;
      }
      const el = document.createElement("annot-save-menu");
      el.items = args.items;
      el.actions = Object.fromEntries(
        args.items.map((it) => [
          it.id,
          () => console.log("[story] save-menu action:", it.id),
        ]),
      );
      el.anchor = trigger;
      document.body.appendChild(el);
    });
    wrapper.appendChild(trigger);
    return wrapper;
  },
  argTypes: {
    items: { control: false },
  },
  args: {
    items: SAMPLE_ITEMS,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {
  args: { items: SAMPLE_ITEMS },
};

export const SVGOnly: Story = {
  args: {
    items: [{ id: "svg", label: "Download SVG", description: "Editable vector format" }],
  },
};

export const TauriHostItems: Story = {
  name: "Tauri host items",
  args: {
    items: [
      { id: "svg", label: "Download SVG", description: "Editable vector format" },
      {
        id: "jpg-editable",
        label: "Save as JPG (re-editable)",
        description: "JPEG with embedded annotations",
      },
      {
        id: "png-editable",
        label: "Save as PNG (re-editable)",
        description: "PNG with embedded annotations",
      },
      {
        id: "pptx",
        label: "Download PPTX (PowerPoint)",
        description: "Editable PowerPoint slide with native shapes",
      },
    ],
  },
};
