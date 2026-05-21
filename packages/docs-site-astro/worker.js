// Worker script for the `annot-docs-site-astro` Cloudflare Worker.
//
// Two responsibilities on top of the static-asset binding:
//
// 1. Bare-`/docs` redirect — Astro is configured with
//    `base: "/docs/"` so internal links carry the prefix and
//    on-disk files live under `./dist/docs/`. A request to
//    `annot.work/docs` (no trailing slash) doesn't match the
//    static-asset binding pattern for directory-style resources;
//    without this Worker it would 404.
//
// 2. `/docs/pwa/*` → `/docs/app/*` 301 redirects — Open Question
//    #7 (see `docs/plans/annot-work-astro-unification.md`)
//    renamed the legacy "PWA" section to "Annot web app" because
//    the web app no longer ships a service worker or
//    manifest.json. The four legacy pages are renamed in
//    Phase 2; the URL-preservation contract is honoured via
//    permanent 301s installed here, so external links to
//    annot.work/docs/pwa/... keep resolving forever.

const PWA_TO_APP_REDIRECTS = new Map([
  ["/docs/pwa", "/docs/app"],
  ["/docs/pwa/", "/docs/app/"],
  ["/docs/pwa/sign-in", "/docs/app/sign-in"],
  ["/docs/pwa/sign-in/", "/docs/app/sign-in/"],
  ["/docs/pwa/storage-backends", "/docs/app/storage-backends"],
  ["/docs/pwa/storage-backends/", "/docs/app/storage-backends/"],
  ["/docs/pwa/share-links", "/docs/app/share-links"],
  ["/docs/pwa/share-links/", "/docs/app/share-links/"],
]);

export default {
  /** @param {Request} request @param {{ASSETS: Fetcher}} env */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/docs") {
      url.pathname = "/docs/";
      return Response.redirect(url.toString(), 301);
    }

    const target = PWA_TO_APP_REDIRECTS.get(url.pathname);
    if (target !== undefined) {
      url.pathname = target;
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
