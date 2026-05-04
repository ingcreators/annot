import { resolve } from "path";
import { defineConfig } from "vite";

/**
 * Vite config for the VSCode extension-host bundle (Node).
 *
 * Output: `dist/extension.js`. Loaded by VSCode via the `main`
 * field in `package.json`. CommonJS format because VSCode's
 * extension host requires CJS.
 *
 * `vscode` is external — the API is provided by the runtime, not
 * bundled. `@ingcreators/*` are also external; the extension-host
 * resolves them via pnpm's node_modules at runtime, mirroring how
 * the PWA resolves them via Vite's bundler at build time.
 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/extension.ts"),
      formats: ["cjs"],
      fileName: () => "extension.js",
    },
    outDir: "dist",
    emptyOutDir: false,
    target: "node18",
    rollupOptions: {
      external: ["vscode", /^@ingcreators\//, /^node:/],
    },
  },
});
