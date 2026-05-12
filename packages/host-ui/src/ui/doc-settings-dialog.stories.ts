/**
 * Stories for `showDocSettingsDialog` — used as a visual
 * regression net for the dialog's overall shape. The dialog
 * is built imperatively rather than as a LitElement so we
 * mount it by calling the show-function and renders it
 * in-place; the story's `render` returns a wrapper div that
 * triggers the dialog on first paint.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { showDocSettingsDialog } from "./doc-settings-dialog.js";
import "./annot-dialog.js";

interface Args {
  defaultAppearanceTemplate?: string;
  defaultAppearanceCustomCss?: string;
}

const meta: Meta<Args> = {
  title: "Doc / DialogSettings",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "height:100vh;background:#1f2937;padding:24px;";
    const trigger = document.createElement("button");
    trigger.textContent = "Open Doc Settings dialog";
    trigger.style.cssText =
      "padding:10px 16px;border-radius:4px;background:#2563eb;color:white;border:none;cursor:pointer;font-size:14px;";
    trigger.addEventListener("click", async () => {
      const result = await showDocSettingsDialog({
        defaultTitle: "Sample card document",
        defaultLang: "en",
        defaultAuthor: "Ada Lovelace",
        defaultTheme: "auto",
        defaultMaxWidth: "medium",
        defaultCardColumns: 1,
        defaultCardStepLayout: "image-bottom",
        defaultHeaderDescription: "",
        defaultHeaderIcon: "",
        defaultNumberingSteps: true,
        defaultNumberingStepLabel: undefined,
        defaultAppearanceTemplate: args.defaultAppearanceTemplate,
        defaultAppearanceFontFamilySans: undefined,
        defaultAppearanceFontFamilySerif: undefined,
        defaultAppearanceFontFamilyMono: undefined,
        defaultAppearanceCustomCss: args.defaultAppearanceCustomCss,
      });
      console.log("[story] result:", result);
    });
    wrapper.appendChild(trigger);
    // Open the dialog automatically so the story renders the
    // intended state without a click.
    requestAnimationFrame(() => trigger.click());
    return wrapper;
  },
};

export default meta;
type Story = StoryObj<Args>;

export const Default: Story = {
  args: {},
};

export const WithAppearanceTemplate: Story = {
  args: {
    defaultAppearanceTemplate: "editorial",
  },
};

export const WithCustomCss: Story = {
  args: {
    defaultAppearanceCustomCss: "body { background: pink; }\n/* user CSS */",
  },
};
