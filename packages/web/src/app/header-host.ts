/**
 * Header host — owns the editor header bar (#editor-header):
 * brand → gallery button, breadcrumb, filename + inline rename,
 * `SaveStatusIndicator`, file-actions cluster (Open / Copy / Save ▼),
 * help button, theme toggle.
 *
 * Also owns the adjacent flows that are triggered from the header or
 * that rebuild it: `#renameCurrentImage` (shared between drawer-inline
 * rename and header-inline rename), external-links enumeration, and the
 * background GitHub last-commit fetch that patches the drawer.
 *
 * Extracted from `app.ts` as part of the Phase 2 decomposition
 * (see `docs/plans/app-decomposition.md`). All storage / path / record
 * state is reached through the injected `HeaderHostDeps` getters so the
 * host never needs a back-reference to `AnnotApp`.
 */

import { createThemeToggle } from "@ingcreators/annot-core";
import type { Toolbar } from "@ingcreators/annot-core";
import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { getFilename } from "@ingcreators/annot-core/storage";
import { setTooltip } from "@ingcreators/annot-core/utils";
import type { FileDetailsDrawer } from "../editor/file-details-drawer.js";
import { estimateDataUrlBytes, validateFilename } from "../editor/file-details-drawer.js";
import type { AnnotSaveStatusElement } from "../editor/save-status-indicator.js";
import "../editor/save-status-indicator.js";
import { editUrl, pushRoute } from "../router.js";
import { getStorageMode } from "../storage/bridge.js";
import { GitHubStore } from "../storage/github-store.js";

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
  getFileDetailsDrawer(): FileDetailsDrawer | null;
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
  ): Array<{ label: string; url: string; icon?: string }> | undefined;
}

export class HeaderHost {
  #saveStatusIndicator: AnnotSaveStatusElement | null = null;

  constructor(private readonly deps: HeaderHostDeps) {}

  /** Rebuild the editor header from scratch. Called on every editor
   *  session start + after a rename so the breadcrumb / filename
   *  reflect the latest path. */
  build(): void {
    const headerEl = document.getElementById("editor-header");
    if (!headerEl) return;
    headerEl.innerHTML = "";

    // Brand — A icon, click → gallery root
    const brandBtn = document.createElement("button");
    brandBtn.type = "button";
    brandBtn.className = "editor-header-brand";
    setTooltip(brandBtn, "Back to Gallery");
    brandBtn.setAttribute("aria-label", "Back to Gallery");
    // Logo is 30×30 — matches the file-manager header's .brand SVG
    // so the logo stays at the exact same x/y position when the user
    // navigates between gallery and editor views. 30px fills ~62% of
    // the 48px header, which is the sweet spot used by Figma / Slack /
    // Notion (all ≈ 28–32px in an equivalent-height chrome).
    brandBtn.innerHTML = `
      <svg width="30" height="30" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="7" r="3.5" fill="#7c9cff"/>
        <path d="M24 13 L13 38" stroke="#7ef0c5" stroke-width="4" stroke-linecap="round"/>
        <path d="M24 13 L35 38" stroke="#b391ff" stroke-width="4" stroke-linecap="round"/>
        <path d="M19 24 H29" stroke="#7c9cff" stroke-width="3.5" stroke-linecap="round"/>
      </svg>
    `;
    brandBtn.addEventListener("click", () => {
      this.deps.setCurrentFolderPath("");
      void this.deps.showGallery();
    });
    headerEl.appendChild(brandBtn);

    // Breadcrumb — folder path. Appends filename as the active final
    // segment + info button, so the full path reads as one unit.
    const breadcrumb = this.#buildBreadcrumb();
    breadcrumb.classList.add("editor-header-path");

    const currentPath = this.deps.getCurrentImagePath();
    if (currentPath) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-sep";
      sep.textContent = "\u203a";
      sep.setAttribute("aria-hidden", "true");
      breadcrumb.appendChild(sep);

      // Filename is the "active" final breadcrumb segment. Double-click
      // enters inline rename mode (Finder / Notion convention). Single
      // click leaves the text selectable so users can copy the name.
      const filenameEl = document.createElement("span");
      filenameEl.className = "breadcrumb-item breadcrumb-filename active";
      filenameEl.textContent = getFilename(currentPath);
      setTooltip(filenameEl, `${currentPath}\nDouble-click to rename`);
      filenameEl.addEventListener("dblclick", () => {
        this.#startInlineFilenameRename(filenameEl);
      });
      breadcrumb.appendChild(filenameEl);

      const infoBtn = document.createElement("button");
      infoBtn.type = "button";
      infoBtn.className = "editor-header-info-btn material-symbols-outlined";
      infoBtn.textContent = "info";
      setTooltip(infoBtn, "Show file details and all tags");
      infoBtn.setAttribute("aria-label", "Show file details and all tags");
      infoBtn.addEventListener("click", () => {
        this.deps.getFileDetailsDrawer()?.toggle();
      });
      breadcrumb.appendChild(infoBtn);
    }
    headerEl.appendChild(breadcrumb);

    // Save status indicator — sits directly after the filename.
    // Rationale: save state is a property OF this file; keeping it next
    // to the file identifier lets the eye read "image.png · Saved" as a
    // single unit. Industry pattern: Figma, Notion, VS Code, macOS
    // title bar all place edit/save status beside the title, not at
    // the far right of the window.
    this.#saveStatusIndicator = document.createElement("annot-save-status");
    headerEl.appendChild(this.#saveStatusIndicator);

    // Spacer then pushes global actions to the far right.
    const spacer = document.createElement("span");
    spacer.className = "toolbar-spacer";
    headerEl.appendChild(spacer);

    // File action cluster (Open / Copy / Save ▼) — document-level
    // actions that used to live in the top toolbar's right group. We
    // render them as standard toolbar buttons in the header and
    // delegate to the canonical Toolbar implementation so keyboard
    // shortcuts (Ctrl+S, Ctrl+C) + click both go through one path.
    this.#appendFileActions(headerEl);

    // Help (placeholder — future keyboard-shortcuts / feature overlay)
    const helpBtn = document.createElement("button");
    helpBtn.type = "button";
    helpBtn.className = "header-info-btn material-symbols-outlined";
    helpBtn.textContent = "help_outline";
    setTooltip(helpBtn, "Help");
    helpBtn.setAttribute("aria-label", "Help");
    headerEl.appendChild(helpBtn);

    // Theme toggle
    headerEl.appendChild(createThemeToggle("header-info-btn material-symbols-outlined"));
  }

  /** Tear down per-session state. Called from `showGalleryView` so the
   *  next editor session gets a fresh `SaveStatusIndicator` whose DOM
   *  is attached to the freshly-rebuilt header. */
  reset(): void {
    this.#saveStatusIndicator = null;
  }

  /** Exposed for `SavePipeline` to read through its `getStatusIndicator`
   *  dep. Null when no editor session is open. */
  getSaveStatusIndicator(): AnnotSaveStatusElement | null {
    return this.#saveStatusIndicator;
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
  ): Array<{ label: string; url: string; icon?: string }> | undefined {
    return this.deps.collectExternalLinks(path);
  }

  /**
   * Lazy-load backend-provided last-commit metadata and patch it
   * into the drawer. Awaits the network call in the background so
   * the editor opens instantly; the drawer section just pops in
   * when the lookup settles (typically within a few hundred ms).
   */
  async populateLastCommit(path: string | null): Promise<void> {
    const storage = this.deps.getStorage();
    if (!path || !(storage instanceof GitHubStore)) return;
    try {
      const info = await storage.getLastCommit(path);
      if (!info) return;
      // Race guard: if the user navigated to a different image
      // while we were fetching, the drawer is now owned by that
      // image — skip the patch.
      if (this.deps.getCurrentImagePath() !== path) return;
      this.deps.getFileDetailsDrawer()?.setLastCommit({
        authorName: info.authorName,
        authorAvatarUrl: info.authorAvatarUrl,
        messageHeadline: info.messageHeadline,
        date: info.date,
        shortSha: info.shortSha,
        url: info.url,
      });
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
    pushRoute(editUrl(getStorageMode(), newPath));
    this.build();
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

  /**
   * Build the header's right-side file action cluster: Open (optional),
   * Copy, and Save with dropdown. Delegates all behavior to the current
   * Toolbar instance so there's a single source of truth for what "save"
   * and "copy" mean — the header buttons are a UI alias, not a second
   * implementation.
   */
  #appendFileActions(headerEl: HTMLElement): void {
    const group = document.createElement("div");
    group.className = "editor-header-file-actions";

    // Open — only in contexts where the host wires up an opener.
    if (typeof (window as unknown as { __anno_openFile?: () => void }).__anno_openFile === "function") {
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "header-info-btn material-symbols-outlined";
      openBtn.textContent = "folder_open";
      setTooltip(openBtn, "Open File");
      openBtn.setAttribute("aria-label", "Open File");
      openBtn.addEventListener("click", () =>
        (window as unknown as { __anno_openFile: () => void }).__anno_openFile(),
      );
      group.appendChild(openBtn);
    }

    // Copy
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "header-info-btn material-symbols-outlined";
    copyBtn.textContent = "content_copy";
    setTooltip(copyBtn, "Copy (Ctrl+C)");
    copyBtn.setAttribute("aria-label", "Copy");
    copyBtn.addEventListener("click", () => {
      this.deps.getToolbar()?.copyNow().catch((e) => console.error("[copy]", e));
    });
    group.appendChild(copyBtn);

    // Save + dropdown
    const saveWrap = document.createElement("div");
    saveWrap.className = "tool-btn-wrap header-save-wrap";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "header-info-btn material-symbols-outlined";
    saveBtn.textContent = "save";
    setTooltip(saveBtn, "Save (Ctrl+S)");
    saveBtn.setAttribute("aria-label", "Save");
    saveBtn.addEventListener("click", () => {
      this.deps.getToolbar()?.saveNow();
    });
    saveWrap.appendChild(saveBtn);

    const saveArrow = document.createElement("button");
    saveArrow.type = "button";
    saveArrow.className = "tool-dropdown-arrow material-symbols-outlined";
    saveArrow.textContent = "expand_more";
    setTooltip(saveArrow, "Save options");
    saveArrow.setAttribute("aria-label", "Save options");
    saveArrow.addEventListener("click", (e) => {
      e.stopPropagation();
      this.deps.getToolbar()?.showSaveMenu(saveWrap);
    });
    saveWrap.appendChild(saveArrow);

    group.appendChild(saveWrap);
    headerEl.appendChild(group);
  }

  /**
   * Swap the breadcrumb filename span with an inline input so the user
   * can rename the file without opening the details drawer. Commits on
   * Enter / blur, cancels on Escape. Same validation + storage rename
   * path as the drawer.
   */
  #startInlineFilenameRename(filenameEl: HTMLElement): void {
    const currentPath = this.deps.getCurrentImagePath();
    if (!currentPath) return;
    const oldName = getFilename(currentPath);
    const input = document.createElement("input");
    input.type = "text";
    input.value = oldName;
    input.className = "breadcrumb-filename-input";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", "File name, editable");

    const parent = filenameEl.parentElement!;
    parent.replaceChild(input, filenameEl);
    input.focus();
    // Select just the base name so the extension is preserved by default.
    const dot = oldName.lastIndexOf(".");
    setTimeout(() => {
      input.setSelectionRange(0, dot > 0 ? dot : oldName.length);
    }, 0);

    let committing = false;
    const restore = () => {
      if (input.parentElement) input.replaceWith(filenameEl);
    };
    const commit = async () => {
      if (committing) return;
      committing = true;
      const next = input.value.trim();
      if (!next || next === oldName) {
        restore();
        return;
      }
      const err = validateFilename(next);
      if (err) {
        input.setCustomValidity(err);
        input.reportValidity();
        input.focus();
        committing = false;
        return;
      }
      try {
        input.disabled = true;
        await this.renameCurrentImage(next);
        // renameCurrentImage rebuilds the header, so the input is
        // already gone by the time this resolves — nothing to restore.
      } catch (e) {
        console.error("[rename] header:", e);
        restore();
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        input.value = oldName;
        restore();
      }
    });
    input.addEventListener("blur", () => {
      commit();
    });
  }

  /**
   * Build a clickable breadcrumb for the editor header, e.g.:
   *
   *   Device › Screenshots › Mobile
   *
   * - The root segment ("Device" / "Browser" / "Google Drive") returns to
   *   the gallery at the storage root.
   * - Each path segment returns to the gallery focused on that folder.
   * - Reuses the .breadcrumb / .breadcrumb-item CSS already defined for
   *   the gallery so the two views use one visual vocabulary.
   */
  #buildBreadcrumb(): HTMLElement {
    const nav = document.createElement("nav");
    nav.className = "breadcrumb";
    nav.setAttribute("aria-label", "Return to gallery");

    const mode = getStorageMode();
    const rootLabel =
      mode === "device"
        ? "Device"
        : mode === "googledrive"
          ? "Google Drive"
          : mode === "github"
            ? "GitHub"
            : "Browser";

    const makeItem = (label: string, folderPath: string): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "breadcrumb-item";
      btn.textContent = label;
      setTooltip(
        btn,
        folderPath ? `Open "${label}" in gallery` : `Open gallery root (${rootLabel})`,
      );
      btn.addEventListener("click", () => {
        this.deps.setCurrentFolderPath(folderPath);
        void this.deps.showGallery();
      });
      return btn;
    };

    nav.appendChild(makeItem(rootLabel, ""));

    const folderPath = this.deps.getCurrentFolderPath();
    if (folderPath) {
      const segments = folderPath.split("/").filter(Boolean);
      let acc = "";
      for (const seg of segments) {
        acc = acc ? `${acc}/${seg}` : seg;
        const sep = document.createElement("span");
        sep.className = "breadcrumb-sep";
        sep.textContent = "\u203a";
        sep.setAttribute("aria-hidden", "true");
        nav.appendChild(sep);
        nav.appendChild(makeItem(seg, acc));
      }
    }

    return nav;
  }
}
