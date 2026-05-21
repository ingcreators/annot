// Worker script for the `annot-docs-site` Cloudflare Worker.
//
// Two responsibilities:
//
// 1. Bare-`/docs` → `/docs/` 301 redirect. VitePress is
//    configured with `base: "/docs/"` so on-disk files live
//    under `.vitepress/dist/docs/`; the wrangler route pattern
//    `annot.work/docs/*` matches `/docs/foo` but NOT `/docs`
//    bare, and Cloudflare's asset binding doesn't auto-redirect
//    missing trailing slashes. Without this step the bare URL
//    would 404.
//
// 2. **Feature-flag cutover to the Astro Starlight docs**
//    (Phase 6 of
//    `docs/plans/annot-work-astro-unification.md`).
//    The next-generation docs site lives in the
//    `annot-docs-site-astro` Worker. Both workers run in
//    parallel; this worker decides per-request which serves:
//
//    - `?docs-stack=astro` query param → serve from Astro,
//      set a `annot-docs-stack=astro` cookie so subsequent
//      navigations stick.
//    - `?docs-stack=vitepress` query param → serve from
//      VitePress, clear the cookie.
//    - Cookie `annot-docs-stack=astro` present → serve from
//      Astro.
//    - Default → serve from VitePress (this PR keeps
//      VitePress as the default-on stack; a follow-up commit
//      flips the default once smoke tests pass under the
//      cookie opt-in).
//
//    The Astro worker is fetched via the `ASTRO` service
//    binding declared in `wrangler.jsonc`. After a 7-day
//    observation window (the Phase 6.5 TODO in
//    `docs/plans/annot-work-astro-unification.md`), this
//    picker is retired and the Astro worker claims the
//    `annot.work/docs/*` route directly.

const COOKIE_NAME = "annot-docs-stack";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/** @param {Request} request @returns {string | undefined} */
function readStackCookie(request) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)annot-docs-stack=([^;]+)/);
  return match ? match[1] : undefined;
}

/**
 * Decide which stack should serve this request.
 *
 * @param {URL} url
 * @param {Request} request
 * @returns {"astro" | "vitepress" | "default"}
 *   `astro`/`vitepress` mean explicit opt-in via query
 *   param; the side-effect of those is to set/clear the
 *   sticky cookie. `default` means honour the cookie if
 *   present, else fall through to VitePress.
 */
function resolveStack(url, request) {
  const qp = url.searchParams.get("docs-stack");
  if (qp === "astro" || qp === "vitepress") return qp;
  const cookie = readStackCookie(request);
  if (cookie === "astro") return "astro";
  return "default";
}

/**
 * Attach / clear the sticky-cookie header on a response from
 * one of the upstream stacks.
 *
 * @param {Response} response
 * @param {"astro" | "clear" | "none"} stickyAction
 */
function withStickyCookie(response, stickyAction) {
  if (stickyAction === "none") return response;
  const headers = new Headers(response.headers);
  if (stickyAction === "astro") {
    headers.append(
      "set-cookie",
      `${COOKIE_NAME}=astro; Path=/docs/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`,
    );
  } else if (stickyAction === "clear") {
    headers.append("set-cookie", `${COOKIE_NAME}=; Path=/docs/; Max-Age=0; SameSite=Lax`);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  /**
   * @param {Request} request
   * @param {{ASSETS: Fetcher, ASTRO?: Fetcher}} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/docs") {
      url.pathname = "/docs/";
      return Response.redirect(url.toString(), 301);
    }

    const stack = resolveStack(url, request);

    // Explicit `?docs-stack=astro` → serve from Astro + set cookie.
    if (stack === "astro" && env.ASTRO) {
      const upstream = await env.ASTRO.fetch(request);
      const sticky = url.searchParams.get("docs-stack") === "astro" ? "astro" : "none";
      return withStickyCookie(upstream, sticky);
    }

    // Explicit `?docs-stack=vitepress` → serve from VitePress + clear cookie.
    if (stack === "vitepress") {
      const upstream = await env.ASSETS.fetch(request);
      return withStickyCookie(upstream, "clear");
    }

    // Default — VitePress today; will flip to Astro in a follow-up
    // commit once cookie-opt-in smoke tests pass.
    return env.ASSETS.fetch(request);
  },
};
