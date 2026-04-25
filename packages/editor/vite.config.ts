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
      // `@ingcreators/annot-core` and `@ingcreators/annot-render`
      // stay external — consumers (web, extension, desktop) install
      // them alongside the editor package, so bundling them in
      // would duplicate the code and break instanceof checks across
      // package boundaries.
      external: [
        /^@ingcreators\//,
        /^@tauri-apps\//,
      ],
    },
  },
});
