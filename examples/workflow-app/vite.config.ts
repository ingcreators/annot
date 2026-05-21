import { defineConfig } from "vite";

// Vanilla TS + Lit SPA. No JSX, no fancy plugins — the
// example is deliberately minimal so readers can grok the
// whole project in one sitting.
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
