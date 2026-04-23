import { defineConfig } from "vite";
import { resolve } from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["fonts/**/*", "icons/**/*"],
      manifest: {
        name: "Annot (by ingcreators)",
        short_name: "Annot",
        description: "Annot — screenshot & annotate, by ingcreators",
        theme_color: "#0f1730",
        background_color: "#0b1020",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          // Separate maskable variant: full-bleed navy bg + 10% safe-zone
          // padding so Android adaptive masks (circle / squircle / rounded
          // square) don't clip the Annot mark.
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Include `wasm` so libimagequant + future WASM assets are precached.
        globPatterns: ["**/*.{js,css,html,ttf,png,svg,woff2,wasm}"],
        // SPA navigate fallback — but exclude binary assets so the SW
        // doesn't replace `/assets/*.wasm` requests with index.html (which
        // would cause `WebAssembly.compile` to fail with the "expected
        // magic word" error).
        navigateFallback: "index.html",
        navigateFallbackDenylist: [
          /\.(?:wasm|json|map|woff2?|ttf|png|svg|jpe?g|webp|ico)$/i,
          /\/assets\//,
        ],
        // Allow precaching files larger than the default 2 MiB cap (WASM).
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Cache Google Fonts
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-css",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfont",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: resolve(__dirname, "index.html"),
    },
  },
  // Exclude WASM-bearing packages from Vite's dep pre-bundling. The
  // pre-bundled copy lives in `.vite/deps/` and does NOT include the
  // sibling .wasm file, so `new URL("imagequant_bg.wasm", import.meta.url)`
  // would resolve to a non-existent path and the dev server's SPA
  // fallback returns `index.html` (causing "expected magic word" errors).
  optimizeDeps: {
    exclude: ["@panda-ai/imagequant"],
  },
  server: {
    port: 3000,
  },
  base: "/",
});
