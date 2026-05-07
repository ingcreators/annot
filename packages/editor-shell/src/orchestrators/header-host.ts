/**
 * Header host — orchestrates the editor header bar
 * (`<annot-editor-header>`): brand → gallery button, breadcrumb,
 * filename + inline rename (`<annot-editable-filename>`),
 * save-status indicator (`<annot-save-status>`), file-actions
 * cluster (Open / Copy / Save ▼), help button, theme toggle.
 *
 * Also owns the adjacent flows triggered from the header or that
 * rebuild it: `renameCurrentImage` (shared between drawer-inline
 * rename and header-inline rename), external-links enumeration,
 * and the background last-commit fetch that patches the drawer.
 *
 * Lit Phase 4 — the imperative `build()` DOM construction now
 * delegates into the `<annot-editor-header>` Lit element. The
 * orchestration methods here (rename / populateLastCommit /
 * buildExternalLinksFor / build) stay on the class because
 * they're cross-cutting concerns that talk to storage + drawer
 * + plugin host.
 *
 * Phase 3 of `docs/plans/host-convergence.md` lifted this class
 * from `packages/web/src/app/header-host.ts` into editor-shell
 * so PWA + Desktop can share it. Three host-specific concerns
 * thread through the constructor `deps` instead of being
 * imported directly:
 *
 *   1. **Routing** — PWA pushes `editUrl(mode, path)` after a
 *      rename so the URL stays in sync; Desktop has no router and
 *      passes a no-op.
 *   2. **Root label** — PWA maps `getStorageMode()` to
 *      "Browser" / "Device" / "Google Drive" / "GitHub";
 *      Desktop returns the constant "Desktop". The mapping itself
 *      is the host concern.
 *   3. **Last commit** — PWA's `populateLastCommit` only does
 *      anything for GitHubStore; Desktop returns `null`. The
 *      `instanceof GitHubStore` check stays in the PWA closure.
 */

import type { IconSpec } from "@ingcreators/annot-core";
import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { getFilename } from "@ingcreators/annot-core/storage";
import type {
  AnnotFileDetailsDrawerElement,
  LastCommitInfo,
} from "../annot-file-details-drawer.js";
import { estimateDataUrlBytes } from "../annot-file-details-drawer.js";
import "../editor-header.js";
import type { AnnotEditorHeaderElement } from "../editor-header.js";
import type { AnnotSaveStatusElement } from "../save-status-indicator.js";
import type { Toolbar } from "../toolbar.js";

export interface HeaderHostDeps {
  getStorage(): StorageProvider | null;
  getCurrentImagePath(): string | null;
  setCurrentImagePath(path: string): void;
  getCurrentImageRecord(): ImageRecord | null;
  setCurrentImageRecord(record: ImageRecord): void;
  getCurrentTags(): Record<string, string>;
  getCurrentImageDataUrl(): string;
  getCurrentFolderPath(): string;
  setCurrentFolderPath(path: string): void;
  getFileDetailsDrawer(): AnnotFileDetailsDrawerElement | null;
  /** Lazy — the toolbar is built after `build()` returns, so header
   *  buttons that delegate to it (copy / save / save-menu) resolve
   *  on click, not at build time. */
  getToolbar(): Toolbar | null;
  /** Canvas dimensions for the drawer's size fields after a rename. */
  getImageSize(): { width: number; height: number };
  /** Navigate to the gallery view. Owned by the app so routing /
   *  teardown stays co-located with the other navigation logic. */
  showGallery(): Promise<void>;
  /** Plugin-driven external-link contributions (GitHub "View on
   *  GitHub" as the built-in, Cloud / third-party plugins extend).
   *  Delegated to `PluginHost.collectExternalLinks`. */
  collectExternalLinks(
    path: string | null,
  ): Array<{ label: string; url: string; icon?: IconSpec }> | undefined;
  /** Breadcrumb root-label. PWA maps `getStorageMode()` to
   *  "Browser" / "Device" / "Google Drive" / "GitHub"; Desktop
   *  returns the constant "Desktop". The mapping itself is the
   *  host concern. */
  getRootLabel(): string;
  /** Push a route after a successful rename so the URL stays in
   *  sync with the new path. PWA wires this to `pushRoute(editUrl(
   *  mode, newPath))`; Desktop has no router and passes a no-op.
   *  Optional — omit if the host doesn't have URL routing. */
  pushEditRoute?(newPath: string): void;
  /** Background fetch of "last commit" metadata for the file-
   *  details drawer. PWA returns the GitHubStore lookup when the
   *  active store is GitHub; Desktop returns `null`. The
   *  `instanceof GitHubStore` check is the PWA's concern, not
   *  HeaderHost's. Optional — omit if the host doesn't surface
   *  commit metadata. */
  fetchLastCommit?(path: string): Promise<LastCommitInfo | null>;
  /** Optional Open File handler — when supplied, the editor
   *  header renders an "Open File" affordance in the file-actions
   *  cluster. PWA wires this to its `__annot_openFile` plugin
   *  hook; Desktop / VSCode currently omit it. */
  openFile?(): void;
}

export class HeaderHost {
  readonly #host: HTMLElement;
  #headerEl: AnnotEditorHeaderElement | null = null;

  constructor(
    host: HTMLElement,
    private readonly deps: HeaderHostDeps,
  ) {
    this.#host = host;
  }

  /** Rebuild the editor header from scratch inside the host element
   *  supplied at construction. Called on every editor session start +
   *  after a rename so the breadcrumb / filename reflect the latest
   *  path. */
  build(): void {
    this.#host.innerHTML = "";

    const headerEl = document.createElement("annot-editor-header");
    headerEl.callbacks = {
      onNavigateToFolder: (folderPath) => {
        this.deps.setCurrentFolderPath(folderPath);
        void this.deps.showGallery();
      },
      onToggleInfo: () => this.deps.getFileDetailsDrawer()?.toggle(),
      onRename: (newName) => this.renameCurrentImage(newName),
      onOpenFile: this.deps.openFile,
      onCopy: () => {
        this.deps
          .getToolbar()
          ?.copyNow()
          .catch((e) => console.error("[copy]", e));
      },
      onSave: () => {
        this.deps.getToolbar()?.saveNow();
      },
      onSaveMenu: (anchor) => {
        this.deps.getToolbar()?.showSaveMenu(anchor);
      },
    };
    this.#updateHeaderProps(headerEl);
    this.#host.appendChild(headerEl);
    this.#headerEl = headerEl;
  }

  #updateHeaderProps(el: AnnotEditorHeaderElement): void {
    el.rootLabel = this.deps.getRootLabel();
    const folderPath = this.deps.getCurrentFolderPath();
    const segments = folderPath ? folderPath.split("/").filter(Boolean) : [];
    let acc = "";
    el.crumbs = segments.map((seg) => {
      acc = acc ? `${acc}/${seg}` : seg;
      return { label: seg, path: acc };
    });
    const currentPath = this.deps.getCurrentImagePath();
    el.filename = currentPath ? getFilename(currentPath) : "";
    el.fullPath = currentPath ?? "";
  }

  /** Tear down per-session state. Called from `showGalleryView`
   *  so the next editor session gets a fresh header element
   *  whose DOM is attached to the freshly-rebuilt host div. */
  reset(): void {
    this.#headerEl = null;
  }

  /** Exposed for `SavePipeline` to read through its
   *  `getStatusIndicator` dep. Null when no editor session is
   *  open. The save-status element is a child of the header
   *  Lit element. */
  getSaveStatusIndicator(): AnnotSaveStatusElement | null {
    return this.#headerEl?.getSaveStatusIndicator() ?? null;
  }

  /**
   * Build the "External links" section for the file-details drawer
   * by asking the plugin host to collect contributions. The built-in
   * `github-external-links` plugin contributes "View on GitHub";
   * Cloud / third-party plugins can stack their own links (team
   * comment thread, JIRA ticket, etc.).
   */
  buildExternalLinksFor(
    path: string | null,
  ): Array<{ label: string; url: string; icon?: IconSpec }> | undefined {
    return this.deps.collectExternalLinks(path);
  }

  /**
   * Lazy-load backend-provided last-commit metadata and patch it
   * into the drawer. Awaits the network call in the background so
   * the editor opens instantly; the drawer section just pops in
   * when the lookup settles (typically within a few hundred ms).
   *
   * The actual fetch is host-specific and threads through
   * `deps.fetchLastCommit`. PWA returns a result only when the
   * active store is GitHub; Desktop / VSCode omit the dep entirely.
   */
  async populateLastCommit(path: string | null): Promise<void> {
    if (!path || !this.deps.fetchLastCommit) return;
    try {
      const info = await this.deps.fetchLastCommit(path);
      if (!info) return;
      // Race guard: if the user navigated to a different image
      // while we were fetching, the drawer is now owned by that
      // image — skip the patch.
      if (this.deps.getCurrentImagePath() !== path) return;
      this.deps.getFileDetailsDrawer()?.setLastCommit(info);
    } catch {
      // Silent — the drawer just omits the section.
    }
  }

  /**
   * Rename the currently-open image. Called from both the drawer's
   * inline edit and the header's double-click-to-rename flow so the
   * two entry points share exactly one code path.
   *
   * The storage layer may uniquify ("foo (2).png") if the desired name
   * collides with a sibling; we trust the path it returns and refresh
   * the UI (URL, header breadcrumb, drawer contents) to match.
   */
  async renameCurrentImage(newName: string): Promise<void> {
    const storage = this.deps.getStorage();
    const oldPath = this.deps.getCurrentImagePath();
    if (!storage || !oldPath) {
      throw new Error("No active file to rename.");
    }
    const newPath = await storage.renameImage(oldPath, newName);
    this.deps.setCurrentImagePath(newPath);
    const record = this.deps.getCurrentImageRecord();
    if (record) {
      this.deps.setCurrentImageRecord({ ...record, path: newPath });
    }
    this.deps.pushEditRoute?.(newPath);
    // Refresh the header in place — props update, filename input
    // exits edit mode automatically because Lit re-renders the
    // breadcrumb segment from scratch when `.filename` changes.
    if (this.#headerEl) this.#updateHeaderProps(this.#headerEl);
    const size = this.deps.getImageSize();
    const currentRecord = this.deps.getCurrentImageRecord();
    this.deps.getFileDetailsDrawer()?.setData({
      filename: getFilename(newPath),
      folderPath: currentRecord?.folderPath ?? this.deps.getCurrentFolderPath(),
      width: size.width,
      height: size.height,
      fileSizeBytes: estimateDataUrlBytes(this.deps.getCurrentImageDataUrl()),
      createdAt: currentRecord?.createdAt,
      updatedAt: currentRecord?.updatedAt,
      sourceUrl: currentRecord?.sourceUrl,
      tags: this.deps.getCurrentTags(),
      externalLinks: this.buildExternalLinksFor(newPath),
    });
    // Rename changes the blob path → the "View on GitHub" URL + last
    // commit reflect the new location. Re-fetch in the background.
    void this.populateLastCommit(newPath);
  }
}
