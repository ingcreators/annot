import { resolve } from "path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

/**
 * Wrap the content-script entry in an IIFE with a re-injection guard.
 *
 * Why: `chrome.scripting.executeScript({ files: ["content.js"] })`
 * executes the file in the page's existing JS realm. Vite's ES-module
 * output declares `let` / `const` at module top level (e.g.
 * `let overlay = null` in area-selector.ts). Running the file twice
 * in the same realm throws `SyntaxError: Identifier 'X' has already
 * been declared`, which crashes the whole content script (no handlers
 * register, no metadata is collected).
 *
 * A plain probe in the service worker ("is it already injected?")
 * races with concurrent capture calls: two capture paths both see
 * "not yet" and both inject. The only race-free fix is to make the
 * content script ITSELF idempotent — wrapping all its code in an
 * IIFE so each execution gets its own scope, and early-returning on
 * a globalThis flag so the second execution is a no-op.
 *
 * Only applied to the `content` entry; other entries (service-worker,
 * popup, options, offscreen) run in their own single-shot realms and
 * don't need wrapping.
 */
function iifeWrapContentScript(): Plugin {
  return {
    name: "iife-wrap-content-script",
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk") continue;
        if (chunk.name !== "content") continue;
        // IIFE with a guard — `return` is legal inside the function,
        // giving us an early-out on repeat executions without touching
        // user code. `globalThis` works in browsers (window) and
        // isolated worlds alike.
        chunk.code = `(function(){\nif(globalThis.__anno_content_loaded)return;\nglobalThis.__anno_content_loaded=true;\n${chunk.code}\n})();\n`;
        void fileName;
      }
    },
  };
}

export default defineConfig({
  plugins: [iifeWrapContentScript()],
  build: {
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        "service-worker": resolve(__dirname, "src/background/service-worker.ts"),
        content: resolve(__dirname, "src/content/index.ts"),
        popup: resolve(__dirname, "src/popup/popup.html"),
        options: resolve(__dirname, "src/options/options.html"),
        offscreen: resolve(__dirname, "src/offscreen/offscreen.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        // Prevent service-worker from importing chunks that use DOM APIs
        manualChunks(_id) {
          // Keep service-worker self-contained (no shared chunks)
          return undefined;
        },
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
  publicDir: "public",
  base: "./",
});
