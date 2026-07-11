import { defineConfig } from "@playwright/test";

// E2e suite for the Electron desktop host. Each test launches the
// built app (dist-electron/main/main.js) through Playwright's
// Electron driver against a throwaway library: the
// ANNOT_TEST_USER_DATA_DIR seam in src-electron/main.ts redirects
// `userData` (and with it `<userData>/library/` + session storage)
// into a per-test temp directory, so runs never touch the real
// user library.
//
// Electron needs an X display — run through `xvfb-run -a` on
// headless Linux (the `e2e` script does this; CI mirrors it).
//
// One worker, serial: every test boots its own Electron instance,
// and the main process binds the extension-handoff HTTP server to
// the fixed port 19530 — parallel instances would race it (the
// bind failure is non-fatal but would silently drop coverage).
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 120_000,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
  },
  projects: [{ name: "desktop" }],
});
