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

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(__dirname, "dist-electron/main"),
      lib: {
        entry: resolve(__dirname, "src-electron/main.ts"),
        formats: ["es"],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(__dirname, "dist-electron/preload"),
      lib: {
        entry: resolve(__dirname, "src-electron/preload.ts"),
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
