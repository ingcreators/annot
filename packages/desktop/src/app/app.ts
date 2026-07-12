// CSS imports — mirror packages/web/src/main.ts. The desktop's
// index.html intentionally has no <link> tags; Vite resolves the
// workspace-package paths at build time and inlines the styles
// into the renderer bundle. file-manager.css scopes its rules
// under #file-manager / #sidebar / #main-content; the host DOM
// in index.html uses those exact ids so the rules apply.
import "@ingcreators/annot-core/styles/editor.css";
import "@ingcreators/annot-core/styles/toolbar.css";
import "@ingcreators/annot-core/styles/property-panel.css";
import "@ingcreators/annot-core/styles/fonts.css";
import "@ingcreators/annot-host-ui/styles/file-manager.css";
import "../styles/app.css";

import { applyPersistedTheme } from "@ingcreators/annot-editor";
// Phase 1 of `docs/plans/_done/host-convergence.md` swapped the desktop's
// imperative `new CanvasManager / new History / new SelectionManager`
// chain for `EditorShell.mountFromRecord`. The shell owns the per-image
// canvas / history / selection lifecycle; the desktop adapter wires
// the surrounding chrome (editor-header / right-panel / drawer /
// statusbar) to the shell's events.
import {
  type AnnotFileDetailsDrawerElement,
  EditorShell,
  installKeyboardHelp,
} from "@ingcreators/annot-host-ui";
import type { AnnotEditorRightPanelElement } from "@ingcreators/annot-host-ui/right-panel";
import "@ingcreators/annot-host-ui/right-panel";
import "@ingcreators/annot-host-ui/editor-statusbar";
import {
  captureScreen,
  isDesktop,
  minimizeMainWindow,
  restoreMainWindow,
} from "@ingcreators/annot-core/desktop-bridge";
import { getFilename, type ImageRecord } from "@ingcreators/annot-core/storage";
import { estimateDataUrlBytes } from "@ingcreators/annot-host-ui";
import { HeaderHost } from "@ingcreators/annot-host-ui/orchestrators/header-host";
import {
  SAVE_DEBOUNCE_LOCAL_MS,
  SavePipeline,
} from "@ingcreators/annot-host-ui/orchestrators/save-pipeline";
import { StatusHost } from "@ingcreators/annot-host-ui/orchestrators/status-host";
import { Toolbar } from "@ingcreators/annot-host-ui/toolbar";
import { showConfirmDialog } from "@ingcreators/annot-host-ui/ui/dialog";
import { bootstrapDesktopFsGallery, type DesktopGalleryHandle } from "../storage/bootstrap.js";

// Restore the user's last-chosen theme + any saved token overrides
// before first paint. Mirrors the PWA's main.ts flow.
applyPersistedTheme();

interface ElectronApi {
  invoke<T = unknown>(channel: string, args?: unknown): Promise<T>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

function api(): ElectronApi | null {
  return (
    (typeof window !== "undefined"
      ? (window as unknown as { electronAPI?: ElectronApi }).electronAPI
      : undefined) ?? null
  );
}

let fsGallery: DesktopGalleryHandle | null = null;

// =============================================================
// Editor session — one open image at a time.
// =============================================================
//
// The desktop now follows the same shape as the PWA's editor:
// `EditorShell` owns canvas / history / selection per-image,
// and the desktop wires the surrounding chrome (editor-header /
// right-panel / drawer / statusbar) to the shell's events.
//
// Phase 3 of `docs/plans/_done/host-convergence.md` collapses the
// debounce + status-indicator + header builders below into the
// shared `HeaderHost` / `StatusHost` / `SavePipeline` primitives.
// Until that lands, the desktop carries throwaway equivalents
// that talk directly to the shell.

interface EditorSession {
  shell: EditorShell;
  toolbar: Toolbar;
  headerHost: HeaderHost;
  rightPanel: AnnotEditorRightPanelElement;
  statusHost: StatusHost;
  savePipeline: SavePipeline;
  drawer: AnnotFileDetailsDrawerElement;
  /** Disposers run when leaving the editor for the gallery. Keeps
   *  the teardown sequence explicit so a future refactor can verify
   *  that nothing leaks across editor sessions. */
  disposers: Array<() => void>;
  /** ResizeObserver that keeps "Fit to window" tracking the
   *  viewport size. Mirrors the PWA's behaviour. */
  fitObserver: ResizeObserver | null;
  /** The image path currently open. Used by autosave + rename. */
  path: string;
  /** The full ImageRecord at open time. Updated on rename so the
   *  drawer's File / Tags sections stay in sync. */
  record: ImageRecord;
  /** Mutable tag map driven by drawer edits. SavePipeline reads
   *  via `getCurrentTags()` so tag edits ride alongside annotation
   *  saves through the unified `storage.updateImage` call instead
   *  of the previous separate-write path. */
  tags: Record<string, string>;
}

let session: EditorSession | null = null;

function showEditorView(): void {
  document.getElementById("editor-view")!.style.display = "";
  // `body.editor-mode` is the switch the editor.css rules in
  // `@ingcreators/annot-core/styles/editor.css` watch for. It
  // promotes `#editor-sidebar` from `display: none` to a 48 px
  // vertical strip, hides the gallery `#toolbar`, and shifts
  // `#canvas-container` to make room for the sidebar.
  document.body.classList.add("editor-mode");
}

function hideEditorView(): void {
  document.getElementById("editor-view")!.style.display = "none";
  document.body.classList.remove("editor-mode");
}

/**
 * Open an image in the editor. Builds an `EditorShell` session
 * around the supplied `ImageRecord` and wires every chrome
 * surface (header / right-panel / drawer / statusbar) plus
 * autosave + error-banner.
 *
 * Idempotent: if an editor session is already open, it's torn
 * down first so the new image starts from a clean state.
 */
function openEditor(record: ImageRecord): void {
  if (!fsGallery) {
    console.error("[desktop] openEditor before gallery bootstrap finished");
    return;
  }
  // Tear down any prior editor session so we don't leak listeners
  // / timers / DOM into the next image. `mountFromRecord` already
  // disposes the shell's CanvasManager / SelectionManager / History,
  // but the surrounding chrome (drawer, observers, error banner,
  // autosave timers) needs explicit cleanup.
  closeEditorSession();

  showEditorView();
  fsGallery.hideGallery();

  const headerEl = document.getElementById("editor-header")!;
  const sidebarEl = document.getElementById("editor-sidebar")!;
  const canvasContainer = document.getElementById("canvas-container")!;
  const rightPanelHostEl = document.getElementById("editor-right-panel")!;
  const statusbarHostEl = document.getElementById("statusbar")!;
  const svg = document.getElementById("svg-root") as unknown as SVGSVGElement;

  // Reset chrome containers — Lit elements use `display: contents`
  // as their host wrapper, so flex children of the host land
  // directly inside the host div on append.
  headerEl.innerHTML = "";
  rightPanelHostEl.innerHTML = "";
  statusbarHostEl.innerHTML = "";
  sidebarEl.innerHTML = "";

  const shell = new EditorShell({
    container: canvasContainer,
    storage: fsGallery.store,
    svgRoot: svg,
  });
  shell.mountFromRecord(record.path, record);

  const canvas = shell.getCanvas();
  const history = shell.getHistory();
  const selection = shell.getSelection();
  if (!canvas || !history || !selection) {
    console.error("[desktop] EditorShell.mountFromRecord did not produce a canvas");
    return;
  }

  // ---- Statusbar ----------------------------------------------
  // Phase 3 of `docs/plans/_done/host-convergence.md` collapsed the inline
  // `<annot-editor-statusbar>` build into the shared `StatusHost`
  // primitive that the PWA + VSCode also use.
  const statusHost = new StatusHost(statusbarHostEl);
  statusHost.build(canvas, record.width, record.height);

  // ---- Toolbar (vertical sidebar) -----------------------------
  // Mirror the PWA's editor-mode toolbar shape: vertical left
  // strip, no gallery / theme / save buttons (those live in
  // `<annot-editor-header>` now). Tool ▼ dropdowns stay enabled
  // because the right panel renders tool properties persistently
  // and the variant flyouts still ship a faster picker.
  //
  // `savePipelineRef` forward-declares a writable handle so the
  // `applyCrop` closure can call `cancelAutoSave()` before the
  // destructive bake's explicit `storage.updateImage` runs (mirrors
  // the PWA wiring + the deferred `applyAllRedactions` assignment
  // below). The closure is only invoked AFTER the user clicks
  // Apply on a drawn crop rect, by which point savePipelineRef has
  // been pointed at the real instance — the null default keeps the
  // type honest until then.
  let savePipelineRef: SavePipeline | null = null;
  const toolbar = new Toolbar(
    sidebarEl,
    canvas,
    history,
    selection,
    (toolName, toolId) => {
      statusHost.setActiveTool(toolName);
      rightPanel.showToolProperties(toolId);
    },
    {
      orientation: "vertical",
      showSettingsButton: false,
      showGalleryButton: false,
      showSaveGroup: false,
      hideToolDropdowns: false,
      getCurrentFilename: () => getFilename(session?.path ?? record.path),
      // Confirm-then-bake gate the CropTool calls when the user
      // commits a crop rect. Mirrors the PWA wiring in
      // `editor-session.ts` and the VSCode wiring in
      // `webview/main.ts`.
      applyCrop: async (x, y, w, h) => {
        const ok = await showConfirmDialog({
          title: "Crop image?",
          message:
            `The image will be permanently cropped to ${Math.round(w)}×${Math.round(h)} pixels. ` +
            "The pixels outside the crop region can no longer be recovered after the next save. Continue?",
          okLabel: "Crop",
          cancelLabel: "Cancel",
          danger: true,
        });
        if (!ok) return false;
        savePipelineRef?.cancelAutoSave();
        const result = await shell.applyCrop(x, y, w, h);
        return result.applied;
      },
    },
  );

  // ---- Right panel --------------------------------------------
  const rightPanel = document.createElement("annot-editor-right-panel");
  rightPanel.toolbar = toolbar;
  rightPanel.canvas = canvas;
  rightPanel.history = history;
  rightPanel.selection = selection;
  rightPanel.getPluginSections = null;
  rightPanel.isBuiltinSectionDisabled = null;
  // Phase 6 of `docs/plans/_done/redact-burn-into-image.md` — wire the
  // shell's burn-in orchestration through the right-panel's
  // "Apply redactions to image" button. Mirrors the PWA's
  // EditorSession registration. The panel hides the button when
  // `redactCount === 0`, so the initial refresh ensures it
  // appears immediately when an annotated document with existing
  // redactions opens.
  //
  // The actual `applyAllRedactions` callback is wired below, AFTER
  // `savePipeline` is constructed — the wiring needs to call
  // `savePipeline.cancelAutoSave()` before the burn's explicit
  // `storage.updateImage` to avoid a debounce-vs-apply race that
  // would PATCH a stale `originalDataUrl` over the burned bytes.
  // See the PWA-side comment in `editor-session.ts` for the full
  // diagnosis. Desktop uses fast local writes so the race rarely
  // triggers there, but the parity matters for correctness.
  rightPanel.refreshRedactCount();
  rightPanelHostEl.appendChild(rightPanel);

  // ---- File details drawer ------------------------------------
  const drawer = document.createElement("annot-file-details-drawer");
  drawer.data = {
    filename: getFilename(record.path),
    folderPath: record.folderPath,
    width: record.width,
    height: record.height,
    fileSizeBytes: estimateDataUrlBytes(record.originalDataUrl),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sourceUrl: record.sourceUrl,
    tags: record.tags,
  };
  drawer.getPluginSections = null;
  drawer.isBuiltinSectionDisabled = null;
  drawer.onRename = (newName) => headerHost.renameCurrentImage(newName);
  drawer.onTagsChange = (tags) => {
    if (!session) return;
    session.tags = tags;
    session.record = { ...session.record, tags };
    // Tag edits ride through the same SavePipeline path as
    // annotation edits — `getCurrentTags()` returns the latest map
    // and `writeAnnotations` folds both into one `updateImage`
    // call. Phase 1's separate `store.updateImage(path, { tags })`
    // shortcut is gone now that the pipeline is shared.
    void session.savePipeline.writeAnnotations();
  };
  document.body.appendChild(drawer);

  // ---- SavePipeline (shared autosave + dirty-debounce) -------
  // Phase 3 / PR B of `docs/plans/_done/host-convergence.md` swapped the
  // throwaway desktop-local debounce shipped in Phase 1 for the
  // shared `SavePipeline` orchestrator. The pipeline owns:
  //   - dirty → debounce → writeAnnotations cadence
  //   - concurrent-save guarding (queue while in-flight, catch up after)
  //   - status-indicator transitions (saving → saved / error)
  //   - flushPending() for navigation boundaries
  // Banner UI is host-specific so it threads through callbacks.
  const sessionTags = { ...record.tags };
  const savePipeline = new SavePipeline({
    getStorage: () => fsGallery!.store,
    getCanvas: () => shell.getCanvas(),
    getCurrentImagePath: () => session?.path ?? null,
    getCurrentTags: () => session?.tags ?? sessionTags,
    getStatusIndicator: () => headerHost.getSaveStatusIndicator(),
    getThumbnailManager: () => null,
    notifyBeforeSave: async () => {
      /* no plugin host on desktop yet — see plugin-host-extraction.md */
    },
    onAfterSave: () => {
      /* no plugin host on desktop yet */
    },
    onSaveError: (message, retry) => surfaceSaveError(message, retry),
    onSaveSuccess: () => hideEditorError(),
  });
  // Point the forward-declared `savePipelineRef` at the live
  // pipeline so the toolbar's `applyCrop` closure (constructed
  // before this point) can reach `cancelAutoSave()`.
  savePipelineRef = savePipeline;

  // ---- Apply-redactions wiring (deferred until savePipeline exists) ----
  // Cancel any pending debounced annotation autosave BEFORE the burn's
  // explicit `storage.updateImage` runs so a draw-redact-then-Apply
  // gesture doesn't leave the timer armed (see the comment block above
  // `rightPanel.refreshRedactCount` for the full race diagnosis).
  rightPanel.applyAllRedactions = () => {
    savePipeline.cancelAutoSave();
    return shell.applyAllRedactions();
  };

  // ---- Editor header (shared HeaderHost orchestrator) -------
  // Phase 3 / PR C of `docs/plans/_done/host-convergence.md` collapsed
  // the inline `<annot-editor-header>` build + populateHeaderProps
  // chain into the shared `HeaderHost` orchestrator. The desktop
  // wires the host-specific concerns as deps callbacks: a constant
  // "Desktop" root label, no-op routing (no router on desktop),
  // and no last-commit fetch (no GitHub backend on desktop yet).
  let pendingNavigationFolder = record.folderPath;
  const headerHost = new HeaderHost(headerEl, {
    getStorage: () => fsGallery!.store,
    getCurrentImagePath: () => session?.path ?? record.path,
    setCurrentImagePath: (p) => {
      if (session) session.path = p;
    },
    getCurrentImageRecord: () => session?.record ?? record,
    setCurrentImageRecord: (r) => {
      if (session) session.record = r;
    },
    getCurrentTags: () => session?.tags ?? sessionTags,
    getCurrentImageDataUrl: () => session?.record.originalDataUrl ?? record.originalDataUrl,
    getCurrentFolderPath: () => pendingNavigationFolder,
    setCurrentFolderPath: (p) => {
      pendingNavigationFolder = p;
    },
    getFileDetailsDrawer: () => drawer,
    getToolbar: () => toolbar,
    getImageSize: () => {
      const c = shell.getCanvas();
      return { width: c?.imageWidth ?? record.width, height: c?.imageHeight ?? record.height };
    },
    showGallery: async () => {
      await backToGallery(pendingNavigationFolder);
    },
    collectExternalLinks: () => undefined,
    getRootLabel: () => "Desktop",
    // Desktop has no in-app router and no GitHub last-commit
    // surface; both deps are intentionally omitted (HeaderHost
    // treats them as no-ops via the optional-method shape).
  });
  headerHost.build();

  // ---- Selection sync → right-panel ---------------------------
  const unsubSelection = shell.on("selection-change", () => {
    const els = selection.selectedElements;
    if (els.length > 0 && !canvas.activeTool) {
      rightPanel.showSelectionProperties(els);
    } else {
      rightPanel.showSelectionProperties([]);
    }
  });

  // ---- Dirty → debounced autosave ----------------------------
  // Local-only DesktopStore — the shared local-tier policy from
  // save-pipeline.ts. Network-backed stores use
  // SAVE_DEBOUNCE_NETWORKED_MS in the PWA; the desktop never sees
  // those, so no conditional here.
  const unsubDirty = shell.on("dirty", () => {
    const status = headerHost.getSaveStatusIndicator();
    if (status) status.status = "pending";
    savePipeline.scheduleAnnotationSave(SAVE_DEBOUNCE_LOCAL_MS);
    // Phase 6 of `docs/plans/_done/redact-burn-into-image.md` — keep
    // the right-panel's apply-redactions button in sync with the
    // document's redact-element count. The count drops to 0
    // right after a successful burn so the button auto-hides
    // without any explicit teardown.
    rightPanel.refreshRedactCount();
  });

  // Surface mount errors from the shell's own emit (covers the
  // `await shell.open(...)` path; SavePipeline's own onSaveError
  // covers direct save throws via the deps callback).
  const unsubError = shell.on("error", (err) => {
    surfaceEditorError("Editor error", err);
  });

  // ---- Fit-to-window observer --------------------------------
  // Re-fit the canvas whenever #canvas-container resizes. Covers
  // window resize, right-panel toggle, devtools open/close.
  const fitObserver = new ResizeObserver(() => canvas.refitIfFitMode());
  fitObserver.observe(canvasContainer);

  // ---- Keyboard shortcuts (?) -------------------------------
  const uninstallKeyboardHelp = installKeyboardHelp();

  // ---- Esc / Ctrl+S keyboard handlers (PWA parity) ----------
  const onKeyDown = (e: KeyboardEvent): void => {
    // Ctrl+S / Cmd+S → flush save now (cancel debounce, save in
    // place). Match the PWA's eager-save-on-Ctrl+S behaviour so
    // users have a manual checkpoint affordance.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void savePipeline.flushPending();
    }
  };
  document.addEventListener("keydown", onKeyDown);

  session = {
    shell,
    toolbar,
    headerHost,
    rightPanel,
    statusHost,
    savePipeline,
    drawer,
    fitObserver,
    path: record.path,
    record,
    tags: sessionTags,
    disposers: [
      unsubSelection,
      unsubDirty,
      unsubError,
      uninstallKeyboardHelp,
      () => document.removeEventListener("keydown", onKeyDown),
    ],
  };
}

/**
 * Tear down the active editor session. Called on every navigation
 * away from the editor (Back button, Browse window open, brand
 * click). Runs disposers in order, destroys the shell, and clears
 * chrome containers so the next open starts from a known-clean
 * state.
 */
function closeEditorSession(): void {
  if (!session) return;
  // Flush any pending save BEFORE we tear the shell down so the
  // user doesn't lose the last keystroke when going back to
  // gallery / opening a different image. Fire-and-forget — the
  // SavePipeline owns its own concurrency gating, and the
  // `getCanvas` / `getCurrentImagePath` deps still resolve until
  // `shell.destroy()` runs below.
  void session.savePipeline.flushPending();
  for (const dispose of session.disposers) {
    try {
      dispose();
    } catch (e) {
      console.error("[desktop] editor session disposer threw:", e);
    }
  }
  session.fitObserver?.disconnect();
  session.drawer.destroy();
  session.rightPanel.destroy();
  session.shell.destroy();
  session = null;
  hideEditorError();
  // Lit elements also live in the host divs — strip them so the
  // next open starts from a clean state without stale event
  // listeners attached to the same custom-element nodes.
  document.getElementById("editor-header")!.innerHTML = "";
  document.getElementById("editor-right-panel")!.innerHTML = "";
  document.getElementById("statusbar")!.innerHTML = "";
  document.getElementById("editor-sidebar")!.innerHTML = "";
  // The shell's `destroy()` already cleared #svg-root's children.
  // `body.has-right-panel` is removed by the right-panel's own
  // disconnectedCallback when it leaves the DOM.
}

async function backToGallery(folderPath: string): Promise<void> {
  closeEditorSession();
  hideEditorView();
  fsGallery?.showGallery();
  await fsGallery?.fileManager.refresh(folderPath);
}

// =============================================================
// Editor error banner (self-contained chrome scoped under
// #editor-error-banner — see app.css).
// =============================================================

function surfaceEditorError(label: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[desktop]", `${label}:`, err);
  showBannerMessage(`${label}: ${message}`);
}

/**
 * SavePipeline-shaped variant: receives a pre-classified message
 * (from the pipeline's 401/403/404/offline/generic decision tree)
 * plus an optional retry callback. The current chrome doesn't yet
 * surface the retry button — for parity with the PWA banner this
 * could grow a "Retry" action button, but for Phase 3 / PR B we
 * keep the banner shape unchanged and just log the retry option.
 */
function surfaceSaveError(message: string, retry?: () => void): void {
  console.error("[desktop] save error:", message);
  showBannerMessage(message, retry);
}

/** Retry callback for the banner's Retry button. Re-assigned on
 *  every `showBannerMessage` call so the single delegated click
 *  handler always fires the latest failed save's retry —
 *  PWA-parity for SavePipeline's `onSaveError(message, retry)`
 *  (metadata-unification Phase 6). */
let bannerRetry: (() => void) | null = null;

function showBannerMessage(message: string, retry?: () => void): void {
  let banner = document.getElementById("editor-error-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "editor-error-banner";
    banner.setAttribute("role", "alert");
    banner.innerHTML =
      '<span id="editor-error-banner-message"></span>' +
      '<button class="action-btn" id="editor-error-banner-retry" type="button">Retry</button>' +
      '<button class="action-btn" id="editor-error-banner-dismiss" type="button">Dismiss</button>';
    document.getElementById("editor-view")!.appendChild(banner);
    banner.querySelector("#editor-error-banner-retry")!.addEventListener("click", () => {
      const fn = bannerRetry;
      hideEditorError();
      fn?.();
    });
    banner
      .querySelector("#editor-error-banner-dismiss")!
      .addEventListener("click", () => hideEditorError());
  }
  bannerRetry = retry ?? null;
  (banner.querySelector("#editor-error-banner-retry") as HTMLElement).style.display = retry
    ? ""
    : "none";
  banner.querySelector("#editor-error-banner-message")!.textContent = message;
  banner.classList.add("visible");
}

function hideEditorError(): void {
  document.getElementById("editor-error-banner")?.classList.remove("visible");
}

// =============================================================
// Image / capture helpers (unchanged from pre-Phase-1).
// =============================================================

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

/**
 * Spawn (or focus) the Browse window. The Browse window embeds an
 * `<webview>` for arbitrary URLs and ships its own
 * back/forward/reload + URL bar + Capture Visible chrome — see
 * `packages/desktop/browse.html` + `src/browse/browse.ts`. Phase 6
 * of `desktop-electron-migration.md` set up the IPC; this helper
 * just calls into it from the renderer's New menu entry.
 *
 * The IPC channel is `browse.open` (per
 * `packages/desktop/src-electron/ipc/browse.ts`); on success the
 * main process either focuses the existing window or spawns a
 * fresh one. The editor session — if any — is torn down first
 * so the user doesn't return to a stale canvas after the Browse
 * window closes.
 */
async function openBrowseWindow(): Promise<void> {
  closeEditorSession();
  const ipc = api();
  if (!ipc) {
    console.error("[desktop] openBrowseWindow: electronAPI unavailable");
    return;
  }
  try {
    await ipc.invoke("browse.open", { url: undefined });
  } catch (err) {
    console.error("[desktop] browse.open failed:", err);
  }
}

// --- Unified screen capture (Snipping Tool style) ---

type CaptureModeType = "fullscreen" | "window" | "rect";

async function doCapture(mode: CaptureModeType): Promise<void> {
  const ipc = api();
  try {
    if (mode === "fullscreen") {
      // Simple: minimize, capture, restore
      await minimizeMainWindow();
      await new Promise((r) => setTimeout(r, 400));
      const result = await captureScreen();
      await restoreMainWindow();
      await persistViaDesktopStore({
        dataUrl: result.data_url,
        width: result.width,
        height: result.height,
        dpr: window.devicePixelRatio || undefined,
      });
      return;
    }

    // rect / window: use overlay window on the actual screen.
    // `start_capture_overlay` isn't surfaced as a typed export on
    // `desktop-bridge` (the orchestration is host-internal), so
    // the renderer drops to the raw `electronAPI.invoke` for it.
    if (!ipc) throw new Error("[desktop] electronAPI unavailable");
    const overlayResult = await ipc.invoke<{
      region: { x: number; y: number; w: number; h: number };
      screenshot_data_url: string;
      screen_width: number;
      screen_height: number;
    } | null>("start_capture_overlay", { mode });

    if (!overlayResult) return;

    // Crop from the ORIGINAL screenshot (taken before overlay was shown)
    const { region, screenshot_data_url } = overlayResult;
    const cropped = await cropImage(screenshot_data_url, region.x, region.y, region.w, region.h);
    await persistViaDesktopStore({
      dataUrl: cropped,
      width: region.w,
      height: region.h,
      dpr: window.devicePixelRatio || undefined,
    });
  } catch (err) {
    try {
      await restoreMainWindow();
    } catch {
      /* ignore */
    }
    if (String(err) !== "Capture cancelled") {
      alert(`Capture failed: ${err}`);
    }
  }
}

function cropImage(
  dataUrl: string,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = sw;
      c.height = sh;
      c.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// --- Init ---

/**
 * Boot the desktop renderer. The unified gallery (`FileManager`
 * from `@ingcreators/annot-web/gallery/file-manager`) mounts
 * against `DesktopStore` and serves as the only gallery surface;
 * the bespoke SQLite-backed gallery + project manager were deleted
 * in Phase 5 of `docs/plans/_done/desktop-storage-provider-migration.md`.
 *
 * The legacy `<portable_dir>/data/` directory (SQLite db, captured
 * thumbnails) stays untouched on disk; Annot never reads or
 * mentions it (the one-time notice was removed in
 * metadata-unification Phase 5). The user owns the back-up /
 * delete decision.
 */
async function init(): Promise<void> {
  fsGallery = await bootstrapDesktopFsGallery({
    onOpenImage: async (record) => {
      if (!fsGallery) return;
      // The gallery's `record` is the index entry; refetch the
      // full one (with `originalDataUrl`) before opening the editor.
      const full = await fsGallery.store.getImage(record.path);
      if (!full) return;
      openEditor(full);
    },
    onCaptureScreen: async () => {
      await doCapture("fullscreen");
    },
    // Phase 5 of `docs/plans/web-capture-redesign.md` made
    // `onTimedCapture` optional and the sidebar now hides the
    // entry when omitted. The desktop host hadn't implemented
    // timed capture beyond the empty stub, so we drop it
    // entirely — users can install the (future) Auto Capture
    // workspace in the desktop host once it's enabled there.
    onPasteClipboard: async () => {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          for (const type of item.types) {
            if (!type.startsWith("image/")) continue;
            const blob = await item.getType(type);
            const dataUrl = await blobToDataUrl(blob);
            const img = await loadImage(dataUrl);
            await persistViaDesktopStore({
              dataUrl,
              width: img.naturalWidth,
              height: img.naturalHeight,
            });
            return;
          }
        }
      } catch (e) {
        console.error("[desktop] paste failed:", e);
      }
    },
    onUploadImage: () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      // Unified post-import navigation (2026-07-12 product
      // decision, PWA parity): a single image opens straight into
      // the editor; multi-file batches import silently and stay on
      // the gallery.
      input.multiple = true;
      input.onchange = async () => {
        const files = Array.from(input.files ?? []);
        if (files.length === 0) return;
        for (const file of files) {
          const dataUrl = await blobToDataUrl(file);
          const img = await loadImage(dataUrl);
          await persistViaDesktopStore({
            dataUrl,
            width: img.naturalWidth,
            height: img.naturalHeight,
            filename: file.name,
            openInEditor: files.length === 1,
          });
        }
      };
      input.click();
    },
    // Desktop-only entries appended to the New menu's built-ins.
    // Window / Region capture and the Browse window used to live
    // as a separate `<div class="desktop-fs-action-row">` above
    // the gallery and the OS File menu's "New Browse Window";
    // folding them into the unified New menu lets the desktop's
    // gallery chrome match the PWA's surface 1:1. The OS File
    // menu's Browse entry was dropped in the same PR.
    getNewMenuExtras: () => [
      {
        icon: "desktop_windows",
        label: "Capture Window",
        action: () => void doCapture("window"),
        section: "image",
      },
      {
        icon: "crop",
        label: "Capture Region",
        action: () => void doCapture("rect"),
        section: "image",
      },
      {
        icon: "open_in_new",
        label: "Open Browse Window",
        action: () => void openBrowseWindow(),
        section: "more",
      },
    ],
  });

  if (isDesktop) {
    document.addEventListener("keydown", (e) => {
      if (e.key === "PrintScreen") {
        e.preventDefault();
        void doCapture("rect");
      }
    });

    // Extension-capture HTTP push + Native Messaging handoff sweep.
    // Drains `<userData>/data/incoming/` via the Phase 9
    // `extension.drainIncoming` IPC and persists each capture
    // through `DesktopStore.saveImage` (lands in `Inbox/`).
    void startIncomingListener();
  }

  // Document-level paste listener: covers Ctrl+V / Cmd+V from
  // anywhere outside the editor surface.
  document.addEventListener("paste", async (e) => {
    if (document.getElementById("editor-view")!.style.display !== "none") return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (!item.type.startsWith("image/")) continue;
      const blob = item.getAsFile();
      if (!blob) continue;
      const dataUrl = await blobToDataUrl(blob);
      const img = await loadImage(dataUrl);
      await persistViaDesktopStore({
        dataUrl,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
      return;
    }
  });
}

interface PersistOpts {
  dataUrl: string;
  width: number;
  height: number;
  /** Filename to suggest. Without one, `DesktopStore` picks
   *  `annot-<ts>.annot.{png,jpg}` per the shared filename utility. */
  filename?: string;
  /** Source URL — propagated to `ImageRecord.sourceUrl` so the
   *  Elements panel + external-links plugin can resolve back to the
   *  page that was captured. Empty when the capture has no source
   *  (in-app screenshot, paste, drag-drop import). */
  sourceUrl?: string;
  /** Destination folder. Defaults to the file manager's current
   *  folder, falling back to `Inbox/` when navigating at the root.
   *  Incoming-sweep callers force this to `"Inbox"` so asynchronous
   *  extension captures don't land in whichever folder the user
   *  was browsing at the time. */
  folderPath?: string;
  /** Open the saved image in the editor on success. Default true.
   *  Batch incoming sweeps set this to false for files 2..N so a
   *  single capture batch doesn't fire-hose the editor. */
  openInEditor?: boolean;
  /** Provenance: what created the image. Defaults to `"desktop"`;
   *  the extension-handoff sweep passes `"extension"` so handed-off
   *  captures keep their true origin. */
  producer?: string;
  /** Provenance: devicePixelRatio at capture time, when known. */
  dpr?: number;
}

/** Persist a captured / uploaded / imported data URL via
 *  `DesktopStore` and (optionally) open it in the editor. The
 *  single entry point every image source funnels through:
 *  capture (full-screen / window / region), paste, upload,
 *  extension HTTP / Native Messaging handoff. Returns the
 *  persisted path so callers can choose whether to refresh /
 *  open / batch-continue. */
async function persistViaDesktopStore(opts: PersistOpts): Promise<string | null> {
  if (!fsGallery) return null;
  const now = new Date().toISOString();
  const folderPath = opts.folderPath ?? (fsGallery.fileManager.currentFolderPath || "Inbox");
  const path = await fsGallery.store.saveImage(
    {
      folderPath,
      originalDataUrl: opts.dataUrl,
      thumbnailDataUrl: "",
      annotationsSvg: "",
      width: opts.width,
      height: opts.height,
      sourceUrl: opts.sourceUrl ?? "",
      tags: {},
      createdAt: now,
      updatedAt: now,
      producer: opts.producer ?? "desktop",
      dpr: opts.dpr,
    },
    opts.filename ? { filename: opts.filename } : undefined,
  );
  await fsGallery.refresh();
  if (opts.openInEditor !== false) {
    // Re-fetch through `getImage` — `saveImage` returns the path,
    // not the full record. The fresh fetch is also defensive
    // against the writeFile / index-rebuild race so the editor
    // sees the canonical record (XMP-encoded `tags`, computed
    // `createdAt`/`updatedAt`).
    const record = await fsGallery.store.getImage(path);
    if (record) openEditor(record);
  }
  return path;
}

async function startIncomingListener(): Promise<void> {
  // Listen for real-time events from the Electron HTTP server
  // (the browser extension POSTs captures there). The main
  // process emits `chrome-capture` after writing each capture
  // to `<userData>/data/incoming/`; the renderer then drains
  // the staging directory via the Phase 9 `extension.drainIncoming`
  // IPC.
  const ipc = api();
  if (ipc) {
    ipc.on("chrome-capture", () => {
      void (async () => {
        // Small delay to let the file be flushed before draining.
        await new Promise((r) => setTimeout(r, 500));
        await processIncomingFs();
      })();
    });
  }

  // Also poll periodically (catches missed events + Native
  // Messaging fallback).
  setInterval(() => void processIncomingFs(), 5000);
}

interface DrainedCapture {
  filename: string;
  source_url: string;
  width: number;
  height: number;
  data_url: string;
}

/**
 * Drain `<userData>/data/incoming/` via the
 * `extension.drainIncoming` IPC, save each capture through
 * `DesktopStore` (lands in `Inbox/`). The first capture in the
 * batch opens in the editor (matching the historical "newest
 * capture takes focus" behaviour); subsequent ones persist
 * silently.
 *
 * The renderer never touches the disk directly — Phase 9 of
 * `desktop-electron-migration.md` moved the file IO into the
 * main process so the renderer can drop the
 * `@tauri-apps/plugin-fs` runtime dep entirely.
 */
async function processIncomingFs(): Promise<void> {
  if (!fsGallery) return;
  const ipc = api();
  if (!ipc) return;
  let captures: DrainedCapture[];
  try {
    captures = await ipc.invoke<DrainedCapture[]>("extension.drainIncoming");
  } catch (err) {
    console.error("[desktop] extension.drainIncoming failed:", err);
    return;
  }
  for (let i = 0; i < captures.length; i++) {
    const cap = captures[i]!;
    try {
      // Resolve dimensions: use the metadata when present, fall
      // back to decoding the image (rare — main-process always
      // populates them).
      let w = cap.width;
      let h = cap.height;
      if (!w || !h) {
        const img = await loadImage(cap.data_url);
        w = img.naturalWidth;
        h = img.naturalHeight;
      }
      await persistViaDesktopStore({
        dataUrl: cap.data_url,
        width: w,
        height: h,
        sourceUrl: cap.source_url,
        folderPath: "Inbox",
        openInEditor: i === 0,
        // The staged capture came from the browser extension via the
        // HTTP / Native Messaging handoff — keep its true origin.
        producer: "extension",
      });
    } catch (e) {
      console.error("[desktop] processIncoming entry failed:", e);
    }
  }
}

void init();
