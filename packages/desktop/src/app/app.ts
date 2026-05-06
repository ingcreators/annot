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
 * Phase 2 of `docs/plans/desktop-storage-provider-migration.md`:
 * developer feature flag toggling between the bespoke SQLite
 * gallery (`"sqlite"`, default) and the unified
 * `<annot-file-manager-shell>` against `DesktopStore` (`"fs"`).
 *
 * Set via DevTools — `localStorage.annotDesktopStorageMode = "fs"`
 * — then reload. Phase 4 default-flips to `"fs"`; Phase 5 deletes
 * the SQLite codepath and the flag itself.
 */
function getDesktopStorageMode(): "sqlite" | "fs" {
  try {
    return window.localStorage.getItem("annotDesktopStorageMode") === "fs" ? "fs" : "sqlite";
  } catch {
    return "sqlite";
  }
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
      const saved = await saveScreenshot(result.data_url, activeProjectId());
      openEditor(result.data_url, result.width, result.height, saved.id);
      gallery?.refresh();
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
    const saved = await saveScreenshot(cropped, activeProjectId());
    openEditor(cropped, region.w, region.h, saved.id);
    gallery?.refresh();
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
      // Phase 2 stop-gap: the legacy `doCapture` path lands the
      // file in `<portable_dir>/data/`, not `<userData>/library/`,
      // so the unified gallery doesn't see it. QA flipping the
      // flag should use Upload / Paste for end-to-end verification
      // until Phase 3 reroutes capture through `DesktopStore`.
      await doCapture("fullscreen");
    },
    onTimedCapture: async () => {
      // Timed capture isn't implemented in the legacy desktop
      // host; Phase 3 introduces it natively against
      // `DesktopStore`. Stub for now so the menu item doesn't
      // crash if surfaced by `isScreenCaptureSupported()`.
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
            await persistViaDesktopStore(dataUrl, img.naturalWidth, img.naturalHeight);
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
        await persistViaDesktopStore(dataUrl, img.naturalWidth, img.naturalHeight, file.name);
      };
      input.click();
    },
  });

  // Wire the back button + the Window/Region capture row that
  // sits OUTSIDE the unified gallery (per Phase 0 audit
  // recommendation #1). Capture results still go through the
  // legacy SQLite path until Phase 3 reroutes them.
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
  }
}

/** Persist a captured / uploaded data URL via `DesktopStore` and
 *  open it in the editor. Used by FS-mode upload + paste paths
 *  (Phase 2). Phase 3 wires capture screen / window / region /
 *  extension-handoff through this same helper. */
async function persistViaDesktopStore(
  dataUrl: string,
  w: number,
  h: number,
  filename?: string,
): Promise<void> {
  if (!fsGallery) return;
  const now = new Date().toISOString();
  const folderPath = fsGallery.fileManager.currentFolderPath || "Inbox";
  await fsGallery.store.saveImage(
    {
      folderPath,
      originalDataUrl: dataUrl,
      thumbnailDataUrl: "",
      annotationsSvg: "",
      width: w,
      height: h,
      sourceUrl: "",
      tags: {},
      createdAt: now,
      updatedAt: now,
    },
    filename ? { filename } : undefined,
  );
  await fsGallery.refresh();
  openEditor(dataUrl, w, h);
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

init();
