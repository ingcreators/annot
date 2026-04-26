/**
 * Split-editor host — owns the lifecycle of the `SplitEditor` overlay
 * (mounting it over the single-image editor chrome, wiring
 * cancel/apply callbacks) and the `applySlices` persistence flow
 * that replaces a session's frames with a new set of slices.
 *
 * Extracted from `app.ts` as part of the Phase 3.5 follow-up to the
 * Phase 3 decomposition (see `docs/plans/_done/app-decomposition.md`).
 * The plan originally left these in `app.ts`; splitting them out
 * finishes the "app.ts is orchestration only" goal.
 */

import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { getFilename } from "@ingcreators/annot-core/storage";
import { assertNonNull, newIdB58 } from "@ingcreators/annot-core/utils";
import type { SplitEditor, SplitEditorSlice } from "../editor/split-editor.js";
import { loadEncodeOptions } from "../encode-options.js";
import { generateThumbnailFromDataUrl } from "../storage/image-thumbnail.js";
import { showAlertDialog } from "../ui/dialog.js";
import { encodeCaptureInWorker } from "../workers/encode-client.js";
import { bumpFilenameSuffix, retryFsOp } from "./fs-utils.js";

export interface SplitEditorHostDeps {
  getStorage(): StorageProvider | null;
  /** Navigate back to the gallery view owning the session. Called
   *  after a successful apply and on cancel. */
  showGallery(): Promise<void>;
}

export class SplitEditorHost {
  #splitEditor: SplitEditor | null = null;

  constructor(private readonly deps: SplitEditorHostDeps) {}

  /** Tear down the overlay if mounted. Called by `showGalleryView`
   *  during a session → gallery transition so the SplitEditor DOM is
   *  released before the gallery tiles re-render. */
  unmount(): void {
    if (this.#splitEditor) {
      this.#splitEditor.unmount();
      this.#splitEditor = null;
    }
  }

  async setup(records: ImageRecord[]): Promise<void> {
    const storage = this.deps.getStorage();
    if (records.length === 0 || !storage) return;

    // Tear down any previous instance
    this.unmount();

    // `listImages` on FileSystem / Drive / some extension-bridged stores
    // returns lazy records with `originalDataUrl: ""` for performance. The
    // split editor needs the full pixel data, so load each record via
    // `getImage()` which forces the full read.
    const fullRecords: ImageRecord[] = [];
    for (const r of records) {
      if (r.originalDataUrl) {
        fullRecords.push(r);
        continue;
      }
      try {
        const full = await storage.getImage(r.path);
        if (full?.originalDataUrl) {
          fullRecords.push(full);
        } else {
          console.warn("[split-editor] getImage returned no data for:", r.path);
          fullRecords.push(r); // push placeholder so index/count stays stable; mount() will throw with a clear message
        }
      } catch (e) {
        console.error("[split-editor] getImage failed for:", r.path, e);
        fullRecords.push(r);
      }
    }
    records = fullRecords;

    const sessionId = records[0]!.tags?.session || "";

    // Hide the single-image editor chrome so the SplitEditor owns the screen.
    const canvasContainer = assertNonNull(
      document.getElementById("canvas-container"),
      "#canvas-container missing — check index.html shell",
    );
    canvasContainer.style.display = "none";
    const statusbar = assertNonNull(
      document.getElementById("statusbar"),
      "#statusbar missing — check index.html shell",
    );
    statusbar.style.display = "none";
    const fileManagerEl = assertNonNull(
      document.getElementById("file-manager"),
      "#file-manager missing — check index.html shell",
    );
    fileManagerEl.style.display = "none";

    const closeAndGoHome = () => {
      this.unmount();
      canvasContainer.style.display = "";
      statusbar.style.display = "";
      void this.deps.showGallery();
    };

    try {
      const { SplitEditor: SplitEditorCtor } = await import("../editor/split-editor.js");
      this.#splitEditor = new SplitEditorCtor(records, {
        onCancel: () => closeAndGoHome(),
        onApply: async (slices) => {
          try {
            await this.#applySlicesToStorage(records, slices, sessionId);
            // After apply, session content changed — go back to gallery in
            // the folder that owned the session.
            closeAndGoHome();
          } catch (e: unknown) {
            console.error("[split-editor] apply failed:", e);
            await showAlertDialog({
              title: "Couldn't apply splits",
              message:
                (e as { message?: string })?.message ||
                "An error occurred while saving the new slices.",
            });
          }
        },
      });
      await this.#splitEditor.mount();
    } catch (e: unknown) {
      console.error("[split-editor] mount failed:", e);
      await showAlertDialog({
        title: "Couldn't open split editor",
        message: (e as { message?: string })?.message || "Failed to load session frames.",
      });
      closeAndGoHome();
    }
  }

  /**
   * Persist a new list of slices as replacement frames for the given
   * session. All original records are deleted first, then N fresh records
   * are saved. Output count may differ from input count (splits can be
   * added or removed). Preserves session id and sessionKind; assigns fresh
   * captureIds and re-sequences sessionIndex/page/sessionTotal.
   */
  async #applySlicesToStorage(
    records: ImageRecord[],
    slices: SplitEditorSlice[],
    sessionId: string,
  ): Promise<void> {
    const storage = this.deps.getStorage();
    if (!storage) throw new Error("Storage is not available");
    if (slices.length === 0) throw new Error("No slices to save");
    const now = new Date().toISOString();
    const total = slices.length;

    // Derive a stable base filename stem from the first record (strip any
    // trailing "-p<n>" so re-splits don't accumulate suffixes).
    const first = records[0]!;
    const firstName = getFilename(first.path);
    const dot = firstName.lastIndexOf(".");
    let stem = dot >= 0 ? firstName.slice(0, dot) : firstName;
    stem = stem.replace(/-p\d+$/, "");

    // The split editor outputs lossless PNG slices. Run them through the
    // shared encoder so each slice respects the user's format preference
    // (PNG-8 smart fallback by default — same logic as initial captures).
    const encodeOptions = loadEncodeOptions();

    // Inherit shared metadata from the first record
    const inheritedTags = { ...(first.tags || {}) };
    // Drop per-frame keys that we'll re-assign
    delete inheritedTags.captureId;
    delete inheritedTags.page;
    delete inheritedTags.sessionIndex;
    delete inheritedTags.sessionTotal;
    inheritedTags.session = sessionId;

    // Add a `.split-<timestamp>-` prefix to slice filenames so they never
    // collide with the originals we're about to remove. We rename them back
    // (drop the prefix) only AFTER all originals are safely deleted.
    const tempPrefix = `.split-${Date.now()}-`;

    // 1) Save all N new slices first (with disambiguated filenames). This
    //    ensures the user never loses data if a delete fails partway.
    const pad = String(total).length;
    const savedSlicePaths: string[] = [];
    for (let i = 0; i < slices.length; i++) {
      const slice = slices[i]!;
      // Re-encode the slice (PNG → PNG-8 / PNG / JPEG per options).
      const encoded = await encodeCaptureInWorker(slice.dataUrl, encodeOptions);
      const finalDataUrl = encoded.dataUrl;
      const ext = encoded.chosen === "jpeg" ? ".jpg" : ".png";
      const thumb = await generateThumbnailFromDataUrl(finalDataUrl);
      const page = String(i + 1).padStart(pad, "0");
      const tmpFilename = `${tempPrefix}${stem}-p${page}${ext}`;
      const savedPath = await retryFsOp(() =>
        storage.saveImage({
          originalDataUrl: finalDataUrl,
          thumbnailDataUrl: thumb,
          annotationsSvg: "",
          width: slice.width,
          height: slice.height,
          sourceUrl: first.sourceUrl || "",
          tags: {
            ...inheritedTags,
            captureId: newIdB58(),
            page: String(i + 1),
            sessionIndex: String(i),
            sessionTotal: String(total),
          },
          folderPath: first.folderPath,
          filename: tmpFilename,
          createdAt: first.createdAt || now,
          updatedAt: now,
        }),
      );
      savedSlicePaths.push(savedPath);
    }

    // 2) Now that all slices are safely saved, delete every original record.
    for (const rec of records) {
      try {
        await retryFsOp(() => storage.deleteImage(rec.path));
      } catch (e) {
        console.warn("[split-editor] delete failed (continuing):", rec.path, e);
      }
    }

    // 3) Rename slices to drop the temporary prefix so the user sees the
    //    expected names. If a same-named file already exists in the folder
    //    (e.g. orphaned output from a prior split that wasn't cleaned up),
    //    uniquify with " (2)", " (3)" etc. so we never lose the slice.
    for (const tmpPath of savedSlicePaths) {
      const tmpName = getFilename(tmpPath);
      if (!tmpName.startsWith(tempPrefix)) continue;
      const baseFinalName = tmpName.slice(tempPrefix.length);
      let finalName = baseFinalName;
      let success = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          await retryFsOp(() => storage.renameImage(tmpPath, finalName));
          success = true;
          break;
        } catch (e: unknown) {
          const err = e as { message?: string; name?: string };
          const msg = String(err?.message || "");
          if (msg.includes("already exists") || err?.name === "ConstraintError") {
            // Bump the suffix and retry: "name.png" → "name (2).png" → "name (3).png" ...
            finalName = bumpFilenameSuffix(baseFinalName, attempt + 2);
            continue;
          }
          throw e;
        }
      }
      if (!success) {
        console.warn("[split-editor] rename failed after retries (keeping temp name):", tmpPath);
      }
    }
  }
}
