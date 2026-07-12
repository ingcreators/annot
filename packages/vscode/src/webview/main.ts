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

import { buildZip } from "@ingcreators/annot-core";
import {
  readSvgProvenanceAttrs,
  writeSvgProvenanceAttrs,
} from "@ingcreators/annot-core/editor/svg-format";
import {
  type AnnotMetadata,
  createEditableImage,
  readEditableImage,
} from "@ingcreators/annot-core/xmp";
import {
  type AnnotDocument,
  parseDocument,
  serializeStandaloneDocument,
} from "@ingcreators/annot-doc";
import { exportSVGString, getPngDataUrl } from "@ingcreators/annot-editor";
import { buildPptxFiles } from "@ingcreators/annot-editor/pptx-export";
import { EditorShell } from "@ingcreators/annot-host-ui";
import "@ingcreators/annot-host-ui/annot-doc-shell";
import type {
  AnnotDocShellElement,
  DocChangedDetail,
} from "@ingcreators/annot-host-ui/annot-doc-shell";
// Phase 1 of `docs/plans/annot-html-document-ux-polish.md` —
// the VSCode webview gets the same doc-mode header strip the
// PWA grew. Back + save-status are hidden because VSCode owns
// dirty / saved state via the tab badge.
import "@ingcreators/annot-host-ui/annot-doc-header";
import type {
  AnnotDocHeaderElement,
  DocHeaderOverflowItem,
} from "@ingcreators/annot-host-ui/annot-doc-header";
import { Toolbar } from "@ingcreators/annot-host-ui/toolbar";
import { showConfirmDialog } from "@ingcreators/annot-host-ui/ui/dialog";
// Deep subpath (not the barrel) so the webview bundle doesn't pull
// the full rendering surface — same rationale as the pptx dynamic
// import below.
import { probeRasterDims } from "@ingcreators/annot-render/raster-dims";
// `<annot-editor-right-panel>` registers a custom element on import.
import "@ingcreators/annot-host-ui/right-panel";
import { StatusHost } from "@ingcreators/annot-host-ui/orchestrators/status-host";
import type { AnnotEditorRightPanelElement } from "@ingcreators/annot-host-ui/right-panel";
import "@ingcreators/annot-host-ui/annot-file-details-drawer";
import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import type { AnnotFileDetailsDrawerElement } from "@ingcreators/annot-host-ui/annot-file-details-drawer";
import { VSCODE_THEME_MAP } from "./theme-map.js";

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

/** True for `.annot.html` documents — Phase 10 of
 *  `docs/plans/_done/annot-html-document.md`. Drives the boot-mode
 *  branch so `.annot.html` mounts `<annot-doc-shell>` instead
 *  of the image-side `EditorShell`. */
function isDocFile(filename: string): boolean {
  return filename.toLowerCase().endsWith(".annot.html");
}

function folderPathOf(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/\/[^/]+$/, "/");
}

async function decodeRecord(
  filePath: string,
  filename: string,
  bytes: Uint8Array,
): Promise<ImageRecord> {
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
    // Provenance round-trip (schema-2.0 parity with the raster
    // XMP packet): read the data-annot-* root attributes so the
    // next save writes them back instead of dropping them.
    const provRoot = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    const prov = readSvgProvenanceAttrs(provRoot);
    return {
      ...base,
      // The base screenshot must be carried on the record:
      // `restoreAnnotations` deliberately skips the root-level
      // `<image>` (annotations only), so leaving this empty mounts
      // a blank canvas — and the next Ctrl+S then writes
      // `href=""` back to disk, destroying the screenshot pixels.
      originalDataUrl: extractBaseImageHref(svg),
      annotationsSvg: svg,
      width: dims.width,
      height: dims.height,
      sourceUrl: prov.sourceUrl,
      createdAt: prov.createdAt || now,
      producer: prov.producer || undefined,
      dpr: prov.dpr || undefined,
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
      // Provenance (schema 2.0) — kept on the record so the next
      // save writes it back instead of dropping it.
      sourceUrl: meta.sourceUrl || "",
      createdAt: meta.createdAt || now,
      producer: meta.producer || undefined,
      dpr: meta.dpr || undefined,
    };
  }

  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
  // Probe the real pixel dimensions — a 0×0 record mounts a
  // 0×0 canvas svg (blank editor) since the shell sizes the
  // canvas from the record, not from the decoded bitmap.
  const dims = await probeRasterDims(new Blob([bytes as BlobPart], { type: mime }));
  return {
    ...base,
    originalDataUrl: dataUrl,
    annotationsSvg: "",
    width: dims.width,
    height: dims.height,
  };
}

async function encodeBytesForSave(_filePath: string, filename: string): Promise<Uint8Array> {
  const ext = extOf(filename);
  const canvas = shell.getCanvas();
  if (!canvas) throw new Error("encodeBytesForSave: no canvas mounted");

  if (ext === "svg") {
    // Standalone .annot.svg carries the same provenance the raster
    // formats persist in XMP (data-annot-* root attributes —
    // docs/metadata-format.md "Carriers"). Parse → stamp →
    // re-serialize keeps exportSVGString itself provenance-free
    // (its other callers embed the SVG inside an XMP packet, where
    // the packet is the carrier).
    const svgString = exportSVGString(canvas);
    const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
    const root = doc.documentElement;
    writeSvgProvenanceAttrs(root, {
      sourceUrl: activeProvenance.sourceUrl,
      createdAt: activeProvenance.createdAt,
      producer: activeProvenance.producer || "vscode",
      dpr: activeProvenance.dpr,
    });
    return new TextEncoder().encode(new XMLSerializer().serializeToString(root));
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
    // Write the opened record's provenance back; a plain raster
    // that never had a packet gets stamped as vscode-authored on
    // its first upgrade to a re-editable file.
    sourceUrl: activeProvenance.sourceUrl,
    createdAt: activeProvenance.createdAt,
    producer: activeProvenance.producer || "vscode",
    dpr: activeProvenance.dpr,
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
// Provenance of the currently-open record (schema 2.0), captured
// at decode time so `runSave` / export write it back instead of
// dropping it on every re-save.
let activeProvenance: { sourceUrl?: string; createdAt?: string; producer?: string; dpr?: number } =
  {};

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
      const record = await decodeRecord(path, activeFilename || path, bytes);
      activeProvenance = {
        sourceUrl: record.sourceUrl || undefined,
        createdAt: record.createdAt || undefined,
        producer: record.producer,
        dpr: record.dpr,
      };
      return record;
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
  // Phase 6 of `docs/plans/_done/redact-burn-into-image.md` — keep the
  // right-panel's apply-redactions button in sync with the
  // document's redact-element count. Mirrors the PWA's
  // EditorSession dirty handler; the count drops to 0 right
  // after a successful burn (the redact elements are removed
  // from the annotations group), so the button auto-hides
  // without any explicit teardown.
  activeRightPanel?.refreshRedactCount();
});

shell.on("error", (err) => {
  console.error("[annot/vscode] EditorShell error:", err);
});

// ─── Toolbar + right-panel + statusbar + drawer mount ─────────

let activeToolbar: Toolbar | null = null;
let activeRightPanel: AnnotEditorRightPanelElement | null = null;
let activeStatusHost: StatusHost | null = null;
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
  const panel = document.createElement("annot-editor-right-panel") as AnnotEditorRightPanelElement;
  panel.canvas = canvas;
  panel.history = history;
  panel.selection = selection;
  panel.getPluginSections = null;
  panel.isBuiltinSectionDisabled = null;
  // Phase 6 of `docs/plans/_done/redact-burn-into-image.md` — wire the
  // shell's burn-in orchestration through the right-panel's
  // "Apply redactions to image" button. Mirrors the PWA's
  // EditorSession registration; no VSCode-specific code path
  // beyond binding the callback. The panel hides the button
  // when `redactCount === 0`, so the initial refresh ensures
  // it appears immediately when an annotated document with
  // existing redactions opens.
  panel.applyAllRedactions = () => shell.applyAllRedactions();
  panel.refreshRedactCount();
  rightPanelMount.appendChild(panel);
  activeRightPanel = panel;
  panel.setElementTree(shell.getCurrentElementTree());

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
      activeStatusHost?.setActiveTool(_toolName);
    },
    {
      orientation: "vertical",
      showSettingsButton: false,
      showGalleryButton: false,
      showSaveGroup: false,
      hideToolDropdowns: false,
      getCurrentFilename: () => activeFilename || undefined,
      // Confirm-then-bake gate the CropTool calls when the user
      // commits a crop rect. Mirrors the PWA wiring in
      // `editor-session.ts`: dialog → `shell.applyCrop` → save the
      // new bitmap + dimensions through the VSCode storage proxy.
      // The CustomEditorProvider's `updateImage` is a no-op (the
      // host saves on its own schedule via the `save` IPC), so the
      // shell's persistence call is harmless here — the bake mutation
      // shows up on disk via the next host-driven save instead.
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
        const result = await shell.applyCrop(x, y, w, h);
        return result.applied;
      },
    },
  );
  // Wire the toolbar to the right-panel ref so the panel can
  // call back into it (the panel's tool-properties section needs
  // a Toolbar handle to read the current preset).
  panel.toolbar = activeToolbar;

  // Statusbar — `[zoom] [dimensions] ───── [current tool]`.
  // Phase 3 of `docs/plans/_done/host-convergence.md` collapsed the inline
  // build into the shared `StatusHost` primitive (PWA + Desktop +
  // VSCode now share one implementation).
  activeStatusHost = new StatusHost(statusbarMount);
  activeStatusHost.build(canvas, canvas.imageWidth, canvas.imageHeight);

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
  if (bootMode === "doc") {
    // The image-side file-details drawer renders canvas
    // dimensions / data URL. Documents don't have those —
    // suppress the command silently in doc mode (the
    // command palette is shared so this keeps the
    // discoverability without the broken UX).
    return;
  }
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

// ─── Doc-mode mount (Phase 10 of annot-html-document.md) ──────
//
// `.annot.html` documents go through a separate boot path that
// mounts `<annot-doc-shell>` directly (no toolbar / right-panel
// / statusbar — those are image-only affordances). The shell's
// `doc-changed` event drives the same VSCode-native save
// lifecycle the image side uses: edit → mark dirty (●), Ctrl+S
// → encode + write via `vscode.workspace.fs`. Revert re-fetches
// the bytes and re-parses.
//
// `bootMode` flips on the first `open` message and never
// changes after — the image and doc paths are mutually
// exclusive; opening a different file uses a fresh
// `vscode.openWith` invocation which spawns a new webview
// panel.

type BootMode = "image" | "doc" | null;
let bootMode: BootMode = null;
let activeDocShell: AnnotDocShellElement | null = null;

/** Boot the doc-mode UI: hide the image-side grid (toolbar /
 *  right-panel / statusbar) and replace its centre column with
 *  the doc-shell. The first call wires the `doc-changed`
 *  listener (drives the dirty marker) + the save / revert
 *  hooks below. */
function bootDocMode(initialBytes: Uint8Array): void {
  const root = document.getElementById("annot-shell-root");
  if (!root) return;

  // Hide image-side panes — keep them in the DOM so the boot
  // path doesn't have to re-create them on a hypothetical
  // mode-switch (which doesn't happen in practice; one panel
  // = one mode for its lifetime). The doc-mode container
  // overlays the entire grid.
  for (const child of Array.from(root.children) as HTMLElement[]) {
    child.style.display = "none";
  }

  let docHost = document.getElementById("annot-doc-host") as HTMLDivElement | null;
  if (!docHost) {
    docHost = document.createElement("div");
    docHost.id = "annot-doc-host";
    docHost.style.cssText =
      "position:absolute;inset:0;display:flex;flex-direction:column;overflow:auto;padding:1.5rem;";
    root.appendChild(docHost);
  }
  docHost.innerHTML = "";

  let parsed: AnnotDocument;
  try {
    parsed = parseDocument(new TextDecoder().decode(initialBytes));
  } catch (err) {
    docHost.textContent = `Failed to parse ${activeFilename}: ${(err as Error).message}`;
    return;
  }

  // Phase 1 of `annot-html-document-ux-polish.md` — header strip
  // sits above the shell. VSCode hides Back (no gallery) +
  // save-status (VSCode owns dirty marker). Mode toggle / Undo
  // / Redo / "+ Image" / overflow Export all wire to the shell.
  const headerEl = document.createElement("annot-doc-header") as AnnotDocHeaderElement;
  headerEl.documentTitle = parsed.title || activeFilename;
  headerEl.mode = "edit";
  headerEl.editableTitle = false; // VSCode renames via the file tab, not inline
  headerEl.showBack = false;
  headerEl.showSaveStatus = false;
  headerEl.showModeToggle = true;
  headerEl.canUndo = false;
  headerEl.canRedo = false;
  // VSCode reaches Export to PowerPoint via the extension command
  // palette ("Annot: Export to PowerPoint…") — the extension owns
  // the save-dialog round-trip there. Surfacing the same action
  // via the header's overflow menu would need a new
  // webview-initiated RPC into the extension's `runExport` path;
  // [`docs/plans/annot-html-document-ux-polish.md`](../../../docs/plans/annot-html-document-ux-polish.md)
  // Phase 12 (Export menu + save-status feedback) is the right
  // home for that wiring. Phase 1 keeps the chrome minimal here:
  // empty overflow → ⋯ button hides automatically.
  const buildVscodeOverflow = (_doc: AnnotDocument): DocHeaderOverflowItem[] => [];
  headerEl.overflowItems = buildVscodeOverflow(parsed);
  docHost.appendChild(headerEl);

  const shellEl = document.createElement("annot-doc-shell") as AnnotDocShellElement;
  shellEl.document = parsed;
  shellEl.editing = true;
  // VSCode owns the dirty marker via `{type: "edit"}` on every
  // doc-changed event; no per-keystroke save here. Save is
  // driven by VSCode (`Ctrl+S`, `files.autoSave`, hot-exit) —
  // when the extension wants bytes it posts `{type: "save",
  // id}` and `runSave` (below) reads from `activeDocShell.
  // document` and serialises via `serializeDocument`.
  shellEl.addEventListener("doc-changed", (e) => {
    const detail = (e as CustomEvent<DocChangedDetail>).detail;
    activeDocShell = shellEl;
    // Update our tracked document so save / revert / external
    // changes always see the latest tree.
    activeDocument = detail.document;
    headerEl.setTitleText(detail.document.title || activeFilename);
    headerEl.canUndo = shellEl.canUndo();
    headerEl.canRedo = shellEl.canRedo();
    headerEl.overflowItems = buildVscodeOverflow(detail.document);
    vscode.postMessage({ type: "edit" });
  });
  headerEl.callbacks = {
    onUndo: () => {
      shellEl.undo();
    },
    onRedo: () => {
      shellEl.redo();
    },
    onInsertImage: () => {
      const docNow = shellEl.document;
      if (!docNow) return;
      const lastIndex = Math.max(0, docNow.blocks.length - 1);
      const lastWrapper = shellEl.querySelector(
        `.annot-doc-block-host[data-block-index="${lastIndex}"]`,
      );
      const target = lastWrapper?.querySelector("annot-doc-block-toolbar");
      target?.dispatchEvent(
        new CustomEvent("block-action", {
          bubbles: true,
          composed: true,
          detail: { action: "insertImage" },
        }),
      );
    },
    onModeChange: (next) => {
      const editing = next === "edit";
      shellEl.editing = editing;
      headerEl.mode = next;
    },
    // No overflow actions in VSCode v1 (see comment on
    // `buildVscodeOverflow` above). Phase 12 of the parent plan
    // owns the in-canvas export wiring.
  };
  docHost.appendChild(shellEl);
  activeDocShell = shellEl;
  activeDocument = parsed;
}

/** Last-known parsed document — kept in sync via `doc-changed`.
 *  The `runSave` hook serialises this on demand; `runRevert`
 *  replaces it with a freshly-parsed copy from disk. */
let activeDocument: AnnotDocument | null = null;

// ─── Extension → webview message handler ───────────────────────

window.addEventListener("message", (event) => {
  const msg = event.data as ExtensionMessage;
  switch (msg.type) {
    case "open": {
      activeFilename = msg.filename;
      activeFilePath = msg.path;
      if (isDocFile(msg.filename)) {
        // Phase 10 — `.annot.html` document path. fs.read the
        // bytes once, hand to `bootDocMode` for parse + mount,
        // and that's the entire boot. No EditorShell, no
        // toolbar, no right-panel.
        bootMode = "doc";
        void fsRead(msg.path).then((bytes) => {
          activeFileBytes = bytes.length;
          bootDocMode(bytes);
        });
      } else {
        bootMode = "image";
        // `shell.open(path)` triggers `proxyStorage.getImage(path)`
        // which round-trips through `fs.read`. `shell.open` rejects
        // on missing files; we surface that via the `error` event
        // listener installed above.
        void shell.open(msg.path).then(() => {
          // Clear the placeholder text once the canvas is mounted.
          for (const child of Array.from(container.children)) {
            if (child instanceof HTMLElement && child.classList.contains("annot-placeholder")) {
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
      }
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

/** Pull the base screenshot's data URL out of a saved `.annot.svg`.
 *  The base bitmap is the root-level `<image>` that is neither a
 *  mosaic / blur redact (`data-redact-style`) nor inside a `<g>` —
 *  the same discriminator `restoreAnnotations` uses to SKIP it. */
function extractBaseImageHref(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  for (const image of Array.from(doc.documentElement.querySelectorAll("image"))) {
    if (image.closest("g")) continue;
    if (image.hasAttribute("data-redact-style")) continue;
    const href = image.getAttribute("href") ?? image.getAttribute("xlink:href") ?? "";
    if (href.startsWith("data:")) return href;
  }
  return "";
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
    const bytes =
      bootMode === "doc"
        ? await encodeBytesForDocSave()
        : await encodeBytesForSave(activeFilePath, activeFilename);
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

/** Doc-mode save: serialise the current `activeDocument` —
 *  kept up-to-date by the shell's `doc-changed` listener — back
 *  to canonical `.annot.html` bytes. The shell's document
 *  property IS the source of truth; the parser-serialiser
 *  contract guarantees byte-equality if no edits happened
 *  since the last open. */
async function encodeBytesForDocSave(): Promise<Uint8Array> {
  if (!activeDocument) throw new Error("encodeBytesForDocSave: no document loaded");
  return new TextEncoder().encode(serializeStandaloneDocument(activeDocument));
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
    if (bootMode === "doc") {
      // Re-fetch from disk + re-parse + replace the shell's
      // document. The shell's contentEditable mutations are
      // discarded; the next render pulls from the new tree.
      const bytes = await fsRead(activeFilePath);
      activeFileBytes = bytes.length;
      const reparsed = parseDocument(new TextDecoder().decode(bytes));
      activeDocument = reparsed;
      if (activeDocShell) activeDocShell.document = reparsed;
      return;
    }
    await shell.open(activeFilePath);
    mountToolbarAndRightPanel();
  } catch (err) {
    console.error("[annot/vscode] revert failed:", err);
  }
}

// ─── Export RPC ────────────────────────────────────────────────

async function runExport(id: number, format: "png" | "jpeg" | "pptx"): Promise<void> {
  try {
    if (bootMode === "doc") {
      // Phase 11 — multi-slide PPTX export for documents.
      // PNG / JPEG remain image-mode only (a document is not a
      // single bitmap; per-slide PNG export would be a future
      // enhancement).
      if (format !== "pptx") {
        throw new Error("PNG / JPEG export is image-mode only");
      }
      if (!activeDocument) throw new Error("no document loaded");
      // Deep subpath dynamic import — the barrel
      // `@ingcreators/annot-render` is already in the static
      // dependency chain via `toolbar.ts` / `editor-shell.ts` /
      // `pptx-export.ts`, so a barrel-shaped dynamic import does
      // NOT move `exportDocumentPptx` to its own chunk
      // (`[INEFFECTIVE_DYNAMIC_IMPORT]` Rollup warning). The
      // `./pptx/document-pptx` submodule pulls in the multi-slide
      // OOXML builder + zip writer; that surface is NOT reachable
      // from the eager bundle, so this import really does split.
      const { exportDocumentPptx } = await import("@ingcreators/annot-render/pptx/document-pptx");
      const blob = exportDocumentPptx(activeDocument);
      if (!blob) {
        throw new Error("Document has no image blocks to export.");
      }
      const docStem =
        activeFilename.replace(/\.annot\.html$/i, "").replace(/\.[^.]+$/, "") || "document";
      vscode.postMessage({
        type: "export.result",
        id,
        bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
        suggestedFilename: `${docStem}.pptx`,
      });
      return;
    }
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
        sourceUrl: activeProvenance.sourceUrl,
        createdAt: activeProvenance.createdAt,
        producer: activeProvenance.producer || "vscode",
        dpr: activeProvenance.dpr,
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
