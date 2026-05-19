import { resolve } from "path";
import { defineConfig, loadEnv } from "vite";

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
 *
 * Env loading: VITE_* vars from the repo-root `.env*` files are
 * read here and propagated to bundled code via
 * `import.meta.env.VITE_*`. Self-hosters set
 * `VITE_ANNOTATION_URL` + friends in `.env.local`; see
 * `.env.example` at the repo root.
 */

const REPO_ROOT = resolve(__dirname, "../..");

export default defineConfig(({ mode }) => {
  // Eagerly read env so a typo / misnamed override surfaces
  // during config evaluation rather than as a silent default
  // later. The actual `import.meta.env.VITE_*` substitution at
  // build time is driven by Vite's own env loader via `envDir`
  // below — the explicit `loadEnv` here is for the diagnostic
  // log only.
  const env = loadEnv(mode, REPO_ROOT, "VITE_");
  if (env.VITE_ANNOTATION_URL) {
    console.log(`[annot-extension] VITE_ANNOTATION_URL = ${env.VITE_ANNOTATION_URL}`);
  }

  return {
    // `vite build` defaults `import.meta.env.PROD` to `true` regardless of
    // `--mode`, so `pnpm build:dev` (mode: "development") still produces
    // production-mode runtime output. Override the constants explicitly so
    // the logger module's `isProd` check picks up dev mode and the default
    // log level becomes `debug` — needed to see the content script's
    // `[annot] sending metadata: …` line in the page console.
    define: {
      "import.meta.env.PROD": JSON.stringify(mode !== "development"),
      "import.meta.env.DEV": JSON.stringify(mode === "development"),
    },
    // Tell Vite to look for `.env*` files at the repo root, not in
    // this package's directory. Mirrors the `loadEnv` call above so
    // `import.meta.env.VITE_*` substitution at build time picks up
    // the same values.
    envDir: REPO_ROOT,
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
  };
});
