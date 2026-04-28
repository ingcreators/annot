import { resolve } from "path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

/**
 * Dedicated Vite build for the content script entry.
 *
 * The content script ships as a SINGLE self-contained file that
 * `chrome.scripting.executeScript({ files: ["content.js"] })` loads
 * as a CLASSIC script. Two constraints conflict with the main
 * extension build:
 *
 *  1. Classic-script load means top-level `import` / `export`
 *     statements throw at parse time. Rollup's default ES output
 *     does both (entry chunks lead with `import` for shared chunks
 *     and trail with `export{X as Y}` to surface the entry's
 *     exports). The IIFE wrapper plugin below eliminates them.
 *
 *  2. Sharing modules with other entries (logger, message types)
 *     pulls them into a separate chunk that BOTH the content
 *     script AND the service worker would `import`. After the
 *     manualChunks fix in #266 forced shared modules INTO
 *     content.js, the service worker started emitting
 *     `import{t as i}from"./content.js"` and threw
 *     `The requested module './content.js' does not provide an
 *     export named 't'` at service-worker.js:1 — the trailing
 *     export got stripped (correctly, for a classic-script
 *     content.js), but service-worker still expected it.
 *
 * The robust fix is to build the content entry IN ITS OWN Vite
 * pass with `inlineDynamicImports: true` plus a single input. That
 * way every module reachable from `src/content/index.ts` is
 * inlined — INCLUDING the logger / shared utils — and the resulting
 * `content.js` has zero imports / exports. The other entries
 * (service-worker, popup, options, offscreen) build separately via
 * `vite.config.ts` and get their own copy of the shared modules
 * (still smaller than re-running everything through extra chunking
 * heuristics).
 *
 * Cost: ~3 kB of duplicated logger / shared util code shipped in
 * BOTH content.js and service-worker.js. Acceptable price for
 * "an extension that actually works".
 */
function iifeWrapContentScript(): Plugin {
  return {
    name: "iife-wrap-content-script",
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk") continue;
        // Single-entry build emits one entry chunk to `dist/content.js`
        // (per `entryFileNames` below). Match by output filename
        // rather than `chunk.name` because the latter is derived
        // from the input file name (`index`) when the input is a
        // single resolved path.
        if (fileName !== "content.js") continue;
        // Strip Rollup's trailing re-export hoist (`export{X as Y};`).
        // With `inlineDynamicImports: true` + a single entry there
        // are no `import` statements to strip — but `export` is
        // still emitted because Rollup hoists the entry's exports
        // for would-be importers, and chrome's classic-script
        // loader rejects it.
        const stripped = chunk.code.replace(/export\s*\{[^}]*\}\s*;?/g, "");
        // IIFE with a guard — `return` is legal inside the function,
        // giving us an early-out on repeat executions without touching
        // user code. `globalThis` works in browsers (window) and
        // isolated worlds alike.
        chunk.code = `(function(){\nif(globalThis.__annot_content_loaded)return;\nglobalThis.__annot_content_loaded=true;\n${stripped}\n})();\n`;
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [iifeWrapContentScript()],
  // Mirror the main `vite.config.ts` define block: override the
  // `import.meta.env.PROD` / `DEV` constants that Vite hardcodes to
  // production values during `vite build`, so `--mode development`
  // actually flips the logger module's default level to `debug`.
  define: {
    "import.meta.env.PROD": JSON.stringify(mode !== "development"),
    "import.meta.env.DEV": JSON.stringify(mode === "development"),
  },
  build: {
    modulePreload: { polyfill: false },
    // Don't wipe `dist/` — the main `vite build` already populated
    // it with service-worker / popup / options / offscreen output.
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, "src/content/index.ts"),
      output: {
        entryFileNames: "content.js",
        format: "es",
      },
    },
    // Disable code splitting entirely so every module reachable from
    // the single input gets inlined into content.js — the output then
    // has no `import` statements at all. The trailing `export{}` is
    // stripped by the IIFE wrapper plugin above. Replaces Rollup's
    // legacy `inlineDynamicImports: true`, which Vite 8 / Rolldown
    // deprecated in favour of this build-level flag.
    cssCodeSplit: false,
    // @ts-expect-error — `codeSplitting` is a Vite 8 / Rolldown build
    // option not yet in @types/vite. Documented at
    // https://vite.dev/config/build-options.html#build-codesplitting.
    codeSplitting: false,
    outDir: "dist",
    target: "es2022",
  },
  publicDir: false,
  base: "./",
}));
