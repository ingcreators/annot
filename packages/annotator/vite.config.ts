import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Vite library build for `@ingcreators/annot-annotator`. Phase 6
// of `docs/plans/annot-cloud-roadmap.md` — Stage 1 of
// `headless-annotator-publish.md`. Emits `dist/index.js` (ESM) +
// `dist/index.d.ts` so npm consumers can `import { createAnnotator }
// from "@ingcreators/annot-annotator"` against pre-built artefacts
// instead of the `.ts` source the workspace consumers see.
//
// Runtime dependencies stay external — consumers install them
// separately via the package.json `dependencies` declarations.

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
      // Everything in `dependencies` stays external. resvg + xmldom
      // are the heavy runtime pieces; bundling them would multiply
      // the tarball size for no gain (npm dedupes them on install).
      // `@ingcreators/*` regex catches the `annot-core` workspace
      // dep; it'll be a real version range by publish time.
      external: [/^@ingcreators\//, "@resvg/resvg-js", "@xmldom/xmldom"],
    },
  },
});
