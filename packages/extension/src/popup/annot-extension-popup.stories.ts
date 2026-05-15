/**
 * Stories for `<annot-extension-popup>` — the Chrome extension's
 * toolbar popup. Phase 1 of
 * `docs/plans/browser-extension-web-optimized-pudding.md`.
 *
 * The component is purely presentational + emits `popup-message`,
 * `settings-changed`, and `open-options` events for its host (the
 * real `popup.ts` wires these to `chrome.runtime.sendMessage` /
 * `chrome.storage.sync` / `chrome.runtime.openOptionsPage`). The
 * stories below pass a `Settings` value, mount the element inside
 * a 360px-wide host (matching the production popup), and log every
 * event for arg-flow tracing.
 *
 * The popup's stylesheet (`packages/extension/src/styles/popup.css`)
 * is imported as a side-effect so the rendered Storybook frame
 * matches what the chrome popup shows.
 */

import { DEFAULT_SETTINGS, type Settings } from "@ingcreators/annot-capture/shared";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "../styles/popup.css";
import "./annot-extension-popup.js";
import type { AnnotExtensionPopupElement, PopupView } from "./annot-extension-popup.js";

interface Args {
  settings: Settings;
  view: PopupView;
  hotkeyCount: number;
  quickOptionsOpen: boolean;
}

function renderPopup(args: Args): HTMLElement {
  // The production popup uses `body { width: 360px; background:
  // #0f1730 }` (see popup.css). Mirror those in the story wrapper
  // so Storybook reflects the Chrome popup pixel-for-pixel.
  const wrapper = document.createElement("div");
  wrapper.style.cssText = `
    width: 360px;
    background: #0f1730;
    color: #eef2ff;
    border-radius: 8px;
  `;
  const el = document.createElement("annot-extension-popup") as AnnotExtensionPopupElement;
  el.settings = args.settings;
  el.view = args.view;
  el.hotkeyCount = args.hotkeyCount;
  el.quickOptionsOpen = args.quickOptionsOpen;
  el.addEventListener("popup-message", (e) => {
    // Arg-flow trace — intentional `console.log`.
    console.log("[story] popup-message", (e as CustomEvent).detail);
  });
  el.addEventListener("popup-settings-changed", (e) => {
    console.log("[story] settings-changed", (e as CustomEvent).detail);
  });
  el.addEventListener("open-options", () => {
    console.log("[story] open-options");
  });
  wrapper.appendChild(el);
  return wrapper;
}

const meta: Meta<Args> = {
  title: "Extension / Popup",
  render: renderPopup,
  argTypes: {
    settings: { control: "object" },
    view: { control: "select", options: ["idle", "hotkeyActive"] },
    hotkeyCount: { control: "number" },
    quickOptionsOpen: { control: "boolean" },
  },
  args: {
    settings: DEFAULT_SETTINGS,
    view: "idle",
    hotkeyCount: 0,
    quickOptionsOpen: false,
  },
};
export default meta;

type Story = StoryObj<Args>;

/** Default idle popup with Quick Options collapsed. The most common
 *  state — what users see every time they click the toolbar icon. */
export const Idle: Story = {};

/** Idle popup with Quick Options expanded so all five selects
 *  (Format / Save size / Emulation / Hide overlays / Whole Page
 *  output) are visible. Useful for verifying the panel's layout
 *  + select widths under 360px. */
export const IdleWithQuickOptionsOpen: Story = {
  args: {
    quickOptionsOpen: true,
  },
};

/** The popup view after Hotkey Capture has been started. Frame
 *  count is a live property pushed from the service worker via the
 *  status message — the story pins it at 7 to show how it reads at
 *  a non-zero value. */
export const HotkeyActive: Story = {
  args: {
    view: "hotkeyActive",
    hotkeyCount: 7,
  },
};
