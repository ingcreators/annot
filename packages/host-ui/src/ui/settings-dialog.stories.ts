/**
 * Stories for the app-level Settings dialog. Replaces the direct
 * theme-toggle icon — the Theme row lives inside the dialog now,
 * with future settings sections plugging in below it.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";

import { showSettingsDialog } from "./settings-dialog.js";

interface Args {
  defaultTheme: "system" | "light" | "dark";
}

const meta: Meta<Args> = {
  title: "UI / SettingsDialog",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.width = "100%";
    wrapper.style.minHeight = "320px";
    wrapper.style.background = "var(--bg-canvas, #1e1e1e)";
    const opener = document.createElement("button");
    opener.type = "button";
    opener.textContent = "Open Settings";
    opener.style.cssText = "margin:12px;padding:6px 12px;";
    opener.addEventListener("click", async () => {
      const result = await showSettingsDialog({ defaultTheme: args.defaultTheme });
      console.log("[story] settings result", result);
    });
    wrapper.appendChild(opener);
    return wrapper;
  },
  argTypes: {
    defaultTheme: {
      control: "select",
      options: ["system", "light", "dark"],
    },
  },
  args: {
    defaultTheme: "system",
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {};

export const WithExistingLightChoice: Story = {
  args: { defaultTheme: "light" },
};

export const WithExistingDarkChoice: Story = {
  args: { defaultTheme: "dark" },
};
