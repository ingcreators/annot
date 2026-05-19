// Worker script for the `annot` (PWA) Cloudflare Worker.
//
// Sole responsibility: strip the `/app` URL prefix before
// consulting the static-asset binding, plus 301 the bare `/app`
// to `/app/`.
//
// ## Background
//
// The PWA is built with Vite's `base: "/app/"` (configurable via
// `VITE_PWA_BASE`) so its HTML carries `/app/`-prefixed asset
// URLs:
//
//     <script src="/app/assets/index-XXX.js"></script>
//
// Cloudflare's static-asset binding looks up files by treating
// the URL path verbatim as a relative path under
// `assets.directory`. Without this Worker, the binding would
// either:
//
//   - require `dist/app/assets/index-XXX.js` to exist (nesting
//     the build output under `dist/app/`), OR
//   - 404 on every nested URL.
//
// AND the `not_found_handling: "single-page-application"`
// fallback is HARDCODED to serve `<assets-root>/index.html` —
// the root, not a nested copy. With the nested layout, SPA
// fallback could not find `dist/index.html`, so deep links like
// `annot.work/app/edit/img/browser/foo` returned 404 instead of
// loading the SPA shell.
//
// This Worker reconciles both:
//
//   1. Bare `/app` → 301 to `/app/` (Cloudflare's asset binding
//      doesn't auto-redirect missing trailing slashes).
//   2. `/app/<anything>` → strip the prefix, hand to ASSETS.
//      Missing assets fall back to `dist/index.html` cleanly.
//
// ## Why a Worker script + not just routes
//
// Cloudflare Workers route patterns can't rewrite the URL path
// they pass to the asset binding. The path the user requested is
// the path the binding sees. A small Worker is the only way to
// host a Vite-base'd SPA at a sub-path with proper SPA fallback.

export default {
  /** @param {Request} request @param {{ASSETS: Fetcher}} env */
  async fetch(request, env) {
    const url = new URL(request.url);

    // Bare /app (no trailing slash) — 301 to canonical form.
    // Cloudflare's asset binding treats `/app` as a missing file
    // (no extension, no directory index at root). Forcing the
    // trailing slash also normalises the URL for any analytics
    // / referrer headers that might key on path equality.
    if (url.pathname === "/app") {
      url.pathname = "/app/";
      return Response.redirect(url.toString(), 301);
    }

    // Inside the /app/ scope — strip the prefix and consult
    // ASSETS. The stripped URL hits the same paths Vite emitted
    // into `dist/` (no nesting), so static assets resolve
    // directly. Missing paths trigger
    // `not_found_handling: "single-page-application"`, which
    // serves `dist/index.html` — the SPA shell — letting the
    // PWA's client-side router take over.
    if (url.pathname.startsWith("/app/")) {
      url.pathname = url.pathname.slice("/app".length);
      return env.ASSETS.fetch(new Request(url.toString(), request));
    }

    // Defensive: route binding `annot.work/app*` shouldn't send
    // anything outside that scope here, but if it did, pass
    // through to ASSETS unchanged so the binding's own 404
    // handler takes effect.
    return env.ASSETS.fetch(request);
  },
};
