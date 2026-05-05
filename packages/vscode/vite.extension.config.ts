import { resolve } from "path";
import { defineConfig } from "vite";

/**
 * Vite config for the VSCode extension-host bundle (Node).
 *
 * Output: `dist/extension.cjs`. Loaded by VSCode via the `main`
 * field in `package.json`. CommonJS format because VSCode's
 * extension host (as of 1.85) requires CJS for the activation
 * entry; the `.cjs` extension is mandatory because the package
 * sets `"type": "module"` for the webview bundle, so a `.js`
 * file would be loaded as ESM and `exports`/`require` would
 * blow up at activation time. The webview bundle is built
 * separately by `vite.webview.config.ts` and ships ESM.
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
      fileName: () => "extension.cjs",
    },
    outDir: "dist",
    emptyOutDir: false,
    target: "node18",
    rollupOptions: {
      external: ["vscode", /^@ingcreators\//, /^node:/],
    },
  },
});
