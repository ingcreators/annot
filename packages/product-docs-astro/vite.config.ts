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
// Phase 2 of `docs/plans/living-product-docs.md`. Multi-entry
// library mode emits BOTH `dist/index.js` (the main entry
// re-exporting the Astro integration + Image Service +
// component types) AND `dist/playwright/index.js` (the
// `page.screenshot({ annot })` Playwright fixture from
// `_done/playwright-screenshot-annot-fixture.md`).
//
// The `./playwright` subpath was declared in `package.json`'s
// `publishConfig.exports` from day one, but the original
// single-entry `lib.entry` only built `dist/index.js`. The
// `0.1.0` + `0.2.0` tarballs accordingly shipped
// `dist/playwright/*.d.ts` (via the `dts` plugin's source
// glob) but NOT the runtime `dist/playwright/index.js` — any
// consumer doing `import { test } from
// "@ingcreators/annot-product-docs-astro/playwright"` got
// a "Cannot find module" error at runtime.
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
        "playwright/index": resolve(__dirname, "src/playwright/index.ts"),
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
