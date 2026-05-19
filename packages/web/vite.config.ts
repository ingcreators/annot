import { resolve } from "path";
import { defineConfig, loadEnv } from "vite";
import { appVersionPlugin } from "./vite/version-plugin.js";

const REPO_ROOT = resolve(__dirname, "../..");

export default defineConfig(({ mode }) => {
  // Load env from the repo root (`.env`, `.env.local`,
  // `.env.<mode>`, `.env.<mode>.local`). Self-hosters set
  // `VITE_PWA_BASE` here to override the default `/app/` prefix
  // — see `.env.example` at the repo root + `docs/self-hosting.md`
  // for the full walkthrough.
  const env = loadEnv(mode, REPO_ROOT, "VITE_");

  // Vite's `base` config — the URL path prefix the PWA serves at.
  // Default `/app/` matches the canonical `annot.work/app/*`
  // deployment (Phase 8d of `docs/plans/launch-prep.md`).
  // Vite normalises the value to ensure leading + trailing slashes.
  const PWA_BASE = (env.VITE_PWA_BASE || "/app/").replace(/\/?$/, "/");

  // outDir mirrors the public URL space so Cloudflare's static-
  // asset binding maps URL → file without a route-prefix rewrite.
  // The binding includes the route prefix when resolving paths, so
  // nesting the build output under `dist/<base>/` keeps the
  // wrangler config trivial.
  //
  //   base "/app/" → outDir "dist/app"
  //   base "/"     → outDir "dist"
  //   base "/editor/" → outDir "dist/editor"
  const baseSegment = PWA_BASE.replace(/^\//, "").replace(/\/$/, "");
  const OUT_DIR = baseSegment ? `dist/${baseSegment}` : "dist";

  return {
    plugins: [
      // Inject __APP_VERSION__ + emit dist/version.txt so the
      // post-deploy recovery code can detect a stale tab vs the
      // currently-deployed bundle. See
      // `docs/plans/web-dynamic-import-recovery.md`.
      appVersionPlugin(),
    ],
    // Vite resolves `import.meta.env.VITE_*` substitutions from
    // `.env*` files under `envDir`. Default is the project root
    // (this package); we point at the repo root so a single
    // `.env.local` configures every workspace package.
    envDir: REPO_ROOT,
    build: {
      outDir: OUT_DIR,
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
    // The PWA serves from `${PWA_BASE}` — `/app/` by default.
    // Vite rewrites every absolute asset reference in built HTML
    // (`<link href="/icons/...">`, `<script src="/assets/...">`)
    // to be prefixed with this base, and `import.meta.env.BASE_URL`
    // propagates the value into `src/router.ts` so the SPA's
    // internal navigation lines up with what Cloudflare's static-
    // asset binding serves.
    base: PWA_BASE,
  };
});
