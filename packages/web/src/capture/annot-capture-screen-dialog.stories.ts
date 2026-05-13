/**
 * Stories for `<annot-capture-screen-dialog>` — the modal Phase 1
 * of `docs/plans/web-capture-redesign.md` introduces. Only Capture
 * Once is enabled in Phase 1; the other two chips render disabled
 * with a "Coming soon" hint. Future phases enable Auto (Phase 4)
 * and Area (deferred spec Phase 4).
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-capture-screen-dialog.js";
import type { CursorMode } from "./capture-prefs.js";
import type { CaptureMode } from "./types.js";

interface Args {
  mode: CaptureMode;
  cursor: CursorMode;
}

const meta: Meta<Args> = {
  title: "Capture / CaptureScreenDialog",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.width = "100%";
    wrapper.style.minHeight = "560px";
    wrapper.style.background = "var(--bg-canvas, #1e1e1e)";
    const dlg = document.createElement("annot-capture-screen-dialog");
    dlg.mode = args.mode;
    dlg.cursor = args.cursor;
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
    mode: { control: "radio", options: ["auto", "once", "area"] },
    cursor: { control: "radio", options: ["always", "motion", "never"] },
  },
  args: {
    mode: "once",
    cursor: "always",
  },
};
export default meta;

type Story = StoryObj<Args>;

/** Default open state — the only enabled mode is selected. */
export const Default: Story = {};

/** Capture Once selected (the only enabled mode in Phase 1). */
export const OnceSelected: Story = {
  args: {
    mode: "once",
    cursor: "always",
  },
};

/** Auto Capture pre-selected: the chip remains highlighted but is
 *  disabled; the Start button is greyed out until the user picks an
 *  enabled mode. Stand-in for what the dialog will look like once
 *  Phase 4 lands and `auto` becomes the default. */
export const AutoDisabled: Story = {
  args: {
    mode: "auto",
    cursor: "always",
  },
};
