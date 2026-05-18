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
    outDir: "dist",
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
  base: "/",
});
