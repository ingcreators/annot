/**
 * @vitest-environment happy-dom
 *
 * `RouterHost` doc-route dispatch — Phase 6b of
 * `docs/plans/annot-html-document.md`. Focused on the new
 * `/doc/<store>/<path>` branch in `handleRoute`; the existing
 * gallery / edit / handoff branches keep their end-to-end
 * coverage in `app.test.ts` (not duplicated here).
 */

import type {
  DocumentRecord,
  StorageProvider,
  StorageWithDocuments,
} from "@ingcreators/annot-core/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  showError: vi.fn(),
  showInfo: vi.fn(),
}));
vi.mock("../ui/error-bar.js", () => ({
  showError: mocks.showError,
  showInfo: mocks.showInfo,
}));

import { RouterHost, type RouterHostDeps } from "./router-host.js";

function setHref(href: string): void {
  window.history.replaceState({}, "", href);
}

function makeDocStore(record?: DocumentRecord): StorageProvider & StorageWithDocuments {
  const stub = {
    saveImage: async () => "",
    getImage: async () => undefined,
    listImages: async () => [],
    updateImage: async () => {},
    moveImage: async () => "",
    renameImage: async () => "",
    deleteImage: async () => {},
    createFolder: async () => "",
    listFolders: async () => [],
    getFolder: async () => undefined,
    renameFolder: async () => "",
    moveFolder: async () => "",
    deleteFolder: async () => {},
    getBreadcrumb: async () => [],
    saveDocument: async () => "",
    getDocument: vi.fn(async () => record),
    listDocuments: async () => [],
    updateDocument: async () => {},
  };
  return stub as unknown as StorageProvider & StorageWithDocuments;
}

function makeImageOnlyStore(): StorageProvider {
  return {
    saveImage: async () => "",
    getImage: async () => undefined,
    listImages: async () => [],
    updateImage: async () => {},
    moveImage: async () => "",
    renameImage: async () => "",
    deleteImage: async () => {},
    createFolder: async () => "",
    listFolders: async () => [],
    getFolder: async () => undefined,
    renameFolder: async () => "",
    moveFolder: async () => "",
    deleteFolder: async () => {},
    getBreadcrumb: async () => [],
  } as unknown as StorageProvider;
}

function makeDeps(storage: StorageProvider | null, overrides: Partial<RouterHostDeps> = {}) {
  const openDocFromGallery = vi.fn(async (_record: DocumentRecord) => {});
  const showGalleryView = vi.fn();
  const deps: RouterHostDeps = {
    getStorage: () => storage,
    getCurrentFolderPath: () => "",
    setFileManager: () => {},
    showGalleryView,
    handleStorageSelect: async () => {},
    transferAllFromExtension: async () => {},
    transferAndOpen: async () => {},
    openFromGallery: async () => {},
    setupSplitEditor: async () => {},
    openDocFromGallery,
    notifyRouteChange: () => {},
    ...overrides,
  };
  return { deps, openDocFromGallery, showGalleryView };
}

const SAMPLE_DOC: DocumentRecord = {
  path: "Manuals/onboarding.annot.html",
  folderPath: "Manuals",
  bytes: "<!doctype html>",
  thumbnailDataUrl: "",
  title: "Onboarding",
  imageCount: 0,
  blockCount: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  setHref("/");
  mocks.showError.mockReset();
  mocks.showInfo.mockReset();
});

afterEach(() => {
  setHref("/");
});

describe("RouterHost: /doc dispatch", () => {
  it("loads the document via storage + invokes openDocFromGallery", async () => {
    const storage = makeDocStore(SAMPLE_DOC);
    const { deps, openDocFromGallery, showGalleryView } = makeDeps(storage);
    const host = new RouterHost(deps);

    setHref("/doc/browser/Manuals/onboarding.annot.html");
    await host.handleRoute();

    expect(storage.getDocument).toHaveBeenCalledWith("Manuals/onboarding.annot.html");
    expect(openDocFromGallery).toHaveBeenCalledTimes(1);
    expect(openDocFromGallery).toHaveBeenCalledWith(SAMPLE_DOC);
    expect(showGalleryView).not.toHaveBeenCalled();
  });

  it("falls back to gallery + showError when the document is missing", async () => {
    const storage = makeDocStore(undefined);
    const { deps, openDocFromGallery, showGalleryView } = makeDeps(storage);
    const host = new RouterHost(deps);

    setHref("/doc/browser/Missing.annot.html");
    await host.handleRoute();

    expect(openDocFromGallery).not.toHaveBeenCalled();
    expect(showGalleryView).toHaveBeenCalled();
    expect(mocks.showError).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "warning",
        message: expect.stringContaining("not found"),
      }),
    );
  });

  it("falls back to gallery + warns when storage doesn't support documents", async () => {
    const storage = makeImageOnlyStore();
    const { deps, openDocFromGallery, showGalleryView } = makeDeps(storage);
    const host = new RouterHost(deps);

    setHref("/doc/browser/x.annot.html");
    await host.handleRoute();

    expect(openDocFromGallery).not.toHaveBeenCalled();
    expect(showGalleryView).toHaveBeenCalled();
    expect(mocks.showError).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "warning",
        message: expect.stringContaining("documents"),
      }),
    );
  });

  it("handles getDocument errors via showError + falls back to gallery", async () => {
    const storage = makeDocStore(undefined);
    (storage.getDocument as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    const { deps, openDocFromGallery, showGalleryView } = makeDeps(storage);
    const host = new RouterHost(deps);

    setHref("/doc/browser/x.annot.html");
    await host.handleRoute();

    expect(openDocFromGallery).not.toHaveBeenCalled();
    expect(showGalleryView).toHaveBeenCalled();
    expect(mocks.showError).toHaveBeenCalledWith(expect.objectContaining({ severity: "error" }));
  });
});
