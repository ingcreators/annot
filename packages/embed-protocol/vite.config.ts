import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Vite library build for `@ingcreators/annot-embed-protocol`.
// Phase 5a of `docs/plans/living-spec-authoring-roadmap.md`.
// Tier A — pure types + constants, zero runtime deps, browser-
// + Node-friendly. Emits `dist/index.js` (ESM) +
// `dist/index.d.ts` so the package can be installed via npm from
// annot-cloud (which lives in a separate repo and consumes this
// package's published artefacts rather than the workspace source).

export default defineConfig({
  plugins: [
    dts({
      rollupTypes: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "index",
    },
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
