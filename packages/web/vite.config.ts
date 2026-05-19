import { resolve } from "path";
import { defineConfig } from "vite";
import { appVersionPlugin } from "./vite/version-plugin.js";

export default defineConfig({
  plugins: [
    // Inject __APP_VERSION__ + emit dist/version.txt so the
    // post-deploy recovery code can detect a stale tab vs the
    // currently-deployed bundle. See
    // `docs/plans/web-dynamic-import-recovery.md`.
    appVersionPlugin(),
  ],
  build: {
    // Output mirrors the public URL space so Cloudflare's static-
    // asset binding maps `annot.work/app/...` →
    // `dist/app/...` without a route-prefix rewrite step. The
    // binding includes the route prefix when resolving URL →
    // file, so nesting under `dist/app/` keeps deploy
    // configuration trivial. See `wrangler.jsonc` at the repo
    // root + Phase 8d in `docs/plans/launch-prep.md`.
    outDir: "dist/app",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: resolve(__dirname, "index.html"),
    },
  },
  // Exclude WASM-bearing packages from Vite's dep pre-bundling. The
  // pre-bundled copy lives in `.vite/deps/` and does NOT include the
  // sibling .wasm file, so `new URL("imagequant_bg.wasm", import.meta.url)`
  // would resolve to a non-existent path and the dev server's SPA
  // fallback returns `index.html` (causing "expected magic word" errors).
  optimizeDeps: {
    exclude: ["@panda-ai/imagequant"],
  },
  server: {
    port: 3000,
  },
  // The PWA serves from `annot.work/app/*` per Phase 8d of
  // `docs/plans/launch-prep.md` (atomic URL switchover).
  // Vite rewrites every absolute asset reference in built HTML
  // (`<link href="/icons/..." />`, `<script src="/assets/..." />`)
  // to be prefixed with this base, and `import.meta.env.BASE_URL`
  // propagates the value into `src/router.ts` so the SPA's
  // internal navigation lines up with what Cloudflare's
  // static-asset binding serves.
  base: "/app/",
});
