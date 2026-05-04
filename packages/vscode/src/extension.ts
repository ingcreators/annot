/**
 * Annot — VSCode extension entry (extension-host / Node side).
 *
 * Registers a `CustomEditorProvider` for the
 * `*.annot.{svg,png,jpeg,jpg}` glob (declared in
 * `package.json#contributes.customEditors`).
 *
 * Lifecycle:
 *
 *   1. User opens an `*.annot.*` file → VSCode calls
 *      `resolveCustomEditor(document, webviewPanel, token)`.
 *   2. The provider:
 *      - Enables scripts in the webview (needed for the bundled
 *        EditorShell entry).
 *      - Sets the webview's `localResourceRoots` to the
 *        extension's `dist/webview/` so the bundled JS / CSS
 *        loads.
 *      - Reads `dist/webview/index.html`, rewrites asset paths
 *        to `webview.asWebviewUri(...)` URIs, and assigns to
 *        `webviewPanel.webview.html`.
 *   3. The webview boots, posts `{type: "ready"}`, and the
 *      extension responds with `{type: "open", path, filename}`
 *      (path-only — the webview pulls bytes via `fs.read`).
 *   4. Webview ↔ extension messages drive a small RPC protocol:
 *      `{type: "fs.read", id, path}` → `{type: "fs.read.result",
 *      id, bytes / error}`, `{type: "fs.write", id, path, bytes}`
 *      → `{type: "fs.write.result", id, error?}`. All XMP
 *      encoding / decoding lives in the webview (where the
 *      canvas + the `@ingcreators/annot-core/xmp` helpers run);
 *      the extension's role is plain `vscode.workspace.fs` I/O.
 *
 * The extension also brokers two side-band messages:
 *   - `{type: "dirty"}` from the webview → flips the status bar
 *     to the unsaved indicator.
 *   - `{type: "theme", kind}` from the extension → forwards the
 *     active `ColorThemeKind` so the shell stays in sync with
 *     workbench theming.
 *
 * Command-driven export RPC (Save as PNG / JPEG / Export to
 * PowerPoint…): the extension posts
 * `{type: "export", id, format}` to the active webview; the
 * webview renders + encodes via `getPngDataUrl` /
 * `createEditableImage` / `buildPptxFiles`+`buildZip` and
 * answers with `{type: "export.result", id, bytes / error,
 * suggestedFilename}`. The extension then drives
 * `vscode.window.showSaveDialog` + `vscode.workspace.fs.writeFile`.
 */

import * as path from "node:path";
import * as vscode from "vscode";

const VIEW_TYPE = "annot.editor";

/** Format the Annot extension can export to via the
 *  command palette `Annot: Save as …` / `Annot: Export to …`
 *  family. The webview owns the encode; the extension drives
 *  the save dialog + write. */
type ExportFormat = "png" | "jpeg" | "pptx";

/**
 * Singleton tracker for the currently-focused Annot webview
 * panel. The save-as / export commands route through the
 * active panel's `webview.postMessage`; without a registry the
 * commands have no way to know which editor instance to
 * render from.
 *
 * Two open Annot tabs each have their own panel + status item;
 * `setActive(panel)` is called from the panel's
 * `onDidChangeViewState` so whichever panel currently has focus
 * is the target for export commands.
 */
class ActiveWebviewRegistry {
  #active: { panel: vscode.WebviewPanel; document: AnnotDocument } | null = null;

  setActive(panel: vscode.WebviewPanel, document: AnnotDocument): void {
    this.#active = { panel, document };
  }
  clearIfActive(panel: vscode.WebviewPanel): void {
    if (this.#active?.panel === panel) this.#active = null;
  }
  getActive(): { panel: vscode.WebviewPanel; document: AnnotDocument } | null {
    return this.#active;
  }
}

const activeRegistry = new ActiveWebviewRegistry();

class AnnotEditorProvider implements vscode.CustomReadonlyEditorProvider<AnnotDocument> {
  static readonly viewType = VIEW_TYPE;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<AnnotDocument> {
    return new AnnotDocument(uri);
  }

  async resolveCustomEditor(
    document: AnnotDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const webview = webviewPanel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
      ],
    };
    webview.html = await this.#renderHtml(webview);

    // Status bar item per webview, cleaned up when the panel
    // is disposed. The status item is owned by the webview
    // lifecycle so two open editors don't fight over a single
    // global item.
    const statusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    statusItem.text = "$(sync~spin) Annot";
    statusItem.tooltip = `Annot — ${path.basename(document.uri.fsPath)}`;
    statusItem.show();
    webviewPanel.onDidDispose(() => statusItem.dispose());

    const setStatus = (icon: string, label: string): void => {
      statusItem.text = `${icon} ${label}`;
    };

    // Theme bridging: forward the current ColorThemeKind on
    // activation + re-forward on changes so the shell's
    // `themeOverrides` stays in sync with the workbench theme.
    const sendTheme = (): void => {
      void webview.postMessage({
        type: "theme",
        kind: vscode.window.activeColorTheme.kind,
      });
    };
    const themeSub = vscode.window.onDidChangeActiveColorTheme(sendTheme);
    webviewPanel.onDidDispose(() => themeSub.dispose());

    // Active-panel tracking for the export commands. Mark
    // active immediately (the command palette can fire before
    // `onDidChangeViewState` if the user opens a file then
    // immediately runs a command).
    activeRegistry.setActive(webviewPanel, document);
    webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.active) activeRegistry.setActive(webviewPanel, document);
    });
    webviewPanel.onDidDispose(() => activeRegistry.clearIfActive(webviewPanel));

    webview.onDidReceiveMessage((msg) => {
      void this.#handleMessage(msg, document, webview, setStatus, sendTheme);
    });
  }

  async #handleMessage(
    msg: unknown,
    document: AnnotDocument,
    webview: vscode.Webview,
    setStatus: (icon: string, label: string) => void,
    sendTheme: () => void,
  ): Promise<void> {
    if (typeof msg !== "object" || msg === null) return;
    const m = msg as { type?: string; id?: number; path?: string; bytes?: number[] };
    switch (m.type) {
      case "ready": {
        const filename = path.basename(document.uri.fsPath);
        webview.postMessage({
          type: "open",
          path: document.uri.fsPath,
          filename,
        });
        sendTheme();
        setStatus("$(check)", "Annot");
        break;
      }
      case "fs.read": {
        if (typeof m.id !== "number" || typeof m.path !== "string") return;
        try {
          const uri = this.#resolvePath(document, m.path);
          const bytes = await vscode.workspace.fs.readFile(uri);
          webview.postMessage({
            type: "fs.read.result",
            id: m.id,
            bytes: Array.from(bytes),
          });
        } catch (err) {
          webview.postMessage({
            type: "fs.read.result",
            id: m.id,
            error: String(err),
          });
        }
        break;
      }
      case "fs.write": {
        if (typeof m.id !== "number" || typeof m.path !== "string" || !m.bytes) return;
        setStatus("$(sync~spin)", "Saving…");
        try {
          const uri = this.#resolvePath(document, m.path);
          await vscode.workspace.fs.writeFile(uri, new Uint8Array(m.bytes));
          webview.postMessage({ type: "fs.write.result", id: m.id });
          setStatus("$(check)", "Saved");
        } catch (err) {
          webview.postMessage({
            type: "fs.write.result",
            id: m.id,
            error: String(err),
          });
          setStatus("$(error)", "Save failed");
          void vscode.window.showErrorMessage(
            `Annot: failed to save ${path.basename(document.uri.fsPath)}: ${err}`,
          );
        }
        break;
      }
      case "dirty": {
        setStatus("$(circle-filled)", "Unsaved");
        break;
      }
    }
  }

  /** Resolve a path the webview asked for. The webview passes
   *  the open document's `uri.fsPath` back as-is in the typical
   *  case; for safety we still resolve through `vscode.Uri` so
   *  any edge case (custom URI scheme, network-mounted folder)
   *  is handled correctly. We refuse paths that don't match the
   *  document's path so a future "open arbitrary file from a
   *  webview" command can't be triggered by the current
   *  webview's storage proxy. */
  #resolvePath(document: AnnotDocument, requested: string): vscode.Uri {
    if (requested === document.uri.fsPath) return document.uri;
    throw new Error(
      `Annot: webview requested unauthorized path ${requested}; only ${document.uri.fsPath} is allowed.`,
    );
  }

  async #renderHtml(webview: vscode.Webview): Promise<string> {
    const htmlOnDisk = vscode.Uri.joinPath(
      this.context.extensionUri,
      "dist",
      "webview",
      "index.html",
    );
    let html: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(htmlOnDisk);
      html = new TextDecoder().decode(bytes);
    } catch {
      // Pre-build placeholder shown when the webview bundle
      // hasn't been built yet (e.g. running the extension
      // straight from source via `code --extensionDevelopmentPath
      // packages/vscode` without running `pnpm build`). Helps
      // contributors see something useful.
      return placeholderHtml();
    }
    // Rewrite relative `<script src="…">` and `<link href="…">`
    // attributes to webview-safe URIs.
    const webviewRoot = vscode.Uri.joinPath(
      this.context.extensionUri,
      "dist",
      "webview",
    );
    return html.replace(
      /(?:src|href)="(\.\/[^"]+|[^"/][^"]*)"/g,
      (match, p1) => {
        const assetUri = webview.asWebviewUri(
          vscode.Uri.joinPath(webviewRoot, p1),
        );
        return match.replace(p1, assetUri.toString());
      },
    );
  }
}

class AnnotDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri) {}
  dispose(): void {}
}

function placeholderHtml(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Annot</title>
<style>body{font:13px/1.5 system-ui;margin:24px;color:#ddd;background:#1e1e1e}</style></head>
<body>
<h1>Annot — webview not built</h1>
<p>Run <code>pnpm --filter @ingcreators/annot-vscode build</code> from the repo root, then reopen this file.</p>
</body></html>`;
}

// ─── Command implementations ───────────────────────────────────

async function cmdOpenAnnotation(): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    title: "Open Annot annotation",
    canSelectMany: false,
    filters: {
      "Annot files": ["annot.svg", "annot.png", "annot.jpeg", "annot.jpg"],
    },
  });
  if (!uris || uris.length === 0) return;
  await vscode.commands.executeCommand("vscode.openWith", uris[0]!, VIEW_TYPE);
}

async function cmdRevealInExplorer(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const uri = editor?.document.uri ?? vscode.window.tabGroups.activeTabGroup?.activeTab?.input;
  if (uri instanceof vscode.Uri) {
    await vscode.commands.executeCommand("revealFileInOS", uri);
    return;
  }
  // Fall back to the active Annot panel's document URI when the
  // user runs the command while focused on a webview tab (which
  // doesn't expose an `activeTextEditor`).
  const active = activeRegistry.getActive();
  if (active) {
    await vscode.commands.executeCommand("revealFileInOS", active.document.uri);
    return;
  }
  void vscode.window.showInformationMessage(
    "Annot: no Annot file is currently active.",
  );
}

/**
 * `Annot: New annotation from image…`
 *
 * Mirrors the PWA's `CaptureHost.openFile` contract:
 *
 *   1. `showOpenDialog` lets the user pick a source image
 *      (`.png` / `.jpg` / `.jpeg` / `.svg`, with or without
 *      the `.annot.` infix).
 *   2. `showSaveDialog` confirms the destination Annot file
 *      path, defaulting the filename to the source's basename
 *      with `.annot.` inserted before the extension
 *      (`screenshot.png` → `screenshot.annot.png`). The user
 *      is free to change the path / name / extension.
 *   3. The source bytes are copied as-is to the destination
 *      via `vscode.workspace.fs.writeFile`. XMP recovery (for
 *      `.png` / `.jpeg` sources that are already editable) and
 *      raw-raster wrapping happen automatically when the
 *      destination is opened — the webview's storage proxy
 *      does the right thing per extension.
 *   4. `vscode.openWith` opens the destination in the Annot
 *      custom editor.
 *
 * The source file on disk is never modified — same model as
 * the PWA: "import as a new annotation file; the upstream is
 * the user's, not Annot's."
 */
async function cmdNewFromImage(): Promise<void> {
  const sources = await vscode.window.showOpenDialog({
    title: "Pick an image to annotate",
    canSelectMany: false,
    filters: {
      "Image / Annot files": ["png", "jpg", "jpeg", "svg"],
    },
  });
  if (!sources || sources.length === 0) return;
  const source = sources[0]!;

  const defaultUri = defaultAnnotDestinationUri(source);
  const dest = await vscode.window.showSaveDialog({
    title: "Save new Annot file as…",
    defaultUri,
    filters: filtersForExt(path.extname(defaultUri.fsPath)),
  });
  if (!dest) return;

  try {
    const bytes = await vscode.workspace.fs.readFile(source);
    await vscode.workspace.fs.writeFile(dest, bytes);
    await vscode.commands.executeCommand("vscode.openWith", dest, VIEW_TYPE);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Annot: failed to create new annotation: ${err}`,
    );
  }
}

/** Insert the `.annot.` infix into `source` before its
 *  extension. `screenshot.png` → `screenshot.annot.png`. If
 *  the source already carries `.annot.`, the basename passes
 *  through unchanged. */
function defaultAnnotDestinationUri(source: vscode.Uri): vscode.Uri {
  const dir = path.dirname(source.fsPath);
  const ext = path.extname(source.fsPath);
  const base = path.basename(source.fsPath, ext);
  const baseWithInfix = base.endsWith(".annot") ? base : `${base}.annot`;
  return vscode.Uri.file(path.join(dir, `${baseWithInfix}${ext}`));
}

function filtersForExt(extWithDot: string): Record<string, string[]> {
  const ext = extWithDot.replace(/^\./, "").toLowerCase();
  switch (ext) {
    case "svg":
      return { "Annot SVG": ["annot.svg"] };
    case "png":
      return { "Annot PNG": ["annot.png"] };
    case "jpg":
      return { "Annot JPG": ["annot.jpg"] };
    case "jpeg":
      return { "Annot JPEG": ["annot.jpeg"] };
    default:
      return { "Annot files": ["annot.svg", "annot.png", "annot.jpeg", "annot.jpg"] };
  }
}

/**
 * `Annot: New annotation from clipboard image`
 *
 * VSCode's clipboard API only handles text — image bytes from
 * the OS clipboard require a webview (which has
 * `navigator.clipboard.read()`). The pragmatic flow:
 *
 *   1. Prompt the user for a destination via `showSaveDialog`
 *      (default: `clipboard.annot.png` in the workspace root).
 *   2. Write a minimal placeholder Annot file to the
 *      destination so VSCode has something to open via
 *      `vscode.openWith`.
 *   3. Open the file in the Annot custom editor; the webview
 *      then auto-reads the OS clipboard via
 *      `navigator.clipboard.read()` and replaces the
 *      placeholder image. (The auto-read on open is a webview-
 *      side feature; see `webview/main.ts`.)
 */
async function cmdNewFromClipboard(): Promise<void> {
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!wsFolder) {
    void vscode.window.showErrorMessage(
      "Annot: no workspace folder open. Open a folder first, then run this command again.",
    );
    return;
  }
  const dest = await vscode.window.showSaveDialog({
    title: "Save new Annot file as…",
    defaultUri: vscode.Uri.joinPath(wsFolder, "clipboard.annot.png"),
    filters: { "Annot PNG": ["annot.png"] },
  });
  if (!dest) return;

  // Minimal 1x1 transparent PNG placeholder. The webview will
  // detect the clipboard-bootstrap context (the placeholder's
  // pixel dimensions match this constant) and overwrite with
  // the OS clipboard image on first open. If the clipboard
  // doesn't carry an image, the placeholder remains and the
  // user gets a blank canvas to draw on.
  const PLACEHOLDER_PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  try {
    await vscode.workspace.fs.writeFile(dest, PLACEHOLDER_PNG);
    await vscode.commands.executeCommand("vscode.openWith", dest, VIEW_TYPE);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Annot: failed to create clipboard annotation: ${err}`,
    );
  }
}

// ─── Export commands (delegate to active webview) ──────────────

interface PendingExport {
  resolve: (result: { bytes: Uint8Array; suggestedFilename: string }) => void;
  reject: (err: Error) => void;
}
let nextExportId = 1;
const pendingExports = new Map<number, PendingExport>();

/** Listen for `export.result` messages from any webview. The
 *  webview correlates by `id`; we resolve the matching pending
 *  Promise. Subscribed once at activation; persists for the
 *  extension lifetime. */
function installExportResultListener(): vscode.Disposable {
  return vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
    deserializeWebviewPanel: () => Promise.resolve(),
  });
  // Note: we don't actually use the serializer; we're using
  // `registerWebviewPanelSerializer` only to satisfy the
  // disposable contract — the real listener is per-panel via
  // `webview.onDidReceiveMessage` in `resolveCustomEditor`.
  // The export.result handling is patched into that handler
  // separately below via the active-panel registry.
}

async function requestExport(format: ExportFormat): Promise<void> {
  const active = activeRegistry.getActive();
  if (!active) {
    void vscode.window.showInformationMessage(
      "Annot: no Annot editor is currently active. Open a file first.",
    );
    return;
  }
  const id = nextExportId++;
  const promise = new Promise<{ bytes: Uint8Array; suggestedFilename: string }>(
    (resolve, reject) => {
      pendingExports.set(id, { resolve, reject });
      // Time out so the command doesn't hang forever if the
      // webview is unresponsive (e.g. the canvas isn't mounted
      // yet because the user fired the command immediately on
      // open).
      setTimeout(() => {
        if (pendingExports.has(id)) {
          pendingExports.delete(id);
          reject(new Error(`Annot: ${format} export timed out`));
        }
      }, 30_000);
    },
  );

  void active.panel.webview.postMessage({ type: "export", id, format });

  let result: { bytes: Uint8Array; suggestedFilename: string };
  try {
    result = await promise;
  } catch (err) {
    void vscode.window.showErrorMessage(`Annot: ${err}`);
    return;
  }

  const wsFolder =
    vscode.workspace.getWorkspaceFolder(active.document.uri)?.uri ??
    vscode.workspace.workspaceFolders?.[0]?.uri;
  const defaultUri = wsFolder
    ? vscode.Uri.joinPath(wsFolder, result.suggestedFilename)
    : vscode.Uri.file(result.suggestedFilename);
  const dest = await vscode.window.showSaveDialog({
    title: `Save as ${format.toUpperCase()}`,
    defaultUri,
    filters: saveDialogFiltersFor(format),
  });
  if (!dest) return;

  try {
    await vscode.workspace.fs.writeFile(dest, result.bytes);
  } catch (err) {
    void vscode.window.showErrorMessage(`Annot: failed to write ${dest.fsPath}: ${err}`);
  }
}

/** `Annot: Show file details` — toggles the file-details drawer
 *  in the active webview. The drawer itself lives in the webview
 *  (it needs the canvas dimensions / data URL) so the extension
 *  just posts a message. */
function cmdShowFileDetails(): void {
  const active = activeRegistry.getActive();
  if (!active) {
    void vscode.window.showInformationMessage(
      "Annot: no Annot editor is currently active. Open a file first.",
    );
    return;
  }
  void active.panel.webview.postMessage({ type: "show-file-details" });
}

function saveDialogFiltersFor(format: ExportFormat): Record<string, string[]> {
  switch (format) {
    case "png":
      return { PNG: ["png"] };
    case "jpeg":
      return { JPEG: ["jpeg", "jpg"] };
    case "pptx":
      return { PowerPoint: ["pptx"] };
  }
}

/** Patched into `resolveCustomEditor`'s message handler chain
 *  — listens for `{type: "export.result", id, ...}` from any
 *  webview and resolves the matching pending export Promise.
 *  Exposed module-level so the same logic doesn't have to be
 *  copy-pasted into the per-panel `onDidReceiveMessage`. */
function tryHandleExportResult(msg: unknown): boolean {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as {
    type?: string;
    id?: number;
    bytes?: number[];
    suggestedFilename?: string;
    error?: string;
  };
  if (m.type !== "export.result" || typeof m.id !== "number") return false;
  const pending = pendingExports.get(m.id);
  if (!pending) return true;
  pendingExports.delete(m.id);
  if (m.error) {
    pending.reject(new Error(m.error));
    return true;
  }
  if (m.bytes && typeof m.suggestedFilename === "string") {
    pending.resolve({
      bytes: new Uint8Array(m.bytes),
      suggestedFilename: m.suggestedFilename,
    });
  } else {
    pending.reject(new Error("Annot: export.result missing bytes / suggestedFilename"));
  }
  return true;
}

export function activate(context: vscode.ExtensionContext): void {
  // Patch the provider's message handler to also hand
  // `export.result` to the module-level resolver. Done by
  // hooking `vscode.window.onDidReceiveMessage` would be ideal
  // but VSCode doesn't expose that — we wire it through
  // `resolveCustomEditor` instead. The provider's existing
  // `onDidReceiveMessage` callback already runs unknown
  // messages through the switch, but `export.result` isn't a
  // case there; instead, we install a per-panel pre-handler
  // when the panel resolves. Keep `installExportResultListener`
  // unused for now (its stale `registerWebviewPanelSerializer`
  // approach is wrong) and rely on the inline patch below.
  void installExportResultListener;

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      AnnotEditorProvider.viewType,
      new (class extends AnnotEditorProvider {
        override async resolveCustomEditor(
          document: AnnotDocument,
          webviewPanel: vscode.WebviewPanel,
          token: vscode.CancellationToken,
        ): Promise<void> {
          await super.resolveCustomEditor(document, webviewPanel, token);
          // Tap into the same webview's message stream for
          // export.result correlation. The provider's own
          // `onDidReceiveMessage` returns ignored types
          // (export.result isn't one of its switch cases) so
          // adding a second listener is safe.
          webviewPanel.webview.onDidReceiveMessage((msg) => {
            tryHandleExportResult(msg);
          });
        }
      })(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
    vscode.commands.registerCommand("annot.openAnnotation", cmdOpenAnnotation),
    vscode.commands.registerCommand("annot.newFromClipboard", cmdNewFromClipboard),
    vscode.commands.registerCommand("annot.newFromImage", cmdNewFromImage),
    vscode.commands.registerCommand("annot.saveAsPng", () => requestExport("png")),
    vscode.commands.registerCommand("annot.saveAsJpeg", () => requestExport("jpeg")),
    vscode.commands.registerCommand("annot.exportPptx", () => requestExport("pptx")),
    vscode.commands.registerCommand("annot.revealInExplorer", cmdRevealInExplorer),
    vscode.commands.registerCommand("annot.showFileDetails", cmdShowFileDetails),
  );
}

export function deactivate(): void {
  // Nothing to tear down: the custom editor provider's
  // subscriptions disposal is handled via `context.subscriptions`
  // by VSCode's lifecycle.
}
