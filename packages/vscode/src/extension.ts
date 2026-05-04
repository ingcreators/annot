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
 */

import * as path from "node:path";
import * as vscode from "vscode";

const VIEW_TYPE = "annot.editor";

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

    // Phase 5: status bar + dirty state per webview, cleaned up
    // when the panel is disposed. The status item is owned by
    // the webview lifecycle so two open editors don't fight over
    // a single global item.
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
        // Tell the webview which file is open. The webview's
        // `EditorShell.open(path)` then routes through its
        // `MessageProxyStorageProvider`, which sends `fs.read` to
        // pull the bytes. The message-protocol round-trip for
        // I/O lives entirely in the webview-side proxy so the
        // extension host stays a plain `vscode.workspace.fs`
        // shim.
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
//
// Phase 5 lands the command palette entries declared in
// `package.json#contributes.commands`. The `Open annotation` /
// `Reveal in Explorer` commands are fully wired (delegating to
// VSCode's native APIs); the new-from-image / save-as-* / export
// commands stub with an info message indicating which Phase will
// land them — the structural surface is in place so future work
// fills behaviour, not registration.

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
  void vscode.window.showInformationMessage(
    "Annot: no Annot file is currently active.",
  );
}

function cmdNewFromClipboard(): void {
  void vscode.window.showInformationMessage(
    "Annot: New annotation from clipboard image — implementation lands in a follow-up. " +
      "(Phase 5 ships the command registration so the surface is reviewable; the actual " +
      "clipboard read + Save-As + open flow follows.)",
  );
}

function cmdNewFromImage(): void {
  void vscode.window.showInformationMessage(
    "Annot: New annotation from image — implementation lands in a follow-up. " +
      "(Mirrors the PWA's `CaptureHost.openFile` flow per the plan: showOpenDialog → " +
      "XMP recovery → showSaveDialog with the `.annot.` infix → write via VSCodeStore.)",
  );
}

function cmdSaveAs(format: "png" | "jpeg" | "pptx"): void {
  void vscode.window.showInformationMessage(
    `Annot: Save as ${format.toUpperCase()} — implementation lands in a follow-up. ` +
      `(Webview serializes via the editor package's existing save helpers; extension routes ` +
      `the bytes to showSaveDialog + workspace.fs.)`,
  );
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      AnnotEditorProvider.viewType,
      new AnnotEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
    vscode.commands.registerCommand("annot.openAnnotation", cmdOpenAnnotation),
    vscode.commands.registerCommand("annot.newFromClipboard", cmdNewFromClipboard),
    vscode.commands.registerCommand("annot.newFromImage", cmdNewFromImage),
    vscode.commands.registerCommand("annot.saveAsPng", () => cmdSaveAs("png")),
    vscode.commands.registerCommand("annot.saveAsJpeg", () => cmdSaveAs("jpeg")),
    vscode.commands.registerCommand("annot.exportPptx", () => cmdSaveAs("pptx")),
    vscode.commands.registerCommand("annot.revealInExplorer", cmdRevealInExplorer),
  );
}

export function deactivate(): void {
  // Nothing to tear down: the custom editor provider's
  // subscriptions disposal is handled via `context.subscriptions`
  // by VSCode's lifecycle.
}
