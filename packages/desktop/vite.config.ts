import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome105",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        "capture-overlay": resolve(__dirname, "capture-overlay.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
