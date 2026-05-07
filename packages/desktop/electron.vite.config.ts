/**
 * `electron-vite` entry — Phase 0 scaffold.
 *
 * Three sub-builds wired side-by-side with the Tauri config:
 *
 *   - `main`     →  `dist-electron/main/main.js`      (Node ESM —
 *                   `.js` is ESM because the desktop package.json
 *                   declares `"type": "module"`)
 *   - `preload`  →  `dist-electron/preload/preload.cjs` (Node CJS;
 *                   contextBridge is most reliable from CJS preload
 *                   scripts — the renderer always sees the bridged
 *                   surface synchronously regardless of sandbox or
 *                   experimental-modules toggles)
 *   - `renderer` →  `dist-electron/renderer/`         (Chromium)
 *
 * The output filenames (`main.js` + `preload.cjs`) are
 * electron-vite's defaults — the package.json `main` field and
 * the main.ts preload-path reference both depend on those, so
 * this file deliberately doesn't override them.
 *
 * The renderer config mirrors `vite.config.ts` (the Tauri build) —
 * same multi-input HTML pages, same Chrome target, same dev
 * server port. They share the on-disk `index.html` /
 * `capture-overlay.html` files so the Tauri build keeps working
 * during Phases 0–4 (per the plan's "kept buildable until Phase 9"
 * rule).
 *
 * Phase 5 ("Default-to-Electron cutover") flips `pnpm dev` /
 * `pnpm build` to call this config; Phase 9 deletes the Tauri-
 * specific `vite.config.ts` and `src-tauri/` entirely.
 */

import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// `@ingcreators/*` workspace packages declare their `exports` field
// pointing at `.ts` SOURCE files (Vite-and-friends transpile on the
// fly, so this is the natural shape for the renderer build). When
// `electron-builder` packages the app, those packages are copied
// into `app.asar/node_modules/@ingcreators/<pkg>/` — at which point
// Node's "type stripping is unsupported under node_modules" rule
// kicks in and `import { … } from "@ingcreators/annot-core/zip-bytes"`
// crashes the main process at first launch with
// `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. (In dev the symlink
// to `packages/core/` realpaths OUTSIDE `node_modules`, so Node 22+'s
// experimental type-stripping IS allowed and the bug doesn't surface.)
//
// Exclude the workspace packages from the externalize list so Vite
// bundles them INLINE into `main.js` / `preload.cjs`. The compiled
// output is plain JS, lands in `dist-electron/`, and survives
// electron-builder's asar packaging unchanged. Real npm dependencies
// (`js-yaml` etc.) stay externalized — they ship pre-compiled JS in
// `node_modules` and the asar can resolve them at runtime.
const WORKSPACE_PACKAGES_TO_BUNDLE = [
  "@ingcreators/annot-capture",
  "@ingcreators/annot-core",
  "@ingcreators/annot-editor",
  "@ingcreators/annot-host-ui",
  "@ingcreators/annot-web",
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES_TO_BUNDLE })],
    build: {
      outDir: resolve(__dirname, "dist-electron/main"),
      lib: {
        entry: resolve(__dirname, "src-electron/main.ts"),
        formats: ["es"],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES_TO_BUNDLE })],
    build: {
      outDir: resolve(__dirname, "dist-electron/preload"),
      // Two preload bundles:
      //   - `preload.cjs` — chrome's preload (electronAPI bridge)
      //   - `content-preload.cjs` — webview preload that runs
      //     inside the embedded `<webview>` to bridge the
      //     capture-package's `ContentBus` over IPC. Phase 4A of
      //     `desktop-browser-mode.md`.
      lib: {
        entry: {
          preload: resolve(__dirname, "src-electron/preload.ts"),
          "content-preload": resolve(__dirname, "src/browse/content-preload.ts"),
        },
        formats: ["cjs"],
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "."),
    build: {
      outDir: resolve(__dirname, "dist-electron/renderer"),
      emptyOutDir: true,
      target: "chrome105",
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          "capture-overlay": resolve(__dirname, "capture-overlay.html"),
          browse: resolve(__dirname, "browse.html"),
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  },
});
