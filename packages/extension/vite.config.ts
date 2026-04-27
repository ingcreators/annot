import { resolve } from "path";
import { defineConfig } from "vite";

/**
 * Main extension build — service worker, popup, options, offscreen.
 *
 * The content script entry is built SEPARATELY by
 * `vite.content.config.ts` because it has different output
 * constraints (classic-script loader, no `import` / `export`,
 * single self-contained file). Mixing it with the other entries
 * here causes Rollup to extract their shared modules into a
 * cross-entry chunk that BOTH the content script and the service
 * worker import — which breaks the content script's classic-script
 * load AND drags an `import` of a partially-rewritten content.js
 * into service-worker.js.
 *
 * The build script in `package.json` runs both Vite passes
 * sequentially: this config first (writes most of `dist/`), then
 * `vite.content.config.ts` (writes `content.js` over the top).
 */

export default defineConfig({
  build: {
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        "service-worker": resolve(__dirname, "src/background/service-worker.ts"),
        popup: resolve(__dirname, "src/popup/popup.html"),
        options: resolve(__dirname, "src/options/options.html"),
        offscreen: resolve(__dirname, "src/offscreen/offscreen.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
  publicDir: "public",
  base: "./",
});
