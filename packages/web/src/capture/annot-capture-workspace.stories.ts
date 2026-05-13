/**
 * Stories for `<annot-capture-workspace>` — the `/capture` route's
 * main surface.
 *
 * Phase 2 of `docs/plans/web-capture-redesign.md`. Stories run
 * without a real `MediaStream` — the no-pending path is the most
 * representative of what reviewers see when navigating directly
 * to `/capture`.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-capture-workspace.js";
import { setCapturePendingSession } from "./capture-pending-session.js";

const meta: Meta = {
  title: "Capture / Workspace",
  render: (_args) => {
    const wrapper = document.createElement("div");
    wrapper.style.cssText =
      "width:100%;height:600px;background:var(--bg-canvas, #1e1e1e);position:relative;";
    const el = document.createElement("annot-capture-workspace");
    el.addEventListener("workspace-exit", () => console.log("[story] workspace-exit"));
    el.addEventListener("capture-once", (e) => {
      console.log("[story] capture-once", (e as CustomEvent).detail);
    });
    wrapper.appendChild(el);
    return wrapper;
  },
};
export default meta;

type Story = StoryObj;

/** Direct-navigation case — no pending session was set, so the
 *  workspace renders the "Open New > Capture Screen... to start"
 *  hint. */
export const NoPending: Story = {};

/** A pending session is set BEFORE the element mounts so the
 *  workspace tries to start a real `MediaStream`. In Storybook
 *  this typically falls through to the "cancelled" state because
 *  `getDisplayMedia` either isn't available or the user dismisses
 *  the picker — reviewers can verify the chrome / header layout
 *  in either case. */
export const WithPendingOnce: Story = {
  render: () => {
    setCapturePendingSession({
      mode: "once",
      cursor: "always",
      folderPath: "Screenshots/Demo",
    });
    const wrapper = document.createElement("div");
    wrapper.style.cssText =
      "width:100%;height:600px;background:var(--bg-canvas, #1e1e1e);position:relative;";
    const el = document.createElement("annot-capture-workspace");
    el.addEventListener("workspace-exit", () => console.log("[story] workspace-exit"));
    el.addEventListener("capture-once", (e) => {
      console.log("[story] capture-once", (e as CustomEvent).detail);
    });
    wrapper.appendChild(el);
    return wrapper;
  },
};
