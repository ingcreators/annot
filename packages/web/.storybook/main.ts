/**
 * Storybook config for `@ingcreators/annot-web`.
 *
 * Originally Phase 1 of
 * `docs/plans/_done/storybook-introduction.md`. The
 * `web-components-vite` framework is the canonical Storybook
 * path for Lit components (Lit elements are web components).
 * After `_done/lit-migration.md` and
 * `_done/lit-migration-completion.md` landed, every covered
 * component is a `LitElement`; after
 * `_done/litelement-stories-coverage.md` landed, every
 * `LitElement` under `src/` ships at least one story.
 *
 * Stories are co-located with their source — `foo.stories.ts`
 * next to `foo.ts` — matching the existing `foo.test.ts`
 * convention. The glob catches everything under `src/`. Every
 * `LitElement` subclass under `src/` must ship at least one
 * `*.stories.ts`; the symmetry check runs as a Vitest case in
 * `src/storybook-coverage.test.ts`.
 */

import type { StorybookConfig } from "@storybook/web-components-vite";

const config: StorybookConfig = {
  // Both `packages/web/src/` and `packages/host-ui/src/` so
  // built-in Lit components migrated out of the web package per
  // `docs/plans/_done/vscode-extension-host.md` continue to appear
  // in the same Storybook bundle. Stories stay co-located with
  // their component source per CLAUDE.md.
  stories: [
    "../src/**/*.stories.ts",
    "../../host-ui/src/**/*.stories.ts",
  ],
  framework: {
    name: "@storybook/web-components-vite",
    options: {},
  },
  addons: [
    // a11y lint via axe-core, surfaced in the Storybook UI.
    // Useful as we migrate to Lit — scoped shadow DOM is a
    // frequent source of accessibility surprises.
    "@storybook/addon-a11y",
  ],
};

export default config;
