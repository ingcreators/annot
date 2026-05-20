import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Vite library build for `@ingcreators/annot-product-docs-astro`.
// Phase 2 of `docs/plans/living-product-docs.md`. Emits
// `dist/index.js` (ESM) + `dist/index.d.ts` so the package can be
// installed via npm from Phase 7 onward.
//
// `astro` is declared as a peer dependency — npm consumers bring
// their own Astro install. Workspace deps stay external so they
// resolve to their own published `dist/` independently.

export default defineConfig({
  plugins: [
    dts({
      rollupTypes: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.test-helpers.ts"],
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
    rollupOptions: {
      external: ["astro", /^astro\//, /^@ingcreators\//, /^node:/],
    },
  },
});
