// Astro 5 config for the workflow-app example's docs site.
//
// Reads MDX content collections from the sibling
// `../docs/books/<book>/` so the same MDX source serves
// both this site AND any future XLSX export run from the
// `annot-docs-xlsx` CLI.
//
// `productDocsIntegration` is a no-op scaffold in 0.2.0
// (a verbose debug line on config:setup). Future Astro
// versions of the package will plug in the Image Service
// that turns base PNGs into annotated PNGs at build time
// — installing it now means consumers pick up that wiring
// automatically when the package gains it.

import mdx from "@astrojs/mdx";
import { productDocsIntegration } from "@ingcreators/annot-product-docs-astro";
import { defineConfig } from "astro/config";

export default defineConfig({
  integrations: [
    mdx(),
    productDocsIntegration({
      contentDir: "../docs/books",
      verbose: false,
    }),
  ],
  vite: {
    // `.astro` files re-exported via `package.exports` need Vite
    // to resolve them at build time rather than leaving the
    // import as a bare-package runtime require (Rollup's
    // default for node_modules deps). Without this, MDX
    // `import Screen from "@ingcreators/annot-product-docs-astro/components/Screen.astro"`
    // fails with "Rollup failed to resolve import".
    ssr: {
      noExternal: ["@ingcreators/annot-product-docs-astro"],
    },
  },
});
