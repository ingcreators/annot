import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
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
      // `@ingcreators/annot-core` and `@ingcreators/annot-editor`
      // stay external — consumers (web, future vscode) install them
      // alongside the shell so bundling them in would duplicate code
      // and break instanceof checks across package boundaries.
      external: [/^@ingcreators\//, /^@tauri-apps\//],
    },
  },
});
