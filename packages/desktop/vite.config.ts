import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome105",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        "capture-overlay": resolve(__dirname, "capture-overlay.html"),
        // `browse.html` lands in Phase 6 of
        // `desktop-electron-migration.md`. The Tauri rollback
        // build doesn't yet wire the Browse-window UX (only
        // Electron spawns the Browse window), but compiling it
        // here keeps the renderer bundle layout uniform across
        // both build targets.
        browse: resolve(__dirname, "browse.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
