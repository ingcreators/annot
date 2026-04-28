/**
 * Stories for `<annot-editor-header>` — the editor's top bar
 * (brand → breadcrumb → filename → save-status → file actions).
 * Phase 2 of `docs/plans/litelement-stories-coverage.md`.
 *
 * The element uses `display: contents` so the wrapper here
 * mirrors the host `#editor-header` flex row that lays out the
 * grandchildren as direct flex items. Without that wrapper the
 * brand / breadcrumb / actions cluster would stack vertically
 * inside an unintended block.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./editor-header.js";
import type { EditorHeaderCallbacks } from "./editor-header.js";

interface Args {
  rootLabel: string;
  crumbs: { label: string; path: string }[];
  filename: string;
  fullPath: string;
  showOpenFile: boolean;
}

function makeCallbacks(): EditorHeaderCallbacks {
  return {
    onNavigateToFolder: (path) => console.log("[story] onNavigateToFolder", path),
    onToggleInfo: () => console.log("[story] onToggleInfo"),
    onRename: async (next) => {
      console.log("[story] onRename", next);
    },
    onCopy: () => console.log("[story] onCopy"),
    onSave: () => console.log("[story] onSave"),
    onSaveMenu: (anchor) => console.log("[story] onSaveMenu", anchor.tagName),
  };
}

const meta: Meta<Args> = {
  title: "Editor / EditorHeader",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.id = "editor-header";
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.gap = "8px";
    wrapper.style.padding = "0 16px";
    wrapper.style.height = "48px";
    wrapper.style.background = "var(--annot-bg-panel, #1e1e2e)";
    wrapper.style.borderBottom = "1px solid var(--annot-border-color, #2a2a3a)";
    const el = document.createElement("annot-editor-header");
    el.rootLabel = args.rootLabel;
    el.crumbs = args.crumbs;
    el.filename = args.filename;
    el.fullPath = args.fullPath;
    const callbacks = makeCallbacks();
    if (args.showOpenFile) callbacks.onOpenFile = () => console.log("[story] onOpenFile");
    el.callbacks = callbacks;
    wrapper.appendChild(el);
    return wrapper;
  },
  argTypes: {
    rootLabel: { control: "text" },
    crumbs: { control: "object" },
    filename: { control: "text" },
    fullPath: { control: "text" },
    showOpenFile: { control: "boolean" },
  },
  args: {
    rootLabel: "Browser",
    crumbs: [
      { label: "Screenshots", path: "Screenshots" },
      { label: "Mobile", path: "Screenshots/Mobile" },
    ],
    filename: "screenshot-2026-04-25.png",
    fullPath: "Screenshots/Mobile/screenshot-2026-04-25.png",
    showOpenFile: false,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const WithFile: Story = {};

export const RootFolderNoFile: Story = {
  args: {
    crumbs: [],
    filename: "",
    fullPath: "",
  },
};

export const NestedNoFile: Story = {
  args: {
    crumbs: [
      { label: "Screenshots", path: "Screenshots" },
      { label: "Mobile", path: "Screenshots/Mobile" },
    ],
    filename: "",
    fullPath: "",
  },
};

export const TauriHostWithOpenFile: Story = {
  args: {
    showOpenFile: true,
  },
};

export const GitHubBackend: Story = {
  args: {
    rootLabel: "GitHub",
    crumbs: [
      { label: "ingcreators/annot", path: "ingcreators/annot" },
      { label: "docs", path: "ingcreators/annot/docs" },
    ],
    filename: "diagram.png",
    fullPath: "ingcreators/annot/docs/diagram.png",
  },
};
