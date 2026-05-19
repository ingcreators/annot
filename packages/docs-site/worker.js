// Worker script for the `annot-docs-site` Cloudflare Worker.
//
// Sole responsibility: 301 the bare `/docs` (no trailing slash)
// to `/docs/`. Every other URL flows through to the static-asset
// binding (which serves the VitePress per-route HTML files
// directly — no SPA fallback needed, since VitePress emits a
// physical `index.html` for every page).
//
// Background: VitePress is configured with `base: "/docs/"` so
// internal links carry the prefix and on-disk files live under
// `.vitepress/dist/docs/`. The wrangler route pattern
// `annot.work/docs/*` matches `/docs/foo` but NOT `/docs` bare;
// Cloudflare's asset binding doesn't auto-redirect missing
// trailing slashes for directory-style requests, so the bare
// `/docs` would 404 without this Worker.

export default {
  /** @param {Request} request @param {{ASSETS: Fetcher}} env */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/docs") {
      url.pathname = "/docs/";
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
