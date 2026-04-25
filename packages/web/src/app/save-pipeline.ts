/**
 * Save pipeline — owns the annotation-save + thumbnail-regen debounce
 * state machine and the "flush pending work before navigation" protocol.
 *
 * Extracted from `app.ts` as part of the Phase 1 decomposition
 * (see `docs/plans/app-decomposition.md`). `AnnotApp` holds an instance
 * and forwards calls; all save-status state lives here.
 *
 * Storage is taken as a getter rather than a snapshot so a backend
 * mode-switch (device → drive, drive → github) during an edit session
 * routes subsequent saves to the new store without re-wiring.
 */

import { exportAnnotationsSvgForIdb, getPngDataUrl } from "@ingcreators/annot-core";
import type { CanvasManager } from "@ingcreators/annot-core";
import type { StorageProvider } from "@ingcreators/annot-core/storage";
import type { AnnotSaveStatusElement } from "../editor/save-status-indicator.js";
import { hideError, showSaveError } from "../ui/error-bar.js";

export interface SavePipelineDeps {
  getStorage(): StorageProvider | null;
  getCanvas(): CanvasManager | null;
  getCurrentImagePath(): string | null;
  setCurrentImagePath(path: string): void;
  getCurrentTags(): Record<string, string>;
  getStatusIndicator(): AnnotSaveStatusElement | null;
  /** Ask the plugin host if the save should proceed. Rejects if any
   *  `onBeforeSave` listener throws/rejects — the SavePipeline
   *  surfaces that through its normal error-banner path. */
  notifyBeforeSave(path: string, tags: Record<string, string>): Promise<void>;
  /** Notify the plugin host that a save has landed successfully.
   *  Called with the final path (post-uniquify / post-rename) so
   *  plugins read the canonical location. The dep closure is
   *  responsible for reading `getStorageMode()` itself. */
  onAfterSave(path: string): void;
}

export class SavePipeline {
  /** Concurrency gate for `writeAnnotations`. True while an upload is
   *  running; edits that land during that window flip `savePending`
   *  instead of starting a second upload in parallel (slow backends
   *  like Drive otherwise pile up saves and freeze the UI). */
  #saveInFlight = false;
  #savePending = false;
  /** Debounce timer for the annotation autosave. Lifted to an instance
   *  field so `flushPending()` can cancel-and-fire it on navigation
   *  boundaries. */
  #autoSaveTimer: number | undefined;
  /** Same story for the thumbnail regeneration timer. */
  #thumbTimer: number | undefined;

  constructor(private readonly deps: SavePipelineDeps) {}

  /** True if a debounce timer is armed, an upload is running, or a
   *  catch-up save is queued. Used by `beforeunload` to decide whether
   *  to prompt the user. */
  hasPendingWork(): boolean {
    return (
      this.#autoSaveTimer !== undefined ||
      this.#thumbTimer !== undefined ||
      this.#saveInFlight ||
      this.#savePending
    );
  }

  /** Arm the annotation autosave timer. Calling again cancels any
   *  previous timer so a burst of edits coalesces into one save. */
  scheduleAnnotationSave(debounceMs: number): void {
    clearTimeout(this.#autoSaveTimer);
    this.#autoSaveTimer = window.setTimeout(() => {
      this.#autoSaveTimer = undefined;
      void this.writeAnnotations();
    }, debounceMs);
  }

  /** Arm the thumbnail regeneration timer. Same coalescing behaviour. */
  scheduleThumbnailRegen(debounceMs: number): void {
    clearTimeout(this.#thumbTimer);
    this.#thumbTimer = window.setTimeout(() => {
      this.#thumbTimer = undefined;
      void this.writeThumbnail();
    }, debounceMs);
  }

  async writeAnnotations(): Promise<void> {
    const storage = this.deps.getStorage();
    const canvas = this.deps.getCanvas();
    const path = this.deps.getCurrentImagePath();
    if (!canvas || !storage || !path) return;

    // Concurrency gate: if a save is already in flight, just mark
    // that another one is needed once the current one completes.
    // Without this, rapid edits on a slow backend (Drive) kick off
    // overlapping multi-second uploads and freeze the UI.
    if (this.#saveInFlight) {
      this.#savePending = true;
      return;
    }

    this.#saveInFlight = true;
    const annotationsSvg = exportAnnotationsSvgForIdb(canvas);
    const updates = { annotationsSvg, tags: { ...this.deps.getCurrentTags() } };

    // Every save goes through this method, so this is the single place
    // that drives the save-status indicator through its full lifecycle:
    // saving → saved on success, saving → error on failure.
    const statusEl = this.deps.getStatusIndicator();
    if (statusEl) statusEl.status = "saving";

    try {
      // Plugin pre-save gate — a throw here cancels the save and
      // routes through the same error banner as a backend failure.
      await this.deps.notifyBeforeSave(path, updates.tags);

      const newPath = await storage.updateImage(path, updates);
      // Path may change if we ever call updateImage with { folderPath }
      this.deps.setCurrentImagePath(newPath);
      hideError();
      const s = this.deps.getStatusIndicator();
      if (s) s.status = "saved";
      // Notify plugins — `annot-cloud` uses this for server-side
      // state (comments, team metadata) that rides alongside a save
      // but doesn't block it.
      this.deps.onAfterSave(newPath);
    } catch (e: unknown) {
      const s = this.deps.getStatusIndicator();
      if (s) s.status = "error";
      console.error("[save] Error:", e);
      const err = e as { status?: number; message?: string };
      const retry = () => this.writeAnnotations();
      if (err.status === 401) {
        // Token refresh is handled internally by every network-backed
        // store via `setTokenRefresher` (see bridge.ts), so a 401 that
        // reaches here means the user already dismissed the refresh
        // banner. Don't stack another auth banner on top — surface a
        // plain retry so they can either sign back in via the sidebar
        // and come back, or try again once the store has a valid
        // session. The provider-labelled banner shown by the store's
        // refresher carries the correct UX for re-auth.
        showSaveError(
          "Save failed — session expired. Sign in again from the sidebar and retry.",
          retry,
        );
      } else if (err.status === 403) {
        showSaveError("Permission denied. You may not have write access to this folder.");
      } else if (err.status === 404) {
        showSaveError("File or folder not found. It may have been deleted.");
      } else if (!navigator.onLine) {
        showSaveError("You are offline. Changes will be lost.", retry);
      } else {
        showSaveError(`Save failed: ${err.message || "Unknown error"}`, retry);
      }
    } finally {
      this.#saveInFlight = false;
      // Catch-up save: if edits arrived while we were uploading,
      // flush them now. Clearing the flag first so the nested call
      // actually runs instead of bouncing on the gate.
      if (this.#savePending) {
        this.#savePending = false;
        void this.writeAnnotations();
      }
    }
  }

  async writeThumbnail(): Promise<void> {
    const storage = this.deps.getStorage();
    const canvas = this.deps.getCanvas();
    const path = this.deps.getCurrentImagePath();
    if (!canvas || !storage || !path) return;
    const renderedDataUrl = await getPngDataUrl(canvas);
    const thumbnailDataUrl = await storage.generateThumbnail(renderedDataUrl);
    await storage.updateImage(path, { thumbnailDataUrl });
  }

  /**
   * Resolve once (a) no debounced save is scheduled, (b) no upload is
   * running, and (c) no catch-up save is queued. Safe to call while
   * not editing — it no-ops.
   *
   * Called from every in-app navigation boundary (gallery button,
   * brand click, session cleanup) and from `beforeunload` so the
   * user doesn't silently lose a pending edit.
   */
  async flushPending(): Promise<void> {
    // If a debounce timer is armed, cancel it and run the save now.
    if (this.#autoSaveTimer !== undefined) {
      clearTimeout(this.#autoSaveTimer);
      this.#autoSaveTimer = undefined;
      await this.writeAnnotations();
    }
    // Wait for any in-flight save + catch-up save to settle. Polling
    // with a short interval is ugly but this only runs at navigation
    // boundaries, never in the hot edit path.
    while (this.#saveInFlight || this.#savePending) {
      await new Promise((r) => setTimeout(r, 50));
    }
    // Also flush the thumbnail regen so the gallery tile that's
    // about to be rendered shows the latest state.
    if (this.#thumbTimer !== undefined) {
      clearTimeout(this.#thumbTimer);
      this.#thumbTimer = undefined;
      await this.writeThumbnail();
    }
  }
}
