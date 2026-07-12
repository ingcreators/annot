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
// `dist/index.js` — the main entry re-exporting the Astro
// integration + Image Service + component types. (The deprecated
// `./playwright` re-export subpath was removed in 0.5.0 per the
// DeprecationWarning it shipped since Phase 4 of
// `_done/playwright-screenshot-fixture-relayer.md`; import from
// `@ingcreators/annot-product-docs` or
// `@ingcreators/annot-playwright` instead.)
//
// `astro` is declared as a peer dependency — npm consumers
// bring their own Astro install. Workspace deps stay external
// so they resolve to their own published `dist/` independently.
// `@playwright/test` is also peer for the same reason.

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
      entry: {
        index: resolve(__dirname, "src/index.ts"),
      },
      formats: ["es"],
    },
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      external: ["astro", /^astro\//, "@playwright/test", /^@ingcreators\//, /^node:/],
    },
  },
});
