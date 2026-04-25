/**
 * Storybook config for `@ingcreators/annot-web`.
 *
 * Phase 1 of `docs/plans/storybook-introduction.md`. The
 * `web-components-vite` framework is the canonical Storybook
 * path for Lit components (Lit elements are web components);
 * it also renders today's vanilla DOM components so the five
 * initial stories can bootstrap before the Lit migration lands.
 *
 * Stories are co-located with their source — `foo.stories.ts`
 * next to `foo.ts` — matching the existing `foo.test.ts`
 * convention. The glob catches everything under `src/`.
 */

import type { StorybookConfig } from "@storybook/web-components-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.ts"],
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
