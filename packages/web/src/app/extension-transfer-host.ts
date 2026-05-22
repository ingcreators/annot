/**
 * Extension transfer host — owns the "pull images out of the
 * browser-extension IDB into the user's selected storage" flows.
 *
 * Extracted from `app.ts` as part of the Phase 3.5 follow-up to the
 * Phase 3 decomposition (see `docs/plans/_done/app-decomposition.md`).
 * The plan originally bundled the whole app-level reshape under
 * Phase 3, but `setupSplitEditor` + `transferAllFromExtension` were
 * separately cohesive and deferred to their own PR to keep the
 * Phase 3 diff manageable.
 *
 * Two entry points:
 *   - `transferAll()` — bulk re-home every extension-root image
 *     into the current folder. Invoked from the `extId` URL handoff
 *     path in `RouterHost`.
 *   - `transferAndOpen(record, extPath)` — copy a single record
 *     into the current folder and open it in the editor. Invoked
 *     from the `edit?store=extension` handoff path.
 */

import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { logger } from "../logger.js";
import { editUrl, pushRoute } from "../router.js";
import { deleteExtensionImage, getStorage, getStorageMode } from "../storage/bridge.js";
import type { EditorSession } from "./editor-session.js";
import { retryFsOp } from "./fs-utils.js";
import { loadImage } from "./image-utils.js";

export interface ExtensionTransferHostDeps {
  getStorage(): StorageProvider | null;
  getCurrentFolderPath(): string;
  /** Post-transfer: app-level state for the "currently open" image. */
  setCurrentImagePath(path: string): void;
  setCurrentTags(tags: Record<string, string>): void;
  /** The bulk transfer invalidates the file-manager cache; subsequent
   *  gallery views must rebuild. `null` triggers a fresh mount in
   *  `showGalleryView`. */
  clearFileManager(): void;
  getEditorSession(): EditorSession;
}

export class ExtensionTransferHost {
  constructor(private readonly deps: ExtensionTransferHostDeps) {}

  /**
   * Pull every image out of the extension's root folder and re-home
   * it into the user's currently-selected backend, under the current
   * folder path. Each image is individually retried + logged; one bad
   * image doesn't abort the batch.
   */
  async transferAll(): Promise<void> {
    try {
      const extStorage = await getStorage();
      // Extension root images only — walking all folders would be expensive
      const rootImages = await extStorage.listImages("");
      if (rootImages.length === 0) return;

      logger.debug("[transfer] Found", rootImages.length, "images in Extension IDB root");

      const { BrowserStore } = await import("../storage/browser-store.js");
      // Transfer to the user's currently selected storage
      const targetStore = this.deps.getStorage() || new BrowserStore();
      const folderPath = this.deps.getCurrentFolderPath();

      for (const img of rootImages) {
        try {
          const full = await extStorage.getImage(img.path);
          if (!full?.originalDataUrl) continue;

          let w = full.width;
          let h = full.height;
          if (!w || !h) {
            try {
              const imgEl = await loadImage(full.originalDataUrl);
              w = imgEl.naturalWidth;
              h = imgEl.naturalHeight;
            } catch {
              continue;
            }
          }

          const now = new Date().toISOString();
          // Preserve the extension's filename (not path — we re-home into the
          // user's currently-selected folder).
          const filename = img.path.includes("/")
            ? img.path.slice(img.path.lastIndexOf("/") + 1)
            : img.path;
          // Wrap in retry: rapid back-to-back saves into a fresh FS handle
          // can hit Chrome's "stale cached state" issue (InvalidStateError).
          await retryFsOp(() =>
            targetStore.saveImage(
              {
                originalDataUrl: full.originalDataUrl,
                thumbnailDataUrl: full.thumbnailDataUrl || "",
                annotationsSvg: full.annotationsSvg || "",
                width: w,
                height: h,
                sourceUrl: full.sourceUrl || "",
                tags: full.tags || {},
                folderPath,
                createdAt: full.createdAt || now,
                updatedAt: now,
                // Carry the canonical screen-capture tree through the
                // extension → app hand-off so the Elements sidebar works
                // on captures that came in through this bulk-transfer
                // path (which is how the extension typically hands
                // screenshots over).
                elementTree: full.elementTree,
              },
              { filename },
            ),
          );

          deleteExtensionImage(img.path);
        } catch (e) {
          // Don't abort the whole batch on a single bad image — log and continue.
          logger.error("[transfer] failed for", img.path, "(continuing):", e);
        }
      }

      logger.debug(
        "[transfer] Transferred",
        rootImages.length,
        "images to",
        getStorageMode(),
        "folder:",
        JSON.stringify(folderPath),
      );
    } catch (e) {
      logger.error("[transfer] Error:", e);
    }
  }

  /**
   * Copy a single extension record into the user's current folder
   * and open it in the editor. Used for the `/edit?store=extension`
   * URL variant where a specific file is being handed off.
   */
  async transferAndOpen(record: ImageRecord, extPath: string): Promise<void> {
    // Respect the user's currently selected storage
    const targetStore =
      this.deps.getStorage() || new (await import("../storage/browser-store.js")).BrowserStore();

    let w = record.width;
    let h = record.height;
    if (!w || !h) {
      const img = await loadImage(record.originalDataUrl);
      w = img.naturalWidth;
      h = img.naturalHeight;
    }

    const now = new Date().toISOString();
    const savedPath = await targetStore.saveImage({
      originalDataUrl: record.originalDataUrl,
      thumbnailDataUrl: record.thumbnailDataUrl || "",
      annotationsSvg: record.annotationsSvg || "",
      width: w,
      height: h,
      sourceUrl: record.sourceUrl || "",
      tags: record.tags || {},
      folderPath: this.deps.getCurrentFolderPath(),
      createdAt: now,
      updatedAt: now,
      // Carry the canonical screen-capture tree through the
      // single-record handoff so the Elements right-panel section is
      // restored on reload (the first open works either way because
      // setupEditor receives `record.elementTree` directly below — but
      // reopening from the gallery later goes through `getImage`,
      // which only sees what was actually persisted here).
      elementTree: record.elementTree,
    });

    this.deps.setCurrentImagePath(savedPath);
    this.deps.setCurrentTags(record.tags || {});
    this.deps.clearFileManager();

    pushRoute(editUrl(getStorageMode(), savedPath));

    this.deps
      .getEditorSession()
      .setupEditor(
        record.originalDataUrl,
        w,
        h,
        record.annotationsSvg || undefined,
        record.elementTree,
      );

    deleteExtensionImage(extPath);
  }
}
