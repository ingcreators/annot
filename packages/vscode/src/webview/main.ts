/**
 * Annot — VSCode webview entry.
 *
 * Wires the EditorShell into the sandboxed iframe + brokers
 * filesystem I/O through a `postMessage` proxy to the extension
 * host. Every storage call from the shell crosses the boundary
 * via correlated request / response messages:
 *
 *   webview                                 extension host
 *     │   {type: "fs.read", id, path}    →     │
 *     │                                         vscode.workspace.fs.readFile
 *     │   ←  {type: "fs.read.result", id, bytes / error}
 *     │
 *     │   {type: "fs.write", id, path, bytes} →
 *     │                                         vscode.workspace.fs.writeFile
 *     │   ←  {type: "fs.write.result", id, error?}
 *
 * Encoding / decoding (text SVG, raster + XMP) lives entirely in
 * the webview because the canvas + the `@ingcreators/annot-core/xmp`
 * helpers are browser-side. The extension host's role is plain
 * file I/O — it doesn't know what an Annot file looks like.
 *
 * Boot sequence:
 *   1. Webview posts `{type: "ready"}`.
 *   2. Extension posts `{type: "open", path, filename}`.
 *   3. Webview calls `shell.open(path)` → triggers
 *      `proxyStorage.getImage(path)` → `fs.read` round-trip.
 *   4. Webview decodes bytes (XMP-recovery for raster, plain
 *      string for SVG), constructs an `ImageRecord`, mounts via
 *      `EditorShell.mountFromRecord(...)`.
 *
 * Save flow (debounced on `shell.on("dirty", ...)`):
 *   1. Webview-side save callback reads `shell.getCanvas()` and
 *      builds the file bytes per extension (SVG: text encode;
 *      raster: render canvas + `createEditableImage` + bytes).
 *   2. Webview posts `{type: "fs.write", id, path, bytes}`.
 *   3. Extension acknowledges via `{type: "fs.write.result", ...}`.
 */

import {
  createEditableImage,
  readEditableImage,
  type AnnotMetadata,
} from "@ingcreators/annot-core/xmp";
import { buildZip } from "@ingcreators/annot-core";
import { EditorShell } from "@ingcreators/annot-editor-shell";
import { exportSVGString, getPngDataUrl } from "@ingcreators/annot-editor";
import { buildPptxFiles } from "@ingcreators/annot-editor/pptx-export";
import { Toolbar } from "@ingcreators/annot-editor-shell/toolbar";
// `<annot-editor-right-panel>` registers a custom element on import.
import "@ingcreators/annot-editor-shell/right-panel";
import type { AnnotEditorRightPanelElement } from "@ingcreators/annot-editor-shell/right-panel";
import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";

// Pull in the host-side stylesheets that the toolbar +
// property panel + canvas (#svg-root / [data-annot-shell-root])
// rely on. These ship alongside `@ingcreators/annot-core` and
// the editor-shell's components emit class names targeted by
// them. Without these the toolbar is unstyled (no background,
// no spacing) and the property panel renders as raw labels +
// inputs.
import "@ingcreators/annot-core/styles/editor.css";
import "@ingcreators/annot-core/styles/toolbar.css";
import "@ingcreators/annot-core/styles/property-panel.css";
import "@ingcreators/annot-core/styles/fonts.css";

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
};

const vscode = acquireVsCodeApi();
const container = document.getElementById("annot-shell-container") as HTMLElement;
const toolbarMount = document.getElementById("annot-shell-toolbar") as HTMLElement;
const rightPanelMount = document.getElementById("annot-shell-right-panel") as HTMLElement;

// ─── Message types ─────────────────────────────────────────────

interface OpenMessage {
  type: "open";
  path: string;
  filename: string;
}
interface FsReadResultMessage {
  type: "fs.read.result";
  id: number;
  bytes?: number[];
  error?: string;
}
interface FsWriteResultMessage {
  type: "fs.write.result";
  id: number;
  error?: string;
}
interface ThemeMessage {
  type: "theme";
  // ColorThemeKind: 1=Light, 2=Dark, 3=HighContrast, 4=HighContrastLight.
  kind: 1 | 2 | 3 | 4;
}
interface ExportMessage {
  type: "export";
  id: number;
  format: "png" | "jpeg" | "pptx";
}
type ExtensionMessage =
  | OpenMessage
  | FsReadResultMessage
  | FsWriteResultMessage
  | ThemeMessage
  | ExportMessage;

// ─── postMessage round-trip helpers ────────────────────────────

let nextRequestId = 1;
const pendingReads = new Map<
  number,
  { resolve: (bytes: Uint8Array) => void; reject: (err: Error) => void }
>();
const pendingWrites = new Map<
  number,
  { resolve: () => void; reject: (err: Error) => void }
>();

function fsRead(path: string): Promise<Uint8Array> {
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pendingReads.set(id, { resolve, reject });
    vscode.postMessage({ type: "fs.read", id, path });
  });
}

function fsWrite(path: string, bytes: Uint8Array): Promise<void> {
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pendingWrites.set(id, { resolve, reject });
    vscode.postMessage({
      type: "fs.write",
      id,
      path,
      // The structured-clone postMessage protocol handles
      // `Uint8Array` directly, but a plain number array is the
      // safest cross-runtime shape (the Phase 4 path used the
      // same shape for the boot bytes; preserving for symmetry).
      bytes: Array.from(bytes),
    });
  });
}

// ─── ImageRecord encode / decode by extension ──────────────────

function extOf(filename: string): "svg" | "png" | "jpg" | "jpeg" | "" {
  const m = filename.toLowerCase().match(/\.(svg|png|jpe?g)$/i);
  if (!m) return "";
  return (m[1] === "jpeg" ? "jpeg" : m[1]) as "svg" | "png" | "jpg" | "jpeg";
}

function folderPathOf(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/\/[^/]+$/, "/");
}

function decodeRecord(filePath: string, filename: string, bytes: Uint8Array): ImageRecord {
  const ext = extOf(filename);
  const now = new Date().toISOString();
  const base: Omit<ImageRecord, "originalDataUrl" | "annotationsSvg" | "width" | "height"> = {
    path: filePath,
    folderPath: folderPathOf(filePath),
    thumbnailDataUrl: "",
    sourceUrl: "",
    tags: {},
    createdAt: now,
    updatedAt: now,
  };

  if (ext === "svg") {
    const svg = new TextDecoder().decode(bytes);
    const dims = parseSvgDims(svg);
    return {
      ...base,
      originalDataUrl: "",
      annotationsSvg: svg,
      width: dims.width,
      height: dims.height,
    };
  }

  // Raster: try to recover the embedded annotation SVG + the
  // original (un-annotated) screenshot via the existing
  // `readEditableImage` round-trip. Falls back to "raw raster
  // with no annotations" when the file wasn't authored by Annot
  // (e.g. the user manually copied a `screenshot.png` to
  // `screenshot.annot.png` without going through the editor).
  const meta: AnnotMetadata | null = readEditableImage(bytes);
  if (meta) {
    return {
      ...base,
      originalDataUrl: meta.originalImageDataUrl,
      annotationsSvg: meta.annotationsSvg,
      width: meta.width,
      height: meta.height,
      tags: meta.tags ?? {},
    };
  }

  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
  return {
    ...base,
    originalDataUrl: dataUrl,
    annotationsSvg: "",
    width: 0,
    height: 0,
  };
}

async function encodeBytesForSave(filePath: string, filename: string): Promise<Uint8Array> {
  const ext = extOf(filename);
  const canvas = shell.getCanvas();
  if (!canvas) throw new Error("encodeBytesForSave: no canvas mounted");

  if (ext === "svg") {
    return new TextEncoder().encode(exportSVGString(canvas));
  }

  // Raster: render the canvas to a PNG blob, recover the
  // un-annotated original from `<image href="data:...">`, embed
  // both alongside the annotations-only SVG via
  // `createEditableImage`. The output is a re-editable
  // PNG / JPEG that round-trips through `readEditableImage` on
  // next open.
  const renderedDataUrl = await getPngDataUrl(canvas);
  const renderedBlob = await dataUrlToBlob(renderedDataUrl);
  const originalDataUrl = canvas.imageEl.getAttribute("href") ?? "";
  const annotationsSvg = exportAnnotationsOnlySvg(canvas);
  const format: "jpg" | "png" = ext === "jpg" || ext === "jpeg" ? "jpg" : "png";
  const editable = await createEditableImage({
    renderedBlob,
    originalDataUrl,
    annotationsSvg,
    width: canvas.imageWidth,
    height: canvas.imageHeight,
    format,
  });
  return new Uint8Array(await editable.arrayBuffer());
}

// `exportAnnotationsSVGString` in `@ingcreators/annot-editor` is
// not currently re-exported; reproduce the minimal "annotations
// only, no `<image>` and no `#ui-overlay`" path inline. Kept
// dead-simple: clone, drop the ui overlay, drop the screenshot
// `<image>`, serialize.
function exportAnnotationsOnlySvg(canvas: ReturnType<typeof shell.getCanvas> & {}): string {
  const clone = canvas.svg.cloneNode(true) as SVGSVGElement;
  clone.querySelector("#ui-overlay")?.remove();
  clone.querySelector("image")?.remove();
  return new XMLSerializer().serializeToString(clone);
}

// ─── StorageProvider proxy ─────────────────────────────────────

let activeFilename = "";

const proxyStorage: StorageProvider = {
  async getImage(path: string): Promise<ImageRecord | undefined> {
    try {
      const bytes = await fsRead(path);
      return decodeRecord(path, activeFilename || path, bytes);
    } catch (err) {
      console.error("[annot/vscode] getImage failed:", err);
      return undefined;
    }
  },
  async updateImage(path: string): Promise<void> {
    // `updates` is ignored — for VSCode we always re-serialize
    // the live canvas (which matches the user's screen) rather
    // than trusting whatever subset the EditorShell handed us.
    // This is the safer choice when the file format embeds
    // multiple things (SVG = self-contained; raster = original +
    // XMP); the `updates` parameter only carries
    // `annotationsSvg` + `updatedAt` and is not enough on its
    // own to reconstruct a raster file.
    const bytes = await encodeBytesForSave(path, activeFilename || path);
    await fsWrite(path, bytes);
  },
  // EditorShell only calls `getImage` + `updateImage`. The
  // remaining surface throws so a future caller (gallery view
  // etc.) gets a clear NotImplemented error instead of silent
  // misbehaviour.
  saveImage: () => Promise.reject(new Error("VSCode webview proxy: saveImage not implemented")),
  listImages: () => Promise.resolve([]),
  moveImage: () => Promise.reject(new Error("VSCode webview proxy: moveImage not implemented")),
  renameImage: () => Promise.reject(new Error("VSCode webview proxy: renameImage not implemented")),
  deleteImage: () => Promise.resolve(),
  createFolder: () =>
    Promise.reject(new Error("VSCode webview proxy: createFolder not implemented")),
  listFolders: () => Promise.resolve([]),
  getFolder: () => Promise.resolve(undefined),
  renameFolder: () =>
    Promise.reject(new Error("VSCode webview proxy: renameFolder not implemented")),
  moveFolder: () => Promise.reject(new Error("VSCode webview proxy: moveFolder not implemented")),
  deleteFolder: () => Promise.resolve(),
  getBreadcrumb: () => Promise.resolve([]),
};

// ─── Shell construction ────────────────────────────────────────

const shell = new EditorShell({
  container,
  storage: proxyStorage,
  features: {
    capture: false,
    fileManager: false,
    scratchpad: false,
    keyboardHelp: true,
  },
  themeOverrides: {
    "--annot-bg-canvas": "var(--vscode-editor-background)",
    "--annot-text-primary": "var(--vscode-editor-foreground)",
    "--annot-border-color": "var(--vscode-panel-border)",
  },
});

// Debounced autosave on every `dirty`. 500 ms matches the
// magnitude of PWA's `SavePipeline` debounce; tweak if needed.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveInFlight: Promise<void> | null = null;

shell.on("dirty", () => {
  vscode.postMessage({ type: "dirty" });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(scheduleSave, 500);
});

shell.on("error", (err) => {
  console.error("[annot/vscode] EditorShell error:", err);
});

function scheduleSave(): void {
  // Coalesce: if a save is currently flying, defer this trigger
  // until it lands (the next dirty after success kicks off the
  // followup; saveInFlight chaining keeps this simple).
  if (saveInFlight) {
    saveInFlight = saveInFlight.then(scheduleSave);
    return;
  }
  saveInFlight = shell.saveNow().finally(() => {
    saveInFlight = null;
  });
}

// ─── Toolbar + right-panel mount (per shell.open) ──────────────

let activeToolbar: Toolbar | null = null;
let activeRightPanel: AnnotEditorRightPanelElement | null = null;

function mountToolbarAndRightPanel(): void {
  const canvas = shell.getCanvas();
  const history = shell.getHistory();
  const selection = shell.getSelection();
  if (!canvas || !history || !selection) return;

  // Tear down any toolbar / right-panel from a previous open.
  // `Toolbar` doesn't expose a `destroy()` — clearing the host
  // div + dropping the reference is sufficient (the toolbar's
  // listeners on `canvas` go away when the SelectionManager /
  // CanvasManager get disposed by the next `shell.mountFromRecord`).
  toolbarMount.innerHTML = "";
  rightPanelMount.innerHTML = "";
  activeRightPanel?.destroy();

  // Right-panel first so the toolbar's `onToolChange` callback
  // (which calls `panel.showToolProperties`) has a target.
  const panel = document.createElement(
    "annot-editor-right-panel",
  ) as AnnotEditorRightPanelElement;
  panel.canvas = canvas;
  panel.history = history;
  panel.selection = selection;
  panel.getPluginSections = null;
  panel.isBuiltinSectionDisabled = null;
  rightPanelMount.appendChild(panel);
  activeRightPanel = panel;
  panel.setPageMetadata(shell.getCurrentPageMetadata());

  // Toolbar — vertical strip on the left, mirroring the PWA's
  // layout. Theme toggle / gallery button / save group hidden
  // because VSCode supplies those affordances itself.
  activeToolbar = new Toolbar(
    toolbarMount,
    canvas,
    history,
    selection,
    (_toolName, toolId) => {
      activeRightPanel?.showToolProperties(toolId);
    },
    {
      orientation: "vertical",
      showThemeToggle: false,
      showGalleryButton: false,
      showSaveGroup: false,
      hideToolDropdowns: false,
      getCurrentFilename: () => activeFilename || undefined,
    },
  );
  // Wire the toolbar to the right-panel ref so the panel can
  // call back into it (the panel's tool-properties section needs
  // a Toolbar handle to read the current preset).
  panel.toolbar = activeToolbar;

  // Selection-change → right-panel's selection-properties section.
  // The shell installs its own single-slot `selection.onChange`
  // callback (which fans out to `shell.on("selection-change",
  // ...)` subscribers); chain the previous callback so we don't
  // shadow it.
  const previousOnChange = selection.onChange;
  selection.onChange = () => {
    previousOnChange?.();
    const els = selection.selectedElements;
    if (els.length > 0 && !canvas.activeTool) {
      activeRightPanel?.showSelectionProperties(els);
    } else {
      activeRightPanel?.showSelectionProperties([]);
    }
  };
}

// ─── Extension → webview message handler ───────────────────────

window.addEventListener("message", (event) => {
  const msg = event.data as ExtensionMessage;
  switch (msg.type) {
    case "open": {
      activeFilename = msg.filename;
      // `shell.open(path)` triggers `proxyStorage.getImage(path)`
      // which round-trips through `fs.read`. `shell.open` rejects
      // on missing files; we surface that via the `error` event
      // listener installed above.
      void shell.open(msg.path).then(() => {
        // Clear the placeholder text once the canvas is mounted.
        for (const child of Array.from(container.children)) {
          if (
            child instanceof HTMLElement &&
            child.classList.contains("annot-placeholder")
          ) {
            child.remove();
          }
        }
        // Mount the toolbar + right-panel now that the shell has
        // canvas / history / selection ready. Mirrors the PWA's
        // `EditorSession.setupEditor` pattern but stripped of
        // PWA-shell-specific bits (no editor-header, no
        // gallery button, no scratchpad — VSCode owns those
        // surfaces or doesn't have them at all).
        mountToolbarAndRightPanel();
        // `cmdNewFromClipboard` (extension-side) writes a 1×1
        // transparent PNG as a placeholder so the file exists for
        // `vscode.openWith`. Detect that exact placeholder here
        // and try to overwrite the canvas's background with the
        // OS clipboard image. If the clipboard doesn't carry an
        // image (or the user denies the permission prompt), the
        // placeholder remains and the user gets a blank canvas
        // they can draw on.
        void maybeBootstrapFromClipboard();
      });
      break;
    }
    case "export": {
      void runExport(msg.id, msg.format);
      break;
    }
    case "fs.read.result": {
      const pending = pendingReads.get(msg.id);
      if (!pending) return;
      pendingReads.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else if (msg.bytes) {
        pending.resolve(new Uint8Array(msg.bytes));
      } else {
        pending.reject(new Error("fs.read.result: missing bytes + error"));
      }
      break;
    }
    case "fs.write.result": {
      const pending = pendingWrites.get(msg.id);
      if (!pending) return;
      pendingWrites.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error));
      else pending.resolve();
      break;
    }
    case "theme": {
      const isDark = msg.kind === 2 || msg.kind === 3;
      container.classList.toggle("annot-theme-dark", isDark);
      container.classList.toggle("annot-theme-light", !isDark);
      break;
    }
  }
});

vscode.postMessage({ type: "ready" });

// ─── Helpers ───────────────────────────────────────────────────

function parseSvgDims(svg: string): { width: number; height: number } {
  const w = svg.match(/<svg[^>]*\bwidth\s*=\s*["']?(\d+(?:\.\d+)?)/i);
  const h = svg.match(/<svg[^>]*\bheight\s*=\s*["']?(\d+(?:\.\d+)?)/i);
  return {
    width: w?.[1] ? Number.parseFloat(w[1]) : 0,
    height: h?.[1] ? Number.parseFloat(h[1]) : 0,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const r = await fetch(dataUrl);
  return r.blob();
}

// ─── Export RPC ────────────────────────────────────────────────

async function runExport(id: number, format: "png" | "jpeg" | "pptx"): Promise<void> {
  try {
    const canvas = shell.getCanvas();
    if (!canvas) throw new Error("no canvas mounted");
    const stem = activeFilename.replace(/\.annot\.[^.]+$/i, "").replace(/\.[^.]+$/, "");
    const safeStem = stem || "annotation";

    let bytes: Uint8Array;
    let suggestedFilename: string;
    if (format === "pptx") {
      const files = buildPptxFiles(canvas);
      const entries = Object.entries(files).map(([name, data]) => ({ name, data }));
      const zipBlob = buildZip(entries);
      bytes = new Uint8Array(await zipBlob.arrayBuffer());
      suggestedFilename = `${safeStem}.pptx`;
    } else {
      // For raster export, build a re-editable image (XMP-bearing)
      // so the produced file can be re-opened in Annot. This
      // matches the PWA's `saveAsEditableImage` semantics.
      const renderedDataUrl = await getPngDataUrl(canvas);
      const renderedBlob = await dataUrlToBlob(renderedDataUrl);
      const originalDataUrl = canvas.imageEl.getAttribute("href") ?? "";
      const annotationsSvg = exportAnnotationsOnlySvg(canvas);
      const editable = await createEditableImage({
        renderedBlob,
        originalDataUrl,
        annotationsSvg,
        width: canvas.imageWidth,
        height: canvas.imageHeight,
        format: format === "jpeg" ? "jpg" : "png",
      });
      bytes = new Uint8Array(await editable.arrayBuffer());
      suggestedFilename = `${safeStem}.${format === "jpeg" ? "jpg" : "png"}`;
    }

    vscode.postMessage({
      type: "export.result",
      id,
      bytes: Array.from(bytes),
      suggestedFilename,
    });
  } catch (err) {
    vscode.postMessage({
      type: "export.result",
      id,
      error: String(err),
    });
  }
}

// ─── Clipboard bootstrap (`Annot: New annotation from clipboard image`)

const PLACEHOLDER_PNG_LENGTH = 67;

async function maybeBootstrapFromClipboard(): Promise<void> {
  // The placeholder the extension writes for the clipboard
  // bootstrap is exactly 67 bytes. After `shell.open(path)`
  // resolves, the canvas's `<image href>` carries the file's
  // raw bytes as a data URL — short-circuit if it doesn't
  // match the placeholder length.
  const canvas = shell.getCanvas();
  if (!canvas) return;
  const href = canvas.imageEl.getAttribute("href") ?? "";
  const m = href.match(/^data:[^;]+;base64,(.+)$/);
  if (!m) return;
  let placeholderBytes: Uint8Array;
  try {
    placeholderBytes = base64ToBytes(m[1]!);
  } catch {
    return;
  }
  if (placeholderBytes.length !== PLACEHOLDER_PNG_LENGTH) return;

  if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") {
    console.warn("[annot/vscode] clipboard.read unavailable; placeholder remains.");
    return;
  }

  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      const dataUrl = await blobToDataUrl(blob);
      const dims = await loadImageDims(dataUrl);
      // Replace the canvas's background image + dimensions with
      // the clipboard image. The shell's `dirty` event fires
      // automatically because we mutate the SVG; the autosave
      // pipeline picks it up.
      canvas.imageEl.setAttribute("href", dataUrl);
      canvas.imageEl.setAttribute("width", String(dims.width));
      canvas.imageEl.setAttribute("height", String(dims.height));
      canvas.svg.setAttribute("viewBox", `0 0 ${dims.width} ${dims.height}`);
      canvas.svg.setAttribute("width", String(dims.width));
      canvas.svg.setAttribute("height", String(dims.height));
      // Trigger a save so the placeholder file gets replaced
      // immediately. The history record stays empty (we didn't
      // edit annotations, just swapped the background) so this
      // is a one-shot side-channel save.
      void shell.saveNow();
      return;
    }
  } catch (err) {
    console.warn("[annot/vscode] clipboard.read failed:", err);
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

function loadImageDims(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("clipboard image failed to load"));
    img.src = dataUrl;
  });
}
