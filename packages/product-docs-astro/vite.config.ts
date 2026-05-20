import { cpSync, mkdirSync } from "fs";
import { resolve } from "path";
import { defineConfig, type PluginOption } from "vite";
import dts from "vite-plugin-dts";

// Copy the `.astro` component source files verbatim into
// `dist/components/`. Vite only processes JS/TS in library mode
// and Astro itself is the compiler for `.astro` files at the
// consumer's build step, so we ship the source as-is.
function copyAstroComponents(): PluginOption {
  return {
    name: "annot-product-docs-astro:copy-components",
    apply: "build",
    writeBundle() {
      const src = resolve(__dirname, "src/components");
      const dst = resolve(__dirname, "dist/components");
      mkdirSync(dst, { recursive: true });
      cpSync(src, dst, {
        recursive: true,
        filter: (file: string) => !file.endsWith(".ts") && !file.endsWith(".test.ts"),
      });
    },
  };
}

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
    copyAstroComponents(),
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
