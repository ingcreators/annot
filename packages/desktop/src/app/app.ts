import { CanvasManager } from "@ingcreators/annot-editor";
import { History } from "@ingcreators/annot-editor";
import { PropertyPanel } from "@ingcreators/annot-editor";
import { SelectionManager } from "@ingcreators/annot-editor";
// Phase 5a moved the Toolbar class from `annot-core` to `annot-web`
// so core stays DOM-free. The desktop shell picks it up from web's
// editor surface — the rest of the imports below remain in core
// because PropertyPanel + Canvas + History stay there.
import { Toolbar } from "@ingcreators/annot-editor-shell/toolbar";
import {
  captureScreen,
  isDesktop,
  minimizeMainWindow,
  restoreMainWindow,
} from "@ingcreators/annot-core/desktop-bridge";
import {
  bootstrapDesktopFsGallery,
  type DesktopGalleryHandle,
} from "../storage/bootstrap.js";

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

/** localStorage key for the one-time legacy-data notice dismissal
 *  flag. Set to `"1"` once the user closes the toast. The notice
 *  itself is the last surface that mentions
 *  `<portable_dir>/data/`; no other Phase 5+ code path touches the
 *  legacy SQLite directory. */
const LEGACY_NOTICE_KEY = "annotLegacyDataNoticeDismissed";

function legacyNoticeAlreadyDismissed(): boolean {
  try {
    return window.localStorage.getItem(LEGACY_NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

function dismissLegacyNotice(): void {
  try {
    window.localStorage.setItem(LEGACY_NOTICE_KEY, "1");
  } catch {
    /* ignore */
  }
}

function showEditorView(): void {
  document.getElementById("editor-view")!.style.display = "";
}

function hideEditorView(): void {
  document.getElementById("editor-view")!.style.display = "none";
}

function openEditor(dataUrl: string, width: number, height: number): void {
  showEditorView();
  // The unified gallery sits in `#desktop-fs-gallery`; hide it
  // explicitly while the editor is up so the canvas isn't sitting
  // on top of a stale gallery list.
  fsGallery?.hideGallery();

  const svg = document.getElementById("svg-root") as unknown as SVGSVGElement;
  svg.innerHTML = "";

  const canvas = new CanvasManager(svg, dataUrl, width, height);

  const history = new History(canvas.annotations);
  const selection = new SelectionManager(canvas, history);

  const zoomLabel = document.getElementById("btn-zoom-label")!;
  const zoomMenu = document.getElementById("zoom-menu")!;
  const statusSize = document.getElementById("status-size")!;
  const statusTool = document.getElementById("status-tool")!;

  statusSize.textContent = `${width} × ${height}`;
  canvas.onZoomChange = (z) => {
    zoomLabel.textContent = `${Math.round(z * 100)}%`;
  };
  zoomLabel.textContent = `${Math.round(canvas.zoom * 100)}%`;

  // Zoom +/-
  document.getElementById("btn-zoom-in")!.addEventListener("click", () => {
    canvas.setZoom(canvas.zoom + 0.1);
  });
  document.getElementById("btn-zoom-out")!.addEventListener("click", () => {
    canvas.setZoom(canvas.zoom - 0.1);
  });

  // Zoom dropdown
  const ZOOM_OPTIONS: { label: string; value: number | "fit" }[] = [
    { label: "Fit", value: "fit" },
    { label: "25%", value: 0.25 },
    { label: "50%", value: 0.5 },
    { label: "75%", value: 0.75 },
    { label: "100%", value: 1.0 },
    { label: "150%", value: 1.5 },
    { label: "200%", value: 2.0 },
    { label: "300%", value: 3.0 },
    { label: "400%", value: 4.0 },
  ];

  function buildZoomMenu(): void {
    zoomMenu.innerHTML = "";
    for (const opt of ZOOM_OPTIONS) {
      if (opt.value === "fit") {
        const item = document.createElement("button");
        item.className = "zoom-menu-item";
        item.textContent = "Fit to window";
        item.addEventListener("click", () => {
          canvas.fitToView();
          zoomMenu.style.display = "none";
        });
        zoomMenu.appendChild(item);
        const sep = document.createElement("div");
        sep.className = "zoom-menu-sep";
        zoomMenu.appendChild(sep);
      } else {
        const item = document.createElement("button");
        item.className = "zoom-menu-item";
        const curZoom = Math.round(canvas.zoom * 100);
        if (Math.round((opt.value as number) * 100) === curZoom) item.classList.add("active");
        item.textContent = opt.label;
        item.addEventListener("click", () => {
          canvas.setZoom(opt.value as number);
          zoomMenu.style.display = "none";
        });
        zoomMenu.appendChild(item);
      }
    }
  }

  zoomLabel.addEventListener("click", (e) => {
    e.stopPropagation();
    if (zoomMenu.style.display === "none") {
      buildZoomMenu();
      zoomMenu.style.display = "block";
    } else {
      zoomMenu.style.display = "none";
    }
  });
  document.addEventListener("click", () => {
    zoomMenu.style.display = "none";
  });

  const toolbarEl = document.getElementById("toolbar")!;
  toolbarEl.innerHTML = "";
  const toolbar = new Toolbar(toolbarEl, canvas, history, selection, (toolName) => {
    statusTool.textContent = toolName;
  });

  // Property panel for selected shapes
  const canvasContainer = document.getElementById("canvas-container")!;
  const propPanel = new PropertyPanel(canvasContainer, canvas, history);
  // Rotate / flip from the property panel mutates targets in place;
  // refresh selection handles so they follow the new visual frame.
  propPanel.onTargetMutated = () => selection.refreshHandles();
  // Rubber-band: color/width/variant edits on a selected shape
  // propagate back into the matching tool's preset so the next
  // shape drawn with that tool matches the user's last choice.
  propPanel.onStyleChanged = (targets) => {
    for (const t of targets) toolbar.syncPresetFromElement(t);
  };
  selection.onChange = () => {
    const els = selection.selectedElements;
    if (els.length > 0 && !canvas.activeTool) {
      propPanel.show(els);
    } else {
      propPanel.hide();
    }
  };
}

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
 * thumbnails) stays untouched on disk — the one-time
 * `maybeShowLegacyDataNotice` toast is the only mention this app
 * ever surfaces. The user owns the back-up / delete decision.
 */
async function init(): Promise<void> {
  fsGallery = await bootstrapDesktopFsGallery({
    onOpenImage: async (record) => {
      if (!fsGallery) return;
      const full = await fsGallery.store.getImage(record.path);
      if (!full?.originalDataUrl) return;
      const img = await loadImage(full.originalDataUrl);
      openEditor(full.originalDataUrl, img.naturalWidth, img.naturalHeight);
    },
    onCaptureScreen: async () => {
      await doCapture("fullscreen");
    },
    onTimedCapture: async () => {
      // Timed capture (delayed Capture Screen) isn't implemented
      // on the desktop host yet. The unified sidebar's "Timed
      // Capture" item surfaces only when `isScreenCaptureSupported()`
      // returns true (the browser API is technically present in
      // the Tauri webview), so we stub it instead of letting the
      // click fall through and emit an undefined-callback warning.
    },
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
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const dataUrl = await blobToDataUrl(file);
        const img = await loadImage(dataUrl);
        await persistViaDesktopStore({
          dataUrl,
          width: img.naturalWidth,
          height: img.naturalHeight,
          filename: file.name,
        });
      };
      input.click();
    },
  });

  // Back button + the Window/Region capture row that sits OUTSIDE
  // the unified gallery (per the Phase 0 audit's recommendation
  // #1 — folding these into the unified "New" menu needs a
  // `getNewMenuExtras?` host hook on `<annot-sidebar>`, tracked as
  // a follow-up).
  document.getElementById("btn-back")!.addEventListener("click", () => {
    hideEditorView();
    fsGallery?.showGallery();
    void fsGallery?.refresh();
  });

  if (isDesktop) {
    document
      .getElementById("btn-fs-capture-window")
      ?.addEventListener("click", () => doCapture("window"));
    document
      .getElementById("btn-fs-capture-region")
      ?.addEventListener("click", () => doCapture("rect"));

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
    // One-time toast surfacing the legacy SQLite directory's path
    // for users upgrading from the pre-Electron build.
    void maybeShowLegacyDataNotice();
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
  const folderPath =
    opts.folderPath ?? (fsGallery.fileManager.currentFolderPath || "Inbox");
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
    },
    opts.filename ? { filename: opts.filename } : undefined,
  );
  await fsGallery.refresh();
  if (opts.openInEditor !== false) {
    openEditor(opts.dataUrl, opts.width, opts.height);
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
      });
    } catch (e) {
      console.error("[desktop] processIncoming entry failed:", e);
    }
  }
}

/**
 * Surface a one-time banner explaining where the legacy SQLite
 * data lives. Shown on Electron-mode boot when
 * `<portable_dir>/data/annot.db` exists (= the user has prior
 * SQLite captures) AND the dismissal flag isn't set.
 *
 * Phase 9 of `desktop-electron-migration.md` moved the
 * existence check into the `extension.legacyDataInfo` IPC — the
 * renderer doesn't touch the filesystem directly. The Reveal
 * button calls `shell.openPath` (also IPC) for the OS file-
 * manager open. It does NOT delete the legacy directory — the
 * user owns that decision.
 */
async function maybeShowLegacyDataNotice(): Promise<void> {
  if (legacyNoticeAlreadyDismissed()) return;
  const ipc = api();
  if (!ipc) return;
  let info: { exists: boolean; path: string };
  try {
    info = await ipc.invoke<{ exists: boolean; path: string }>("extension.legacyDataInfo");
  } catch {
    return;
  }
  if (!info.exists) return;
  renderLegacyDataNotice(info.path);
}

function renderLegacyDataNotice(legacyDataDir: string): void {
  const galleryRoot = document.getElementById("desktop-fs-gallery");
  if (!galleryRoot) return;

  // Avoid double-rendering if the function gets called twice
  // (e.g. polling fired before init finished).
  if (document.getElementById("fs-legacy-data-notice")) return;

  const banner = document.createElement("div");
  banner.id = "fs-legacy-data-notice";
  banner.className = "fs-legacy-notice";
  banner.setAttribute("role", "status");
  banner.innerHTML = `
    <div class="fs-legacy-notice-body">
      <strong>Your previous Annot library has moved.</strong>
      The active library is now at <code>&lt;userData&gt;/library/</code>;
      the previous data lives at <code class="fs-legacy-notice-path"></code>.
      Back it up or remove it at your convenience — Annot won't touch it.
    </div>
    <div class="fs-legacy-notice-actions">
      <button class="action-btn" id="fs-legacy-notice-reveal">Open old folder</button>
      <button class="action-btn" id="fs-legacy-notice-dismiss">Dismiss</button>
    </div>
  `;
  banner.querySelector(".fs-legacy-notice-path")!.textContent = legacyDataDir;
  galleryRoot.insertBefore(banner, galleryRoot.firstChild);

  banner.querySelector("#fs-legacy-notice-reveal")!.addEventListener("click", async () => {
    const ipc = api();
    if (!ipc) return;
    try {
      const result = await ipc.invoke<{ ok: boolean; error?: string }>("shell.openPath", {
        path: legacyDataDir,
      });
      if (!result.ok) {
        console.error("[desktop] reveal legacy data dir failed:", result.error);
      }
    } catch (e) {
      console.error("[desktop] reveal legacy data dir failed:", e);
    }
  });

  banner.querySelector("#fs-legacy-notice-dismiss")!.addEventListener("click", () => {
    dismissLegacyNotice();
    banner.remove();
  });
}

void init();
