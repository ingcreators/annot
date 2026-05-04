/**
 * Annot — VSCode webview entry.
 *
 * Wires the EditorShell into the sandboxed iframe + integrates
 * with VSCode's CustomEditorProvider save / dirty / revert /
 * backup model. Encoding / decoding (text SVG, raster + XMP)
 * lives entirely in the webview because the canvas + the
 * `@ingcreators/annot-core/xmp` helpers are browser-side; the
 * extension host's role is plain `vscode.workspace.fs` I/O.
 *
 * Message protocol:
 *
 *   webview                                 extension host
 *     │   {type: "ready"}                →     │
 *     │   ←  {type: "open", path, filename}    │  (boot)
 *     │
 *     │   {type: "fs.read", id, path}    →     │  (load file bytes)
 *     │   ←  {type: "fs.read.result", id, bytes}
 *     │
 *     │   {type: "edit"}                 →     │  (mark dirty)
 *     │                                         vscode fires onDidChangeCustomDocument
 *     │
 *     │   ←  {type: "save", id}                │  (Ctrl+S / autosave / hot-exit)
 *     │   {type: "save.result", id, bytes} →
 *     │                                         vscode.workspace.fs.writeFile
 *     │
 *     │   ←  {type: "revert"}                  │  (file → revert / git checkout)
 *     │   shell.open(path) again              │
 *     │
 *     │   ←  {type: "export", id, format}      │  (palette: Save as PNG / JPEG / PPTX)
 *     │   {type: "export.result", id, bytes} →
 *     │
 *     │   ←  {type: "show-file-details"}       │  (palette: Show file details)
 *     │   ←  {type: "theme", kind}             │  (workbench theme follow)
 *
 * Save flow:
 *   1. Webview detects `shell.dirty` → posts `{type: "edit"}`.
 *   2. Extension fires `onDidChangeCustomDocument` → VSCode
 *      marks the tab dirty (●) and starts honouring
 *      `files.autoSave` if configured.
 *   3. When VSCode wants the bytes (Ctrl+S, autosave debounce
 *      fires, hot-exit backup), extension posts
 *      `{type: "save", id}` and awaits `save.result`.
 *   4. Webview encodes the live canvas via `encodeBytesForSave`
 *      and replies with the bytes.
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
import "@ingcreators/annot-editor-shell/editor-statusbar";
import type { AnnotEditorStatusbarElement } from "@ingcreators/annot-editor-shell/editor-statusbar";
import "@ingcreators/annot-editor-shell/annot-file-details-drawer";
import type { AnnotFileDetailsDrawerElement } from "@ingcreators/annot-editor-shell/annot-file-details-drawer";
import { VSCODE_THEME_MAP } from "./theme-map.js";
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
const statusbarMount = document.getElementById("annot-shell-statusbar") as HTMLElement;

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
interface ShowFileDetailsMessage {
  type: "show-file-details";
}
interface SaveRequestMessage {
  type: "save";
  id: number;
}
interface RevertMessage {
  type: "revert";
}
type ExtensionMessage =
  | OpenMessage
  | FsReadResultMessage
  | ThemeMessage
  | ExportMessage
  | ShowFileDetailsMessage
  | SaveRequestMessage
  | RevertMessage;

// ─── postMessage round-trip helpers ────────────────────────────

let nextRequestId = 1;
const pendingReads = new Map<
  number,
  { resolve: (bytes: Uint8Array) => void; reject: (err: Error) => void }
>();

function fsRead(path: string): Promise<Uint8Array> {
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pendingReads.set(id, { resolve, reject });
    vscode.postMessage({ type: "fs.read", id, path });
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
// On-disk path of the open file. Set from the extension's
// `open` message so the file-details drawer + the future
// "Reveal in test file" command can use it.
let activeFilePath = "";

const proxyStorage: StorageProvider = {
  async getImage(path: string): Promise<ImageRecord | undefined> {
    try {
      const bytes = await fsRead(path);
      // Track the on-disk file size so the file-details drawer
      // can show "File size: 12.3 kB" without rounding through
      // the data-URL estimate. Updates on every fetch — the
      // most recently-loaded file's bytes are what the drawer
      // surfaces.
      activeFileBytes = bytes.length;
      return decodeRecord(path, activeFilename || path, bytes);
    } catch (err) {
      console.error("[annot/vscode] getImage failed:", err);
      return undefined;
    }
  },
  async updateImage(): Promise<void> {
    // No-op. With the `CustomEditorProvider` switch, save is
    // VSCode-driven — the extension posts `{type: "save", id}`
    // which `runSave` (below) answers with encoded bytes. The
    // shell's `saveNow()` would have called this method on the
    // legacy autosave path, but no code path in this webview
    // calls `shell.saveNow()` anymore. Kept as a no-op so the
    // `StorageProvider` interface is still satisfied.
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

// Apply the Annot ↔ VSCode token mapping at `:root` (i.e. the
// `<html>` element) BEFORE the shell mounts. Why not pass it
// through `EditorShell({themeOverrides: ...})`? Because the
// shell applies the override map to its container element only,
// which is `#annot-shell-container` — the canvas pane. Toolbar,
// right-panel, statusbar (siblings of the container in the
// webview HTML) and the file-details drawer (appended to
// `document.body`) all live OUTSIDE that subtree, so they would
// keep seeing the `--annot-*` defaults from `editor.css`'s
// `:root` block instead of the VSCode-mapped ones. Setting the
// overrides on `<html>` itself is one cascade level higher than
// `editor.css`'s `:root` rule (inline > stylesheet) so they
// cleanly take precedence everywhere in the iframe.
applyThemeMap();

function applyThemeMap(): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(VSCODE_THEME_MAP)) {
    root.style.setProperty(name, value);
  }
}

const shell = new EditorShell({
  container,
  storage: proxyStorage,
  features: {
    capture: false,
    fileManager: false,
    scratchpad: false,
    keyboardHelp: true,
  },
  // No `themeOverrides` here — `applyThemeMap()` above already
  // installed the full mapping on `<html>`, which covers every
  // descendant (canvas + toolbar + right-panel + drawer).
});

// VSCode-native save integration: webview just signals "edit
// happened"; the extension fires `onDidChangeCustomDocument`
// → VSCode marks dirty (●) on the tab. The actual save is
// driven by VSCode (`Ctrl+S`, `files.autoSave`, hot-exit
// backup, etc.); the extension posts `{type: "save", id}`
// when it needs bytes, and the webview answers with
// `{type: "save.result", id, bytes}` (handled below).
shell.on("dirty", () => {
  vscode.postMessage({ type: "edit" });
});

shell.on("error", (err) => {
  console.error("[annot/vscode] EditorShell error:", err);
});

// ─── Toolbar + right-panel + statusbar + drawer mount ─────────

let activeToolbar: Toolbar | null = null;
let activeRightPanel: AnnotEditorRightPanelElement | null = null;
let activeStatusbar: AnnotEditorStatusbarElement | null = null;
let activeDrawer: AnnotFileDetailsDrawerElement | null = null;
let activeFileBytes = 0;
// ResizeObserver that re-fits the canvas whenever the
// container's box changes — VSCode webview is hosted in a
// resizable iframe (split panes / sidebar toggle / window
// resize all change the available width / height), and
// `canvas.refitIfFitMode()` re-runs the fit math so "Fit to
// window" stays accurate as the user reshapes the editor.
let activeFitObserver: ResizeObserver | null = null;

function mountToolbarAndRightPanel(): void {
  const canvas = shell.getCanvas();
  const history = shell.getHistory();
  const selection = shell.getSelection();
  if (!canvas || !history || !selection) return;

  // Tear down any toolbar / right-panel / statusbar from a
  // previous open. `Toolbar` doesn't expose a `destroy()` —
  // clearing the host div + dropping the reference is
  // sufficient (the toolbar's listeners on `canvas` go away
  // when the SelectionManager / CanvasManager get disposed by
  // the next `shell.mountFromRecord`).
  toolbarMount.innerHTML = "";
  rightPanelMount.innerHTML = "";
  statusbarMount.innerHTML = "";
  activeRightPanel?.destroy();
  activeDrawer?.destroy();
  activeDrawer = null;
  activeFitObserver?.disconnect();
  activeFitObserver = null;

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
      activeStatusbar?.setActiveTool(_toolName);
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

  // Statusbar — `[zoom] [dimensions] ───── [current tool]`.
  // Mirrors the PWA's `StatusHost.build(canvas, w, h)`.
  const statusbar = document.createElement(
    "annot-editor-statusbar",
  ) as AnnotEditorStatusbarElement;
  statusbar.canvas = canvas;
  statusbar.width = canvas.imageWidth;
  statusbar.height = canvas.imageHeight;
  statusbarMount.appendChild(statusbar);
  activeStatusbar = statusbar;

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

  // Re-fit the canvas whenever the container resizes — VSCode
  // panel splits, sidebar toggles, window resizes all change
  // the available width / height. `refitIfFitMode` is a no-op
  // when the user is on a fixed zoom level (e.g. 100%, 200%);
  // it only re-runs the fit math when "Fit to window" is the
  // active zoom mode. Mirrors the PWA's `EditorSession`
  // ResizeObserver pattern.
  activeFitObserver = new ResizeObserver(() => canvas.refitIfFitMode());
  activeFitObserver.observe(container);
}

// ─── File-details drawer ───────────────────────────────────────

function showFileDetails(): void {
  const canvas = shell.getCanvas();
  if (!canvas) return;
  // Build a fresh drawer per open. The drawer mounts itself on
  // `document.body` so its absolute-positioning chrome (backdrop
  // + panel) overlays the entire webview.
  activeDrawer?.destroy();
  const drawer = document.createElement(
    "annot-file-details-drawer",
  ) as AnnotFileDetailsDrawerElement;
  drawer.data = {
    filename: activeFilename || "(untitled)",
    folderPath: foldernameFromPath(activeFilePath),
    width: canvas.imageWidth,
    height: canvas.imageHeight,
    fileSizeBytes: activeFileBytes,
    createdAt: undefined,
    updatedAt: undefined,
    sourceUrl: undefined,
    tags: {},
    externalLinks: [],
  };
  drawer.getPluginSections = null;
  drawer.isBuiltinSectionDisabled = null;
  // VSCode owns the filename via the tab title; don't expose
  // rename in the webview drawer (the user renames via the
  // VSCode Explorer / "Rename" command).
  drawer.onRename = null;
  drawer.onTagsChange = null;
  document.body.appendChild(drawer);
  activeDrawer = drawer;
  drawer.open();
}

function foldernameFromPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/[^/]+$/, "/");
}

// ─── Extension → webview message handler ───────────────────────

window.addEventListener("message", (event) => {
  const msg = event.data as ExtensionMessage;
  switch (msg.type) {
    case "open": {
      activeFilename = msg.filename;
      activeFilePath = msg.path;
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
    case "show-file-details": {
      showFileDetails();
      break;
    }
    case "save": {
      void runSave(msg.id);
      break;
    }
    case "revert": {
      void runRevert();
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

// ─── Save / revert RPC (driven by VSCode Ctrl+S / autosave) ────

/**
 * Encode the live canvas to bytes for the open file's extension
 * and reply with `save.result`. The extension's
 * `saveCustomDocument` / `saveCustomDocumentAs` /
 * `backupCustomDocument` await this reply, then write the bytes
 * via `vscode.workspace.fs.writeFile`. If we can't encode (no
 * canvas / unknown extension), we reply with an error so VSCode
 * surfaces "Save failed" instead of writing empty bytes.
 */
async function runSave(id: number): Promise<void> {
  try {
    const bytes = await encodeBytesForSave(activeFilePath, activeFilename);
    vscode.postMessage({
      type: "save.result",
      id,
      bytes: Array.from(bytes),
    });
  } catch (err) {
    vscode.postMessage({
      type: "save.result",
      id,
      error: String(err),
    });
  }
}

/**
 * Discard in-memory edits and re-fetch the file from disk.
 * Triggered by VSCode's Revert command (`File → Revert File`,
 * `git checkout` of the open file, etc.). Routes through
 * `shell.open(path)` again — same boot path as the initial
 * file open, so the proxy storage's `getImage` re-runs `fs.read`
 * and `mountFromRecord` rebuilds the canvas state.
 *
 * After revert the toolbar / right-panel / statusbar may need
 * remounting because the previous CanvasManager instance is
 * gone — call `mountToolbarAndRightPanel()` again.
 */
async function runRevert(): Promise<void> {
  if (!activeFilePath) return;
  try {
    await shell.open(activeFilePath);
    mountToolbarAndRightPanel();
  } catch (err) {
    console.error("[annot/vscode] revert failed:", err);
  }
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
