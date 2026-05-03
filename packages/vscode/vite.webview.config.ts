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
  build: {
    outDir: resolve(__dirname, "dist/webview"),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: resolve(__dirname, "src/webview/index.html"),
    },
  },
});
