import { defineConfig } from "@playwright/test";

// Playwright config for the workflow-app docs tour.
//
// `npm run docs:sync` boots Vite on port 5173 via the
// `webServer` block, walks the SPA twice (applicant flow,
// approver flow), and per (screen, mdx) pair:
//
//   1. Writes the base PNG to `docs-site/public/shots/<id>.png`.
//   2. Refreshes the matching MDX's `annot:snapshot` +
//      `annot:attributes` comment blocks via the upstream
//      `page.screenshot({ annot: { mdx } })` interceptor from
//      `@ingcreators/annot-product-docs-astro/playwright`.
//
// Note: we don't spread `devices["Desktop Chrome"]` into the
// project's `use` block. That preset carries a `screen:
// { width, height }` device-emulation hint which collides
// with the `screen` Playwright fixture that the upstream
// `@ingcreators/annot-product-docs` test runner registers
// (Playwright refuses to override a fixture from `use`).
// The browser binary is selected via Playwright's default
// Chromium build — explicit `channel` is unnecessary.

export default defineConfig({
  testDir: "./tests/docs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  },
  projects: [{ name: "chromium" }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
