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
import type { ImageRecord } from "@ingcreators/annot-core/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserStore } from "../storage/browser-store.js";
import { FileManager } from "./file-manager.js";

// 1×1 transparent PNG — minimal valid data URL the storage
// contract accepts. The size doesn't matter; we only need
// `saveImage` / `listImages` to round-trip.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Build the full `Omit<ImageRecord, "path">` shape `saveImage`
 *  expects — most fields are uninteresting for this test, but
 *  the type is strict so we fill them with sensible empties. */
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
    const path = await store.saveImage(makeRecord("fixture.png", ""));
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
    await store.saveImage(makeRecord("deep.png", "Sub"));

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
