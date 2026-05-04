/**
 * Annot — VSCode webview entry.
 *
 * Phase 4 skeleton. The webview boots, posts `{type: "ready"}`
 * to the extension, and waits for the extension to send back the
 * file's bytes via `{type: "open", path, filename, bytes}`. On
 * receipt, the webview constructs an `EditorShell` against
 * `#annot-shell-container` and either:
 *
 *   - Calls `shell.mountFromRecord(...)` for `*.annot.svg` files
 *     (the SVG IS the record's `annotationsSvg`; the embedded
 *     `<image href="data:...">` carries the screenshot bytes,
 *     which the existing `restoreAnnotations` flow handles).
 *   - Calls `shell.mountFromRecord(...)` for raster files with a
 *     basic `originalDataUrl` constructed from the bytes.
 *
 * Phase 5 wires the full message protocol:
 *   - `{type: "save", bytes}` extension → write via
 *     `vscode.workspace.fs.writeFile`.
 *   - `{type: "saved"}` extension → webview re-enables editing.
 *   - `{type: "error", message}` either direction.
 *
 * The webview-side `StorageProvider` proxy (forwarding every
 * EditorShell storage call to the extension via postMessage) also
 * lands in Phase 5 — Phase 4 sticks with `mountFromRecord` so the
 * shell architecture is exercised without the message-protocol
 * complexity.
 */

import { EditorShell } from "@ingcreators/annot-editor-shell";
import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
};

interface OpenMessage {
  type: "open";
  path: string;
  filename: string;
  bytes: number[];
}

interface SavedMessage {
  type: "saved";
}

interface SaveErrorMessage {
  type: "save-error";
  message: string;
}

interface ThemeMessage {
  type: "theme";
  // VSCode's `ColorThemeKind` enum values: Light=1, Dark=2,
  // HighContrast=3, HighContrastLight=4. The webview doesn't
  // import the enum (it would drag the @types/vscode runtime
  // shape into the bundle), so the message uses raw integers.
  kind: 1 | 2 | 3 | 4;
}

type ExtensionMessage = OpenMessage | SavedMessage | SaveErrorMessage | ThemeMessage;

const vscode = acquireVsCodeApi();

const container = document.getElementById("annot-shell-container") as HTMLElement;

// Extension-side provides storage via postMessage (Phase 5). Phase
// 4 uses a stub that satisfies the StorageProvider type so
// `EditorShell` constructs successfully — the shell only calls
// `getImage` / `updateImage`, and Phase 4 routes those through the
// message protocol via `requestSave` below rather than the
// StorageProvider directly.
const noopStorage = {
  getImage: () => Promise.resolve(undefined),
  updateImage: () => Promise.resolve(),
  saveImage: () => Promise.reject(new Error("phase 4: not wired")),
  listImages: () => Promise.resolve([]),
  moveImage: () => Promise.reject(new Error("phase 4: not wired")),
  renameImage: () => Promise.reject(new Error("phase 4: not wired")),
  deleteImage: () => Promise.resolve(),
  createFolder: () => Promise.reject(new Error("phase 4: not wired")),
  listFolders: () => Promise.resolve([]),
  getFolder: () => Promise.resolve(undefined),
  renameFolder: () => Promise.reject(new Error("phase 4: not wired")),
  moveFolder: () => Promise.reject(new Error("phase 4: not wired")),
  deleteFolder: () => Promise.resolve(),
} as unknown as StorageProvider;

const shell = new EditorShell({
  container,
  storage: noopStorage,
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

shell.on("dirty", () => {
  // Phase 5: forward to the extension's status bar item.
  vscode.postMessage({ type: "dirty" });
});

shell.on("error", (err) => {
  console.error("[annot/vscode] EditorShell error:", err);
});

window.addEventListener("message", (event) => {
  const msg = event.data as ExtensionMessage;
  switch (msg.type) {
    case "open": {
      const record = bytesToImageRecord(msg);
      shell.mountFromRecord(msg.path, record);
      // Clear the placeholder text once the canvas is mounted.
      for (const child of Array.from(container.children)) {
        if (
          child instanceof HTMLElement &&
          child.classList.contains("annot-placeholder")
        ) {
          child.remove();
        }
      }
      break;
    }
    case "theme": {
      // ColorThemeKind: 1=Light, 2=Dark, 3=HighContrast, 4=HighContrastLight.
      // Toggle a class on the container so future per-theme CSS can
      // adjust palette nuances beyond what `--vscode-*` vars cover.
      const isDark = msg.kind === 2 || msg.kind === 3;
      container.classList.toggle("annot-theme-dark", isDark);
      container.classList.toggle("annot-theme-light", !isDark);
      break;
    }
    case "saved": {
      // The extension confirmed the write; `EditorShell.saveNow`
      // already emitted its own `saved` event when the in-memory
      // write resolved. No-op here, kept for protocol symmetry.
      break;
    }
    case "save-error": {
      console.error("[annot/vscode] save-error from extension:", msg.message);
      break;
    }
  }
});

vscode.postMessage({ type: "ready" });

function bytesToImageRecord(msg: OpenMessage): ImageRecord {
  const bytes = new Uint8Array(msg.bytes);
  const ext = msg.filename.toLowerCase().split(".").pop() ?? "";
  const folderPath = msg.path.replace(/\\/g, "/").replace(/\/[^/]+$/, "/");
  if (ext === "svg") {
    const svg = new TextDecoder().decode(bytes);
    const dims = parseSvgDims(svg);
    return {
      path: msg.path,
      folderPath,
      originalDataUrl: "",
      thumbnailDataUrl: "",
      annotationsSvg: svg,
      width: dims.width,
      height: dims.height,
      sourceUrl: "",
      tags: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
  return {
    path: msg.path,
    folderPath,
    originalDataUrl: dataUrl,
    thumbnailDataUrl: "",
    annotationsSvg: "",
    width: 0,
    height: 0,
    sourceUrl: "",
    tags: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

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
