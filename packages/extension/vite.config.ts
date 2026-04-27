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

/**
 * Force content.js to be a SINGLE self-contained file.
 *
 * Why: `chrome.scripting.executeScript({ files: ["content.js"] })`
 * runs the file as a CLASSIC SCRIPT, not an ES module. Static `import`
 * statements throw `SyntaxError: Cannot use import statement outside a
 * module` at runtime, which silently kills the content script (no
 * listener registers, every `chrome.tabs.sendMessage` to it returns
 * "Could not establish connection. Receiving end does not exist", and
 * features that depend on it — DOM-element metadata for the editor's
 * Elements panel, area-select messaging, sticky hiding — all fail).
 *
 * This `manualChunks` walks the import graph reachable from the
 * `content` entry and forces every reachable module into the same
 * 'content' output chunk. Modules that are ALSO reachable from a
 * different entry (logger, shared message types) get duplicated into
 * each entry, which is what we want — the cost is a few KB per
 * entry, the alternative is an unloadable content script.
 *
 * Other entries (service-worker, popup, options, offscreen) load via
 * `<script type="module">` (popup/options HTML) or as MV3 service-
 * worker modules and accept ES `import` fine, so they keep the
 * default chunking behaviour.
 */
function inlineContentChunks(): Plugin {
  let contentReachable: Set<string> | null = null;

  return {
    name: "inline-content-chunks",
    buildStart() {
      contentReachable = null;
    },
    outputOptions(opts) {
      const entryId = resolve(__dirname, "src/content/index.ts").replace(/\\/g, "/");
      const baseManualChunks = opts.manualChunks;
      return {
        ...opts,
        manualChunks: (id, api) => {
          // Lazily build the set of modules reachable from src/content/index.ts.
          // `getModuleIds` returns every loaded module; for each, walk imports.
          if (!contentReachable) {
            contentReachable = new Set();
            const queue: string[] = [entryId];
            while (queue.length > 0) {
              const cur = queue.pop()!;
              const norm = cur.replace(/\\/g, "/");
              if (contentReachable.has(norm)) continue;
              contentReachable.add(norm);
              const info = api.getModuleInfo(cur);
              if (!info) continue;
              for (const imp of info.importedIds) queue.push(imp);
              for (const imp of info.dynamicallyImportedIds) queue.push(imp);
            }
          }
          const norm = id.replace(/\\/g, "/");
          if (contentReachable.has(norm)) return "content";
          if (typeof baseManualChunks === "function") {
            // Defer to any caller-supplied manualChunks for non-content modules.
            return baseManualChunks(id, api);
          }
          return undefined;
        },
      };
    },
  };
}

export default defineConfig({
  plugins: [inlineContentChunks(), iifeWrapContentScript()],
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
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
  publicDir: "public",
  base: "./",
});
