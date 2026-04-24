/**
 * Router host — owns `handleRoute` (the popstate + boot entry point)
 * and the per-source handoff dispatchers.
 *
 * Extracted from `app.ts` as part of the Phase 3 decomposition
 * (see `docs/plans/app-decomposition.md`). The host parses the
 * current URL and delegates the concrete transition — transfer from
 * extension, open from gallery, open split editor, show gallery —
 * back to `AnnotApp` through the `RouterHostDeps` callbacks.
 *
 * The extension pushes the "handoff" entry point through a separate
 * URL shape (`/handoff?source=googledrive&state=…`), currently used
 * only by the Google Drive UI Integration. Future OneDrive / GitHub
 * picker flows slot into the same dispatcher.
 */

import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import type { FileManager } from "../gallery/file-manager.js";
import { editUrl, galleryUrl, parseRoute, pushRoute, sessionEditUrl } from "../router.js";
import { getStorageMode, setExtensionId, setStorageMode, type StorageMode } from "../storage/bridge.js";
import { GoogleDriveStore } from "../storage/google-drive-store.js";
import { showError, showInfo } from "../ui/error-bar.js";
import { findSessionRecords } from "./session-slice.js";

export interface RouterHostDeps {
  getStorage(): StorageProvider | null;
  getCurrentFolderPath(): string;
  /** The router invalidates the file manager after an extension
   *  transfer so the gallery re-reads the folder after the bulk
   *  re-home. `null` triggers the `showGalleryView` rebuild on the
   *  next gallery entry. */
  setFileManager(fm: FileManager | null): void;

  showGalleryView(): void;
  handleStorageSelect(mode: StorageMode): Promise<void>;
  transferAllFromExtension(): Promise<void>;
  transferAndOpen(record: ImageRecord, extPath: string): Promise<void>;
  openFromGallery(record: ImageRecord): Promise<void>;
  setupSplitEditor(records: ImageRecord[]): Promise<void>;
  /** Fire the plugin-host `onRouteChange` event. Dispatched at the
   *  top of `handleRoute` so plugins see every URL transition
   *  (including the handoff path) before the dispatcher branches. */
  notifyRouteChange(route: unknown): void;
}

export class RouterHost {
  constructor(private readonly deps: RouterHostDeps) {}

  async handleRoute(): Promise<void> {
    const route = parseRoute();
    console.log("[handleRoute]", route);
    this.deps.notifyRouteChange(route);

    // Handoff from Drive UI Integration (and future OneDrive / GitHub
    // sources). Resolve the incoming file into a path the editor
    // understands, then replace the URL with the canonical edit URL.
    if (route.type === "handoff") {
      await this.#handleHandoff(route.handoffSource || "", route.handoffState || "");
      return;
    }

    let transferred = false;
    if (route.extId) {
      // Remember the user's selected mode; connecting to extension is transient
      const savedMode = getStorageMode();
      const connected = await setExtensionId(
        route.extId,
        (route.store as StorageMode) || "extension",
      );
      if (connected) {
        await this.deps.transferAllFromExtension();
        transferred = true;
        this.deps.setFileManager(null);
        const url = new URL(window.location.href);
        url.searchParams.delete("extId");
        window.history.replaceState({}, "", url.pathname + url.search || url.pathname);
      }
      // Restore user's selected mode after extension read
      setStorageMode(savedMode);
    }

    const storage = this.deps.getStorage();

    // Capture session: open the Split Editor for scroll / perPage sessions.
    // Other session kinds (click / hotkey / interval) still carry session
    // tags for future grouping features but currently fall through to the
    // gallery view.
    if (route.session && storage) {
      try {
        const folderPath = this.deps.getCurrentFolderPath();
        const records = await findSessionRecords(storage, folderPath, route.session);
        const kind = records[0]?.tags?.sessionKind;
        if (records.length > 0 && (kind === "scroll" || kind === "perPage")) {
          // Rewrite the URL to the canonical `/edit/<store>?session=…` form
          // so reloads / popstate re-enter the split editor cleanly.
          pushRoute(sessionEditUrl(getStorageMode(), route.session));
          await this.deps.setupSplitEditor(records);
          return;
        }
        if (records.length === 0) {
          console.warn(
            "[handleRoute] session has no records in current folder:",
            route.session,
            "folder=",
            folderPath,
          );
        }
      } catch (e) {
        console.error("[handleRoute] session lookup error:", e);
      }
    }

    if (route.type === "edit" && route.path && storage) {
      try {
        // Try direct lookup first
        let record = await storage.getImage(route.path);
        // If the route came from the extension and a bulk-transfer just ran,
        // the image was re-homed into the current folder — look it up there.
        const folderPath = this.deps.getCurrentFolderPath();
        if (!record && transferred && folderPath) {
          const filename = route.path.includes("/")
            ? route.path.slice(route.path.lastIndexOf("/") + 1)
            : route.path;
          const candidate = `${folderPath}/${filename}`;
          record = await storage.getImage(candidate);
          if (record) {
            // Fix up the URL so it matches the actual stored path
            pushRoute(editUrl(getStorageMode(), record.path));
          }
        }
        if (record?.originalDataUrl) {
          if (route.store === "extension" && !transferred) {
            await this.deps.transferAndOpen(record, route.path);
          } else {
            await this.deps.openFromGallery(record);
          }
          return;
        }
      } catch (e) {
        console.error("[handleRoute] getImage error:", e);
      }
    }

    this.deps.showGalleryView();
  }

  /**
   * Dispatch a `/handoff?source=…&state=…` URL to the per-source
   * handler. The state blob is JSON-encoded by the handing-off
   * service (Drive today) and carries the file id + intended action.
   *
   * Currently only `googledrive` is implemented; future OneDrive /
   * GitHub sources will plug in here.
   */
  async #handleHandoff(source: string, rawState: string): Promise<void> {
    if (!rawState) {
      showError({
        message: "Drive handoff: missing state parameter.",
        severity: "warning",
      });
      window.history.replaceState({}, "", galleryUrl());
      this.deps.showGalleryView();
      return;
    }
    let state: { action?: string; ids?: string[]; folderId?: string };
    try {
      state = JSON.parse(rawState);
    } catch {
      showError({
        message: "Drive handoff: state parameter is not valid JSON.",
        severity: "warning",
      });
      window.history.replaceState({}, "", galleryUrl());
      this.deps.showGalleryView();
      return;
    }

    if (source === "googledrive") {
      await this.#handleGoogleDriveHandoff(state);
      return;
    }

    showError({
      message: `Handoff source "${source}" is not supported yet.`,
      severity: "warning",
    });
    window.history.replaceState({}, "", galleryUrl());
    this.deps.showGalleryView();
  }

  async #handleGoogleDriveHandoff(state: {
    action?: string;
    ids?: string[];
    folderId?: string;
  }): Promise<void> {
    // Make sure the Drive store is the active one. If the user isn't
    // signed in yet, the `handleStorageSelect` flow below takes care
    // of it (sign-in + reuse of persisted root + store creation).
    let storage = this.deps.getStorage();
    if (getStorageMode() !== "googledrive" || !(storage instanceof GoogleDriveStore)) {
      await this.deps.handleStorageSelect("googledrive");
      storage = this.deps.getStorage();
    }
    if (!(storage instanceof GoogleDriveStore)) {
      showError({
        message: "Drive handoff: couldn't connect to Google Drive.",
        severity: "error",
      });
      window.history.replaceState({}, "", galleryUrl());
      this.deps.showGalleryView();
      return;
    }

    const action = state.action || (state.ids?.length ? "open" : "create");

    if (action === "create") {
      showInfo(
        "Creating a new annotation from Drive's New menu isn't implemented yet. Please capture via the extension or paste an image in Annot.",
      );
      window.history.replaceState({}, "", galleryUrl());
      this.deps.showGalleryView();
      return;
    }

    if (action !== "open" || !state.ids || state.ids.length === 0) {
      showError({
        message: "Drive handoff: unsupported action or missing file id.",
        severity: "warning",
      });
      window.history.replaceState({}, "", galleryUrl());
      this.deps.showGalleryView();
      return;
    }

    const fileId = state.ids[0]!;
    let resolvedPath: string | null = null;
    try {
      resolvedPath = await storage.resolveFileIdToPath(fileId);
    } catch (e) {
      console.error("[handoff/googledrive] resolve failed:", e);
      showError({
        message: "Drive handoff: couldn't read the file from Drive.",
        severity: "error",
      });
      window.history.replaceState({}, "", galleryUrl());
      this.deps.showGalleryView();
      return;
    }

    if (!resolvedPath) {
      // File exists but lives outside the user's Annot root folder.
      // Under `drive.file` we could technically operate on it, but the
      // gallery UI is path-rooted and wouldn't know how to display
      // "a file outside the workspace", so tell the user how to recover.
      showError({
        message:
          'That file is outside your Annot workspace folder. Use the sidebar\'s "Change Drive folder" icon to point Annot at a folder that contains it.',
        severity: "warning",
      });
      window.history.replaceState({}, "", galleryUrl());
      this.deps.showGalleryView();
      return;
    }

    // Replace the handoff URL with the canonical edit URL (so Back
    // goes to gallery, not to the opaque handoff), then let the
    // regular route handler open the file.
    window.history.replaceState({}, "", editUrl("googledrive", resolvedPath));
    await this.handleRoute();
  }
}
