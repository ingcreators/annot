import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
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
