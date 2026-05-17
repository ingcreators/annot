/**
 * Capture host — owns the "get a new image into the app" flows:
 * screenshot capture, interval capture, clipboard paste, file upload.
 *
 * Extracted from `app.ts` as part of the Phase 1 decomposition
 * (see `docs/plans/_done/app-decomposition.md`). After a successful save the
 * host invokes the `openEditor` callback rather than reaching into
 * `AnnotApp` state directly — that indirection is what lets Phase 2's
 * `EditorSession` extraction land without touching this file again.
 *
 * Storage is taken as a getter so a mode-switch during capture routes
 * the save to the newly-selected backend.
 */

import type { StorageProvider } from "@ingcreators/annot-core/storage";
import { readEditableImage } from "@ingcreators/annot-core/xmp";
import type { FileManager } from "@ingcreators/annot-host-ui/gallery/file-manager";
import {
  type ImportFileResult,
  importFiles as importFilesBatch,
} from "@ingcreators/annot-host-ui/gallery/import-files";
import { generateThumbnailFromDataUrl } from "@ingcreators/annot-host-ui/image-thumbnail";
import type { ThumbnailManager } from "@ingcreators/annot-host-ui/thumbnail-manager";
import { setCapturePendingSession } from "../capture/capture-pending-session.js";
import {
  type CursorMode,
  saveCursorPreference,
  saveModePreference,
} from "../capture/capture-prefs.js";
import { showCaptureScreenDialog } from "../capture/capture-screen-dialog.js";
import { CaptureSession } from "../capture/capture-session.js";
import { pasteFromClipboard } from "../capture/pwa-capture.js";
import { loadEncodeOptions } from "../encode-options.js";
import { captureUrl, pushRoute } from "../router.js";
import { hideError, showError, showSaveError } from "../ui/error-bar.js";
import { encodeCaptureInWorker } from "../workers/encode-client.js";
import { fileToDataUrl, loadImage } from "./image-utils.js";

export interface OpenEditorArgs {
  path: string;
  dataUrl: string;
  width: number;
  height: number;
  tags: Record<string, string>;
  annotations?: string;
  filename?: string;
}

export interface CaptureHostDeps {
  getStorage(): StorageProvider | null;
  getCurrentFolderPath(): string;
  getFileManager(): FileManager | null;
  /** Unified thumbnail cache. Capture flows seed it via
   *  `tm.write(provider, path, dataUrl, dims)` after `saveImage`
   *  resolves so the gallery card has a thumbnail before any
   *  background prefetch round-trip. Null in tests / hosts that
   *  haven't booted the manager. */
  getThumbnailManager(): ThumbnailManager | null;
  /** Invoked after a successful save to switch the app into the editor
   *  view for the new image. The callback owns `setCurrentImagePath`,
   *  `setupEditor`, and the URL push. */
  openEditor(args: OpenEditorArgs): void;
  /** Phase 2 of `docs/plans/web-capture-redesign.md`. Invoked after
   *  the dialog confirm + `pushRoute("/capture")` to mount the
   *  workspace. The host owns the actual element creation +
   *  surface teardown — the capture host just signals "now". */
  openCaptureWorkspace(): void;
}

export class CaptureHost {
  constructor(private readonly deps: CaptureHostDeps) {}

  /**
   * Opens the `Capture Screen...` mode-picker dialog and routes
   * the user per the chosen mode:
   *
   *   - `auto`: push to `/capture` so the workspace's live preview
   *     + Auto Capture engine handle the session.
   *   - `once`: skip the workspace entirely — single-shot capture
   *     against a hidden `<video>` + immediate save + open editor,
   *     matching the legacy `Capture Screen` menu behaviour the
   *     dialog's "Capture Once" mode preserves. The post-rollout
   *     workspace's `+ Add Capture` button covers "stay in
   *     workspace, manually grab additional frames" — a different
   *     flow from "I want one shot then start annotating".
   *
   * The dialog's Start button click is the user gesture
   * `getDisplayMedia` needs in both cases.
   */
  async captureScreenDialogAndSave(): Promise<void> {
    const result = await showCaptureScreenDialog();
    if (!result) return;
    saveModePreference(result.mode);
    saveCursorPreference(result.cursor);

    if (result.mode === "once") {
      await this.#captureOnceAndOpenEditor(result.cursor);
      return;
    }

    setCapturePendingSession({
      mode: result.mode,
      cursor: result.cursor,
      folderPath: this.deps.getCurrentFolderPath(),
    });
    pushRoute(captureUrl());
    // Surface the workspace via the routing pathway so plugin
    // route-change listeners + browser history all participate.
    this.deps.openCaptureWorkspace();
  }

  /**
   * Capture-Once flow: one frame from `getDisplayMedia`, smart-
   * encoded, saved to the active storage, opened in the editor.
   * Stops the stream as soon as the frame is grabbed — the
   * browser's "this tab is being shared" bar disappears within
   * one tick.
   */
  async #captureOnceAndOpenEditor(cursor: CursorMode): Promise<void> {
    // Detached `<video>` — never appended to the DOM. The
    // `CaptureSession` only needs `videoWidth` / `videoHeight`
    // + `drawImage` to grab the frame; rendering it on screen
    // would just briefly flash the shared content during the
    // ~200ms post-paint wait.
    const video = document.createElement("video");
    const session = new CaptureSession({ video, cursor });
    const ok = await session.start();
    if (!ok) return; // user cancelled the screen-share picker
    let dataUrl: string;
    try {
      dataUrl = session.captureFrame().dataUrl;
    } finally {
      session.stop();
    }
    try {
      await this.#saveEncodedAndOpenEditor(dataUrl);
    } catch (err) {
      showSaveError(`Couldn't save capture: ${(err as Error).message}`);
    }
  }

  async pasteAndSave(): Promise<void> {
    const dataUrl = await pasteFromClipboard();
    if (!dataUrl) {
      showSaveError("No image found in clipboard.");
      return;
    }
    await this.saveDataUrlAndOpen(dataUrl);
  }

  openFileDialog(): void {
    const input = document.createElement("input");
    input.type = "file";
    // Includes `.annot.html` so the user can re-import documents
    // they previously exported, plus the same image set as before.
    // Multi-file selection routes through `importFiles` — same code
    // path as drag-drop.
    input.accept = ".jpg,.jpeg,.png,.svg,.html,.annot.html";
    input.multiple = true;
    input.addEventListener("change", async () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) return;
      await this.importFiles(files);
    });
    input.click();
  }

  /**
   * Batch import — used by both the sidebar picker and the file
   * manager's drag-drop overlay. Saves every file to the active
   * storage under the current folder, surfaces progress + an
   * end-of-batch summary via the error bar, and refreshes the file
   * manager so the new files appear in the gallery. The editor is
   * NOT opened — even a single-file import keeps the user on the
   * file manager.
   */
  async importFiles(files: File[]): Promise<void> {
    const storage = this.deps.getStorage();
    if (!storage) return;
    if (files.length === 0) return;

    const folderPath = this.deps.getCurrentFolderPath();
    const tm = this.deps.getThumbnailManager() ?? undefined;
    const total = files.length;
    showError({
      severity: "info",
      message: total === 1 ? "Importing 1 file…" : `Importing 0 / ${total}…`,
      autoDismiss: 0,
    });

    let results: ImportFileResult[];
    try {
      results = await importFilesBatch(files, {
        storage,
        folderPath,
        thumbnailManager: tm ?? null,
        onProgress: (done) => {
          if (total === 1) return;
          showError({
            severity: "info",
            message: `Importing ${done} / ${total}…`,
            autoDismiss: 0,
          });
        },
      });
    } catch (err) {
      // The helper itself is "never throws" by contract; this branch
      // only fires if something happens before the per-file loop
      // starts. Surface the error and bail.
      showSaveError(`Couldn't import files: ${(err as Error).message}`);
      return;
    }

    hideError();
    await this.deps.getFileManager()?.refresh(folderPath);

    // End-of-batch summary. Quiet on full success — the user sees the
    // new files appear in the gallery. Warn / error on partial /
    // total failure.
    const ok = results.filter((r) => r.path).length;
    const skipped = results.filter((r) => r.kind === "skipped").length;
    const failed = results.filter((r) => r.error).length;

    if (failed > 0 && ok === 0) {
      const firstError = results.find((r) => r.error);
      const msg = firstError?.error
        ? `Couldn't import any files. ${(firstError.error as Error).message}`
        : "Couldn't import any files.";
      showSaveError(msg);
    } else if (failed > 0 || skipped > 0) {
      const parts: string[] = [`Imported ${ok} file${ok === 1 ? "" : "s"}.`];
      if (skipped > 0) parts.push(`${skipped} skipped (unsupported type).`);
      if (failed > 0) parts.push(`${failed} failed.`);
      showError({
        severity: "warning",
        message: parts.join(" "),
        autoDismiss: 5000,
      });
    }
  }

  /**
   * Single-file import that opens the editor on success. Kept for
   * the legacy paste-from-clipboard flow and any external callers
   * that still want the "import then start annotating" UX. The
   * sidebar picker no longer uses this — it routes through
   * `importFiles`.
   */
  async openFile(file: File): Promise<void> {
    const storage = this.deps.getStorage();
    if (!storage) return;
    const dataUrl = await fileToDataUrl(file);
    const img = await loadImage(dataUrl);

    const arrayBuf = await file.arrayBuffer();
    const meta = readEditableImage(new Uint8Array(arrayBuf));

    let originalUrl = dataUrl;
    let annotations = "";
    let tags: Record<string, string> = {};
    let w = img.naturalWidth;
    let h = img.naturalHeight;

    if (meta?.annotationsSvg) {
      originalUrl = meta.originalImageDataUrl || dataUrl;
      annotations = meta.annotationsSvg;
      tags = meta.tags || {};
      w = meta.width || w;
      h = meta.height || h;
    }

    const thumbnailDataUrl = await generateThumbnailFromDataUrl(originalUrl);
    const now = new Date().toISOString();
    const path = await storage.saveImage(
      {
        originalDataUrl: originalUrl,
        thumbnailDataUrl,
        annotationsSvg: annotations,
        width: w,
        height: h,
        sourceUrl: "",
        tags,
        folderPath: this.deps.getCurrentFolderPath(),
        createdAt: now,
        updatedAt: now,
      },
      { filename: file.name || undefined },
    );
    await this.deps.getThumbnailManager()?.write(storage, path, thumbnailDataUrl, {
      width: w,
      height: h,
    });

    this.deps.openEditor({
      path,
      dataUrl: originalUrl,
      width: w,
      height: h,
      tags,
      annotations: annotations || undefined,
      filename: file.name || undefined,
    });
  }

  async saveDataUrlAndOpen(dataUrl: string): Promise<void> {
    const storage = this.deps.getStorage();
    if (!storage) return;
    const img = await loadImage(dataUrl);
    const thumbnailDataUrl = await generateThumbnailFromDataUrl(dataUrl);
    const now = new Date().toISOString();
    const path = await storage.saveImage({
      originalDataUrl: dataUrl,
      thumbnailDataUrl,
      annotationsSvg: "",
      width: img.naturalWidth,
      height: img.naturalHeight,
      sourceUrl: "",
      tags: {},
      folderPath: this.deps.getCurrentFolderPath(),
      createdAt: now,
      updatedAt: now,
    });
    await this.deps.getThumbnailManager()?.write(storage, path, thumbnailDataUrl, {
      width: img.naturalWidth,
      height: img.naturalHeight,
    });

    this.deps.openEditor({
      path,
      dataUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
      tags: {},
    });
  }

  /**
   * Save without opening the editor — used by the /capture
   * workspace for both Auto Capture-detected frames AND the
   * manual "Add Capture" button.
   *
   * Routes the captured PNG-24 through `encodeCaptureInWorker`
   * (the shared `encodeCapture` smart pipeline running in a Web
   * Worker so libimagequant + DEFLATE-9 don't freeze the UI) so
   * the saved bytes use PNG-8 for UI-heavy frames and fall back
   * to PNG-24 / JPEG for photo-heavy ones — identical behaviour
   * to the Chrome Extension's capture pipeline. The user-tunable
   * `EncodeOptions` are loaded from `loadEncodeOptions()` so the
   * same Settings UI that drives the extension's capture quality
   * also drives /capture.
   *
   * Returns the saved path + the generated thumbnail + the
   * source dimensions so callers can populate their session list
   * without re-decoding the image or hitting storage again.
   * `null` when no storage backend is active.
   */
  async saveDataUrlSilently(
    dataUrl: string,
    tags: Record<string, string> = {},
  ): Promise<{
    path: string;
    thumbnailDataUrl: string;
    width: number;
    height: number;
  } | null> {
    const storage = this.deps.getStorage();
    if (!storage) return null;
    // Smart-encode the captured PNG-24 before persisting. The
    // worker-backed `encodeCaptureInWorker` falls back to a
    // main-thread `encodeCapture` automatically when workers
    // aren't available (restrictive CSP, Storybook fixtures,
    // etc.). On unexpected errors we keep the raw PNG-24 — saving
    // *something* beats losing the user's capture to an
    // encode failure.
    let finalDataUrl = dataUrl;
    let encodeReason: string | undefined;
    try {
      const result = await encodeCaptureInWorker(dataUrl, loadEncodeOptions());
      finalDataUrl = result.dataUrl;
      encodeReason = result.reason;
    } catch (e) {
      console.warn("[capture-host] smart encode failed, keeping raw PNG-24:", e);
    }
    const img = await loadImage(finalDataUrl);
    const thumbnailDataUrl = await generateThumbnailFromDataUrl(finalDataUrl);
    const now = new Date().toISOString();
    const folderPath = this.deps.getCurrentFolderPath();
    const path = await storage.saveImage({
      originalDataUrl: finalDataUrl,
      thumbnailDataUrl,
      annotationsSvg: "",
      width: img.naturalWidth,
      height: img.naturalHeight,
      sourceUrl: "",
      tags: { ...tags, ...(encodeReason ? { encodeReason } : {}) },
      folderPath,
      createdAt: now,
      updatedAt: now,
    });
    await this.deps.getThumbnailManager()?.write(storage, path, thumbnailDataUrl, {
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
    // Refresh the file manager in the background so when the user
    // exits the workspace the gallery is already up-to-date.
    void this.deps.getFileManager()?.refresh(folderPath);
    return {
      path,
      thumbnailDataUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  }

  /**
   * Smart-encode + save + open editor. Mirrors `saveDataUrlSilently`
   * (worker-backed `encodeCaptureInWorker`, smart PNG-8 / JPEG
   * routing, encode-reason tag, file-manager refresh) plus the
   * editor hand-off. Used by the Capture Once dialog flow — the
   * `saveDataUrlAndOpen` path stays JPEG-direct for the
   * paste-from-clipboard case where the bytes are usually
   * already-compressed and a re-encode round-trip isn't worth
   * the latency.
   */
  async #saveEncodedAndOpenEditor(dataUrl: string): Promise<void> {
    const storage = this.deps.getStorage();
    if (!storage) return;
    let finalDataUrl = dataUrl;
    let encodeReason: string | undefined;
    try {
      const result = await encodeCaptureInWorker(dataUrl, loadEncodeOptions());
      finalDataUrl = result.dataUrl;
      encodeReason = result.reason;
    } catch (e) {
      console.warn("[capture-host] smart encode failed, keeping raw PNG-24:", e);
    }
    const img = await loadImage(finalDataUrl);
    const thumbnailDataUrl = await generateThumbnailFromDataUrl(finalDataUrl);
    const now = new Date().toISOString();
    const folderPath = this.deps.getCurrentFolderPath();
    const tags: Record<string, string> = encodeReason ? { encodeReason } : {};
    const path = await storage.saveImage({
      originalDataUrl: finalDataUrl,
      thumbnailDataUrl,
      annotationsSvg: "",
      width: img.naturalWidth,
      height: img.naturalHeight,
      sourceUrl: "",
      tags,
      folderPath,
      createdAt: now,
      updatedAt: now,
    });
    await this.deps.getThumbnailManager()?.write(storage, path, thumbnailDataUrl, {
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
    this.deps.openEditor({
      path,
      dataUrl: finalDataUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
      tags,
    });
  }

  /** Delete a saved capture from storage. Used by the /capture
   *  workspace's Delete button — the user removes session
   *  captures that didn't pan out. */
  async deleteCapture(path: string): Promise<void> {
    const storage = this.deps.getStorage();
    if (!storage) return;
    try {
      await storage.deleteImage(path);
      // Refresh the file manager so the deletion is reflected in
      // the gallery if the user exits straight after.
      void this.deps.getFileManager()?.refresh(this.deps.getCurrentFolderPath());
    } catch (err) {
      console.error("[capture-host] deleteCapture failed:", err);
    }
  }
}
