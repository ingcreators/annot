/**
 * Annot — VSCode extension entry (extension-host / Node side).
 *
 * Phase 4 of `docs/plans/_done/vscode-extension-host.md` skeleton.
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
 *      extension responds with the document's bytes + path so
 *      the webview-side `EditorShell` can mount.
 *   4. Subsequent webview ↔ extension messages drive
 *      `getImage` / `updateImage` calls through
 *      `vscode.workspace.fs`.
 *
 * Phase 4 ships the structural skeleton; the message protocol +
 * full bidirectional flow lands in Phase 5 polish.
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

    // Phase 5 wires the message protocol (ready / read / write /
    // dirty / saved). Phase 4 leaves the channel set up but
    // unused — opening an `*.annot.svg` file boots the webview
    // and shows the placeholder UI.
    webview.onDidReceiveMessage((msg) => {
      void this.#handleMessage(msg, document, webview);
    });
  }

  async #handleMessage(
    msg: unknown,
    document: AnnotDocument,
    webview: vscode.Webview,
  ): Promise<void> {
    if (typeof msg !== "object" || msg === null) return;
    const m = msg as { type?: string };
    switch (m.type) {
      case "ready": {
        // Send the document's bytes + path so the webview-side
        // EditorShell can `mountFromRecord`. Phase 5 will route
        // this through `VSCodeStore.getImage(path)` so the
        // webview takes the same code path as `EditorShell.open`.
        const bytes = await vscode.workspace.fs.readFile(document.uri);
        const filename = path.basename(document.uri.fsPath);
        webview.postMessage({
          type: "open",
          path: document.uri.fsPath,
          filename,
          bytes: Array.from(bytes),
        });
        break;
      }
      case "save": {
        const payload = msg as { type: "save"; bytes?: number[] };
        if (!payload.bytes) return;
        await vscode.workspace.fs.writeFile(
          document.uri,
          new Uint8Array(payload.bytes),
        );
        webview.postMessage({ type: "saved" });
        break;
      }
    }
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

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      AnnotEditorProvider.viewType,
      new AnnotEditorProvider(context),
      {
        // Phase 4: keep one webview per file (no shared state
        // across re-opens). Phase 5 can tune this if cross-file
        // state matters.
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
  );
}

export function deactivate(): void {
  // Nothing to tear down: the custom editor provider's
  // subscriptions disposal is handled via `context.subscriptions`
  // by VSCode's lifecycle.
}
