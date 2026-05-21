// Worker script for the `annot-docs-site-astro` Cloudflare Worker.
//
// Same shape as the legacy `annot-docs-site` worker: the static-
// asset binding serves Astro's per-route HTML directly, this
// script only handles the bare-`/docs` redirect that the asset
// binding doesn't auto-resolve.
//
// Astro is configured with `base: "/docs/"` so internal links
// carry the prefix and on-disk files live under `./dist/docs/`.
// A request to `annot.work/docs` (no trailing slash) doesn't
// match the static-asset binding pattern for directory-style
// resources; without this Worker it would 404.

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
