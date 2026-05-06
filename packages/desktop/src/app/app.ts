import { CanvasManager } from "@ingcreators/annot-editor";
import { History } from "@ingcreators/annot-editor";
import { PropertyPanel } from "@ingcreators/annot-editor";
import { SelectionManager } from "@ingcreators/annot-editor";
// Phase 5a moved the Toolbar class from `annot-core` to `annot-web`
// so core stays DOM-free. The Tauri shell now picks it up from
// web's editor surface — the rest of the imports below remain in
// core because PropertyPanel + Canvas + History stay there.
import { Toolbar } from "@ingcreators/annot-editor-shell/toolbar";
import {
  isTauri,
  loadScreenshot,
  saveScreenshot,
} from "@ingcreators/annot-core/tauri-bridge";
import {
  bootstrapDesktopFsGallery,
  type DesktopGalleryHandle,
} from "../storage/bootstrap.js";
import { Gallery } from "./gallery.js";
import { ProjectManager } from "./project-manager.js";

let currentCanvas: CanvasManager | null = null;
let _currentImageId: number | undefined;
let gallery: Gallery | null = null;
let fsGallery: DesktopGalleryHandle | null = null;

/**
 * `docs/plans/desktop-storage-provider-migration.md` storage-backend
 * selector. Phase 2 introduced the flag with `"sqlite"` default;
 * Phase 4 (this PR) flipped the default to `"fs"` so a fresh
 * install lands on the unified gallery + `DesktopStore` against
 * `<userData>/library/`. Users who flipped the flag explicitly
 * during Phase 2/3 keep their setting; a new "rollback to legacy
 * gallery" toggle in Settings sets the flag back to `"sqlite"` for
 * one release cycle. Phase 5 deletes the SQLite codepath + the
 * flag entirely.
 */
function getDesktopStorageMode(): "sqlite" | "fs" {
  try {
    const value = window.localStorage.getItem("annotDesktopStorageMode");
    // Explicit `"sqlite"` opt-out (set by Phase 4's rollback
    // toggle) keeps the bespoke gallery active. Any other value —
    // including the historical Phase 2/3 `"fs"` value — and the
    // unset case both resolve to `"fs"`.
    return value === "sqlite" ? "sqlite" : "fs";
  } catch {
    return "fs";
  }
}

/** localStorage key for the one-time legacy-data notice dismissal
 *  flag. Set to `"1"` once the user closes the toast. */
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

function setStorageModeAndReload(mode: "sqlite" | "fs"): void {
  try {
    window.localStorage.setItem("annotDesktopStorageMode", mode);
  } catch {
    /* ignore */
  }
  window.location.reload();
}

function showView(view: "gallery" | "editor"): void {
  document.getElementById("gallery-view")!.style.display = view === "gallery" ? "" : "none";
  document.getElementById("editor-view")!.style.display = view === "editor" ? "" : "none";
}

function openEditor(dataUrl: string, width: number, height: number, imageId?: number): void {
  showView("editor");
  // FS-mode keeps its gallery in `#desktop-fs-gallery`, separate
  // from the bespoke `#gallery-view` `showView` toggles. Hide it
  // explicitly while the editor is up so the canvas isn't sitting
  // on top of a stale gallery list.
  fsGallery?.hideGallery();
  _currentImageId = imageId;

  const svg = document.getElementById("svg-root") as unknown as SVGSVGElement;
  svg.innerHTML = "";

  const canvas = new CanvasManager(svg, dataUrl, width, height);
  currentCanvas = canvas;

  const history = new History(canvas.annotations);
  const selection = new SelectionManager(canvas, history);

  const zoomLabel = document.getElementById("btn-zoom-label")!;
  const zoomMenu = document.getElementById("zoom-menu")!;
  const statusSize = document.getElementById("status-size")!;
  const statusTool = document.getElementById("status-tool")!;

  statusSize.textContent = `${width} \u00d7 ${height}`;
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

async function openImageFile(): Promise<void> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readXmp } = await import("@ingcreators/annot-core/utils/tauri-bridge");
    const selected = await open({
      // `annot.png` / `annot.jpg` / `annot.svg` are the annot-native
      // variants (XMP metadata + embedded original). Plain `png` /
      // `jpg` / `webp` etc. also match so users can bring in any
      // screenshot.
      filters: [
        {
          name: "Images",
          extensions: [
            "png",
            "jpg",
            "jpeg",
            "svg",
            "annot.png",
            "annot.jpg",
            "annot.svg",
            "webp",
            "bmp",
          ],
        },
      ],
    });
    if (selected) {
      const filePath = selected as string;

      // SVG file: parse and restore background + annotations
      if (filePath.endsWith(".svg")) {
        await openSvgFile(filePath);
        return;
      }

      // Check for XMP metadata (re-editable image)
      const xmp = await readXmp(filePath);
      if (xmp?.original_image_b64 && xmp.annotations_svg) {
        const originalDataUrl = `data:image/jpeg;base64,${xmp.original_image_b64}`;
        const img = await loadImage(originalDataUrl);
        openEditor(originalDataUrl, img.naturalWidth, img.naturalHeight);
        setTimeout(() => restoreAnnotations(xmp.annotations_svg), 100);
        return;
      }

      const { invoke } = await import("@tauri-apps/api/core");
      const dataUrl: string = await invoke("load_screenshot", { path: filePath });
      const img = await loadImage(dataUrl);
      const result = await saveScreenshot(dataUrl, activeProjectId());
      openEditor(dataUrl, img.naturalWidth, img.naturalHeight, result.id);
    }
  } else {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const img = await loadImage(dataUrl);
        openEditor(dataUrl, img.naturalWidth, img.naturalHeight);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }
}

async function pasteFromClipboard(): Promise<void> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith("image/")) {
          const blob = await item.getType(type);
          const dataUrl = await blobToDataUrl(blob);
          const img = await loadImage(dataUrl);
          if (isTauri) {
            const result = await saveScreenshot(dataUrl, activeProjectId());
            openEditor(dataUrl, img.naturalWidth, img.naturalHeight, result.id);
          } else {
            openEditor(dataUrl, img.naturalWidth, img.naturalHeight);
          }
          return;
        }
      }
    }
  } catch {}
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

/** Open an SVG file: extract base image and annotations */
async function openSvgFile(filePath: string): Promise<void> {
  try {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const svgContent = await readTextFile(filePath);

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, "image/svg+xml");
    const svgRoot = doc.documentElement;

    // Find the base image element (first <image> with data URI)
    const imageEl = svgRoot.querySelector("image[href], image[xlink\\:href]");
    const href = imageEl?.getAttribute("href") || imageEl?.getAttribute("xlink:href") || "";

    if (!href.startsWith("data:")) {
      // No embedded image, treat as annotation-only SVG
      // Use a blank white background
      const w = Number.parseInt(svgRoot.getAttribute("width") || "800", 10);
      const h = Number.parseInt(svgRoot.getAttribute("height") || "600", 10);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      const blankDataUrl = canvas.toDataURL("image/png");
      openEditor(blankDataUrl, w, h);
      setTimeout(() => restoreAnnotationsFromSvgRoot(svgRoot), 100);
      return;
    }

    // Load the base image
    const img = await loadImage(href);
    openEditor(href, img.naturalWidth, img.naturalHeight);

    // Restore annotations (everything except the base image and defs)
    setTimeout(() => restoreAnnotationsFromSvgRoot(svgRoot), 100);
  } catch (err) {
    alert(`Failed to open SVG: ${err}`);
  }
}

/** Restore annotations from a parsed SVG root element */
function restoreAnnotationsFromSvgRoot(svgRoot: Element): void {
  if (!currentCanvas) return;
  for (const child of Array.from(svgRoot.children)) {
    const tag = child.tagName;
    // Skip: defs, base image, ui-overlay, annotations group wrapper
    if (tag === "defs") continue;
    if (
      tag === "image" &&
      (child.getAttribute("href")?.startsWith("data:") ||
        child.getAttribute("xlink:href")?.startsWith("data:"))
    )
      continue;
    if (child.id === "ui-overlay") continue;

    if (child.id === "annotations") {
      // Flatten annotations group
      for (const annotation of Array.from(child.children)) {
        const imported = document.importNode(annotation, true) as SVGElement;
        currentCanvas.annotations.appendChild(imported);
      }
    } else {
      // Direct annotation element (flattened SVG)
      const imported = document.importNode(child, true) as SVGElement;
      currentCanvas.annotations.appendChild(imported);
    }
  }
}

/** Restore annotations from SVG XML into the current editor */
function restoreAnnotations(svgXml: string): void {
  if (!currentCanvas) return;
  // Parse the SVG string and extract child elements
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgXml, "image/svg+xml");
  const svgRoot = doc.documentElement;

  // Copy all child elements (annotations) into the canvas
  for (const child of Array.from(svgRoot.children)) {
    if (child.tagName === "defs") continue; // skip defs
    const imported = document.importNode(child, true) as SVGElement;
    currentCanvas.annotations.appendChild(imported);
  }
}

/** Get the active project ID from the gallery, defaulting to 1 */
function activeProjectId(): number {
  return gallery?.currentProjectId ?? 1;
}

// --- Unified screen capture (Snipping Tool style) ---

async function tauriInvoke<T = any>(cmd: string, args?: any): Promise<T> {
  const internals = (window as any).__TAURI_INTERNALS__;
  if (internals?.invoke) return internals.invoke(cmd, args);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args);
}

type CaptureModeType = "fullscreen" | "window" | "rect";

/**
 * Persist a freshly-captured data URL through the active storage
 * backend. Phase 3 of `desktop-storage-provider-migration.md`:
 * when the FS-mode flag is on, route through `DesktopStore` so
 * captures land in `<userData>/library/` and show up in the
 * unified gallery; otherwise legacy SQLite path keeps writing to
 * `<portable_dir>/data/project_<id>/`.
 *
 * The capture-pipeline-side logic (overlay invocation, cropping,
 * minimize/restore choreography) lives one level up in
 * `doCapture`; this helper is purely the persist + open-editor
 * step the two flag branches diverge on.
 */
async function persistCaptureResult(dataUrl: string, w: number, h: number): Promise<void> {
  if (getDesktopStorageMode() === "fs") {
    await persistViaDesktopStore({ dataUrl, width: w, height: h });
    return;
  }
  const saved = await saveScreenshot(dataUrl, activeProjectId());
  openEditor(dataUrl, w, h, saved.id);
  gallery?.refresh();
}

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
      await persistCaptureResult(result.data_url, result.width, result.height);
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
    await persistCaptureResult(cropped, region.w, region.h);
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
 * Phase 2 FS-mode boot path: hide the bespoke gallery DOM, mount
 * the unified `FileManager` against `DesktopStore`, wire the
 * sidebar's "New" menu callbacks. The bespoke header buttons
 * (Capture Screen / Window / Region / Open / Paste) stay reachable
 * via the top-of-viewport action row outside the unified gallery
 * surface so QA can still exercise them; Phase 3 reroutes those
 * capture pipelines through `DesktopStore` as well.
 */
async function initFsMode(): Promise<void> {
  showView("gallery");
  fsGallery = await bootstrapDesktopFsGallery({
    onOpenImage: async (record) => {
      if (!fsGallery) return;
      const full = await fsGallery.store.getImage(record.path);
      if (!full?.originalDataUrl) return;
      const img = await loadImage(full.originalDataUrl);
      openEditor(full.originalDataUrl, img.naturalWidth, img.naturalHeight);
    },
    onCaptureScreen: async () => {
      // Phase 3: `doCapture` checks the storage flag and persists
      // through `DesktopStore` when FS-mode is active, so the
      // captured file lands in `<userData>/library/` and shows up
      // in the unified gallery on the post-save refresh.
      await doCapture("fullscreen");
    },
    onTimedCapture: async () => {
      // Timed capture (delayed Capture Screen) isn't implemented
      // on the desktop host yet — the legacy code never had it.
      // The unified sidebar's "Timed Capture" item surfaces only
      // when `isScreenCaptureSupported()` returns true (the
      // browser API is technically present in the Tauri webview),
      // so we stub it instead of letting the click fall through
      // and emit an undefined-callback warning.
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
        console.error("[fs-mode] paste failed:", e);
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

  // Wire the back button + the Window/Region capture row that
  // sits OUTSIDE the unified gallery (per Phase 0 audit
  // recommendation #1). `doCapture` is now flag-aware (Phase 3),
  // so these buttons persist through `DesktopStore` when the
  // FS-mode flag is on.
  document.getElementById("btn-back")!.addEventListener("click", () => {
    showView("gallery");
    fsGallery?.showGallery();
    currentCanvas = null;
    _currentImageId = undefined;
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

    // Phase 3: dispatch the extension-capture HTTP push + Native
    // Messaging handoff sweep. `processIncoming` checks the flag
    // at every call and routes through `DesktopStore` when FS-mode
    // is on, so it's safe to start the listener here.
    void startIncomingListener();
  }

  // Document-level paste listener for FS-mode. The legacy
  // `init()` registers an equivalent that gates on
  // `#gallery-view` visibility — that DOM is permanently hidden
  // when FS-mode is on, so the listener never fires from there.
  // Mirror the behaviour against the editor view's hidden state.
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

  // Phase 4: settings button (rollback to legacy gallery) + the
  // one-time legacy-data notice. Both are gated to Tauri builds —
  // a non-Tauri rendering of `index.html` (storybook, devtools
  // standalone) has no portable_dir to reference.
  if (isTauri) {
    wireSettingsButton();
    void maybeShowLegacyDataNotice();
  }
}

/**
 * Wire the "Settings" button in `#desktop-fs-action-row` to open
 * the rollback-to-legacy-gallery dialog. The button is in the
 * Phase 2 host DOM but inert until this listener attaches.
 */
function wireSettingsButton(): void {
  const btn = document.getElementById("btn-fs-settings");
  if (!btn) return;
  btn.addEventListener("click", () => {
    showRollbackDialog();
  });
}

/**
 * Show the Phase 4 rollback dialog. A single checkbox toggles the
 * storage flag back to `"sqlite"` and reloads. The dialog is
 * built imperatively so it can be re-mounted without leaking
 * stale listeners — there's no persistent dialog DOM in
 * index.html.
 */
function showRollbackDialog(): void {
  const existing = document.getElementById("fs-settings-dialog");
  if (existing) existing.remove();

  const dialog = document.createElement("dialog");
  dialog.id = "fs-settings-dialog";
  dialog.className = "fs-settings-dialog";
  dialog.innerHTML = `
    <div class="fs-settings-header">
      <h2>Desktop Settings</h2>
      <button class="fs-settings-close" aria-label="Close">&times;</button>
    </div>
    <div class="fs-settings-body">
      <label class="fs-settings-row">
        <input type="checkbox" id="fs-settings-rollback" />
        <span>
          <span class="fs-settings-label">Use legacy gallery (SQLite-backed)</span>
          <span class="fs-settings-hint">
            Reverts to the previous gallery implementation. The new
            filesystem-backed library at <code>&lt;userData&gt;/library/</code>
            stays unchanged. This toggle will be removed in a future release.
          </span>
        </span>
      </label>
    </div>
    <div class="fs-settings-footer">
      <button class="action-btn" id="fs-settings-cancel">Cancel</button>
      <button class="action-btn action-btn-primary" id="fs-settings-apply">Apply</button>
    </div>
  `;
  document.body.appendChild(dialog);

  const closeDialog = (): void => {
    dialog.close();
    dialog.remove();
  };

  dialog.querySelector(".fs-settings-close")!.addEventListener("click", closeDialog);
  dialog.querySelector("#fs-settings-cancel")!.addEventListener("click", closeDialog);
  dialog.querySelector("#fs-settings-apply")!.addEventListener("click", () => {
    const checked = (dialog.querySelector<HTMLInputElement>("#fs-settings-rollback"))!.checked;
    if (checked) {
      // User opted in to the legacy gallery — set the explicit
      // `"sqlite"` flag and reload so `getDesktopStorageMode()`
      // picks it up at boot. Without the explicit value the new
      // default is `"fs"`.
      setStorageModeAndReload("sqlite");
      return;
    }
    closeDialog();
  });

  dialog.showModal();
}

/**
 * Phase 4 one-time notice: when the FS-mode default kicks in on
 * a build that previously used the SQLite gallery, surface a
 * banner explaining where the legacy data lives. The banner has
 * a "Reveal in Finder/Explorer" button (via
 * `@tauri-apps/plugin-shell`'s `open(path)`) and a dismiss button
 * that persists `localStorage.annotLegacyDataNoticeDismissed`.
 *
 * The notice is gated on the legacy `<portable_dir>/data/annot.db`
 * file existing — a fresh install with no prior history skips
 * the banner entirely.
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
      console.error("[fs-mode] reveal legacy data dir failed:", e);
    }
  });

  banner.querySelector("#fs-legacy-notice-dismiss")!.addEventListener("click", () => {
    dismissLegacyNotice();
    banner.remove();
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
   *  Phase 3 incoming-sweep callers force this to `"Inbox"` so
   *  asynchronous extension captures don't land in whichever folder
   *  the user was browsing at the time. */
  folderPath?: string;
  /** Open the saved image in the editor on success. Default true.
   *  Phase 3 batch incoming sweeps set this to false for files
   *  2..N so a single capture batch doesn't fire-hose the editor. */
  openInEditor?: boolean;
}

/** Persist a captured / uploaded / imported data URL via
 *  `DesktopStore` and (optionally) open it in the editor.
 *
 *  Used by every FS-mode entry point that produces image bytes:
 *  capture (full-screen / window / region) — Phase 3, paste — Phase
 *  2, upload — Phase 2, extension HTTP / Native Messaging handoff
 *  — Phase 3. Returns the persisted path so callers can choose
 *  whether to refresh / open / batch-continue. */
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

function init(): void {
  // Phase 2 feature flag: when set, mount the unified gallery
  // against `DesktopStore` instead of the bespoke SQLite-backed
  // one. Defaults to the legacy path so an unset flag is a
  // no-op upgrade.
  if (getDesktopStorageMode() === "fs") {
    void initFsMode();
    return;
  }

  showView("gallery");

  const galleryView = document.getElementById("gallery-view")!;
  gallery = new Gallery(galleryView);
  gallery.onOpenImage = (dataUrl, w, h, imageId) => {
    openEditor(dataUrl, w, h, imageId);
  };

  const pm = new ProjectManager();
  pm.onChange = () => gallery?.refresh();

  document.getElementById("btn-open-image")!.addEventListener("click", openImageFile);
  document.getElementById("btn-paste-image")!.addEventListener("click", pasteFromClipboard);

  if (isTauri) {
    document
      .getElementById("btn-capture-screen")!
      .addEventListener("click", () => doCapture("fullscreen"));
    document
      .getElementById("btn-capture-window")!
      .addEventListener("click", () => doCapture("window"));
    document
      .getElementById("btn-capture-region")!
      .addEventListener("click", () => doCapture("rect"));

    // Global hotkey: PrintScreen
    document.addEventListener("keydown", (e) => {
      if (e.key === "PrintScreen") {
        e.preventDefault();
        doCapture("rect");
      }
    });
  } else {
    document.getElementById("btn-capture-screen")!.style.display = "none";
    document.getElementById("btn-capture-window")!.style.display = "none";
    document.getElementById("btn-capture-region")!.style.display = "none";
  }

  const projBtn = document.createElement("button");
  projBtn.className = "action-btn";
  projBtn.textContent = "Projects";
  projBtn.addEventListener("click", () => pm.show());
  document.querySelector(".gallery-actions")!.appendChild(projBtn);

  document.getElementById("btn-back")!.addEventListener("click", () => {
    showView("gallery");
    currentCanvas = null;
    _currentImageId = undefined;
    gallery?.refresh();
  });

  if (isTauri) startIncomingListener();

  document.addEventListener("paste", async (e) => {
    if (document.getElementById("gallery-view")!.style.display === "none") return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (!blob) continue;
        const dataUrl = await blobToDataUrl(blob);
        const img = await loadImage(dataUrl);
        if (isTauri) {
          const result = await saveScreenshot(dataUrl, activeProjectId());
          openEditor(dataUrl, img.naturalWidth, img.naturalHeight, result.id);
        } else {
          openEditor(dataUrl, img.naturalWidth, img.naturalHeight);
        }
        return;
      }
    }
  });
}

async function startIncomingListener(): Promise<void> {
  const baseDir = `${await tauriInvoke<string>("get_portable_dir")}/images`;

  // Listen for real-time events from HTTP server
  try {
    const { listen } = await import("@tauri-apps/api/event");
    await listen("chrome-capture", async () => {
      // Small delay to let file be written
      await new Promise((r) => setTimeout(r, 500));
      await processIncoming(baseDir);
    });
  } catch {
    // Fallback: if event listening fails, use polling
  }

  // Also poll periodically (catches missed events, Native Messaging fallback)
  setInterval(() => processIncoming(baseDir), 5000);
}

async function processIncoming(baseDir: string): Promise<void> {
  if (getDesktopStorageMode() === "fs") {
    await processIncomingFs();
    return;
  }
  try {
    const results: any[] = await tauriInvoke("check_incoming", { baseDir });
    if (results.length > 0) {
      gallery?.refresh();
      const first = results[0];
      const dataUrl = await loadScreenshot(first.path);
      const img = await loadImage(dataUrl);
      openEditor(dataUrl, img.naturalWidth, img.naturalHeight, first.id);
    }
  } catch {}
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
 * FS-mode equivalent of `check_incoming`: scan
 * `<portable_dir>/data/incoming/` from the JS side via
 * `@tauri-apps/plugin-fs`, save each image through `DesktopStore`
 * (lands in `Inbox/`), delete the source .json + image. The first
 * file in the batch opens in the editor (matching the legacy
 * single-image flow); subsequent files in the same batch persist
 * silently.
 *
 * Phase 3 of `desktop-storage-provider-migration.md`. The Rust
 * `check_incoming` IPC stays in place for the SQLite default; this
 * branch runs only when the FS-mode flag is on.
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

  // Match the Rust `check_incoming` logic: drive the loop off the
  // .json metadata files, with the image file at `meta.path`. The
  // JSON-driven approach also catches orphan .json files (writes
  // that completed the metadata but lost the image) and prunes
  // them.
  const metaFiles = entries
    .filter((e) => e.isFile && e.name.toLowerCase().endsWith(".json"))
    .map((e) => `${incomingDir}/${e.name}`);

  let firstSavedDataUrl: string | null = null;
  let firstSavedDims: { w: number; h: number } | null = null;

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
        // Open only the first file — matches the legacy flow's
        // "newest capture takes focus" behavior. Files 2..N in
        // the same batch land in the gallery silently.
        openInEditor: i === 0,
      });

      if (i === 0) {
        firstSavedDataUrl = dataUrl;
        firstSavedDims = { w, h };
      }

      // Best-effort cleanup of the source files. Failures here
      // don't block the save; the next sweep will see them again
      // and retry.
      await fs.remove(imagePath).catch(() => {});
      await fs.remove(metaPath).catch(() => {});
    } catch (e) {
      console.error("[fs-mode] processIncoming entry failed:", e);
    }
  }

  // The persistViaDesktopStore call already opened the editor for
  // the first file via its `openInEditor: true` branch — the locals
  // above remain for future use (e.g. a notification toast saying
  // "Captured page X loaded"). Suppress unused-var noise.
  void firstSavedDataUrl;
  void firstSavedDims;
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

init();
