import { defineConfig } from "@playwright/test";

// E2e suite for the PWA host. Chromium-only, matching the
// docs-site tour config (packages/docs-site/playwright.config.ts).
//
// The webServer boots the package's own Vite dev server with the
// default `/app/` base, so router paths in the tests match what
// production Cloudflare serves. `--strictPort` makes a busy port a
// hard failure instead of a silent drift to :3001 (which would make
// the webServer `url` probe hang until timeout).
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000/app/",
    viewport: { width: 1280, height: 800 },
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "pnpm dev --port 3000 --strictPort",
    url: "http://localhost:3000/app/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
