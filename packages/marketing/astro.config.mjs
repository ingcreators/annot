// @ts-check
import { defineConfig } from "astro/config";

// Astro config for the annot.work marketing site.
//
// Output: pure static HTML in `dist/`. Phase 8d will wire `dist/`
// to a Cloudflare Workers static-assets binding that claims
// `annot.work/*` (with the existing PWA worker re-mounted under
// `/app/*`). For now the build artefact lives unaccompanied —
// no deploy from this PR.
//
// `site` is the canonical absolute URL used for sitemap / OG
// metadata. We point at production because the marketing site
// will only ever be deployed under that origin.
export default defineConfig({
  site: "https://annot.work",
  trailingSlash: "ignore",
  build: {
    format: "directory",
  },
});
