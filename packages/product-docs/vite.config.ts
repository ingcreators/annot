import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Vite library build for `@ingcreators/annot-product-docs`.
// Phase 1 of `docs/plans/living-product-docs.md`. Emits
// `dist/index.js` (ESM) + `dist/index.d.ts` so the package can be
// installed via npm from Phase 7 onward. `private: true` in
// package.json gates publishing until the publication PR flips it.
//
// `@playwright/test` is a peerDependency on the package side, so it
// stays external here too — consumers bring their own Playwright
// install. Workspace deps (`@ingcreators/annot-annotator`,
// `@ingcreators/annot-playwright`) also stay external so npm
// consumers resolve the published `dist/` of each package
// independently.

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
      // Runtime deps stay external — npm consumers install them
      // via this package's `dependencies` declarations. Bundling
      // `unified` + `remark-*` + `js-yaml` + `zod` would
      // double-count when the consumer already depends on any of
      // them, and would prevent the host from controlling the
      // version pin.
      external: [
        "@playwright/test",
        /^@ingcreators\//,
        /^node:/,
        "js-yaml",
        "remark-frontmatter",
        "remark-mdx",
        "remark-parse",
        "remark-stringify",
        "unified",
        "unist-util-visit",
        "zod",
      ],
    },
  },
});
