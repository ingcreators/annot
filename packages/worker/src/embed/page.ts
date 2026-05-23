// `/embed` static page emitter — Phase 6 follow-up 5y-3.
//
// Serves the HTML shell that mounts `<annot-embed-shell>` against
// the GitHub-App-backed StorageProvider. The shell's runtime JS
// ships as a separate Cloudflare Pages bundle (built from
// `@ingcreators/annot-host-ui/embed-bundle` — to land alongside
// the PWA's existing Pages deploy in a follow-up infra PR); this
// page references the bundle by path so the Worker stays
// asset-agnostic.
//
// The emitter is deliberately small + self-contained:
//   - Inline minimal CSS (no Tailwind / design-system dep).
//   - Single `<script type="module">` import of the shell bundle.
//   - No JS framework on the Worker side — Hono just routes the
//     GET to here.
//
// The page is served WITHOUT a Content-Security-Policy
// `frame-ancestors` directive (i.e. relaxed from the platform
// default) since the `inline` embed mode (5e) mounts this same
// HTML in an `<iframe>` from arbitrary docs-site origins. Origin
// validation for postMessage exchanges lives in the embed-
// protocol's `createEmbedClientMessenger` (5c, Phase 5).

import type { Context } from "hono";
import type { Env } from "../index.js";
import { inspectGitHubAppSecrets } from "./github-app.js";

/** Where the shell's JS bundle is served from. Override via the
 *  `EMBED_SHELL_BUNDLE_URL` Worker secret for self-host
 *  deployments (e.g. customers hosting the bundle on their own
 *  Pages / CDN). Defaults to the relative `/embed/shell.js` path
 *  so a co-deployed Pages bundle at the same origin works
 *  out-of-the-box without any config. */
const DEFAULT_SHELL_BUNDLE_URL = "/embed/shell.js";

/** `GET /embed` — serve the HTML shell page. */
export function handleEmbedPage(c: Context<{ Bindings: Env }>): Response {
  const status = inspectGitHubAppSecrets(c.env);
  const bundleUrl = c.env.EMBED_SHELL_BUNDLE_URL || DEFAULT_SHELL_BUNDLE_URL;
  const html = renderEmbedPage({
    secretsBound: status.ok,
    bundleUrl,
    requestUrl: c.req.url,
  });
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // `frame-ancestors *` so the inline-mode iframe (5e) can
      // mount this page from arbitrary docs-site origins. Origin
      // validation is enforced by the message-channel layer per
      // the 5c design.
      "Content-Security-Policy":
        // Allow inline styles (the minimal page chrome) + the
        // shell bundle JS from same-origin. `connect-src` covers
        // the `/api/embed/*` calls the shell makes on save / load.
        "default-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "script-src 'self'; connect-src 'self'; img-src 'self' data: blob:; " +
        "frame-ancestors *",
    },
  });
}

interface RenderPageOpts {
  secretsBound: boolean;
  bundleUrl: string;
  requestUrl: string;
}

/** Build the static HTML for the embed page. Exported for tests
 *  so the structural assertions don't need to spin up the full
 *  Hono `Context`. */
export function renderEmbedPage(opts: RenderPageOpts): string {
  const requestUrl = new URL(opts.requestUrl);
  // Forward the request params (repo / pngPath / annotationsPath
  // / return / mode / v) to the shell via a data attribute. The
  // shell parses them via `parseEmbedRequestUrl` from
  // `@ingcreators/annot-embed-protocol`.
  const paramsJson = JSON.stringify(Object.fromEntries(requestUrl.searchParams));
  const notice = opts.secretsBound
    ? ""
    : `<noscript-placeholder class="embed-warning">
          <strong>annot-cloud editor isn't fully configured.</strong>
          The deployment's GitHub App secrets aren't bound.
          See <a href="/api/embed/setup">/api/embed/setup</a>.
        </noscript-placeholder>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Annot Cloud — Edit</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #fafafa; color: #222; font-family: system-ui, sans-serif; }
  #embed-mount { display: block; width: 100%; height: 100%; }
  .embed-warning { display: block; padding: 0.75rem 1rem; background: #fef3c7; color: #92400e; font-size: 0.9rem; }
  .embed-warning a { color: inherit; text-decoration: underline; }
  .embed-loading { display: flex; align-items: center; justify-content: center; height: 100%; color: #555; font-size: 0.95rem; }
</style>
</head>
<body>
${notice}
<annot-embed-shell id="embed-mount" data-embed-params='${escapeAttribute(paramsJson)}'>
  <div class="embed-loading">Loading editor…</div>
</annot-embed-shell>
<script type="module" src="${escapeAttribute(opts.bundleUrl)}"></script>
</body>
</html>`;
}

function escapeAttribute(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("'", "&#39;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
