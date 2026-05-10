/**
 * Stories for `<annot-doc-header>` — the document-mode top bar
 * (Phase 1 of `docs/plans/annot-html-document-ux-polish.md`).
 *
 * The element is a self-contained header strip with inline
 * styles; the story wrapper just sizes a containing div so the
 * Storybook viewport mirrors the production mount under
 * `#annot-doc-host`.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-doc-header.js";
import type {
  AnnotDocHeaderElement,
  DocHeaderCallbacks,
  DocHeaderMode,
  DocHeaderOverflowItem,
} from "./annot-doc-header.js";

interface Args {
  documentTitle: string;
  mode: DocHeaderMode;
  canUndo: boolean;
  canRedo: boolean;
  showBack: boolean;
  showSaveStatus: boolean;
  showModeToggle: boolean;
  saveStatus: "saved" | "pending" | "saving" | "error";
  overflowItems: DocHeaderOverflowItem[];
}

function makeCallbacks(): DocHeaderCallbacks {
  return {
    onBack: () => console.log("[story] onBack"),
    onUndo: () => console.log("[story] onUndo"),
    onRedo: () => console.log("[story] onRedo"),
    onInsertImage: () => console.log("[story] onInsertImage"),
    onModeChange: (next) => console.log("[story] onModeChange", next),
    onTitleCommit: (next) => console.log("[story] onTitleCommit", next),
    onOverflowSelect: (action) => console.log("[story] onOverflowSelect", action),
  };
}

const meta: Meta<Args> = {
  title: "Editor / DocHeader",
  render: (args) => {
    // The wrapper mimics the PWA's `#annot-doc-host` flex column —
    // the header is one row, the body fills the rest. Storybook
    // canvas is full-width by default, which matches the
    // production layout above the doc-shell.
    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.height = "120px";
    wrapper.style.background = "var(--annot-doc-bg, #ffffff)";

    const el = document.createElement("annot-doc-header") as AnnotDocHeaderElement;
    el.documentTitle = args.documentTitle;
    el.mode = args.mode;
    el.canUndo = args.canUndo;
    el.canRedo = args.canRedo;
    el.showBack = args.showBack;
    el.showSaveStatus = args.showSaveStatus;
    el.showModeToggle = args.showModeToggle;
    el.overflowItems = args.overflowItems;
    el.callbacks = makeCallbacks();
    wrapper.appendChild(el);

    // Drive the save-status indicator after first render — the
    // child element only exists once the header has rendered.
    queueMicrotask(() => {
      const indicator = el.getSaveStatusIndicator();
      if (indicator) indicator.status = args.saveStatus;
    });

    return wrapper;
  },
  argTypes: {
    documentTitle: { control: "text" },
    mode: { control: { type: "select" }, options: ["view", "edit"] },
    canUndo: { control: "boolean" },
    canRedo: { control: "boolean" },
    showBack: { control: "boolean" },
    showSaveStatus: { control: "boolean" },
    showModeToggle: { control: "boolean" },
    saveStatus: {
      control: { type: "select" },
      options: ["saved", "pending", "saving", "error"],
    },
    overflowItems: { control: "object" },
  },
  args: {
    documentTitle: "Onboarding manual",
    mode: "edit",
    canUndo: true,
    canRedo: false,
    showBack: true,
    showSaveStatus: true,
    showModeToggle: true,
    saveStatus: "saved",
    overflowItems: [
      { id: "exportPptx", label: "Export to PowerPoint…" },
      { id: "saveAsTemplate", label: "Save as template…" },
    ],
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {};

export const ViewMode: Story = {
  args: {
    mode: "view",
    canUndo: false,
    canRedo: false,
  },
};

export const Saving: Story = {
  args: {
    saveStatus: "saving",
  },
};

export const SaveError: Story = {
  args: {
    saveStatus: "error",
  },
};

export const ExportDisabled: Story = {
  args: {
    overflowItems: [
      { id: "exportPptx", label: "Export to PowerPoint…", disabled: true },
      { id: "saveAsTemplate", label: "Save as template…" },
    ],
  },
};

export const NewDocumentNothingToUndo: Story = {
  args: {
    documentTitle: "Untitled",
    canUndo: false,
    canRedo: false,
    saveStatus: "pending",
  },
};

export const VSCodeHost: Story = {
  args: {
    showBack: false,
    showSaveStatus: false,
    documentTitle: "release-notes.annot.html",
  },
};
