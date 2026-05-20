import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Vite library build for `@ingcreators/annot-mcp`.
//
// Phase 1 of `docs/plans/agent-mcp-integration.md`. Emits
// `dist/index.js` (ESM) + `dist/index.d.ts` so the published
// package can be installed via npm and the `annot-mcp` bin
// script can resolve `../dist/index.js`.
//
// Runtime dependencies stay external — npm consumers install
// `@modelcontextprotocol/sdk` and `@ingcreators/annot-playwright`
// via the package.json `dependencies` declarations.

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
      // MCP SDK + future workspace packages stay external.
      // `@ingcreators/*` is reserved for the `@ingcreators/annot-annotator`
      // dep that Phase 2 adds — npm consumers install it separately
      // and get the published `dist/`. Phase 1 has no `@ingcreators/*`
      // imports (SVG primitives live in-tree under `dsl/svg-primitives.ts`
      // rather than going through `@ingcreators/annot-playwright` —
      // see the rationale comment in that file).
      external: [
        "@modelcontextprotocol/sdk",
        /^@modelcontextprotocol\/sdk\//,
        /^@ingcreators\//,
        "playwright-core",
        "@napi-rs/canvas",
        /^node:/,
      ],
    },
  },
});
