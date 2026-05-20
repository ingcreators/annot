import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Vite library build for `@ingcreators/annot-playwright`.
// Phase 6 of `docs/plans/annot-cloud-roadmap.md` — Stage 1 of
// `_done/headless-annotator-publish.md`. Emits `dist/index.js` (ESM) +
// `dist/index.d.ts` for the Playwright-fixture surface.
//
// `@playwright/test` is a peerDependency on the package side, so
// it stays external here too — consumers bring their own
// Playwright install.

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
      // For v0.1.0 the fixture is published with `annot-annotator`
      // as a real `dependencies` entry — npm consumers get the
      // full annotator package on `npm install`. We don't bundle
      // it here because `annot-annotator` transitively imports
      // `@resvg/resvg-js`, whose native `.node` binding can't
      // pass through Rolldown's bundler.
      //
      // `@playwright/test` stays external because it's a peer dep
      // (consumers bring their own pinned Playwright version).
      external: ["@playwright/test", /^@ingcreators\//, "@resvg/resvg-js", "@xmldom/xmldom"],
    },
  },
});
