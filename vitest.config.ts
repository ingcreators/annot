import { defineConfig } from "vitest/config";

/**
 * Root Vitest config for the monorepo.
 *
 * Tests live next to their sources (`foo.ts` + `foo.test.ts`) rather
 * than in a separate `__tests__` directory — closer proximity makes
 * it easier to keep tests honest during refactors and matches the
 * module-level granularity we're aiming for.
 *
 * Phase 1 scope is the DOM-free core (path utils, XMP, SVG format,
 * encode, pure utilities). Tests for UI / Lit components come later
 * with a browser-like environment (happy-dom). For now we default
 * to `node` and opt each UI test in via `// @vitest-environment
 * happy-dom`.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: [
      "packages/*/src/**/*.{test,spec}.ts",
      // `packages/desktop/src-electron/` houses the Electron main-
      // process IPC handlers introduced by Phase 1 of
      // `docs/plans/desktop-electron-migration.md`. Tests live next
      // to sources here, same as in `src/`.
      "packages/desktop/src-electron/**/*.{test,spec}.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-electron/**",
      "**/.turbo/**",
      "packages/desktop/src-tauri/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "packages/*/src/**/*.ts",
        "packages/desktop/src-electron/**/*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/*.d.ts",
        "packages/*/src/env.d.ts",
        // Storybook showroom files — visual surfaces for reviewers,
        // not production code paths. Counting them as "uncovered"
        // distorts the per-package totals (every Lit component
        // ships at least one story per CLAUDE.md).
        "**/*.stories.ts",
        // Test-only mocks that ship in src/ alongside the storage
        // backends so the contract test suites can import them
        // without crossing the package boundary. Pure test fixtures
        // — coverage of the implementation under test, not the mock,
        // is what matters.
        "**/*.test-mock.ts",
      ],
    },
  },
});
