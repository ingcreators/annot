import { defineConfig } from "@playwright/test";

// Playwright config for the docs-site dogfood tour. Tests live
// under `tests/docs/` and run against the live `annot.work/app/`
// (or whatever URL `ANNOT_APP_URL` overrides to in CI).
//
// Phase 5 of `docs/plans/annot-work-astro-unification.md`.

export default defineConfig({
  testDir: "./tests/docs",
  reporter: "list",
  use: {
    // Chromium only for the dogfood tour — the test surface is
    // capture + aria-snapshot, both of which are deterministic
    // enough to not need cross-browser coverage at this stage.
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
});
