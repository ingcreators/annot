/**
 * Stories for `<annot-sidebar>` — the file-manager's left rail
 * (storage chips + views tabs + folder tree).
 *
 * Bootstrapped in Phase 1 of `docs/plans/_done/storybook-introduction.md`
 * when the sidebar was still imperative; converted to the Lit
 * element in Phase 3 of `docs/plans/_done/lit-migration.md`.
 *
 * Covers each built-in storage mode as the "active" selection
 * plus variants that show / hide plugin chips and sidebar tabs.
 */

import { builtinIcon } from "@ingcreators/annot-core";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import type { SidebarTab, StorageRegistration } from "../app/plugin-host.js";
import type { StorageMode } from "../storage/bridge.js";
import "./sidebar.js";

interface Args {
  activeMode: StorageMode;
  deviceConnected: boolean;
  driveConnected: boolean;
  githubConnected: boolean;
  pluginStorages: StorageRegistration[];
  sidebarTabs: SidebarTab[];
  disabledBuiltins: StorageMode[];
}

function mountSidebar(args: Args): HTMLElement {
  const container = document.createElement("div");
  // The sidebar is laid out by its parent's flex container. Give
  // it a fixed column width + a visible background so the story
  // renders isolated from the rest of the file-manager chrome.
  container.style.display = "flex";
  container.style.width = "260px";
  container.style.height = "600px";
  container.style.background = "var(--bg-sidebar, #2a2a2a)";
  container.style.padding = "8px";
  container.style.flexDirection = "column";

  const sidebar = document.createElement("annot-sidebar");
  // Storybook callback traces — intentional `console.log` so the
  // story actions panel + the dev-tools console both surface the
  // arg flow when reviewers click around the rendered sidebar.
  sidebar.callbacks = {
    onStorageSelect: (m) => console.log("[story] onStorageSelect", m),
    onStorageReselect: (m) => console.log("[story] onStorageReselect", m),
    onFolderSelect: (p) => console.log("[story] onFolderSelect", p),
    onNewFolder: () => console.log("[story] onNewFolder"),
    onUploadImage: () => console.log("[story] onUploadImage"),
    onCaptureScreen: () => console.log("[story] onCaptureScreen"),
    onTimedCapture: () => console.log("[story] onTimedCapture"),
    onPasteClipboard: () => console.log("[story] onPasteClipboard"),
    getPluginStorages: () => args.pluginStorages,
    getSidebarTabs: () => args.sidebarTabs,
    isBuiltinDisabled: (mode) => args.disabledBuiltins.includes(mode as StorageMode),
  };
  sidebar.setActiveMode(args.activeMode);
  if (args.deviceConnected) sidebar.setStorageStatus("device", true, "My Screenshots");
  if (args.driveConnected) sidebar.setStorageStatus("googledrive", true, "Annot Drive");
  if (args.githubConnected) {
    sidebar.setStorageStatus("github", true, "ingcreators/annot@main");
  }
  container.appendChild(sidebar);
  return container;
}

const meta: Meta<Args> = {
  title: "Gallery / Sidebar",
  render: (args) => mountSidebar(args),
  argTypes: {
    activeMode: {
      control: "select",
      options: ["browser", "device", "googledrive", "github"],
    },
    deviceConnected: { control: "boolean" },
    driveConnected: { control: "boolean" },
    githubConnected: { control: "boolean" },
    pluginStorages: { control: false },
    sidebarTabs: { control: false },
    disabledBuiltins: { control: false },
  },
  args: {
    activeMode: "browser",
    deviceConnected: false,
    driveConnected: false,
    githubConnected: false,
    pluginStorages: [],
    sidebarTabs: [],
    disabledBuiltins: [],
  },
};
export default meta;

type Story = StoryObj<Args>;

export const BrowserActive: Story = {
  args: { activeMode: "browser" },
};

export const DeviceConnectedAndActive: Story = {
  args: { activeMode: "device", deviceConnected: true },
};

export const DriveConnectedAndActive: Story = {
  args: { activeMode: "googledrive", driveConnected: true },
};

export const GithubConnectedAndActive: Story = {
  args: { activeMode: "github", githubConnected: true },
};

export const AllConnected: Story = {
  args: {
    activeMode: "googledrive",
    deviceConnected: true,
    driveConnected: true,
    githubConnected: true,
  },
};

export const WithPluginStorage: Story = {
  args: {
    activeMode: "browser",
    pluginStorages: [
      {
        mode: "cloud",
        label: "Annot Cloud",
        icon: builtinIcon("cloud_queue"),
        priority: 25, // lands between Device (20) and Drive (30)
        connect: async () => null,
        restore: () => null,
        status: () => ({ connected: true, label: "My team" }),
      },
    ],
  },
};

export const WithSidebarTabs: Story = {
  args: {
    activeMode: "browser",
    // Storybook arg-flow traces — intentional `console.log`.
    sidebarTabs: [
      {
        id: "recent",
        label: "Recent",
        icon: builtinIcon("history"),
        priority: 10,
        onClick: () => console.log("[story] Recent clicked"),
      },
      {
        id: "team-library",
        label: "Team library",
        icon: builtinIcon("groups"),
        priority: 20,
        isActive: true,
        badge: "12",
        onClick: () => console.log("[story] Team library clicked"),
      },
    ],
  },
};

export const GithubDisabled: Story = {
  name: "Disabled built-in — github",
  args: {
    activeMode: "browser",
    disabledBuiltins: ["github"],
  },
};
