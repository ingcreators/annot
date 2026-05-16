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

import type {
  DocumentRecord,
  FolderRecord,
  ImageRecord,
  StorageProvider,
  StorageWithDocuments,
} from "@ingcreators/annot-core/storage";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-gallery-page.js";

interface Args {
  imageCount: number;
  folderCount: number;
  documentCount: number;
  viewMode: "grid" | "list";
  query: string;
  /** Optional preset list-view sort, applied directly to the
   *  matching `*Sort` property after the element is created.
   *  Stories use this to demonstrate the column-header indicator +
   *  sorted-order behaviour without requiring a manual click. */
  folderSort?: "name-asc" | "name-desc" | "modified-asc" | "modified-desc" | null;
  documentSort?:
    | "name-asc"
    | "name-desc"
    | "modified-asc"
    | "modified-desc"
    | "size-asc"
    | "size-desc"
    | null;
  imageSort?:
    | "name-asc"
    | "name-desc"
    | "modified-asc"
    | "modified-desc"
    | "size-asc"
    | "size-desc"
    | null;
}

function decodeSort(
  s: Args["imageSort"],
): { column: "name" | "modified" | "size"; dir: "asc" | "desc" } | null {
  if (!s) return null;
  const [column, dir] = s.split("-") as ["name" | "modified" | "size", "asc" | "desc"];
  return { column, dir };
}

const PLACEHOLDER_THUMB =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100">' +
      '<rect width="160" height="100" fill="#16213e"/>' +
      '<rect x="6" y="6" width="148" height="88" fill="none" stroke="#7aa2ff" stroke-width="3"/>' +
      "</svg>",
  );

function makeStorage(
  images: ImageRecord[],
  folders: FolderRecord[],
  documents: DocumentRecord[],
): StorageProvider {
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
    async listDocuments(folderPath: string) {
      return documents.filter((d) => d.folderPath === folderPath);
    },
    async getDocument() {
      return undefined;
    },
    async saveDocument() {
      return "";
    },
    async updateDocument() {},
  } as unknown as StorageProvider & StorageWithDocuments;
}

function buildFixture(args: Args): { storage: StorageProvider } {
  const images: ImageRecord[] = [];
  // Vary dimensions + names + timestamps so the sort cycle has
  // visible effect. Names are letter-permuted on purpose: the
  // ascending name order ≠ creation order ≠ size order.
  const imageNames = [
    "zebra-screenshot.png",
    "alpha-mock.png",
    "Mango-demo.png",
    "kappa-capture.png",
    "wave-poster.png",
    "Birch-tree.png",
    "delta-bar.png",
    "Lemon-burst.png",
  ];
  for (let i = 0; i < args.imageCount; i++) {
    const name = imageNames[i % imageNames.length] || `image-${i}.png`;
    images.push({
      path: name,
      folderPath: "",
      originalDataUrl: "",
      thumbnailDataUrl: PLACEHOLDER_THUMB,
      annotationsSvg: "",
      width: 800 + ((i * 73) % 1500),
      height: 600 + ((i * 49) % 900),
      sourceUrl: i === 0 ? "https://example.com/article" : "",
      tags: i === 0 ? { author: "alice" } : {},
      createdAt: `2026-04-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z`,
      updatedAt: `2026-04-${String((i % 28) + 1).padStart(2, "0")}T15:30:00Z`,
    });
  }
  const folderNames = ["Zeppelin", "Atlas", "magnolia", "Bayou", "kestrel"];
  const folders: FolderRecord[] = [];
  for (let i = 0; i < args.folderCount; i++) {
    const name = folderNames[i % folderNames.length] || `Folder ${i + 1}`;
    folders.push({
      path: name,
      name,
      parentPath: "",
      createdAt: `2026-04-${String(((i * 5 + 3) % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    } as FolderRecord);
  }
  const documents: DocumentRecord[] = [];
  const docTitles = ["Onboarding handbook", "Bug triage runbook", "Annual report draft"];
  for (let i = 0; i < args.documentCount; i++) {
    const title = docTitles[i % docTitles.length] || `Card document ${i + 1}`;
    documents.push({
      path: `doc-${i + 1}.annot.html`,
      folderPath: "",
      bytes: "<!doctype html>",
      thumbnailDataUrl: "",
      title,
      imageCount: 1 + ((i * 2) % 8),
      blockCount: 3 + ((i * 7) % 12),
      createdAt: `2026-05-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      updatedAt: `2026-05-${String((i % 28) + 1).padStart(2, "0")}T12:00:00Z`,
    });
  }
  return { storage: makeStorage(images, folders, documents) };
}

const meta: Meta<Args> = {
  title: "Gallery / GalleryPage",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.className = "file-manager-grid-host";
    wrapper.style.height = "560px";
    wrapper.style.background = "var(--bg-canvas, #1e1e1e)";
    // The real file manager nests the gallery inside
    // `.main-content-body` (which carries `overflow-y: auto`).
    // The story wrapper is the visual stand-in for that scroll
    // container, so mirror its overflow rule here — without it
    // the list view's `position: sticky` section bars have no
    // scrolling ancestor to stick to.
    wrapper.style.overflowY = "auto";
    const el = document.createElement("annot-gallery-page");
    const { storage } = buildFixture(args);
    el.storage = storage;
    el.viewMode = args.viewMode;
    if (args.query) el.query = args.query;
    el.folderSort = decodeSort(args.folderSort);
    el.documentSort = decodeSort(args.documentSort);
    el.imageSort = decodeSort(args.imageSort);
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
    documentCount: { control: { type: "number", min: 0, max: 8 } },
    viewMode: { control: "radio", options: ["grid", "list"] },
    query: { control: "text" },
    folderSort: {
      control: "select",
      options: [null, "name-asc", "name-desc", "modified-asc", "modified-desc"],
    },
    documentSort: {
      control: "select",
      options: [
        null,
        "name-asc",
        "name-desc",
        "modified-asc",
        "modified-desc",
        "size-asc",
        "size-desc",
      ],
    },
    imageSort: {
      control: "select",
      options: [
        null,
        "name-asc",
        "name-desc",
        "modified-asc",
        "modified-desc",
        "size-asc",
        "size-desc",
      ],
    },
  },
  args: {
    imageCount: 6,
    folderCount: 2,
    documentCount: 0,
    viewMode: "grid",
    query: "",
    folderSort: null,
    documentSort: null,
    imageSort: null,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const GridWithFoldersAndImages: Story = {
  args: { imageCount: 6, folderCount: 2, documentCount: 0, viewMode: "grid", query: "" },
};

export const ListWithFoldersAndImages: Story = {
  args: { imageCount: 6, folderCount: 2, documentCount: 0, viewMode: "list", query: "" },
};

/** List view exercising every section at once — proves the sticky
 *  section bars hand off correctly as the user scrolls past each
 *  block. Uses the long row counts from `imageNames` to force a
 *  vertical overflow inside the 560px-tall wrapper. */
export const ListMixedAllKinds: Story = {
  args: { imageCount: 8, folderCount: 4, documentCount: 3, viewMode: "list", query: "" },
};

export const ListSortedByNameAsc: Story = {
  args: {
    imageCount: 8,
    folderCount: 4,
    documentCount: 3,
    viewMode: "list",
    query: "",
    folderSort: "name-asc",
    documentSort: "name-asc",
    imageSort: "name-asc",
  },
};

export const ListSortedByModifiedDesc: Story = {
  args: {
    imageCount: 8,
    folderCount: 4,
    documentCount: 3,
    viewMode: "list",
    query: "",
    folderSort: "modified-desc",
    documentSort: "modified-desc",
    imageSort: "modified-desc",
  },
};

/** Demonstrates per-section independent sort: folders by name asc,
 *  images by size desc, documents untouched (storage order). */
export const ListIndependentSectionSort: Story = {
  args: {
    imageCount: 8,
    folderCount: 4,
    documentCount: 3,
    viewMode: "list",
    query: "",
    folderSort: "name-asc",
    documentSort: null,
    imageSort: "size-desc",
  },
};

export const GridWithFoldersDocumentsAndImages: Story = {
  args: { imageCount: 6, folderCount: 1, documentCount: 2, viewMode: "grid", query: "" },
};

export const DocumentsOnly: Story = {
  args: { imageCount: 0, folderCount: 0, documentCount: 3, viewMode: "grid", query: "" },
};

export const Empty: Story = {
  args: { imageCount: 0, folderCount: 0, documentCount: 0, viewMode: "grid", query: "" },
};

export const SearchFiltered: Story = {
  args: {
    imageCount: 6,
    folderCount: 2,
    documentCount: 0,
    viewMode: "grid",
    query: "screenshot-01",
  },
};
