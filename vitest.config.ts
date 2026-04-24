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
    include: ["packages/*/src/**/*.{test,spec}.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "packages/desktop/src-tauri/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/*.d.ts",
        "packages/*/src/env.d.ts",
      ],
    },
  },
});
