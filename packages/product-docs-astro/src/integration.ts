// Astro integration entry point for `@ingcreators/annot-product-docs-astro`.
//
// Phase 2 PR 1 of `docs/plans/living-product-docs.md`. The
// integration is the seam between an Astro site and the living
// product docs core — wires up:
//
//   - The MDX renderer (so `*.mdx` files with `annot:` frontmatter
//     compile through the standard Astro pipeline). PR 3 of
//     Phase 2 ships the JSX components the MDX files import.
//
//   - A custom Image Service that renders `<Screen src=...>`
//     references to annotated PNGs via `@ingcreators/annot-annotator`.
//     PR 2 of Phase 2 wires this in.
//
//   - Sensible defaults for the docs site (content dir, route
//     prefix, MDX shortcodes) that the consumer can override.
//
// This PR (PR 1) ships the scaffold only: the integration object
// installs cleanly, names itself, and prints a debug line. The
// MDX renderer + Image Service land in PRs 2–3 — the contract
// stabilises now so consumers can wire up the integration import
// in their `astro.config.mjs` and have the call site survive
// future fills.

import type { AstroIntegration } from "astro";

export interface ProductDocsIntegrationOptions {
  /**
   * Directory (relative to the Astro project root) that contains
   * the `annot:`-frontmatter MDX files the integration should
   * walk for the Image Service + component-config defaults.
   * Default: `"docs"`.
   */
  contentDir?: string;
  /**
   * Path to the `annot-docs.config.ts` config file. Default:
   * `"annot-docs.config.ts"`. Future PRs read this for the
   * `meta` defaults + per-book template lookups.
   */
  configPath?: string;
  /**
   * If `true`, the integration logs a debug line on every
   * config:setup. Useful for verifying the integration is
   * installed correctly in an Astro project. Default: `false`.
   */
  verbose?: boolean;
}

const INTEGRATION_NAME = "@ingcreators/annot-product-docs-astro";

/**
 * Astro integration factory. Drop into `astro.config.mjs`:
 *
 * ```js
 * import { defineConfig } from "astro/config";
 * import { productDocsIntegration } from "@ingcreators/annot-product-docs-astro";
 *
 * export default defineConfig({
 *   integrations: [productDocsIntegration()],
 * });
 * ```
 *
 * Phase 2 PR 1 ships the scaffold — the hooks are no-ops aside
 * from optional verbose logging. PR 2 adds the Image Service;
 * PR 3 wires up the seven docs components.
 */
export function productDocsIntegration(
  options: ProductDocsIntegrationOptions = {},
): AstroIntegration {
  const opts: Required<ProductDocsIntegrationOptions> = {
    contentDir: options.contentDir ?? "docs",
    configPath: options.configPath ?? "annot-docs.config.ts",
    verbose: options.verbose ?? false,
  };

  return {
    name: INTEGRATION_NAME,
    hooks: {
      "astro:config:setup": ({ logger }) => {
        if (opts.verbose) {
          logger.info(
            `${INTEGRATION_NAME} installed — contentDir=${opts.contentDir} configPath=${opts.configPath}`,
          );
        }
        // PR 2: register the Image Service via
        // `updateConfig({ image: { service: ... } })`.
        // PR 3: thread the MDX renderer / component shortcodes
        // through Astro's content-collection setup.
      },
    },
  };
}

/**
 * Default-export shape some Astro integration authors prefer.
 * Both `import productDocsIntegration from ...` (default) and
 * `import { productDocsIntegration }` (named) resolve to the
 * same factory; consumers can pick whichever feels natural.
 */
export default productDocsIntegration;
