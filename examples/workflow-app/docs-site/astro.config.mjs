// Astro 5 config for the workflow-app example's docs site.
//
// Reads MDX content collections from the sibling
// `../docs/books/<book>/` so the same MDX source serves
// both this site AND any future XLSX export run from
// the `annot-docs-xlsx` CLI.
//
// The vite alias remaps `@ingcreators/annot-product-docs-astro/components/*.astro`
// to a local vendored copy under `src/_components/`. The
// npm-published `0.1.0` of `@ingcreators/annot-product-docs-astro`
// shipped without its `dist/` directory (fix landing via
// `fix(publish): build product-docs packages before pack` —
// PR #947). Once `0.1.1` republishes, this alias goes away
// and the MDX `import` statements resolve against npm
// directly.

import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";

const componentsDir = fileURLToPath(
  new URL("./src/_components/", import.meta.url),
);

export default defineConfig({
  integrations: [mdx()],
  vite: {
    resolve: {
      alias: [
        {
          find: "@ingcreators/annot-product-docs-astro/components/Screen.astro",
          replacement: `${componentsDir}Screen.astro`,
        },
        {
          find: "@ingcreators/annot-product-docs-astro/components/Overlay.astro",
          replacement: `${componentsDir}Overlay.astro`,
        },
        {
          find: "@ingcreators/annot-product-docs-astro/components/Transition.astro",
          replacement: `${componentsDir}Transition.astro`,
        },
      ],
    },
  },
});
