/**
 * Stories for `<annot-capture-screen-dialog>` — the modal Phase 1
 * of `docs/plans/web-capture-redesign.md` introduces. Only Capture
 * Once is enabled in Phase 1; the other two chips render disabled
 * with a "Coming soon" hint. Future phases enable Auto (Phase 4)
 * and Area (deferred spec Phase 4).
 */

import type { SaveSizePreset } from "@ingcreators/annot-core/encode/options";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-capture-screen-dialog.js";
import type { CursorMode } from "./capture-prefs.js";
import type { CaptureMode } from "./types.js";

interface Args {
  mode: CaptureMode;
  cursor: CursorMode;
  saveSizePreset: SaveSizePreset;
}

const meta: Meta<Args> = {
  title: "Capture / CaptureScreenDialog",
  parameters: {
    docs: {
      description: {
        component:
          "Mode picker for the Capture Screen flow. Two modes only: Auto Capture (default) and Capture Once. The originally-planned Capture Area mode was retired — users crop in the editor after a Capture Once instead.",
      },
    },
  },
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.width = "100%";
    wrapper.style.minHeight = "560px";
    wrapper.style.background = "var(--bg-canvas, #1e1e1e)";
    const dlg = document.createElement("annot-capture-screen-dialog");
    dlg.mode = args.mode;
    dlg.cursor = args.cursor;
    dlg.saveSizePreset = args.saveSizePreset;
    // Storybook arg-flow trace — intentional `console.log`.
    dlg.addEventListener("capture-confirm", (e) => {
      console.log("[story] capture-confirm", (e as CustomEvent).detail);
    });
    dlg.addEventListener("capture-cancel", () => {
      console.log("[story] capture-cancel");
    });
    wrapper.appendChild(dlg);
    return wrapper;
  },
  argTypes: {
    mode: { control: "radio", options: ["auto", "once"] },
    cursor: { control: "radio", options: ["always", "motion", "never"] },
    saveSizePreset: {
      control: "radio",
      options: ["light", "standard", "highQuality", "original"],
    },
  },
  args: {
    mode: "once",
    cursor: "always",
    saveSizePreset: "standard",
  },
};
export default meta;

type Story = StoryObj<Args>;

/** Default open state — Auto Capture is the default selection. */
export const Default: Story = {};

/** Capture Once selected. */
export const OnceSelected: Story = {
  args: {
    mode: "once",
    cursor: "always",
    saveSizePreset: "standard",
  },
};

/** Auto Capture pre-selected. */
export const AutoSelected: Story = {
  args: {
    mode: "auto",
    cursor: "always",
    saveSizePreset: "standard",
  },
};

/** Save-size preset set to "Original" (no resize) — useful for
 *  reviewers comparing the dialog state across presets. */
export const OriginalSize: Story = {
  args: {
    mode: "auto",
    cursor: "always",
    saveSizePreset: "original",
  },
};

/** Advanced section programmatically expanded so reviewers can
 *  inspect every Advanced control without clicking. The Auto
 *  Capture sub-group only renders for mode === "auto". */
export const AdvancedExpanded: Story = {
  args: {
    mode: "auto",
    cursor: "always",
    saveSizePreset: "standard",
  },
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.width = "100%";
    wrapper.style.minHeight = "720px";
    wrapper.style.background = "var(--bg-canvas, #1e1e1e)";
    const dlg = document.createElement("annot-capture-screen-dialog");
    dlg.mode = args.mode;
    dlg.cursor = args.cursor;
    dlg.saveSizePreset = args.saveSizePreset;
    dlg.addEventListener("capture-confirm", (e) => {
      console.log("[story] capture-confirm", (e as CustomEvent).detail);
    });
    dlg.addEventListener("capture-cancel", () => {
      console.log("[story] capture-cancel");
    });
    wrapper.appendChild(dlg);
    // Open the <details> after the first render so reviewers
    // see the expanded state by default.
    queueMicrotask(() => {
      const details = dlg.querySelector<HTMLDetailsElement>(".capture-dialog-advanced");
      if (details) details.open = true;
    });
    return wrapper;
  },
};
