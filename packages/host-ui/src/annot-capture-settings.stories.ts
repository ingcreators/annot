/**
 * Stories for `<annot-capture-settings>` — the capture-mode
 * settings form. Phase 6 of `docs/plans/desktop-browser-mode.md`.
 *
 * The component is purely presentational: the host supplies an
 * initial `Settings` value (and optionally an `AutoCaptureOptions`
 * blob when `showAutoCapture` is on) and listens for the
 * matching change events. Stories below cover the default shape,
 * a few format / emulation variants, and the
 * Auto-Capture-section-on extension variant.
 */

import { DEFAULT_SETTINGS, type Settings } from "@ingcreators/annot-capture/shared";
import {
  type AutoCaptureOptions,
  DEFAULT_AUTO_CAPTURE_OPTIONS,
} from "@ingcreators/annot-core/auto-capture-options";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-capture-settings.js";
import type {
  AutoCaptureOptionsChangeDetail,
  CaptureSettingsChangeDetail,
} from "./annot-capture-settings.js";

interface Args {
  settings: Settings;
  autoCaptureOptions: AutoCaptureOptions;
  showAutoCapture: boolean;
}

const meta: Meta<Args> = {
  title: "Capture / CaptureSettings",
  render: (args) => {
    // Wrap in a fixed-width container so Storybook reflects how
    // the form looks in a desktop modal (560 px is the design
    // target: comfortable for the longest label without becoming
    // a wall of text).
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `
      max-width: 560px;
      padding: 18px;
      background: #0b1020;
      border-radius: 8px;
    `;
    const settings = document.createElement("annot-capture-settings");
    settings.settings = args.settings;
    settings.autoCaptureOptions = args.autoCaptureOptions;
    settings.showAutoCapture = args.showAutoCapture;
    settings.addEventListener("settings-changed", (e) => {
      const detail = (e as CustomEvent<CaptureSettingsChangeDetail>).detail;
      // Storybook arg-flow trace — intentional `console.log`.
      console.log("[story] settings-changed", detail.settings);
    });
    settings.addEventListener("auto-capture-options-changed", (e) => {
      const detail = (e as CustomEvent<AutoCaptureOptionsChangeDetail>).detail;
      console.log("[story] auto-capture-options-changed", detail.options);
    });
    wrapper.appendChild(settings);
    return wrapper;
  },
  argTypes: {
    settings: { control: "object" },
    autoCaptureOptions: { control: "object" },
    showAutoCapture: { control: "boolean" },
  },
  args: {
    settings: DEFAULT_SETTINGS,
    autoCaptureOptions: DEFAULT_AUTO_CAPTURE_OPTIONS,
    showAutoCapture: false,
  },
};
export default meta;

type Story = StoryObj<Args>;

/** Default shape — Auto Capture section hidden (default host
 *  context: desktop Browse window). */
export const Default: Story = {};

/** Extension variant — the Auto Capture section is visible. This
 *  mirrors the Chrome extension's options page. */
export const ExtensionWithAutoCapture: Story = {
  args: {
    showAutoCapture: true,
  },
};

/** Plain-PNG mode — the smart-fallback / threshold sub-fields are
 *  hidden because they only apply to "smart" mode. */
export const PngFormat: Story = {
  args: {
    settings: {
      ...DEFAULT_SETTINGS,
      quality: {
        ...DEFAULT_SETTINGS.quality,
        format: "png",
      },
    },
  },
};

/** Emulation enabled with the FullHD preset — the dropdown sits at
 *  "Full HD" and no custom-size fields appear. */
export const EmulationEnabled: Story = {
  args: {
    settings: {
      ...DEFAULT_SETTINGS,
      emulation: {
        ...DEFAULT_SETTINGS.emulation,
        enabled: true,
        preset: "fullhd",
      },
    },
  },
};

/** Custom emulation size — the width / height inputs appear. */
export const CustomEmulationSize: Story = {
  args: {
    settings: {
      ...DEFAULT_SETTINGS,
      emulation: {
        ...DEFAULT_SETTINGS.emulation,
        enabled: true,
        preset: "custom",
        customWidth: 1366,
        customHeight: 768,
      },
    },
  },
};
