import { CanvasManager } from "@ingcreators/annot-editor";
import { History } from "@ingcreators/annot-editor";
import { PropertyPanel } from "@ingcreators/annot-editor";
import { SelectionManager } from "@ingcreators/annot-editor";
// Phase 5a moved the Toolbar class from `annot-core` to `annot-web`
// so core stays DOM-free. The Tauri shell now picks it up from
// web's editor surface — the rest of the imports below remain in
// core because PropertyPanel + Canvas + History stay there.
import { Toolbar } from "@ingcreators/annot-editor-shell/toolbar";
import { isTauri } from "@ingcreators/annot-core/tauri-bridge";
import {
  bootstrapDesktopFsGallery,
  type DesktopGalleryHandle,
} from "../storage/bootstrap.js";

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

async function tauriInvoke<T = any>(cmd: string, args?: any): Promise<T> {
  const internals = (window as any).__TAURI_INTERNALS__;
  if (internals?.invoke) return internals.invoke(cmd, args);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args);
}

type CaptureModeType = "fullscreen" | "window" | "rect";

async function doCapture(mode: CaptureModeType): Promise<void> {
  try {
    if (mode === "fullscreen") {
      // Simple: minimize, capture, restore
      await tauriInvoke("minimize_main_window");
      await new Promise((r) => setTimeout(r, 400));
      const result = await tauriInvoke<{ data_url: string; width: number; height: number }>(
        "capture_screen",
      );
      await tauriInvoke("restore_main_window");
      await persistViaDesktopStore({
        dataUrl: result.data_url,
        width: result.width,
        height: result.height,
      });
      return;
    }

    // rect / window: use overlay window on the actual screen
    const overlayResult = await tauriInvoke<{
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
      await tauriInvoke("restore_main_window");
    } catch {}
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

  if (isTauri) {
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
    // Walks `<portable_dir>/data/incoming/` and persists each file
    // through `DesktopStore.saveImage` (lands in `Inbox/`).
    void startIncomingListener();
    // One-time toast surfacing the legacy SQLite directory's path
    // for users upgrading from the pre-Phase-4 build.
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
  // Listen for real-time events from the Rust HTTP server (the
  // browser extension POSTs captures there).
  try {
    const { listen } = await import("@tauri-apps/api/event");
    await listen("chrome-capture", async () => {
      // Small delay to let file be written
      await new Promise((r) => setTimeout(r, 500));
      await processIncomingFs();
    });
  } catch {
    // Fallback: if event listening fails, use polling
  }

  // Also poll periodically (catches missed events, Native
  // Messaging fallback).
  setInterval(() => void processIncomingFs(), 5000);
}

/** Shape of `<portable_dir>/data/incoming/<name>.json` written by
 *  `packages/desktop/src-tauri/src/http_server.rs:save_incoming`.
 *  The image file lives at `path` (absolute). */
interface IncomingMeta {
  filename: string;
  path: string;
  source_url: string;
  width: number;
  height: number;
}

/**
 * Sweep `<portable_dir>/data/incoming/` from the JS side via
 * `@tauri-apps/plugin-fs`, save each image through `DesktopStore`
 * (lands in `Inbox/`), delete the source .json + image. The first
 * file in the batch opens in the editor (matching the original
 * single-image flow); subsequent files in the same batch persist
 * silently.
 */
async function processIncomingFs(): Promise<void> {
  if (!fsGallery) return;
  let incomingDir: string;
  try {
    const portableDir = await tauriInvoke<string>("get_portable_dir");
    incomingDir = `${portableDir}/data/incoming`;
  } catch {
    return;
  }

  const fs = await import("@tauri-apps/plugin-fs");

  let entries: { name: string; isFile: boolean }[];
  try {
    const dirEntries = await fs.readDir(incomingDir);
    entries = dirEntries.map((e) => ({ name: e.name, isFile: e.isFile }));
  } catch {
    // Directory doesn't exist yet — nothing to sweep.
    return;
  }

  // Drive the loop off the .json metadata files, with the image
  // file at `meta.path`. The JSON-driven approach also catches
  // orphan .json files (writes that completed the metadata but
  // lost the image) and prunes them.
  const metaFiles = entries
    .filter((e) => e.isFile && e.name.toLowerCase().endsWith(".json"))
    .map((e) => `${incomingDir}/${e.name}`);

  for (let i = 0; i < metaFiles.length; i++) {
    const metaPath = metaFiles[i]!;
    try {
      const text = await fs.readTextFile(metaPath);
      const meta = JSON.parse(text) as Partial<IncomingMeta>;
      const imagePath = meta.path;
      if (!imagePath) {
        await fs.remove(metaPath).catch(() => {});
        continue;
      }
      // Read source image as bytes → base64 data URL. Rust always
      // writes JPEG (per `http_server.rs:save_incoming`) so the
      // MIME prefix is hard-coded.
      let bytes: Uint8Array;
      try {
        bytes = (await fs.readFile(imagePath)) as Uint8Array;
      } catch {
        // Orphan metadata — image vanished. Clean up and skip.
        await fs.remove(metaPath).catch(() => {});
        continue;
      }
      const base64 = bytesToBase64(bytes);
      const dataUrl = `data:image/jpeg;base64,${base64}`;

      // Resolve dimensions: use the metadata when present, fall
      // back to decoding the image (rare — Rust populates them).
      let w = meta.width ?? 0;
      let h = meta.height ?? 0;
      if (!w || !h) {
        const img = await loadImage(dataUrl);
        w = img.naturalWidth;
        h = img.naturalHeight;
      }

      await persistViaDesktopStore({
        dataUrl,
        width: w,
        height: h,
        sourceUrl: meta.source_url ?? "",
        folderPath: "Inbox",
        // Open only the first file — matches the historical
        // "newest capture takes focus" behaviour. Files 2..N in
        // the same batch land in the gallery silently.
        openInEditor: i === 0,
      });

      // Best-effort cleanup of the source files. Failures here
      // don't block the save; the next sweep will see them again
      // and retry.
      await fs.remove(imagePath).catch(() => {});
      await fs.remove(metaPath).catch(() => {});
    } catch (e) {
      console.error("[desktop] processIncoming entry failed:", e);
    }
  }
}

/** Convert raw bytes to a base64 string. Used when building data
 *  URLs from filesystem-read bytes (incoming sweep, etc.). Avoids
 *  the `String.fromCharCode(...arr)` arg-spread limit by chunking
 *  the input — multi-megapixel JPEGs blow past 100k bytes easily. */
function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Surface a one-time banner explaining where the legacy SQLite
 * data lives. Shown on FS-mode boot when
 * `<portable_dir>/data/annot.db` exists (= the user has prior
 * SQLite captures) AND the dismissal flag isn't set.
 *
 * The banner has a "Reveal in Finder/Explorer" affordance (via
 * `@tauri-apps/plugin-shell`'s `open(path)`) and a Dismiss
 * button that persists `localStorage.annotLegacyDataNoticeDismissed`.
 * It does NOT delete the legacy directory — the user owns that
 * decision.
 */
async function maybeShowLegacyDataNotice(): Promise<void> {
  if (legacyNoticeAlreadyDismissed()) return;
  let portableDir: string;
  try {
    portableDir = await tauriInvoke<string>("get_portable_dir");
  } catch {
    return;
  }
  const legacyDataDir = `${portableDir}/data`;
  const legacyDbPath = `${legacyDataDir}/annot.db`;

  // Only surface the notice if the user has prior SQLite data.
  // A fresh install ships with neither the directory nor the db
  // file; suppress the banner so the first-launch UX stays clean.
  let hasLegacyDb = false;
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    hasLegacyDb = await fs.exists(legacyDbPath);
  } catch {
    return;
  }
  if (!hasLegacyDb) return;

  renderLegacyDataNotice(legacyDataDir);
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
    try {
      const shell = await import("@tauri-apps/plugin-shell");
      await shell.open(legacyDataDir);
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
