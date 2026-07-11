import { defineConfig } from "@playwright/test";

// E2e suite for the Chrome MV3 extension. The built `dist/` is
// loaded unpacked into a persistent Chromium context per test (see
// tests/e2e/fixtures.ts) — `pnpm e2e` chains `build:dev` first so
// the service worker's ANNOTATION_URL points at the local PWA dev
// server and the capture → editor handoff can complete end to end.
//
// Two servers back the suite:
// - :3100 — a deterministic static page the extension captures
// - :3000 — the PWA host (vite dev, base /app/) for the handoff flow
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium" }],
  webServer: [
    {
      command: "node tests/e2e/fixture-server.mjs",
      url: "http://localhost:3100/",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "pnpm -C ../web dev --port 3000 --strictPort",
      url: "http://localhost:3000/app/",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
