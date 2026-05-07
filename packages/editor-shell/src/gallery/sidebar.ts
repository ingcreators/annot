import { builtinIcon, type IconSpec } from "@ingcreators/annot-core";
import { createBuiltinIcon } from "../annot-icon-imperative.js";
import "../annot-icon.js";
/**
 * `<annot-sidebar>` — storage tree + folder tree + "New" button
 * for the file manager. Path-based identification for folders.
 *
 * Lit Phase 3 — the imperative `Sidebar` class became this Lit
 * element. The chrome (heading text, sections, "New" button,
 * storage chips, sidebar-tab rows) is declarative; the recursive
 * folder-tree itself is still built imperatively in `updated()`
 * because async + recursive expansion doesn't fit Lit's render
 * loop cleanly. Per the migration plan, the tree's hot-spot stays
 * vanilla and a follow-up plan can revisit if it pays off.
 *
 * The public method surface (`setActiveMode` / `setActiveFolderPath`
 * / `setStorage` / `setStorageStatus` / `refreshFolderTree` /
 * `render`) is preserved so pre-Lit callers (FileManager,
 * StorageBridge) don't move.
 */
import type { StorageProvider } from "@ingcreators/annot-core/storage";
import { isClipboardReadSupported, isScreenCaptureSupported } from "../capture-predicates.js";
import { html, LitElement, nothing } from "../lit.js";
import type { SidebarTab, StorageRegistration } from "../plugin-host-types.js";
import type { StorageMode } from "../storage-mode.js";

/** Default priorities the sidebar's three sections render in.
 *  `App.init({ sidebarSectionOrder })` overrides per-section to
 *  reorder. Lower priority renders first; ties fall back to the
 *  fixed (storage / views / folders) declaration order via the
 *  stable sort. */
export const DEFAULT_SIDEBAR_SECTION_ORDER = {
  storage: 10,
  views: 20,
  folders: 30,
} as const;

export type SidebarSectionOrder = Partial<typeof DEFAULT_SIDEBAR_SECTION_ORDER>;

/**
 * Host- or plugin-supplied entry appended to the New menu after
 * the built-in items (New Folder, Upload Image, Capture Screen,
 * Timed Capture, Paste from Clipboard).
 *
 * Today's consumers:
 *   - **Desktop**: contributes "Capture Window" / "Capture Region" /
 *     "Open Browse Window" — the platform-only capture entry points
 *     that previously lived as a separate action-row in the
 *     gallery's chrome.
 *   - **Plugins (future)**: a plugin-registered storage backend can
 *     surface "Import from \<service\>" or "New from template" here
 *     once the plugin host plumbs the registration through.
 *
 * Each item renders as a regular new-menu row so it visually
 * matches the built-ins. The host owns the action — the sidebar
 * just dispatches on click and closes the menu.
 */
export interface NewMenuItem {
  /** Icon for the row. A string is resolved as a builtin icon name
   *  (e.g. `"language"`); an `IconSpec` is rendered as-is, which
   *  is the path plugin authors take for non-builtin icons. */
  icon: string | IconSpec;
  /** Visible label, e.g. `"Open Browse Window"`. */
  label: string;
  /** Click handler. The sidebar closes the menu before invoking. */
  action: () => void;
  /** Hide the entry by returning false. Mirrors the built-in
   *  items' `show` gate (e.g. `Capture Screen` is hidden when
   *  `getDisplayMedia` is unsupported). Default: shown. */
  show?: boolean;
}

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
  /** Plugin-registered storage backends — appended to the sidebar
   *  strip per the registration's `priority`. Defaults to "no
   *  plugins" so existing callers (e.g. the desktop shell) don't
   *  have to be updated. */
  getPluginStorages?: () => StorageRegistration[];
  /** Built-in storage modes the deployment opted out of via
   *  `App.init({ disableBuiltinStorage })`. Optional for the same
   *  reason as `getPluginStorages`. */
  isBuiltinDisabled?: (mode: string) => boolean;
  /** All registered sidebar tabs (built-in + plugin). Sorted by
   *  `priority` inside the sidebar before render. Optional — the
   *  Views section is suppressed entirely when the callback is
   *  absent or returns an empty list. */
  getSidebarTabs?: () => SidebarTab[];
  /** Section ordering override. Merged over
   *  `DEFAULT_SIDEBAR_SECTION_ORDER`; missing fields keep their
   *  default. Optional. */
  getSidebarSectionOrder?: () => SidebarSectionOrder;
  /** Extra items to append to the New menu after the built-ins.
   *  Hosts (e.g. desktop) and plugins surface platform-specific
   *  entry points here. Optional — omit to render only built-ins. */
  getNewMenuExtras?: () => NewMenuItem[];
}

/** Internal chip descriptor shared across built-ins + plugins. The
 *  built-in metadata is hardcoded below; plugin chips lift these
 *  fields out of the `StorageRegistration` they came from. */
interface ChipDescriptor {
  mode: string;
  icon: IconSpec;
  label: string;
  priority: number;
  /** Optional: hide the chip when this returns false. Used by the
   *  Device built-in to gate on `showDirectoryPicker` API support. */
  visible?: () => boolean;
  /** Tooltip on the "reselect" icon. Empty / undefined hides it. */
  reselectTitle?: string;
}

const BUILTIN_CHIP_DESCRIPTORS: readonly ChipDescriptor[] = [
  {
    mode: "browser",
    icon: builtinIcon("database"),
    label: "Browser",
    priority: 10,
  },
  {
    mode: "device",
    icon: builtinIcon("laptop"),
    label: "Device",
    priority: 20,
    visible: () =>
      typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker ===
      "function",
    reselectTitle: "Change device folder",
  },
  {
    mode: "googledrive",
    // Material Symbols' `add_to_drive` (Drive triangle silhouette
    // with a "+" affordance). Picked over the official multi-colour
    // Drive mark because the rest of the storage chip rail is
    // monochrome — the colour-locked logo would visually shout next
    // to every other `currentColor` glyph. When the multi-colour
    // mark is genuinely required (Workspace Marketplace listing,
    // dedicated Drive CTA), that surface ships its own asset.
    icon: builtinIcon("add_to_drive"),
    label: "Google Drive",
    priority: 30,
    reselectTitle: "Change Drive folder",
  },
  {
    mode: "github",
    // Official GitHub Mark (Invertocat); rendered in
    // `currentColor` so it picks up the surrounding text colour.
    icon: builtinIcon("brand.github"),
    label: "GitHub",
    priority: 40,
    reselectTitle: "Change repository",
  },
  {
    // Tauri / Electron desktop host's filesystem-backed library
    // (`@ingcreators/annot-desktop`'s `DesktopStore`). The PWA
    // never instantiates a `DesktopStore`, but the desktop host
    // typically passes `disableBuiltinStorage: ["browser",
    // "device", "googledrive", "github", "extension"]` at
    // bootstrap so this is the only chip that renders — matching
    // VSCode's "single-storage host" UX.
    mode: "desktop",
    icon: builtinIcon("desktop_windows"),
    label: "Desktop",
    priority: 50,
  },
];

interface StorageStatus {
  connected: boolean;
  label?: string;
}

/** Tracks which folder paths are expanded. "" = root (always expanded). */
type ExpandedSet = Set<string>;

export class AnnotSidebarElement extends LitElement {
  static override properties = {
    activeMode: { state: true },
    activeFolderPath: { state: true },
    storage: { attribute: false },
    rootName: { state: true },
    statuses: { state: true },
    callbacks: { attribute: false },
    newMenuOpen: { state: true },
  };

  declare activeMode: StorageMode;
  declare activeFolderPath: string;
  declare storage: StorageProvider | null;
  declare rootName: string | null;
  declare statuses: Map<string, StorageStatus>;
  declare callbacks: SidebarCallbacks;
  declare newMenuOpen: boolean;

  #expanded: ExpandedSet = new Set([""]);
  #closeNewMenu: ((e: MouseEvent) => void) | null = null;

  constructor() {
    super();
    this.activeMode = "browser";
    this.activeFolderPath = "";
    this.storage = null;
    this.rootName = null;
    this.statuses = new Map<string, StorageStatus>([
      ["browser", { connected: true }],
      ["extension", { connected: false }],
      ["device", { connected: false }],
      ["googledrive", { connected: false }],
      // Phase 2 of `docs/plans/github-integration.md` adds the
      // GitHubStore but leaves the visible sidebar item to Phase 3.
      // The status entry exists for type completeness.
      ["github", { connected: false }],
    ]);
    this.callbacks = {
      onStorageSelect: () => {},
      onStorageReselect: () => {},
      onFolderSelect: () => {},
      onNewFolder: () => {},
      onUploadImage: () => {},
      onCaptureScreen: () => {},
      onTimedCapture: () => {},
      onPasteClipboard: () => {},
    };
    this.newMenuOpen = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  // ---- Public method surface (kept for parity with the pre-Lit class) ----

  setActiveMode(mode: StorageMode): void {
    this.activeMode = mode;
  }

  setActiveFolderPath(folderPath: string): void {
    this.activeFolderPath = folderPath;
  }

  setStorage(storage: StorageProvider | null, rootName?: string): void {
    this.storage = storage;
    this.rootName = rootName || null;
    this.#expanded = new Set([""]);
    void this.refreshFolderTree();
  }

  setStorageStatus(mode: StorageMode, connected: boolean, label?: string): void {
    // Mutate via a fresh Map so Lit's identity check picks up the
    // change. Keeping the original reference would skip the render.
    const next = new Map(this.statuses);
    next.set(mode, { connected, label });
    this.statuses = next;
  }

  override render() {
    return this.#renderTemplate();
  }

  async refreshFolderTree(): Promise<void> {
    await this.updateComplete;
    const treeContainer = this.querySelector<HTMLElement>(".sidebar-folder-tree");
    const treeSectionTitle = this.querySelector<HTMLElement>(".sidebar-folders-title");
    if (!treeContainer) return;
    if (!this.storage) {
      treeContainer.innerHTML = "";
      treeContainer.style.display = "none";
      if (treeSectionTitle) treeSectionTitle.style.display = "none";
      return;
    }
    // Keep the whole "Folders" section hidden until the async tree
    // build finishes. Showing the root row early before the heading
    // reappears — possible when `listFolders` hangs on a 401 →
    // banner-blocked token refresh — reads as a stray, unlabelled item.
    treeContainer.style.display = "none";
    if (treeSectionTitle) treeSectionTitle.style.display = "none";
    treeContainer.innerHTML = "";
    treeContainer.setAttribute("role", "tree");
    treeContainer.setAttribute("aria-label", "Folders");

    // Root node — always shows storage type name; folder/repo name
    // as subtitle for Device / Drive / GitHub / Desktop.
    let rootLabel: string;
    switch (this.activeMode) {
      case "device":
        rootLabel = "Device";
        break;
      case "googledrive":
        rootLabel = "Google Drive";
        break;
      case "github":
        rootLabel = "GitHub";
        break;
      case "desktop":
        rootLabel = "Desktop";
        break;
      default:
        rootLabel = "Browser";
        break;
    }

    const rootRow = document.createElement("div");
    rootRow.className = `folder-tree-item${this.activeFolderPath === "" ? " active" : ""}`;
    rootRow.dataset["folderPath"] = "";
    rootRow.style.paddingLeft = "8px";
    rootRow.setAttribute("role", "treeitem");
    rootRow.setAttribute("aria-level", "1");
    rootRow.setAttribute("aria-selected", String(this.activeFolderPath === ""));
    rootRow.tabIndex = 0;

    rootRow.appendChild(createBuiltinIcon("home_storage", "folder-tree-icon"));

    const rootInfo = document.createElement("div");
    rootInfo.className = "folder-tree-root-info";
    const rootNameEl = document.createElement("span");
    rootNameEl.className = "folder-tree-name";
    rootNameEl.textContent = rootLabel;
    rootInfo.appendChild(rootNameEl);
    if (this.rootName) {
      const rootSub = document.createElement("span");
      rootSub.className = "folder-tree-root-sub";
      rootSub.textContent = this.rootName;
      rootInfo.appendChild(rootSub);
    }
    rootRow.appendChild(rootInfo);

    const activateRoot = () => {
      this.activeFolderPath = "";
      this.#updateFolderHighlight();
      this.callbacks.onFolderSelect("");
    };
    rootRow.addEventListener("click", activateRoot);
    rootRow.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activateRoot();
      }
    });
    treeContainer.appendChild(rootRow);

    // Child folders
    const childContainer = document.createElement("div");
    childContainer.className = "folder-tree-children";
    treeContainer.appendChild(childContainer);
    await this.#buildFolderTree(childContainer, "", 1);

    // Reveal both the heading and the tree together.
    if (treeSectionTitle) treeSectionTitle.style.display = "";
    treeContainer.style.display = "";
  }

  // ---- Lit lifecycle ----

  protected override updated(changed: Map<string, unknown>): void {
    if (
      changed.has("storage") ||
      changed.has("activeMode") ||
      changed.has("activeFolderPath") ||
      changed.has("rootName")
    ) {
      void this.refreshFolderTree();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.#closeNewMenu) {
      document.removeEventListener("click", this.#closeNewMenu);
      this.#closeNewMenu = null;
    }
  }

  // ---- Template ----

  #renderTemplate() {
    const orderOverride = this.callbacks.getSidebarSectionOrder?.() ?? {};
    const order = { ...DEFAULT_SIDEBAR_SECTION_ORDER, ...orderOverride };
    type RenderedSection = { priority: number; render: () => unknown };
    const sections: RenderedSection[] = [
      { priority: order.storage, render: () => this.#renderStorageSection() },
      { priority: order.views, render: () => this.#renderViewsSection() },
      { priority: order.folders, render: () => this.#renderFoldersSection() },
    ];
    sections.sort((a, b) => a.priority - b.priority);
    return html`
      ${this.#renderNewButton()} ${sections.map((s) => s.render())}
    `;
  }

  #renderStorageSection() {
    const isBuiltinDisabled = this.callbacks.isBuiltinDisabled ?? (() => false);
    const builtins: ChipDescriptor[] = BUILTIN_CHIP_DESCRIPTORS.filter(
      (d) => !isBuiltinDisabled(d.mode),
    );
    const plugins: ChipDescriptor[] = (this.callbacks.getPluginStorages?.() ?? []).map((reg) => ({
      mode: reg.mode,
      icon: reg.icon ?? builtinIcon("extension"),
      label: reg.label,
      priority: Number.isFinite(reg.priority) ? reg.priority : Number.POSITIVE_INFINITY,
      visible: reg.visible ? () => reg.visible!() : undefined,
      reselectTitle: reg.reselectTitle,
    }));
    const chips = [...builtins, ...plugins]
      .filter((d) => (d.visible ? d.visible() : true))
      .sort((a, b) => a.priority - b.priority);

    return html`
      <div class="sidebar-section-title">Storage</div>
      ${chips.map((chip) => this.#renderStorageChip(chip))}
    `;
  }

  #renderStorageChip(chip: ChipDescriptor) {
    const status = this.statuses.get(chip.mode) ?? { connected: false };
    const defaultLabel =
      chip.mode === "browser" ? "Local" : status.connected ? "Connected" : "Not connected";
    const subtitle = status.connected ? status.label || defaultLabel : defaultLabel;
    const showReselect = chip.reselectTitle && status.connected;
    const isActive = chip.mode === this.activeMode;
    return html`
      <button type="button"
        class=${isActive ? "sidebar-storage-item active" : "sidebar-storage-item"}
        data-mode=${chip.mode}
        aria-label=${`${chip.label} storage \u2014 ${subtitle}`}
        @click=${() => this.callbacks.onStorageSelect(chip.mode as StorageMode)}
      >
        <annot-icon class="sidebar-storage-icon" .spec=${chip.icon}></annot-icon>
        <div class="sidebar-storage-info">
          <div class="sidebar-storage-label">${chip.label}</div>
          <div class="sidebar-storage-status">${subtitle}</div>
        </div>
        ${
          showReselect
            ? html`<button
              type="button"
              class="sidebar-storage-reselect"
              data-tooltip=${chip.reselectTitle ?? "Change folder"}
              aria-label=${chip.reselectTitle ?? "Change folder"}
              @click=${(e: MouseEvent) => {
                e.stopPropagation();
                this.callbacks.onStorageReselect(chip.mode as StorageMode);
              }}>
            <annot-icon .spec=${builtinIcon("drive_folder_upload")}></annot-icon>
          </button>`
            : nothing
        }
      </button>
    `;
  }

  #renderViewsSection() {
    const tabs = (this.callbacks.getSidebarTabs?.() ?? [])
      .filter((t) => t.visible !== false)
      .sort((a, b) => {
        const ap = Number.isFinite(a.priority) ? a.priority : Number.POSITIVE_INFINITY;
        const bp = Number.isFinite(b.priority) ? b.priority : Number.POSITIVE_INFINITY;
        return ap - bp;
      });
    if (tabs.length === 0) return nothing;
    return html`
      <div class="sidebar-section-title">Views</div>
      ${tabs.map((tab) => this.#renderSidebarTab(tab))}
    `;
  }

  #renderSidebarTab(tab: SidebarTab) {
    return html`
      <button
        type="button"
        class=${tab.isActive ? "sidebar-storage-item active" : "sidebar-storage-item"}
        data-tab-id=${tab.id}
        @click=${(e: MouseEvent) => {
          e.stopPropagation();
          try {
            tab.onClick();
          } catch (err) {
            console.error(`[sidebar] tab "${tab.id}" onClick threw:`, err);
          }
        }}
      >
        <annot-icon .spec=${tab.icon ?? builtinIcon("view_module")}></annot-icon>
        <span class="sidebar-storage-label">${tab.label}</span>
        ${tab.badge ? html`<span class="sidebar-tab-badge">${tab.badge}</span>` : nothing}
      </button>
    `;
  }

  #renderFoldersSection() {
    // Heading + tree container — both hidden initially. The async
    // `refreshFolderTree()` reveals them in lock-step once the
    // tree successfully builds, so a slow listFolders() never
    // shows "orphan storage row with no heading".
    return html`
      <div class="sidebar-section-title sidebar-folders-title" style="display: none">
        Folders
      </div>
      <div class="sidebar-folder-tree" style="display: none"></div>
    `;
  }

  #renderNewButton() {
    return html`
      <div class="new-menu-wrap">
        <button
          type="button"
          class="sidebar-new-btn"
          @click=${(e: MouseEvent) => {
            e.stopPropagation();
            this.#toggleNewMenu();
          }}
        >
          <annot-icon .spec=${builtinIcon("add")}></annot-icon> New
        </button>
        ${this.newMenuOpen ? this.#renderNewMenu() : nothing}
      </div>
    `;
  }

  #renderNewMenu() {
    const builtins: NewMenuItem[] = [
      {
        icon: "create_new_folder",
        label: "New Folder",
        action: () => this.callbacks.onNewFolder(),
      },
      { icon: "upload", label: "Upload Image", action: () => this.callbacks.onUploadImage() },
      {
        icon: "screenshot_monitor",
        label: "Capture Screen",
        action: () => this.callbacks.onCaptureScreen(),
        show: isScreenCaptureSupported(),
      },
      {
        icon: "timer",
        label: "Timed Capture...",
        action: () => this.callbacks.onTimedCapture(),
        show: isScreenCaptureSupported(),
      },
      {
        icon: "content_paste",
        label: "Paste from Clipboard",
        action: () => this.callbacks.onPasteClipboard(),
        show: isClipboardReadSupported(),
      },
    ];
    // Host- or plugin-supplied extras (e.g. desktop's "Capture
    // Window" / "Capture Region" / "Open Browse Window") render
    // after the built-ins. The hook is called every render so the
    // host can return different items based on runtime state
    // (e.g. hide Browse when the Browse window is already focused).
    const extras = this.callbacks.getNewMenuExtras?.() ?? [];
    const items = [...builtins, ...extras];
    return html`
      <div class="new-menu">
        ${items
          .filter((item) => item.show !== false)
          .map(
            (item) => html`
              <button
                type="button"
                class="new-menu-item"
                @click=${() => {
                  this.newMenuOpen = false;
                  item.action();
                }}
              >
                <annot-icon
                  .spec=${typeof item.icon === "string" ? builtinIcon(item.icon) : item.icon}
                ></annot-icon>
                ${item.label}
              </button>
            `,
          )}
      </div>
    `;
  }

  #toggleNewMenu(): void {
    if (this.newMenuOpen) {
      this.newMenuOpen = false;
      if (this.#closeNewMenu) {
        document.removeEventListener("click", this.#closeNewMenu);
        this.#closeNewMenu = null;
      }
      return;
    }
    this.newMenuOpen = true;
    // Close on outside click. Defer one frame so the click that
    // opened the menu doesn't immediately re-close it.
    const close = (e: MouseEvent) => {
      const wrap = this.querySelector(".new-menu-wrap");
      if (wrap && !wrap.contains(e.target as Node)) {
        this.newMenuOpen = false;
        document.removeEventListener("click", close);
        this.#closeNewMenu = null;
      }
    };
    this.#closeNewMenu = close;
    requestAnimationFrame(() => document.addEventListener("click", close));
  }

  // ---- Folder tree (imperative; recursive + async) ----

  async #buildFolderTree(container: HTMLElement, parentPath: string, depth: number): Promise<void> {
    if (!this.storage) return;
    try {
      const folders = await this.storage.listFolders(parentPath);
      for (const folder of folders) {
        const folderPath = folder.path;
        const isExpanded = this.#expanded.has(folderPath);
        const isActive = this.activeFolderPath === folderPath;

        const row = document.createElement("div");
        row.className = `folder-tree-item${isActive ? " active" : ""}`;
        row.dataset["folderPath"] = folderPath;
        row.style.paddingLeft = `${8 + depth * 16}px`;
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-level", String(depth + 1));
        row.setAttribute("aria-expanded", String(isExpanded));
        row.setAttribute("aria-selected", String(isActive));
        row.setAttribute("aria-label", folder.name);
        row.tabIndex = 0;

        const chevron = document.createElement("button");
        chevron.type = "button";
        chevron.className = "folder-tree-chevron";
        chevron.appendChild(createBuiltinIcon(isExpanded ? "expand_more" : "chevron_right"));
        chevron.setAttribute(
          "aria-label",
          isExpanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`,
        );
        chevron.setAttribute("tabindex", "-1");
        chevron.addEventListener("click", (e) => {
          e.stopPropagation();
          void this.#toggleExpand(folderPath);
        });
        row.appendChild(chevron);

        row.appendChild(
          createBuiltinIcon(isExpanded ? "folder_open" : "folder", "folder-tree-icon"),
        );

        const name = document.createElement("span");
        name.className = "folder-tree-name";
        name.textContent = folder.name;
        row.appendChild(name);

        const activate = () => {
          this.activeFolderPath = folderPath;
          this.#updateFolderHighlight();
          this.callbacks.onFolderSelect(folderPath);
          if (!this.#expanded.has(folderPath)) {
            this.#expanded.add(folderPath);
            void this.refreshFolderTree();
          }
        };
        row.addEventListener("click", activate);
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            activate();
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            if (!isExpanded) void this.#toggleExpand(folderPath);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            if (isExpanded) void this.#toggleExpand(folderPath);
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
    if (this.#expanded.has(folderPath)) this.#expanded.delete(folderPath);
    else this.#expanded.add(folderPath);
    await this.refreshFolderTree();
  }

  #updateFolderHighlight(): void {
    const treeContainer = this.querySelector<HTMLElement>(".sidebar-folder-tree");
    if (!treeContainer) return;
    for (const item of treeContainer.querySelectorAll<HTMLElement>(".folder-tree-item")) {
      const p = item.dataset["folderPath"];
      item.classList.toggle("active", p === this.activeFolderPath);
    }
  }
}

if (!customElements.get("annot-sidebar")) {
  customElements.define("annot-sidebar", AnnotSidebarElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-sidebar": AnnotSidebarElement;
  }
}
