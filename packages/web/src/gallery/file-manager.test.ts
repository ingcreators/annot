/**
 * @vitest-environment happy-dom
 *
 * `FileManager` racing-path regression test.
 *
 * Phase 3's Lit migration of the file-manager shell turned
 * `#rebuildGallery()` async — it now awaits
 * `<annot-file-manager-shell>`'s `updateComplete` before reading
 * the grid host. Pre-fix, callers of `setStorage()` followed
 * immediately by `refresh("")` (the `handleStorageSelect` path
 * in `app.ts`) raced the rebuild: by the time `refresh()`
 * checked `if (this.#gallery)`, the rebuild was still pending
 * and the field was null, so the post-switch storage's files
 * never rendered.
 *
 * The fix captures the rebuild promise in `#galleryReady` and
 * has `refresh()` / `navigateToFolder()` await it before reading
 * `#gallery`. This test asserts the post-fix behaviour: a
 * fixture image saved into BrowserStore is visible in the
 * gallery after `setStorage` + `refresh("")`.
 */

import { IDBFactory } from "fake-indexeddb";
import type {
  FolderRecord,
  ImageRecord,
  ImageRecordUpdate,
  StorageProvider,
} from "@ingcreators/annot-core/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserStore } from "../storage/browser-store.js";
import { FileManager } from "./file-manager.js";

/** Minimal in-memory `StorageProvider` for tests that need a
 *  storage backend distinct from `BrowserStore` — the gallery's
 *  bug surface depends on the storage REFERENCE held by the
 *  active GalleryPage, so reusing two `BrowserStore` instances
 *  against a swapped IDB factory produces a false-positive
 *  "test passes" since both stores ultimately read the same
 *  factory at the time of `listImages`. */
class MemoryStore implements StorageProvider {
  #images = new Map<string, ImageRecord>();
  constructor(seed: ImageRecord[] = []) {
    for (const img of seed) this.#images.set(img.path, img);
  }
  saveImage(_record: Omit<ImageRecord, "path">, _opts?: { filename?: string }): Promise<string> {
    throw new Error("not implemented");
  }
  async getImage(path: string): Promise<ImageRecord | undefined> {
    return this.#images.get(path);
  }
  async listImages(folderPath: string): Promise<ImageRecord[]> {
    return Array.from(this.#images.values()).filter((i) => i.folderPath === folderPath);
  }
  updateImage(_path: string, _updates: ImageRecordUpdate): Promise<void> {
    throw new Error("not implemented");
  }
  moveImage(): Promise<string> {
    throw new Error("not implemented");
  }
  renameImage(): Promise<string> {
    throw new Error("not implemented");
  }
  deleteImage(): Promise<void> {
    throw new Error("not implemented");
  }
  createFolder(): Promise<string> {
    throw new Error("not implemented");
  }
  async listFolders(): Promise<FolderRecord[]> {
    return [];
  }
  getFolder(): Promise<FolderRecord | undefined> {
    return Promise.resolve(undefined);
  }
  renameFolder(): Promise<string> {
    throw new Error("not implemented");
  }
  moveFolder(): Promise<string> {
    throw new Error("not implemented");
  }
  deleteFolder(): Promise<void> {
    throw new Error("not implemented");
  }
  async getBreadcrumb(): Promise<FolderRecord[]> {
    return [];
  }
  generateThumbnail(_dataUrl: string): Promise<string> {
    throw new Error("not implemented");
  }
}

// 1×1 transparent PNG — minimal valid data URL the storage
// contract accepts. The size doesn't matter; we only need
// `saveImage` / `listImages` to round-trip.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Build the full `Omit<ImageRecord, "path">` shape `saveImage`
 *  expects — most fields are uninteresting for this test, but
 *  the type is strict so we fill them with sensible empties. */
/** Save a {@link makeRecord} payload through `StorageProvider.saveImage`'s
 *  `(record, opts?)` shape — splits the inline `filename` off the
 *  record before passing them to the store. */
async function saveTestRecord(
  store: import("@ingcreators/annot-core/storage").StorageProvider,
  payload: ReturnType<typeof makeRecord>,
): Promise<string> {
  const { filename, ...record } = payload;
  return store.saveImage(record, { filename });
}

function makeRecord(
  filename: string,
  folderPath: string,
): Omit<import("@ingcreators/annot-core/storage").ImageRecord, "path"> & {
  filename: string;
} {
  const now = new Date().toISOString();
  return {
    filename,
    folderPath,
    originalDataUrl: TINY_PNG,
    thumbnailDataUrl: TINY_PNG,
    annotationsSvg: "",
    width: 1,
    height: 1,
    sourceUrl: "",
    tags: {},
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  // Fresh in-memory IDB per test so BrowserStore starts clean.
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  // Clean up any sidebar / file-manager-shell custom elements
  // appended to body so the next test starts with a quiet DOM.
  document.body.innerHTML = "";
});

describe("FileManager — storage-switch racing path", () => {
  it("renders the new storage's files after setStorage() + refresh('') (Lit-shell readiness await)", async () => {
    // Seed BrowserStore with a single image. The test asserts
    // that the FileManager's gallery surfaces this image after
    // a setStorage → refresh sequence — the exact path the
    // production `handleStorageSelect` follows.
    const store = new BrowserStore();
    const path = await saveTestRecord(store, makeRecord("fixture.png", ""));
    expect(path).toBe("fixture.png");

    const sidebarHost = document.createElement("div");
    const mainHost = document.createElement("div");
    document.body.append(sidebarHost, mainHost);

    const fm = new FileManager(sidebarHost, mainHost, {
      onStorageSelect: async () => {},
      onStorageReselect: async () => {},
      onOpenImage: () => {},
      onFolderChange: () => {},
      onNewFolder: async () => {},
      onUploadImage: () => {},
      onCaptureScreen: async () => {},
      onTimedCapture: async () => {},
      onPasteClipboard: async () => {},
    });

    fm.setStorage(store, "browser");
    // Pre-fix this `refresh("")` would short-circuit because
    // the gallery rebuild was still pending and `#gallery`
    // was null. Post-fix it awaits `#galleryReady` first.
    await fm.refresh("");

    const items = mainHost.querySelectorAll<HTMLElement>(".gallery-item");
    const paths = Array.from(items).map((el) => el.dataset["imagePath"]);
    expect(paths).toEqual(["fixture.png"]);
  });

  it("switches storages mid-session and shows the new storage's files (Browser \u2192 second backend)", async () => {
    // Repro for the user-reported bug: after Browser \u2192 Device
    // switch, the new storage's files don't appear. The second
    // store here uses `BrowserStore` against a fresh IDBFactory
    // to act as a stand-in "different storage backend" — the
    // FileManager doesn't care which store class it gets, only
    // that `setStorage` swaps it cleanly + the post-switch
    // refresh lists the new store's files.
    const browserStore = new BrowserStore();
    await saveTestRecord(browserStore, makeRecord("from-browser.png", ""));

    const sidebarHost = document.createElement("div");
    const mainHost = document.createElement("div");
    document.body.append(sidebarHost, mainHost);

    const fm = new FileManager(sidebarHost, mainHost, {
      onStorageSelect: async () => {},
      onStorageReselect: async () => {},
      onOpenImage: () => {},
      onFolderChange: () => {},
      onNewFolder: async () => {},
      onUploadImage: () => {},
      onCaptureScreen: async () => {},
      onTimedCapture: async () => {},
      onPasteClipboard: async () => {},
    });

    fm.setStorage(browserStore, "browser");
    await fm.refresh("");

    // Sanity: Browser's file lands first.
    expect(
      Array.from(mainHost.querySelectorAll<HTMLElement>(".gallery-item")).map(
        (el) => el.dataset["imagePath"],
      ),
    ).toEqual(["from-browser.png"]);

    // Now swap to a DIFFERENT storage backend (not BrowserStore)
    // with a different fixture and re-run the production
    // "setStorage + refresh('')" sequence.
    //
    // Pre-fix bug: `GalleryPage`'s constructor wrote
    // `container.className = "gallery-panel"`, which clobbered
    // the `.file-manager-grid-host` class on the Lit shell's
    // grid host. The shell's class-based `getGridHost()` lookup
    // then returned null on the second mount, `#rebuildGallery`
    // returned early, and the gallery kept rendering the OLD
    // storage's items.
    const now = new Date().toISOString();
    const secondStore = new MemoryStore([
      {
        path: "from-second.png",
        folderPath: "",
        originalDataUrl: TINY_PNG,
        thumbnailDataUrl: TINY_PNG,
        annotationsSvg: "",
        width: 1,
        height: 1,
        sourceUrl: "",
        tags: {},
        createdAt: now,
        updatedAt: now,
      },
    ]);

    fm.setStorage(secondStore, "device");
    await fm.refresh("");

    const after = Array.from(
      mainHost.querySelectorAll<HTMLElement>(".gallery-item"),
    ).map((el) => el.dataset["imagePath"]);
    expect(after).toEqual(["from-second.png"]);
  });

  it("navigateToFolder() called immediately after setStorage() finds the new storage's nested files", async () => {
    // Guard-rail integration test: the production
    // `navigateToFolder` flow happens to dodge the racing bug
    // because `await this.#refreshBreadcrumbs()` yields to the
    // microtask queue, by which point the rebuild has settled.
    // Still worth covering — if a future refactor inlines the
    // breadcrumb fetch synchronously, this test catches the
    // regression.
    const store = new BrowserStore();
    await store.createFolder("", "Sub");
    await saveTestRecord(store, makeRecord("deep.png", "Sub"));

    const sidebarHost = document.createElement("div");
    const mainHost = document.createElement("div");
    document.body.append(sidebarHost, mainHost);

    const fm = new FileManager(sidebarHost, mainHost, {
      onStorageSelect: async () => {},
      onStorageReselect: async () => {},
      onOpenImage: () => {},
      onFolderChange: () => {},
      onNewFolder: async () => {},
      onUploadImage: () => {},
      onCaptureScreen: async () => {},
      onTimedCapture: async () => {},
      onPasteClipboard: async () => {},
    });

    fm.setStorage(store, "browser");
    await fm.navigateToFolder("Sub");

    const items = mainHost.querySelectorAll<HTMLElement>(".gallery-item");
    const paths = Array.from(items).map((el) => el.dataset["imagePath"]);
    // The image lives at `Sub/deep.png`; navigation should
    // reveal it without losing it to the racing rebuild.
    expect(paths).toContain("Sub/deep.png" satisfies ImageRecord["path"]);
  });
});
