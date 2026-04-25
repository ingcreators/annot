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
      // `@ingcreators/annot-core` stays external — bundled separately
      // by the consumer. Note: `@ingcreators/annot-editor` is
      // INTENTIONALLY not in this list because annot-render must NOT
      // depend on annot-editor (the whole point of the split). If it
      // ever appears here, that's a sign the dependency direction got
      // inverted.
      external: [
        /^@ingcreators\//,
        /^@tauri-apps\//,
      ],
    },
  },
});
