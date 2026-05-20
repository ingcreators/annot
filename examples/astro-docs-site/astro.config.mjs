// Sample Astro config for the dogfooded living-product-docs site.
// Phase 2 PR 4 of `docs/plans/living-product-docs.md`.

import mdx from "@astrojs/mdx";
import { productDocsIntegration } from "@ingcreators/annot-product-docs-astro";
import { defineConfig } from "astro/config";

export default defineConfig({
  integrations: [
    mdx(),
    productDocsIntegration({
      contentDir: "src/content/docs",
      verbose: true,
    }),
  ],
});
