/**
 * Stories for `<annot-capture-settings>` — the capture-mode
 * settings form. Phase 6 of `docs/plans/desktop-browser-mode.md`.
 *
 * The component is purely presentational: the host supplies an
 * initial `Settings` value and listens for `settings-changed`
 * events on every input change. Stories below cover the default
 * shape + a "smart-mode collapsed" variant where the smart-format
 * sub-fields are visible.
 */

import { DEFAULT_SETTINGS, type Settings } from "@ingcreators/annot-capture/shared";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-capture-settings.js";
import type { CaptureSettingsChangeDetail } from "./annot-capture-settings.js";

interface Args {
  settings: Settings;
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
    settings.addEventListener("settings-changed", (e) => {
      const detail = (e as CustomEvent<CaptureSettingsChangeDetail>).detail;
      // Storybook arg-flow trace — intentional `console.log`.
      console.log("[story] settings-changed", detail.settings);
    });
    wrapper.appendChild(settings);
    return wrapper;
  },
  argTypes: {
    settings: { control: "object" },
  },
  args: {
    settings: DEFAULT_SETTINGS,
  },
};
export default meta;

type Story = StoryObj<Args>;

/** Default shape — every section visible, smart-mode sub-fields
 *  showing because `quality.format === "smart"` is the default. */
export const Default: Story = {};

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

/** Emulation enabled — the preset picker + custom-size fields
 *  appear. */
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
