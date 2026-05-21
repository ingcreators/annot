import { defineConfig, devices } from "@playwright/test";

// Playwright config for the workflow-app docs tour.
//
// `npm run docs:sync` boots Vite on port 5173 via the
// `webServer` block, walks the SPA twice (applicant flow,
// approver flow), captures base PNGs into
// `docs-site/public/shots/` and refreshes the
// `annot:snapshot` block in every matching MDX under
// `docs/books/{operation-manual,screen-design}/`.
//
// The tour does NOT depend on
// `@ingcreators/annot-product-docs` because that package's
// `0.1.0` npm publish is missing its `dist/` (fix landed in
// #947 — gated on operator republish). Once `0.1.1` is on
// the registry, the per-screen `capture()` calls in the
// spec files migrate to `screen.capture({ id, mdxPath })`
// from the published fixture.

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
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
