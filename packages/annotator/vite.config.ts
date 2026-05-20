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
      // Heavy runtime deps stay external — consumers get them via
      // their own npm install. `@ingcreators/annot-core` is
      // INTENTIONALLY NOT externalised: for v0.1.0 the annotator's
      // published bundle inlines its core usage so consumers don't
      // need to know about the workspace's internal layering.
      // (See Stage 2 of `docs/plans/headless-annotator-publish.md`
      // — "self-contained tarballs" rationale.) Once we want
      // version-independent dependency resolution between
      // annot-annotator and annot-core, this list grows
      // `/^@ingcreators\//` back and `annot-core` migrates from a
      // workspace devDep to a real dep with a version range.
      // `@napi-rs/canvas` (native binding) and `@ingcreators/annot-imagequant`
      // (WASM, GPL-3.0, optional dep) MUST stay external — consumers
      // install the platform-matched binary themselves via npm.
      // `pako` is a runtime dep of the inlined annot-core PNG-8
      // encoder; keep it external so we don't ship a duplicate copy
      // in the bundle.
      external: [
        "@resvg/resvg-js",
        "@xmldom/xmldom",
        "@napi-rs/canvas",
        "@ingcreators/annot-imagequant",
        "pako",
      ],
    },
  },
});
