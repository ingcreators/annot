import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    // Emit `.d.ts` files alongside the JS bundle. Needed for the
    // first npm publish (Phase 6 of `annot-cloud-roadmap.md` /
    // `_done/headless-annotator-publish.md`): TypeScript consumers
    // installing `@ingcreators/annot-core` expect typings in the
    // shipped tarball.
    dts({
      // Bundle the .d.ts into a single file matching the JS
      // bundle's shape — consumers `import { ... } from
      // "@ingcreators/annot-core"` resolve through the single
      // `types: ./dist/index.d.ts` entry in package.json.
      // Per-subpath types are emitted via the additional rollup
      // pass below (each subpath's source file in
      // `package.json#exports` ships its own colocated `.d.ts`).
      rollupTypes: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.test-helpers.ts"],
    }),
  ],
  build: {
    lib: {
      // Multi-entry library mode so the Tier A xmp-bytes
      // subpath reaches published consumers as a standalone
      // bundle. `publishConfig.exports` in `package.json`
      // declares the matching `./xmp-bytes` entry pointing at
      // the `dist/xmp-bytes.js` file emitted here.
      //
      // Without this, `@ingcreators/annot-product-docs-astro`'s
      // playwright fixture (which imports `writePngWithTagsOnly`
      // from `@ingcreators/annot-core/xmp-bytes`) fails at
      // runtime against any published `core` tarball.
      //
      // Pure-Tier-A subpaths only — browser-only code under
      // `editor/`, `icons/`, etc. stays workspace-internal
      // (consumers reach for `annot-editor` / `annot-render`).
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        "xmp-bytes": resolve(__dirname, "src/xmp/xmp-bytes.ts"),
      },
      formats: ["es"],
    },
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      // Keep transitive workspace + npm deps external so the
      // shipped bundle stays lean (consumers resolve them via
      // their own `npm install`). `pako` is the one runtime
      // dep that gets bundled because it's small and tied to
      // our `zip/` module.
      external: [/^@ingcreators\//, "pako"],
    },
  },
});
