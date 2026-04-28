/**
 * Stories for `<annot-editor-right-panel>` — the unified
 * context-aware properties panel. The full panel composes
 * tool-properties / selection-properties / page-elements
 * sections + plugin sections, and depends on a live
 * `Toolbar` + `CanvasManager` + `History` + `SelectionManager`
 * for the dynamic surfaces.
 *
 * Phase 3 of `docs/plans/litelement-stories-coverage.md`. The
 * stories exercise the layout shapes the panel can land in
 * **without** the live editor session: Empty (no active tool, no
 * selection) and SelectionWithActions (currentSelection set so
 * the action panel renders). The full sections list is left to
 * the per-section stories that already ship in this PR.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./right-panel.js";
import type { AnnotEditorRightPanelElement } from "./right-panel.js";

interface Args {
  hasSelection: boolean;
}

const meta: Meta<Args> = {
  title: "Editor / RightPanel",
  render: (args) => {
    const wrapper = document.createElement("aside");
    wrapper.id = "editor-right-panel";
    wrapper.style.width = "260px";
    wrapper.style.height = "560px";
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.background = "var(--annot-bg-panel, #1e1e2e)";
    wrapper.style.borderLeft = "1px solid var(--annot-border-color, #2a2a3a)";
    const el = document.createElement("annot-editor-right-panel");
    // We don't attach Toolbar / Canvas / History / Selection — without
    // them the built-in sections refuse to mount, leaving the panel's
    // chrome (actions panel + empty-state) on display.
    if (args.hasSelection) {
      // A non-empty selection makes the actions panel render; the
      // section list still skips because canvas / history are null.
      const fakeRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      (el as AnnotEditorRightPanelElement).currentSelection = [fakeRect];
    }
    wrapper.appendChild(el);
    return wrapper;
  },
  argTypes: {
    hasSelection: { control: "boolean" },
  },
  args: {
    hasSelection: false,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const EmptyState: Story = {
  args: { hasSelection: false },
};

export const SelectionWithActions: Story = {
  args: { hasSelection: true },
};
