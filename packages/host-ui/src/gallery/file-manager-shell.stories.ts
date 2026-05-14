/**
 * Stories for `<annot-file-manager-shell>` — the gallery's
 * main-content chrome (breadcrumb + refresh + view-mode toggle
 * + selection bar + footer count). The grid itself is left
 * empty; the gallery host's stories cover that layer.
 *
 * Phase 2 of `docs/plans/litelement-stories-coverage.md`.
 *
 * The element uses `display: contents` so the wrapper here
 * mirrors the host `#main-content` flex column that lays out
 * [header] [selection-bar] [body] [footer] as direct flex
 * children.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./file-manager-shell.js";
import type {
  BreadcrumbEntry,
  FileManagerShellCallbacks,
  SelectionInfo,
} from "./file-manager-shell.js";

interface Args {
  breadcrumbs: BreadcrumbEntry[];
  viewMode: "grid" | "list";
  countText: string;
  selection: SelectionInfo | null;
  canCreateCardDocument: boolean;
  canDownloadSelection: boolean;
}

function makeCallbacks(): FileManagerShellCallbacks {
  return {
    onNavigate: (path) => console.log("[story] onNavigate", path),
    onRefresh: () => console.log("[story] onRefresh"),
    onSetViewMode: (mode) => console.log("[story] onSetViewMode", mode),
    onClearSelection: () => console.log("[story] onClearSelection"),
    onDeleteSelection: () => console.log("[story] onDeleteSelection"),
    onCreateCardDocument: () => console.log("[story] onCreateCardDocument"),
    onDownloadSelection: () => console.log("[story] onDownloadSelection"),
  };
}

const meta: Meta<Args> = {
  title: "Gallery / FileManagerShell",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.id = "main-content";
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.height = "560px";
    wrapper.style.background = "var(--bg-canvas, #1e1e1e)";
    wrapper.style.border = "1px solid var(--annot-border-color, #2a2a3a)";
    const el = document.createElement("annot-file-manager-shell");
    el.breadcrumbs = args.breadcrumbs;
    el.viewMode = args.viewMode;
    el.countText = args.countText;
    el.selection = args.selection;
    el.canCreateCardDocument = args.canCreateCardDocument;
    el.canDownloadSelection = args.canDownloadSelection;
    el.callbacks = makeCallbacks();
    wrapper.appendChild(el);
    return wrapper;
  },
  argTypes: {
    breadcrumbs: { control: "object" },
    viewMode: { control: "radio", options: ["grid", "list"] },
    countText: { control: "text" },
    selection: { control: "object" },
    canCreateCardDocument: { control: "boolean" },
    canDownloadSelection: { control: "boolean" },
  },
  args: {
    breadcrumbs: [{ label: "Browser", path: "", active: true }],
    viewMode: "grid",
    countText: "12 images",
    selection: null,
    canCreateCardDocument: true,
    canDownloadSelection: true,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const RootGrid: Story = {
  args: {
    breadcrumbs: [{ label: "Browser", path: "", active: true }],
    viewMode: "grid",
    countText: "12 images",
    selection: null,
  },
};

export const NestedFolderList: Story = {
  args: {
    breadcrumbs: [
      { label: "Browser", path: "", active: false },
      { label: "Screenshots", path: "Screenshots", active: false },
      { label: "Mobile", path: "Screenshots/Mobile", active: true },
    ],
    viewMode: "list",
    countText: "5 / 24 images",
    selection: null,
  },
};

export const SelectionBarVisible: Story = {
  args: {
    breadcrumbs: [{ label: "Browser", path: "", active: true }],
    viewMode: "grid",
    countText: "24 images",
    selection: { folders: 1, images: 3, documents: 0 },
  },
};

export const SelectionFoldersOnly: Story = {
  args: {
    selection: { folders: 2, images: 0, documents: 0 },
  },
};

export const SelectionImagesOnly: Story = {
  args: {
    selection: { folders: 0, images: 5, documents: 0 },
  },
};

export const SelectionDocumentsOnly: Story = {
  args: {
    selection: { folders: 0, images: 0, documents: 2 },
  },
};

export const SelectionMixed: Story = {
  args: {
    selection: { folders: 0, images: 3, documents: 2 },
  },
};

export const SelectionImagesWithCreateCardButton: Story = {
  args: {
    selection: { folders: 0, images: 4, documents: 0 },
    canCreateCardDocument: true,
  },
};

export const SelectionWithoutCreateCardButton: Story = {
  args: {
    selection: { folders: 0, images: 4, documents: 0 },
    canCreateCardDocument: false,
  },
};

export const SelectionWithDownloadButton: Story = {
  args: {
    selection: { folders: 0, images: 3, documents: 2 },
    canDownloadSelection: true,
  },
};

export const SelectionWithoutDownloadButton: Story = {
  args: {
    selection: { folders: 0, images: 3, documents: 2 },
    canDownloadSelection: false,
  },
};

export const SelectionFoldersOnlyHidesDownload: Story = {
  args: {
    selection: { folders: 2, images: 0, documents: 0 },
    canDownloadSelection: true,
  },
};

export const Empty: Story = {
  args: {
    breadcrumbs: [{ label: "Browser", path: "", active: true }],
    viewMode: "grid",
    countText: "0 images",
    selection: null,
  },
};
