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
import { newIdB58 } from "@ingcreators/annot-core/utils";
import { readEditableImage } from "@ingcreators/annot-core/xmp";
import type { FileManager } from "@ingcreators/annot-host-ui/gallery/file-manager";
import { generateThumbnailFromDataUrl } from "@ingcreators/annot-host-ui/image-thumbnail";
import type { ThumbnailManager } from "@ingcreators/annot-host-ui/thumbnail-manager";
import { setCapturePendingSession } from "../capture/capture-pending-session.js";
import { saveCursorPreference, saveModePreference } from "../capture/capture-prefs.js";
import { showCaptureScreenDialog } from "../capture/capture-screen-dialog.js";
import {
  loadCursorPreference,
  showIntervalCaptureDialog,
  showIntervalCaptureProgress,
} from "../capture/interval-dialog.js";
import { captureScreen, pasteFromClipboard, startIntervalCapture } from "../capture/pwa-capture.js";
import { captureUrl, pushRoute } from "../router.js";
import { showSaveError } from "../ui/error-bar.js";
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

  async captureScreenAndSave(): Promise<void> {
    // Use last-chosen cursor preference; defaults to "always".
    const dataUrl = await captureScreen(loadCursorPreference());
    if (!dataUrl) return;
    await this.saveDataUrlAndOpen(dataUrl);
  }

  /**
   * Phase 2 of `docs/plans/web-capture-redesign.md` — opens the new
   * `Capture Screen...` mode-picker dialog and routes the user
   * into `/capture` so the workspace handles the live preview +
   * Capture Once / (future) Auto Capture loop.
   *
   * The dialog's Start button click IS the user gesture
   * `getDisplayMedia` needs — the workspace mounts immediately and
   * the API is callable before the gesture window expires.
   *
   * Phase 1 captured inline before the workspace existed; Phase 2
   * removes that path so the workspace is the single source of
   * truth for live capture. Capture Once still saves directly via
   * the workspace's `capture-once` event handler in `app.ts`.
   */
  async captureScreenDialogAndSave(): Promise<void> {
    const result = await showCaptureScreenDialog();
    if (!result) return;
    saveModePreference(result.mode);
    saveCursorPreference(result.cursor);
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

  async timedCaptureAndSave(): Promise<void> {
    const storage = this.deps.getStorage();
    if (!storage) return;
    const cfg = await showIntervalCaptureDialog();
    if (!cfg) return;
    // Remember the cursor choice for next captures (single + timed)
    saveCursorPreference(cfg.cursor);

    const progress = showIntervalCaptureProgress(cfg.count);
    const folderPath = this.deps.getCurrentFolderPath();
    const sessionId = newIdB58();
    const total = cfg.count;
    let savedFrames = 0;

    const handle = await startIntervalCapture({
      intervalSec: cfg.intervalSec,
      count: cfg.count,
      cursor: cfg.cursor,
      onProgress: (captured, total) => progress.update(captured, total),
      onError: (err) => console.error("[timed-capture] frame error:", err),
      onFrame: async (dataUrl, index) => {
        try {
          const img = await loadImage(dataUrl);
          const thumbnailDataUrl = await generateThumbnailFromDataUrl(dataUrl);
          const now = new Date().toISOString();
          const sec = String(index + 1).padStart(3, "0");
          const savedPath = await storage.saveImage(
            {
              originalDataUrl: dataUrl,
              thumbnailDataUrl,
              annotationsSvg: "",
              width: img.naturalWidth,
              height: img.naturalHeight,
              sourceUrl: "",
              tags: {
                timed: "1",
                seq: sec,
                captureId: newIdB58(),
                session: sessionId,
                sessionKind: "interval",
                sessionIndex: String(index),
                sessionTotal: String(total),
              },
              folderPath,
              createdAt: now,
              updatedAt: now,
            },
            { filename: `capture-${now.replace(/[:.]/g, "-")}-${sec}.jpg` },
          );
          // Seed the unified thumbnail cache so the gallery card
          // renders immediately without a prefetch round-trip.
          // No-op for stores that don't participate.
          await this.deps.getThumbnailManager()?.write(storage, savedPath, thumbnailDataUrl, {
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
          savedFrames++;
        } catch (e) {
          console.error("[timed-capture] save error:", e);
        }
      },
    });

    if (!handle) {
      progress.complete();
      return;
    }

    progress.setOnCancel(() => handle.cancel());

    await handle.done;
    progress.complete();

    // Return focus to this tab (which initiated the capture).
    // Chrome may require a recent user gesture; try multiple paths.
    try {
      window.focus();
      // If the tab is hidden, try flashing title to draw attention as a fallback.
      if (document.visibilityState !== "visible") {
        const originalTitle = document.title;
        document.title = `✔ Capture complete — ${originalTitle}`;
        const restore = () => {
          document.title = originalTitle;
          document.removeEventListener("visibilitychange", restore);
        };
        document.addEventListener("visibilitychange", restore);
      }
    } catch {
      /* ignore */
    }

    // Interval capture frames are tagged with a session id for future
    // grouping, but we don't auto-open any editor — just refresh the
    // gallery so the new frames are visible.
    await this.deps.getFileManager()?.refresh(folderPath);
    // Silence the unused-var warning for `savedFrames` / `sessionId` while
    // still keeping the ids attached to the stored tags for later features.
    void savedFrames;
    void sessionId;
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
    input.accept = ".jpg,.jpeg,.png,.svg";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (file) await this.openFile(file);
    });
    input.click();
  }

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
   * Phase 3 of `docs/plans/web-capture-redesign.md`. Save without
   * opening the editor — used by candidate Accept (the user is
   * still in the workspace triaging more candidates; opening the
   * editor would tear it down). Tags carry session metadata so
   * Phase 4's Auto Capture sessions remain groupable in the
   * gallery.
   */
  async saveDataUrlSilently(
    dataUrl: string,
    tags: Record<string, string> = {},
  ): Promise<string | null> {
    const storage = this.deps.getStorage();
    if (!storage) return null;
    const img = await loadImage(dataUrl);
    const thumbnailDataUrl = await generateThumbnailFromDataUrl(dataUrl);
    const now = new Date().toISOString();
    const folderPath = this.deps.getCurrentFolderPath();
    const path = await storage.saveImage({
      originalDataUrl: dataUrl,
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
    // Refresh the file manager in the background so when the user
    // exits the workspace the gallery is already up-to-date.
    void this.deps.getFileManager()?.refresh(folderPath);
    return path;
  }
}
