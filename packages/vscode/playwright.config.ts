import { defineConfig } from "@playwright/test";

// E2e suite for the VSCode extension host. Each test launches a real
// VS Code desktop (downloaded by tests/e2e/global-setup.ts into
// .vscode-test/) through Playwright's Electron driver with
// `--extensionDevelopmentPath` pointing at this package, then drives
// the custom-editor webview via frameLocator.
//
// VS Code needs an X display — run through `xvfb-run -a` on headless
// Linux (the `e2e` script does this; CI mirrors it).
//
// One worker, serial: every test boots its own VS Code instance with
// a fresh user-data-dir; parallel instances are memory-heavy and gain
// little at this suite size.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 120_000,
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    trace: "retain-on-failure",
  },
  projects: [{ name: "vscode" }],
});
