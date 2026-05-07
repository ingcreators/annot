/**
 * Editor session — owns the per-image editor lifecycle:
 * canvas + history + selection construction, file-details drawer,
 * right property panel, toolbar, keyboard-shortcut help, scratchpad
 * popover + paste tool, fit-observer, and the teardown of all of
 * the above.
 *
 * Extracted from `app.ts` as part of the Phase 2 decomposition
 * (see `docs/plans/_done/app-decomposition.md`). `AnnotApp` holds a
 * reference and forwards `setupEditor` / `dispose` calls; the session
 * reaches other collaborators through direct instance references
 * (HeaderHost / StatusHost / SavePipeline) instead of re-plumbing
 * everything through a deps-object indirection.
 */

import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import type { ImageRecord, PageMetadata, StorageProvider } from "@ingcreators/annot-core/storage";
import { getFilename } from "@ingcreators/annot-core/storage";
import { assertNonNull } from "@ingcreators/annot-core/utils";
import type { CanvasManager, History, SelectionManager } from "@ingcreators/annot-editor";
import { openAnchoredPopover } from "@ingcreators/annot-editor";
import type { AnnotFileDetailsDrawerElement } from "@ingcreators/annot-editor-shell/annot-file-details-drawer";
import { estimateDataUrlBytes } from "@ingcreators/annot-editor-shell/annot-file-details-drawer";
import { Toolbar } from "@ingcreators/annot-editor-shell/toolbar";
import "@ingcreators/annot-editor-shell/annot-file-details-drawer";
import { EditorShell, installKeyboardHelp } from "@ingcreators/annot-editor-shell";
import type { AnnotEditorRightPanelElement } from "@ingcreators/annot-editor-shell/right-panel";
import "@ingcreators/annot-editor-shell/right-panel";
import {
  type AnnotScratchpadSectionElement,
  renderThumbnail,
  ScratchpadPasteTool,
  serializeSelection,
} from "@ingcreators/annot-editor-shell";
import "@ingcreators/annot-editor-shell/annot-scratchpad-section";
import type { StatusHost } from "@ingcreators/annot-editor-shell/orchestrators/status-host";
import type { ScratchpadStore } from "../editor/scratchpad-store.js";
import { getStorageMode } from "../storage/bridge.js";
import { addClickMarker } from "./click-marker.js";
import type { HeaderHost } from "./header-host.js";
import type { UISection } from "./plugin-host.js";
import type { SavePipeline } from "./save-pipeline.js";

export interface EditorHandle {
  canvas: CanvasManager;
  history: History;
  selection: SelectionManager;
}

export interface EditorSessionDeps {
  getStorage(): StorageProvider | null;
  getCurrentImagePath(): string | null;
  getCurrentImageRecord(): ImageRecord | null;
  getCurrentFolderPath(): string;
  getCurrentTags(): Record<string, string>;
  setCurrentTags(tags: Record<string, string>): void;
  /** Plugin-registered drawer sections. The drawer combines this
   *  list with built-ins, filters by `isBuiltinUISectionDisabled`,
   *  sorts by `priority`, and mounts each. Optional. */
  getDrawerSections?(): UISection[];
  /** Plugin-registered right-panel sections. Same shape and
   *  semantics as `getDrawerSections`. Optional. */
  getRightPanelSections?(): UISection[];
  /** True if the deployment opted out of the named built-in UI
   *  section via `App.init({ disableBuiltinUISections })`. Used
   *  for both the drawer (Phase 2) and the right-panel
   *  (Phase 3). */
  isBuiltinUISectionDisabled?(id: string): boolean;
  /** Fire the plugin-host `onEditorReady` event. Called at the end
   *  of `setupEditor` once the canvas / history / right panel are
   *  wired but before the first autosave can fire. */
  notifyEditorReady(ev: { path: string | null; tags: Record<string, string> }): void;
}

export class EditorSession {
  #currentEditor: EditorHandle | null = null;
  /** Host-neutral editor lifecycle owner. Lazy-constructed on first
   *  `setupEditor` call (storage provider isn't resolved at
   *  EditorSession construction time, and the shell's `<svg>`
   *  adoption needs the index.html-shipped element which only the
   *  host can locate). Reused across image opens — `mountFromRecord`
   *  disposes the prior canvas / selection internally. */
  #shell: EditorShell | null = null;
  /** Disposers for shell event subscriptions. Re-installed at the
   *  end of every `setupEditor` so PWA-side wiring (right-panel
   *  selection sync, autosave debounce on dirty) reflects the
   *  current canvas + history references the shell just produced. */
  #unsubSelectionChange: (() => void) | null = null;
  #unsubDirty: (() => void) | null = null;
  /** ResizeObserver that keeps the canvas fitted to the viewport
   *  while "Fit to window" mode is active. Observes #canvas-container
   *  so panel open/close, window resize, and toolbar height changes
   *  all re-trigger the fit. */
  #fitObserver: ResizeObserver | null = null;
  /** Current editor toolbar. Kept around so the header-level Save /
   *  Copy actions can delegate to the toolbar's canonical implementation
   *  (saveNow, copyNow, showSaveMenu) instead of re-implementing them. */
  #editorToolbar: Toolbar | null = null;
  /** Right-side property panel (tool properties + selection properties).
   *  Rebuilt per editor session. */
  #editorRightPanel: AnnotEditorRightPanelElement | null = null;
  /** The file-details drawer, created per editor session. */
  #fileDetailsDrawer: AnnotFileDetailsDrawerElement | null = null;
  /** DOM-element metadata captured alongside the current screenshot
   *  (browser-extension captures only). Drives the Elements sidebar
   *  panel / smart-annotation features in the editor. Null when the
   *  image has no metadata (paste, desktop capture, legacy). */
  #pageMetadata: PageMetadata | null = null;
  /** Teardown for the global `?` keyboard-help listener. Installed
   *  once at editor boot; removed on destroy. */
  #keyboardHelpUninstall: (() => void) | null = null;
  /** Reference to the Scratchpad toolbar button — kept so future hooks
   *  (e.g. highlighting when armed) have a stable anchor. */
  #scratchpadToolbarBtn: HTMLButtonElement | null = null;
  /** Live `<annot-scratchpad-section>` element while its popover is
   *  open; null otherwise. Lets external events (selection change,
   *  tool change) push state in even if the popover is currently
   *  closed (they just become no-ops). */
  #openScratchpadSection: AnnotScratchpadSectionElement | null = null;
  /** Cached "is selection non-empty in Select mode" so a freshly
   *  opened scratchpad popover can reflect the save-enabled state
   *  without waiting for the next selection event. */
  #scratchpadCanSave = false;
  /** Id of the scratchpad item currently armed for paste (if any).
   *  Persists across popover open/close cycles so reopening shows the
   *  same active thumbnail. */
  #armedScratchpadItemId: string | null = null;
  /** Latest original data URL — used to approximate file size for the drawer. */
  #currentImageDataUrl = "";

  constructor(
    private readonly deps: EditorSessionDeps,
    private readonly headerHost: HeaderHost,
    private readonly statusHost: StatusHost,
    private readonly savePipeline: SavePipeline,
    private readonly scratchpadStore: ScratchpadStore,
  ) {}

  getEditor(): EditorHandle | null {
    return this.#currentEditor;
  }

  getCanvas(): CanvasManager | null {
    return this.#currentEditor?.canvas ?? null;
  }

  getToolbar(): Toolbar | null {
    return this.#editorToolbar;
  }

  getFileDetailsDrawer(): AnnotFileDetailsDrawerElement | null {
    return this.#fileDetailsDrawer;
  }

  getCurrentImageDataUrl(): string {
    return this.#currentImageDataUrl;
  }

  getImageSize(): { width: number; height: number } {
    const canvas = this.#currentEditor?.canvas;
    return { width: canvas?.imageWidth ?? 0, height: canvas?.imageHeight ?? 0 };
  }

  /** Tear down the previous editor session's PWA-side state.
   *
   *  Canvas / Selection / History listeners — those are owned by
   *  `EditorShell` after the `editor-session-shell-switchover` plan,
   *  and the next `mountFromRecord` call disposes them
   *  automatically. So `disposePreviousEditor` no longer needs to
   *  call `selection.destroy()` / `canvas.destroy()` itself; it
   *  just clears the local handle + unsubscribes shell event
   *  listeners + drops the fit observer.
   *
   *  Called from `resetSessionUI` (gallery-return) and from
   *  `setupEditor` (defensive — the shell's mount path also
   *  cleans up, but `disposePreviousEditor` keeps the explicit
   *  contract that no stale `EditorHandle` survives across
   *  back-to-back opens). */
  disposePreviousEditor(): void {
    if (!this.#currentEditor) return;
    this.#unsubSelectionChange?.();
    this.#unsubSelectionChange = null;
    this.#unsubDirty?.();
    this.#unsubDirty = null;
    this.#currentEditor = null;
    this.#fitObserver?.disconnect();
    this.#fitObserver = null;
  }

  /** Release per-session UI resources when leaving the editor for the
   *  gallery view. The `SaveStatusIndicator` lives on `HeaderHost` so
   *  `HeaderHost.reset()` is invoked there, not here. */
  resetSessionUI(): void {
    this.#fileDetailsDrawer?.destroy();
    this.#fileDetailsDrawer = null;
    this.#editorToolbar = null;
    this.disposePreviousEditor();
    this.#editorRightPanel?.destroy();
    this.#editorRightPanel = null;
  }

  setupEditor(
    dataUrl: string,
    width: number,
    height: number,
    annotations?: string,
    pageMetadata?: PageMetadata,
  ): void {
    this.#currentImageDataUrl = dataUrl;
    this.#pageMetadata = pageMetadata ?? null;

    // Clear local handles + shell-event subscriptions from the
    // previous open. The shell itself disposes its CanvasManager /
    // SelectionManager / History on the upcoming `mountFromRecord`,
    // so the cleanup here is purely PWA-side bookkeeping.
    this.disposePreviousEditor();

    const canvasContainer = assertNonNull(
      document.getElementById("canvas-container"),
      "#canvas-container missing — check index.html shell",
    );
    const fileManagerEl = assertNonNull(
      document.getElementById("file-manager"),
      "#file-manager missing — check index.html shell",
    );
    fileManagerEl.style.display = "none";
    canvasContainer.style.display = "";

    const statusbar = assertNonNull(
      document.getElementById("statusbar"),
      "#statusbar missing — check index.html shell",
    );
    statusbar.style.display = "";

    // Resolve / create the SVG element the shell will mount into.
    // The PWA's `index.html` ships `<svg id="svg-root">` so first-
    // render CSS hits the styled element before JS boots; the
    // fallback creation path covers the case where the shell HTML
    // was substituted for something custom (and gallery → editor
    // re-entry, since the SVG persists on `#canvas-container`
    // across sessions). The shell tags the element with
    // `data-annot-shell-root="1"` and clears children + inline
    // style on each mount, mirroring the legacy in-place reset.
    let svg = document.getElementById("svg-root") as unknown as SVGSVGElement | null;
    if (!svg) {
      canvasContainer.innerHTML = "";
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
      svg.id = "svg-root";
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
      canvasContainer.appendChild(svg);
    }
    canvasContainer.querySelector(".property-panel")?.remove();

    // Lazy-construct the shell on first setupEditor call. Storage
    // isn't resolved at EditorSession construction time so the
    // shell can't be built in the constructor. Reused across opens
    // — `mountFromRecord` disposes the prior canvas / selection /
    // history internally and rebuilds against the supplied SVG.
    const shell = this.#ensureShell(canvasContainer, svg);

    // Synthesize a sparse ImageRecord from the per-call (dataUrl,
    // width, height, annotations) plus the deps' currently-open
    // record context (so any `saveNow()` the shell triggers — not
    // wired to PWA's autosave today, but a future migration of the
    // savePipeline through the shell would expect it — preserves
    // tags / sourceUrl / createdAt). The shell's `mountFromRecord`
    // only reads `originalDataUrl` / `width` / `height` /
    // `annotationsSvg` for the canvas and stashes the rest.
    const currentPath = this.deps.getCurrentImagePath();
    const currentRecord = this.deps.getCurrentImageRecord();
    const record = synthesizeShellRecord(dataUrl, width, height, annotations ?? "", currentRecord);
    shell.mountFromRecord(currentPath, record);
    shell.setPageMetadata(this.#pageMetadata);

    const canvas = assertNonNull(
      shell.getCanvas(),
      "EditorSession: shell.getCanvas() returned null after mountFromRecord",
    );
    const history = assertNonNull(
      shell.getHistory(),
      "EditorSession: shell.getHistory() returned null after mountFromRecord",
    );
    const selection = assertNonNull(
      shell.getSelection(),
      "EditorSession: shell.getSelection() returned null after mountFromRecord",
    );

    // Keep "Fit to window" tracking the viewport size: re-fit whenever
    // #canvas-container resizes. This covers window resize, right-panel
    // open/close (future), devtools toggle, etc. — the user picks Fit
    // once and the canvas keeps matching the viewport.
    this.#fitObserver?.disconnect();
    this.#fitObserver = new ResizeObserver(() => canvas.refitIfFitMode());
    this.#fitObserver.observe(canvasContainer);

    // Mark the body as "editor mode" so the editor-header becomes visible
    // and the toolbar / canvas offsets account for it.
    // showGalleryView() removes this class.
    document.body.classList.add("editor-mode");

    // Tear down any drawer from a previous editor session and build a
    // fresh one for this image. Attached to document.body so it uses the
    // same absolute-positioning coordinate space as toolbar/canvas/statusbar.
    this.#fileDetailsDrawer?.destroy();
    const drawer = document.createElement("annot-file-details-drawer");
    drawer.data = {
      filename: currentPath ? getFilename(currentPath) : "(untitled)",
      folderPath: currentRecord?.folderPath ?? this.deps.getCurrentFolderPath(),
      width,
      height,
      fileSizeBytes: estimateDataUrlBytes(dataUrl),
      createdAt: currentRecord?.createdAt,
      updatedAt: currentRecord?.updatedAt,
      sourceUrl: currentRecord?.sourceUrl,
      tags: this.deps.getCurrentTags(),
      externalLinks: this.headerHost.buildExternalLinksFor(currentPath),
    };
    drawer.getPluginSections = this.deps.getDrawerSections ?? null;
    drawer.isBuiltinSectionDisabled = this.deps.isBuiltinUISectionDisabled ?? null;
    drawer.onRename = (newName) => this.headerHost.renameCurrentImage(newName);
    drawer.onTagsChange = (t) => {
      this.deps.setCurrentTags(t);
      void this.savePipeline.writeAnnotations();
    };
    document.body.appendChild(drawer);
    this.#fileDetailsDrawer = drawer;
    // GitHub: commit lookup is a separate API call (~300ms) that we
    // don't want to block the editor opening on. Fire it in the
    // background and patch the drawer when it lands.
    void this.headerHost.populateLastCommit(currentPath);

    this.headerHost.build();
    this.statusHost.build(canvas, width, height);

    // The editor toolbar moves from the top bar to a left vertical
    // sidebar (Draw.io / Figma pattern). Theme toggle + gallery button
    // live in the editor header; save/copy/open move there too as
    // document-level actions. Tool ▼ dropdowns are suppressed because
    // the right panel renders tool properties persistently instead.
    const sidebarEl = assertNonNull(
      document.getElementById("editor-sidebar"),
      "#editor-sidebar missing — check index.html shell",
    );
    sidebarEl.innerHTML = "";
    const toolbar = new Toolbar(
      sidebarEl,
      canvas,
      history,
      selection,
      (toolName, toolId) => {
        this.statusHost.setActiveTool(toolName);
        // Show the active tool's properties in the right panel
        // (or hide the tool section when switching to Select).
        this.#editorRightPanel?.showToolProperties(toolId);
        // Any toolbar tool change also cancels a pending scratchpad
        // paste — clear the armed-thumbnail highlight so the user
        // isn't led to believe the scratchpad item is still waiting
        // to drop. (The popover may not currently be open; the
        // section instance is tracked separately so we can still
        // clear its state if the user reopens it.)
        if (this.#openScratchpadSection) {
          this.#openScratchpadSection.activeItemId = null;
        }
        this.#armedScratchpadItemId = null;
      },
      {
        orientation: "vertical",
        showThemeToggle: false,
        showGalleryButton: false,
        showSaveGroup: false,
        // Variant flyouts (shape / arrow / text / draw / redact) open
        // a compact icon-chip row from the ▼ arrow. Full property
        // editing still lives in the right panel — the flyout only
        // shortcuts "pick sub-shape → start drawing".
        hideToolDropdowns: false,
        // Direct-download filenames preserve the opened image's base
        // name (see `buildDownloadName` in core). Freshly-captured
        // images without a stored path fall back to the timestamp
        // default inside the export functions.
        getCurrentFilename: () =>
          this.deps.getCurrentImagePath()
            ? getFilename(this.deps.getCurrentImagePath()!)
            : undefined,
      },
    );
    this.#editorToolbar = toolbar;

    // Scratchpad library lives on the toolbar (consistent with other
    // "add to canvas" actions). The popover is rendered against the
    // button via core's shared popover helper.
    const scratchpadBtn = toolbar.registerExtraToolButton({
      id: "scratchpad",
      icon: "collections_bookmark",
      title: "Scratchpad",
      onClick: (anchor) => this.#openScratchpadPopover(anchor, canvas, selection, history),
    });
    this.#scratchpadToolbarBtn = scratchpadBtn;

    // Right property panel — now pure context (tool defaults +
    // selection properties). Scratchpad moved to the toolbar as its
    // own library popover so the right panel has a single clean
    // responsibility: "edit the thing the user is focused on".
    const rightPanelEl = assertNonNull(
      document.getElementById("editor-right-panel"),
      "#editor-right-panel missing — check index.html shell",
    );
    this.#editorRightPanel?.destroy();
    rightPanelEl.innerHTML = "";
    const panel = document.createElement("annot-editor-right-panel");
    panel.toolbar = toolbar;
    panel.canvas = canvas;
    panel.history = history;
    panel.selection = selection;
    panel.getPluginSections = this.deps.getRightPanelSections ?? null;
    panel.isBuiltinSectionDisabled = this.deps.isBuiltinUISectionDisabled ?? null;
    rightPanelEl.appendChild(panel);
    this.#editorRightPanel = panel;
    // Push DOM-element metadata (captured by the browser extension)
    // into the right panel so the Elements section appears for
    // browser-sourced screenshots. Null/undefined hides the section
    // gracefully for paste / desktop / legacy captures.
    this.#editorRightPanel.setPageMetadata(this.#pageMetadata);

    // Global `?` key → open the keyboard-shortcut help modal. Idempotent
    // — if a prior editor session installed a listener, tear it down
    // first so we don't stack handlers across re-opens.
    this.#keyboardHelpUninstall?.();
    this.#keyboardHelpUninstall = installKeyboardHelp();

    // Selection-change → right-panel selection-properties refresh +
    // scratchpad save-enabled tracking. Subscribed via `shell.on`
    // (the shell's own emit drives the bridge from
    // `SelectionManager.onChange`), which keeps the PWA symmetric
    // with the VSCode webview and lets the shell layer something
    // additional later without changing every consumer. Disposer
    // stored so the next `setupEditor` can swap in fresh handlers
    // bound to the new canvas / selection refs.
    this.#unsubSelectionChange = shell.on("selection-change", () => {
      const els = selection.selectedElements;
      // Selection-based properties only show while Select is active;
      // during a drawing tool, we keep the tool's defaults visible
      // even if a shape was momentarily selected by the creation flow.
      if (els.length > 0 && !canvas.activeTool) {
        this.#editorRightPanel?.showSelectionProperties(els);
      } else {
        this.#editorRightPanel?.showSelectionProperties([]);
      }
      // Scratchpad "+ Save" button is enabled only while something
      // is selected in Select mode (serializeSelection needs at
      // least one element). Stored so the popover can consult it when
      // it opens later.
      this.#scratchpadCanSave = els.length > 0 && !canvas.activeTool;
      if (this.#openScratchpadSection) {
        this.#openScratchpadSection.saveEnabled = this.#scratchpadCanSave;
      }
    });

    // Click-marker path. The shell's `mountFromRecord` already
    // restored `record.annotationsSvg` (when non-empty) before
    // wiring its internal `dirty` emit, so an annotated open does
    // NOT reach this branch. For un-annotated opens of click-
    // captured screenshots, draw the target marker once and persist
    // it. We do this BEFORE subscribing to `dirty` below — the
    // explicit `writeAnnotations()` call already covers the save,
    // and we don't want the debounced autosave path to also fire
    // for the seeded history.save().
    if (!record.annotationsSvg) {
      const tags = this.deps.getCurrentTags();
      if (
        tags["click.x"] !== undefined &&
        tags["click.y"] !== undefined &&
        tags["click.marker"] !== "added"
      ) {
        // First-time open of a click-captured image — draw a target marker
        // at the recorded click position so the user sees where the click was.
        addClickMarker(canvas, tags);
        tags["click.marker"] = "added";
        history.save();
        // Persist the marker so we don't re-add it on next open,
        // and so the thumbnail gets refreshed with the marker included.
        void this.savePipeline.writeAnnotations();
      }
    }

    // Dirty (autosave debounce). Subscribed via `shell.on` instead
    // of writing `history.onStateChange` directly so the shell's
    // single-slot callback (set by `#mountCanvas`) keeps emitting
    // events to all subscribers. The shell snapshots its handler
    // list before each emit, so unsubscribe-during-emit is safe.
    this.#unsubDirty = shell.on("dirty", () => {
      // Reflect "edits made" immediately — the debounce hides latency
      // but the user should know something will be saved soon.
      const statusEl = this.headerHost.getSaveStatusIndicator();
      if (statusEl) statusEl.status = "pending";
      // Network-backed stores (Drive, GitHub) get a longer debounce
      // than local ones so a rapid slider sweep / series of small
      // adjustments coalesces into a single upload instead of a
      // fusillade. Local stores can afford the tight 500 ms window.
      //
      // GitHub previously ran at 10 s specifically to keep the
      // commit log readable when every save was a fresh commit.
      // The `#commitFileAmendable` path in GitHubStore now collapses
      // a streak of same-file updates into a single commit on the
      // branch regardless of save frequency, so the debounce can go
      // back to parity with Drive without risking log spam.
      const mode = getStorageMode();
      const saveDebounceMs = mode === "github" || mode === "googledrive" ? 1500 : 500;
      this.savePipeline.scheduleAnnotationSave(saveDebounceMs);
      this.savePipeline.scheduleThumbnailRegen(2000);
    });

    this.#currentEditor = { canvas, history, selection };

    // Tell plugins the editor is fully wired. Runs AFTER onStateChange
    // is hooked so a plugin that edits annotations inside onEditorReady
    // goes through the normal autosave path, not an orphan state.
    this.deps.notifyEditorReady({
      path: this.deps.getCurrentImagePath(),
      tags: this.deps.getCurrentTags(),
    });
  }

  /**
   * Serialize the current selection into the scratchpad so the user
   * can paste it back later. Uses scratchpad-utils' serializeSelection
   * (wraps elements in an origin-anchored <g> + computes bbox) and
   * renderThumbnail (blob URL → <img> → <canvas> → PNG) for preview.
   */
  async #saveSelectionToScratchpad(selection: SelectionManager): Promise<void> {
    const els = selection.selectedElements;
    if (els.length === 0) return;

    const serialized = serializeSelection(els);
    if (!serialized) return;

    try {
      const thumbnail = await renderThumbnail(serialized.svgMarkup, 80);
      const item = await this.scratchpadStore.save({
        svgMarkup: serialized.svgMarkup,
        thumbnail,
        width: serialized.width,
        height: serialized.height,
      });
      await this.#openScratchpadSection?.addItem(item);
    } catch (e) {
      console.error("[scratchpad] save failed:", e);
    }
  }

  /**
   * Open the Scratchpad library popover anchored to the toolbar
   * button. Reuses the existing `<annot-scratchpad-section>` (thumbnail grid +
   * save button) — just in a popover instead of the right panel.
   *
   * The section is stored on `this.#openScratchpadSection` while the
   * popover is open so save/insert callbacks, selection changes, and
   * tool-change events can still push state in; on close, the ref is
   * cleared.
   */
  #openScratchpadPopover(
    anchor: HTMLElement,
    canvas: CanvasManager,
    selection: SelectionManager,
    history: History,
  ): void {
    openAnchoredPopover(
      anchor,
      (root) => {
        const section = document.createElement("annot-scratchpad-section");
        section.store = this.scratchpadStore;
        section.saveEnabled = this.#scratchpadCanSave;
        section.activeItemId = this.#armedScratchpadItemId;
        section.addEventListener("annot-scratchpad-save-request", () => {
          void this.#saveSelectionToScratchpad(selection);
        });
        section.addEventListener("annot-scratchpad-insert", (e) => {
          const { item } = e.detail;
          this.#armScratchpadPaste(canvas, selection, history, item);
          this.#armedScratchpadItemId = item.id;
          section.activeItemId = item.id;
        });
        root.appendChild(section);
        this.#openScratchpadSection = section;
        // Cleanup when the popover closes — the MutationObserver on
        // <body> catches the helper's `remove()` regardless of WHY the
        // popover closed (outside click, Escape, resize-kill, etc).
        const obs = new MutationObserver(() => {
          if (!root.isConnected) {
            this.#openScratchpadSection = null;
            obs.disconnect();
          }
        });
        obs.observe(document.body, { childList: true, subtree: false });
      },
      { placement: "right", className: "tool-flyout-scratchpad" },
    );
  }

  /**
   * Arm a scratchpad-paste tool. Clicking the thumbnail doesn't
   * insert immediately — it puts the editor into a short-lived
   * "placement mode" where the next click on the canvas drops the
   * item at that exact position.
   *
   * This matches the gesture model of drawing tools (Rectangle, Arrow,
   * Sticky, …) where a tool is armed and then a canvas click creates
   * the shape. Users get precise placement without dragging tiny
   * thumbnails, and the mental model stays consistent across the
   * whole sidebar.
   *
   * Escape cancels placement without inserting. After insertion or
   * cancel, the toolbar returns to Select mode and (on success) the
   * inserted elements become the current selection so the user can
   * immediately re-drag them if the first placement wasn't perfect.
   */
  #armScratchpadPaste(
    canvas: CanvasManager,
    selection: SelectionManager,
    history: History,
    item: { svgMarkup: string; width: number; height: number },
  ): void {
    // Clear the previous selection before entering placement mode.
    // Keeping the old selection handles visible while the user is
    // about to place a NEW item is confusing — handles imply "this
    // is the subject of my next action", which conflicts with the
    // paste tool's "click to drop a fresh object" semantics.
    selection.select(null);

    // ScratchpadPasteTool doesn't actually use ToolOptions, but
    // ToolBase requires them. Pass neutral defaults.
    const opts: ToolOptions = {
      strokeColor: "#ff0000",
      fillColor: "none",
      strokeWidth: 2,
      fontSize: 16,
      strokeDasharray: "",
      fillOpacity: 1,
    };
    const tool = new ScratchpadPasteTool(canvas, history, opts, item);
    tool.onInsert = (inserted) => {
      if (inserted.length === 1) {
        selection.select(inserted[0]!);
      } else if (inserted.length > 1) {
        selection.selectMultiple(inserted);
      }
    };
    tool.onShapeComplete = () => {
      // Return the toolbar to Select mode so its UI reflects the
      // canvas state after the one-shot paste finishes (or is
      // canceled via Escape). onToolChange fires inside activateSelectMode
      // and the app-level handler clears the armed-thumbnail highlight.
      this.#editorToolbar?.activateSelectMode();
    };
    canvas.setActiveTool(tool);

    // Sync the toolbar UI + footer status with the now-armed paste tool:
    // no toolbar button highlighted, footer shows "Scratchpad".
    // The label matches the sidebar area the armed item came from so the
    // user can identify the context at a glance.
    this.#editorToolbar?.setExternalToolActive("Scratchpad", null);
  }

  /** Resolve (or lazily construct) the per-session `EditorShell`.
   *
   *  Called from `setupEditor` with the current `<svg id="svg-root">`
   *  + `#canvas-container` references. Constructs the shell once per
   *  EditorSession instance — subsequent calls just return the
   *  existing shell. The shell's `mountFromRecord` handles per-image
   *  canvas / history / selection construction and disposal.
   *
   *  The shell's storage reference is whatever `deps.getStorage()`
   *  returns at first-call time. The PWA's storage IS dynamic
   *  (mode-switch can swap between LocalStore / DriveStore /
   *  GitHubStore), but switching modes navigates back to the
   *  gallery first, and editor sessions don't span mode swaps.
   *  The shell's `saveNow` is also not on the PWA's autosave path
   *  today (savePipeline.writeAnnotations owns that), so the stored
   *  reference being slightly stale matters less than it would for
   *  a host that drives saves through the shell. */
  #ensureShell(container: HTMLElement, svgRoot: SVGSVGElement): EditorShell {
    if (this.#shell) return this.#shell;
    const storage = assertNonNull(
      this.deps.getStorage(),
      "EditorSession: storage not yet resolved when constructing EditorShell",
    );
    this.#shell = new EditorShell({
      container,
      storage,
      svgRoot,
      // Defaults favour the PWA — capture pipeline, file manager,
      // scratchpad popover, keyboard-help overlay all on. Today
      // the shell doesn't act on these flags itself (they're
      // declarative for now, intended for future feature gating);
      // listing them explicitly documents the PWA's surface.
      features: {
        capture: true,
        fileManager: true,
        scratchpad: true,
        keyboardHelp: true,
      },
    });
    return this.#shell;
  }
}

/** Build a sparse `ImageRecord` from the (`dataUrl`, `width`,
 *  `height`, `annotations`) call args + the deps' currently-open
 *  record context. The shell's `mountFromRecord` only reads
 *  `originalDataUrl` / `width` / `height` / `annotationsSvg` for
 *  the canvas — the other fields ride along so a future
 *  `shell.saveNow()` call would `updateImage` against a record
 *  with the live tags / sourceUrl / createdAt instead of an
 *  empty stub. The PWA today drives saves through `savePipeline`
 *  rather than `shell.saveNow`, so this preservation is forward-
 *  looking, not behaviour-critical for this PR. */
function synthesizeShellRecord(
  dataUrl: string,
  width: number,
  height: number,
  annotations: string,
  currentRecord: ImageRecord | null,
): ImageRecord {
  const now = new Date().toISOString();
  if (currentRecord) {
    return {
      ...currentRecord,
      originalDataUrl: dataUrl,
      annotationsSvg: annotations,
      width,
      height,
    };
  }
  return {
    path: "",
    folderPath: "",
    width,
    height,
    originalDataUrl: dataUrl,
    annotationsSvg: annotations,
    sourceUrl: "",
    tags: {},
    createdAt: now,
    updatedAt: now,
  } as ImageRecord;
}
