/**
 * Stories for `<annot-gallery-page>` — the file-manager's main
 * grid pane (folders + images, multi-select, context menus).
 *
 * Phase 4 of `docs/plans/lit-migration-completion.md` introduced
 * the Lit element. The wrapper applies the `.gallery-panel` /
 * `.file-manager-grid-host` styling so the chrome (section
 * headers, card layout, list-view density) renders the same way
 * users see it inside the file manager.
 */

import type { FolderRecord, ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-gallery-page.js";

interface Args {
  imageCount: number;
  folderCount: number;
  viewMode: "grid" | "list";
  query: string;
}

const PLACEHOLDER_THUMB =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100">' +
      '<rect width="160" height="100" fill="#16213e"/>' +
      '<rect x="6" y="6" width="148" height="88" fill="none" stroke="#7aa2ff" stroke-width="3"/>' +
      "</svg>",
  );

function makeStorage(images: ImageRecord[], folders: FolderRecord[]): StorageProvider {
  return {
    async listImages(folderPath: string) {
      return images.filter((i) => i.folderPath === folderPath);
    },
    async listFolders() {
      return folders;
    },
    async getBreadcrumb() {
      return [];
    },
  } as unknown as StorageProvider;
}

function buildFixture(args: Args): { storage: StorageProvider } {
  const images: ImageRecord[] = [];
  for (let i = 0; i < args.imageCount; i++) {
    images.push({
      path: `screenshot-${String(i + 1).padStart(2, "0")}.png`,
      folderPath: "",
      originalDataUrl: "",
      thumbnailDataUrl: PLACEHOLDER_THUMB,
      annotationsSvg: "",
      width: 1024,
      height: 768,
      sourceUrl: i === 0 ? "https://example.com/article" : "",
      tags: i === 0 ? { author: "alice" } : {},
      createdAt: "2026-04-25T10:00:00Z",
      updatedAt: "2026-04-25T10:00:00Z",
    });
  }
  const folders: FolderRecord[] = [];
  for (let i = 0; i < args.folderCount; i++) {
    folders.push({
      path: `Folder ${i + 1}`,
      name: `Folder ${i + 1}`,
      parentPath: "",
      createdAt: "2026-04-25T00:00:00Z",
    } as FolderRecord);
  }
  return { storage: makeStorage(images, folders) };
}

const meta: Meta<Args> = {
  title: "Gallery / GalleryPage",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.className = "file-manager-grid-host";
    wrapper.style.height = "560px";
    wrapper.style.background = "var(--bg-canvas, #1e1e1e)";
    const el = document.createElement("annot-gallery-page");
    const { storage } = buildFixture(args);
    el.storage = storage;
    el.viewMode = args.viewMode;
    if (args.query) el.query = args.query;
    // Storybook arg-flow trace — intentional `console.log`.
    el.addEventListener("annot-gallery-open-image", (e) => {
      console.log("[story] open image", e.detail.record.path);
    });
    el.addEventListener("annot-gallery-folder-change", (e) => {
      console.log("[story] folder change", e.detail.folderPath);
    });
    wrapper.appendChild(el);
    queueMicrotask(() => void el.refresh());
    return wrapper;
  },
  argTypes: {
    imageCount: { control: { type: "number", min: 0, max: 24 } },
    folderCount: { control: { type: "number", min: 0, max: 8 } },
    viewMode: { control: "radio", options: ["grid", "list"] },
    query: { control: "text" },
  },
  args: {
    imageCount: 6,
    folderCount: 2,
    viewMode: "grid",
    query: "",
  },
};
export default meta;

type Story = StoryObj<Args>;

export const GridWithFoldersAndImages: Story = {
  args: { imageCount: 6, folderCount: 2, viewMode: "grid", query: "" },
};

export const ListWithFoldersAndImages: Story = {
  args: { imageCount: 6, folderCount: 2, viewMode: "list", query: "" },
};

export const Empty: Story = {
  args: { imageCount: 0, folderCount: 0, viewMode: "grid", query: "" },
};

export const SearchFiltered: Story = {
  args: { imageCount: 6, folderCount: 2, viewMode: "grid", query: "screenshot-01" },
};
