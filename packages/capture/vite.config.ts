import { resolve } from "path";
import { defineConfig } from "vite";

/**
 * Library build for `@ingcreators/annot-capture`.
 *
 * Multi-entry library mode: every subpath in `package.json#exports`
 * has a matching entry here so consumers can `import { ... } from
 * "@ingcreators/annot-capture/content"` and the bundler emits one
 * file per surface. The package is workspace-internal — extension
 * + future desktop hosts consume it via the `workspace:*` protocol —
 * so we don't ship `.d.ts` files; consumers typecheck against
 * `src/` directly via the `exports` map's `.ts` entries.
 *
 * The `@ingcreators/*` deps stay external so the consumer's bundler
 * resolves them once, avoiding duplicate `instanceof` identities.
 */
export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        host: resolve(__dirname, "src/host.ts"),
        "content/index": resolve(__dirname, "src/content/index.ts"),
        "content/page-metadata-walker": resolve(__dirname, "src/content/page-metadata-walker.ts"),
        "encode/index": resolve(__dirname, "src/encode/index.ts"),
        "shared/index": resolve(__dirname, "src/shared/index.ts"),
        "orchestrate/index": resolve(__dirname, "src/orchestrate/index.ts"),
      },
      formats: ["es"],
    },
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      external: [/^@ingcreators\//],
    },
  },
});
