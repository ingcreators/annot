/**
 * Sidebar — storage tree + folder tree + "New" button for the file manager.
 * Path-based identification for folders.
 */
import type { FolderRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { setTooltip } from "@ingcreators/annot-core/utils";
import type { StorageMode } from "../storage/bridge.js";
import { isScreenCaptureSupported, isClipboardReadSupported } from "../capture/pwa-capture.js";

export interface SidebarCallbacks {
  onStorageSelect: (mode: StorageMode) => void;
  /** Triggered by the "reselect" icon on a connected storage item (e.g. Device). */
  onStorageReselect: (mode: StorageMode) => void;
  onFolderSelect: (folderPath: string) => void;
  onNewFolder: () => void;
  onUploadImage: () => void;
  onCaptureScreen: () => void;
  onTimedCapture: () => void;
  onPasteClipboard: () => void;
}

interface StorageStatus {
  connected: boolean;
  label?: string;
}

/** Tracks which folder paths are expanded. "" = root (always expanded). */
type ExpandedSet = Set<string>;

export class Sidebar {
  #container: HTMLElement;
  #callbacks: SidebarCallbacks;
  #activeMode: StorageMode = "browser";
  #activeFolderPath: string = "";
  #storage: StorageProvider | null = null;
  #statuses: Record<StorageMode, StorageStatus> = {
    browser: { connected: true },
    extension: { connected: false },
    device: { connected: false },
    googledrive: { connected: false },
  };
  #expanded: ExpandedSet = new Set([""]); // root always expanded
  #rootName: string | null = null;
  #newMenuOpen = false;
  #treeContainer: HTMLElement | null = null;
  #treeSectionTitle: HTMLElement | null = null;

  constructor(container: HTMLElement, callbacks: SidebarCallbacks) {
    this.#container = container;
    this.#callbacks = callbacks;
    this.render();
  }

  setActiveMode(mode: StorageMode): void {
    this.#activeMode = mode;
    this.#updateActiveVisuals();
  }

  setActiveFolderPath(folderPath: string): void {
    this.#activeFolderPath = folderPath;
    this.#updateFolderHighlight();
  }

  setStorage(storage: StorageProvider | null, rootName?: string): void {
    this.#storage = storage;
    this.#rootName = rootName || null;
    this.#expanded = new Set([""]);
    this.refreshFolderTree();
  }

  setStorageStatus(mode: StorageMode, connected: boolean, label?: string): void {
    this.#statuses[mode] = { connected, label };
    this.render();
  }

  async refreshFolderTree(): Promise<void> {
    if (!this.#treeContainer || !this.#storage) {
      if (this.#treeContainer) {
        this.#treeContainer.innerHTML = "";
        this.#treeContainer.style.display = "none";
      }
      if (this.#treeSectionTitle) this.#treeSectionTitle.style.display = "none";
      return;
    }
    // Keep the whole "Folders" section hidden until the async tree
    // build finishes. Showing the root row early before the heading
    // reappears — possible when `listFolders` hangs on a 401 →
    // banner-blocked token refresh — reads as a stray, unlabelled item.
    this.#treeContainer.style.display = "none";
    if (this.#treeSectionTitle) this.#treeSectionTitle.style.display = "none";
    this.#treeContainer.innerHTML = "";
    this.#treeContainer.setAttribute("role", "tree");
    this.#treeContainer.setAttribute("aria-label", "Folders");

    // Root node — always shows storage type name; folder name as subtitle for Device
    const rootLabel = this.#activeMode === "device" ? "Device"
      : this.#activeMode === "googledrive" ? "Google Drive"
      : "Browser";

    const rootRow = document.createElement("div");
    rootRow.className = "folder-tree-item" + (this.#activeFolderPath === "" ? " active" : "");
    rootRow.dataset.folderPath = "";
    rootRow.style.paddingLeft = "8px";
    rootRow.setAttribute("role", "treeitem");
    rootRow.setAttribute("aria-level", "1");
    rootRow.setAttribute("aria-selected", String(this.#activeFolderPath === ""));
    rootRow.tabIndex = 0;

    const rootIcon = document.createElement("span");
    rootIcon.className = "material-symbols-outlined folder-tree-icon";
    rootIcon.textContent = "home_storage";
    rootIcon.setAttribute("aria-hidden", "true");
    rootRow.appendChild(rootIcon);

    const rootInfo = document.createElement("div");
    rootInfo.className = "folder-tree-root-info";
    const rootNameEl = document.createElement("span");
    rootNameEl.className = "folder-tree-name";
    rootNameEl.textContent = rootLabel;
    rootInfo.appendChild(rootNameEl);
    if (this.#rootName) {
      const rootSub = document.createElement("span");
      rootSub.className = "folder-tree-root-sub";
      rootSub.textContent = this.#rootName;
      rootInfo.appendChild(rootSub);
    }
    rootRow.appendChild(rootInfo);

    const activateRoot = () => {
      this.#activeFolderPath = "";
      this.#updateFolderHighlight();
      this.#callbacks.onFolderSelect("");
    };
    rootRow.addEventListener("click", activateRoot);
    rootRow.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activateRoot();
      }
    });
    this.#treeContainer.appendChild(rootRow);

    // Child folders
    const childContainer = document.createElement("div");
    childContainer.className = "folder-tree-children";
    this.#treeContainer.appendChild(childContainer);
    await this.#buildFolderTree(childContainer, "", 1);

    // Reveal both the heading and the tree together. If the build
    // errored inside `#buildFolderTree` it swallowed the throw, which
    // means we still mark the section visible — the user sees the
    // heading + whatever partial tree loaded, rather than an empty
    // container that silently stays hidden.
    if (this.#treeSectionTitle) this.#treeSectionTitle.style.display = "";
    this.#treeContainer.style.display = "";
  }

  render(): void {
    this.#container.innerHTML = "";

    this.#container.appendChild(this.#buildNewButton());

    const title = document.createElement("div");
    title.className = "sidebar-section-title";
    title.textContent = "Storage";
    this.#container.appendChild(title);

    this.#container.appendChild(this.#buildStorageItem(
      "browser",
      "database",
      "Browser",
      this.#statuses.browser.connected ? this.#statuses.browser.label || "Local" : "Local",
    ));

    if (typeof (window as any).showDirectoryPicker === "function") {
      const fs = this.#statuses.device;
      this.#container.appendChild(this.#buildStorageItem(
        "device",
        "laptop",
        "Device",
        fs.connected ? fs.label || "Connected" : "Not connected",
        fs.connected ? { reselect: true, reselectTitle: "Change device folder" } : undefined,
      ));
    }

    const gd = this.#statuses.googledrive;
    this.#container.appendChild(this.#buildStorageItem(
      "googledrive",
      "cloud",
      "Google Drive",
      gd.connected ? gd.label || "Connected" : "Not connected",
      gd.connected ? { reselect: true, reselectTitle: "Change Drive folder" } : undefined,
    ));

    // The "Folders" section (title + tree) is shown as a unit once
    // `refreshFolderTree` has successfully built the tree. Hiding both
    // together avoids the in-between state where the title is
    // suppressed but the async-built root row has already landed — it
    // was reading as "orphan storage row with no heading".
    this.#treeSectionTitle = document.createElement("div");
    this.#treeSectionTitle.className = "sidebar-section-title";
    this.#treeSectionTitle.textContent = "Folders";
    this.#treeSectionTitle.style.display = "none";
    this.#container.appendChild(this.#treeSectionTitle);

    this.#treeContainer = document.createElement("div");
    this.#treeContainer.className = "sidebar-folder-tree";
    this.#treeContainer.style.display = "none";
    this.#container.appendChild(this.#treeContainer);

    this.#updateActiveVisuals();
    this.refreshFolderTree();
  }

  // ---- New button ----

  #buildNewButton(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "new-menu-wrap";

    const btn = document.createElement("button");
    btn.className = "sidebar-new-btn";
    btn.innerHTML = '<span class="material-symbols-outlined">add</span> New';
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.#toggleNewMenu(wrap);
    });
    wrap.appendChild(btn);

    return wrap;
  }

  #toggleNewMenu(wrap: HTMLElement): void {
    const existing = wrap.querySelector(".new-menu");
    if (existing) {
      existing.remove();
      this.#newMenuOpen = false;
      return;
    }

    this.#newMenuOpen = true;
    const menu = document.createElement("div");
    menu.className = "new-menu";

    const items: { icon: string; label: string; action: () => void; show?: boolean }[] = [
      { icon: "create_new_folder", label: "New Folder", action: () => this.#callbacks.onNewFolder() },
      { icon: "upload", label: "Upload Image", action: () => this.#callbacks.onUploadImage() },
      { icon: "screenshot_monitor", label: "Capture Screen", action: () => this.#callbacks.onCaptureScreen(), show: isScreenCaptureSupported() },
      { icon: "timer", label: "Timed Capture...", action: () => this.#callbacks.onTimedCapture(), show: isScreenCaptureSupported() },
      { icon: "content_paste", label: "Paste from Clipboard", action: () => this.#callbacks.onPasteClipboard(), show: isClipboardReadSupported() },
    ];

    for (const item of items) {
      if (item.show === false) continue;
      const btn = document.createElement("button");
      btn.className = "new-menu-item";
      btn.innerHTML = `<span class="material-symbols-outlined">${item.icon}</span> ${item.label}`;
      btn.addEventListener("click", () => {
        menu.remove();
        this.#newMenuOpen = false;
        item.action();
      });
      menu.appendChild(btn);
    }

    wrap.appendChild(menu);

    const close = (e: MouseEvent) => {
      if (!wrap.contains(e.target as Node)) {
        menu.remove();
        this.#newMenuOpen = false;
        document.removeEventListener("click", close);
      }
    };
    requestAnimationFrame(() => document.addEventListener("click", close));
  }

  // ---- Storage items ----

  #buildStorageItem(
    mode: StorageMode,
    icon: string,
    label: string,
    status: string,
    opts: { reselect?: boolean; reselectTitle?: string } = {},
  ): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "sidebar-storage-item";
    btn.dataset.mode = mode;
    btn.type = "button";
    btn.setAttribute("aria-label", `${label} storage — ${status}`);

    // Icon is decorative — hide from AT (status text already conveys meaning)
    btn.innerHTML = `
      <span class="material-symbols-outlined sidebar-storage-icon" aria-hidden="true">${icon}</span>
      <div class="sidebar-storage-info">
        <div class="sidebar-storage-label">${label}</div>
        <div class="sidebar-storage-status">${status}</div>
      </div>
    `;

    btn.addEventListener("click", () => this.#callbacks.onStorageSelect(mode));

    if (opts.reselect) {
      const reselectBtn = document.createElement("button");
      reselectBtn.type = "button";
      reselectBtn.className = "sidebar-storage-reselect material-symbols-outlined";
      reselectBtn.textContent = "drive_folder_upload";
      setTooltip(reselectBtn, opts.reselectTitle || "Change folder");
      reselectBtn.setAttribute("aria-label", opts.reselectTitle || "Change folder");
      reselectBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.#callbacks.onStorageReselect(mode);
      });
      btn.appendChild(reselectBtn);
    }

    return btn;
  }

  #updateActiveVisuals(): void {
    for (const item of this.#container.querySelectorAll<HTMLElement>(".sidebar-storage-item")) {
      item.classList.toggle("active", item.dataset.mode === this.#activeMode);
    }
  }

  // ---- Folder tree ----

  async #buildFolderTree(container: HTMLElement, parentPath: string, depth: number): Promise<void> {
    if (!this.#storage) return;

    try {
      const folders = await this.#storage.listFolders(parentPath);
      for (const folder of folders) {
        const folderPath = folder.path;
        const isExpanded = this.#expanded.has(folderPath);
        const isActive = this.#activeFolderPath === folderPath;

        const row = document.createElement("div");
        row.className = "folder-tree-item" + (isActive ? " active" : "");
        row.dataset.folderPath = folderPath;
        row.style.paddingLeft = `${8 + depth * 16}px`;
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-level", String(depth + 1));
        row.setAttribute("aria-expanded", String(isExpanded));
        row.setAttribute("aria-selected", String(isActive));
        row.setAttribute("aria-label", folder.name);
        row.tabIndex = 0;

        const chevron = document.createElement("button");
        chevron.type = "button";
        chevron.className = "folder-tree-chevron material-symbols-outlined";
        chevron.textContent = isExpanded ? "expand_more" : "chevron_right";
        chevron.setAttribute("aria-label", isExpanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`);
        chevron.setAttribute("tabindex", "-1"); // row handles focus; chevron is a skip target
        chevron.addEventListener("click", (e) => {
          e.stopPropagation();
          this.#toggleExpand(folderPath);
        });
        row.appendChild(chevron);

        const icon = document.createElement("span");
        icon.className = "material-symbols-outlined folder-tree-icon";
        icon.textContent = isExpanded ? "folder_open" : "folder";
        icon.setAttribute("aria-hidden", "true");
        row.appendChild(icon);

        const name = document.createElement("span");
        name.className = "folder-tree-name";
        name.textContent = folder.name;
        row.appendChild(name);

        const activate = () => {
          this.#activeFolderPath = folderPath;
          this.#updateFolderHighlight();
          this.#callbacks.onFolderSelect(folderPath);
          if (!this.#expanded.has(folderPath)) {
            this.#expanded.add(folderPath);
            this.refreshFolderTree();
          }
        };
        row.addEventListener("click", activate);
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            activate();
          } else if (e.key === " ") {
            e.preventDefault();
            activate();
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            if (!isExpanded) this.#toggleExpand(folderPath);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            if (isExpanded) this.#toggleExpand(folderPath);
          }
        });

        container.appendChild(row);

        if (isExpanded) {
          const childContainer = document.createElement("div");
          childContainer.className = "folder-tree-children";
          childContainer.setAttribute("role", "group");
          container.appendChild(childContainer);
          await this.#buildFolderTree(childContainer, folderPath, depth + 1);
        }
      }
    } catch (e) {
      console.error("[sidebar] folder tree error:", e);
    }
  }

  async #toggleExpand(folderPath: string): Promise<void> {
    if (this.#expanded.has(folderPath)) {
      this.#expanded.delete(folderPath);
    } else {
      this.#expanded.add(folderPath);
    }
    await this.refreshFolderTree();
  }

  #updateFolderHighlight(): void {
    if (!this.#treeContainer) return;
    for (const item of this.#treeContainer.querySelectorAll<HTMLElement>(".folder-tree-item")) {
      const p = item.dataset.folderPath;
      item.classList.toggle("active", p === this.#activeFolderPath);
    }
  }
}
