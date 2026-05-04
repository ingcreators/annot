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
import { EditorShell } from "@ingcreators/annot-editor-shell";
import { exportSVGString, getPngDataUrl } from "@ingcreators/annot-editor";
import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
};

const vscode = acquireVsCodeApi();
const container = document.getElementById("annot-shell-container") as HTMLElement;

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
type ExtensionMessage =
  | OpenMessage
  | FsReadResultMessage
  | FsWriteResultMessage
  | ThemeMessage;

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
      });
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
