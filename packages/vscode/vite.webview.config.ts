import { resolve } from "path";
import { defineConfig } from "vite";

/**
 * Vite config for the webview-side bundle.
 *
 * Output: `dist/webview/index.js` + `dist/webview/index.html`.
 * Loaded by the extension's `WebviewPanel` via the `webview.html`
 * setter (the extension reads index.html from disk and rewrites
 * asset paths to webview-safe URIs at runtime).
 *
 * Unlike the extension bundle, the webview bundle ships
 * `@ingcreators/*` symbols inline because the webview's runtime
 * is a sandboxed iframe with no node_modules access. This is the
 * standard VSCode webview pattern.
 */
export default defineConfig({
  root: resolve(__dirname, "src/webview"),
  // Emit relative asset URLs (`./assets/index-XXX.js`) instead of
  // root-absolute (`/assets/index-XXX.js`). The extension host's
  // `webview.asWebviewUri` rewrite in `extension.ts` only matches
  // paths that don't start with `/`; absolute paths would 404 in
  // the sandboxed iframe because the webview root is the
  // `vscode-webview://...` URI scheme, not the workspace root.
  base: "./",
  build: {
    outDir: resolve(__dirname, "dist/webview"),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: resolve(__dirname, "src/webview/index.html"),
    },
  },
});
