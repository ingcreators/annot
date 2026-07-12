// `/api/embed/health` + `/api/embed/setup` route handlers —
// Phase 6 follow-up 5y-1.
//
// These two endpoints are the surface 5y-1 adds:
//
//   GET /api/embed/health
//     JSON status of the GitHub App secrets. The operator runs
//     this after `wrangler secret put` to confirm the binding
//     deploy worked. Returns 200 with `ok: false` when any of the
//     five secrets is unset (the response body still 200's so
//     curl from a self-host customer can easily script-detect
//     "needs setup" via the `ok` field; 5y-2 onward returns 5xx
//     when the same secrets are missing because *those* endpoints
//     fail closed).
//
//   GET /api/embed/setup
//     HTML page guiding the operator through the one-time GitHub
//     App registration. Renders the manifest-flow form pre-
//     populated with `embed-github-app-manifest.json` so the
//     customer (or annot.work's maintainer for the production
//     deployment) can register the App in one click and then run
//     the `wrangler secret put` commands listed at the bottom.
//
// 5y-2 added `/api/embed/load`; 5y-4 added `/api/embed/commit`.
// `/api/embed/webhook` + `/api/embed/setup/callback` land in 5y-6
// (`webhook.ts` + `setup-callback.ts`).

import type { Context } from "hono";
import type { Env } from "../index.js";
import { inspectGitHubAppSecrets } from "./github-app.js";

/** `GET /api/embed/health` — reports whether the GitHub App
 *  secrets are bound. Always 200 OK (the response body's `ok`
 *  field signals binding presence); this matches the existing
 *  `/api/health` + `/api/health/bindings` shape so monitoring
 *  scripts don't need a different status-code path per endpoint. */
export function handleEmbedHealth(c: Context<{ Bindings: Env }>): Response {
  const status = inspectGitHubAppSecrets(c.env);
  return c.json({
    ok: status.ok,
    service: "annot-api",
    feature: "embed",
    appIdMasked: status.appIdMasked,
    secrets: status.secrets,
    timestamp: new Date().toISOString(),
  });
}

/** Inlined copy of the embed-github-app-manifest.json shape. The
 *  manifest file at the package root is the canonical source; we
 *  re-declare the same fields here so the worker bundle stays
 *  self-contained (Wrangler's default bundler doesn't include
 *  non-JS / non-TS sibling files without an explicit
 *  `rules`/`config` entry, and we'd rather have one source of
 *  truth than a build-time include). When updating either the
 *  JSON or this constant, update the other. */
const EMBED_GITHUB_APP_MANIFEST = {
  name: "annot-cloud-editor",
  url: "https://annot.work",
  hook_attributes: {
    url: "https://annot.work/api/embed/webhook",
    active: true,
  },
  redirect_url: "https://annot.work/api/embed/setup/callback",
  // Two callback URLs: the manifest-flow redirect target AND the
  // GitHub App user-authorization callback (one-click GitHub
  // connect — docs/plans/github-app-user-tokens.md). Apps
  // registered before the second entry existed need it added
  // manually on the App settings page.
  callback_urls: [
    "https://annot.work/api/embed/setup/callback",
    "https://annot.work/api/github/app/callback",
  ],
  setup_url: "https://annot.work/api/embed/setup",
  setup_on_update: true,
  public: false,
  default_permissions: {
    contents: "write",
    metadata: "read",
    pull_requests: "write",
  },
  default_events: ["installation", "installation_repositories", "push"],
};

/** Returns the manifest the customer (or annot.work maintainer)
 *  POSTs to `https://github.com/settings/apps/new?state=…`. The
 *  manifest is tailored to the host the Worker is responding on
 *  so a self-host deployment ends up with the right callback URLs
 *  without the customer editing JSON by hand. */
function buildManifestForRequest(reqUrl: string): typeof EMBED_GITHUB_APP_MANIFEST {
  const u = new URL(reqUrl);
  const origin = `${u.protocol}//${u.host}`;
  return {
    ...EMBED_GITHUB_APP_MANIFEST,
    url: origin,
    hook_attributes: {
      url: `${origin}/api/embed/webhook`,
      active: true,
    },
    redirect_url: `${origin}/api/embed/setup/callback`,
    callback_urls: [`${origin}/api/embed/setup/callback`, `${origin}/api/github/app/callback`],
    setup_url: `${origin}/api/embed/setup`,
  };
}

/** `GET /api/embed/setup` — operator-facing setup page. Renders
 *  the GitHub App manifest-flow form with a single submit button
 *  that POSTs to <https://github.com/settings/apps/new>. Once the
 *  App is registered, GitHub redirects to
 *  `/api/embed/setup/callback` (handled by 5y-2) which surfaces
 *  the resulting App ID / client secret / private key / webhook
 *  secret for the operator to paste into `wrangler secret put`.
 *
 *  For the production `annot.work` deployment, this page is run
 *  ONCE by the maintainer. For self-host deployments, the customer
 *  runs it once on their `cloudUrl`. */
export function handleEmbedSetupPage(c: Context<{ Bindings: Env }>): Response {
  const status = inspectGitHubAppSecrets(c.env);
  const manifest = buildManifestForRequest(c.req.url);
  const manifestJson = JSON.stringify(manifest);
  // Static HTML page. No JS framework — Wrangler-bundled Worker
  // responses stay small and the page is rendered once per setup.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Annot Cloud — Embed editor setup</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #222; }
  h1, h2 { line-height: 1.2; }
  code, pre { background: #f5f5f5; padding: 0.15rem 0.4rem; border-radius: 4px; }
  pre { padding: 0.75rem 1rem; overflow-x: auto; }
  .status { padding: 0.75rem 1rem; border-radius: 6px; margin: 1rem 0; }
  .status.ok { background: #e7f7ec; color: #166534; }
  .status.missing { background: #fef3c7; color: #92400e; }
  button.primary { font-size: 1rem; padding: 0.6rem 1.2rem; background: #2563eb; color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
  button.primary:hover { background: #1d4ed8; }
  ol li { margin: 0.4rem 0; }
</style>
</head>
<body>
<h1>Annot Cloud — Embed editor setup</h1>

<p>One-time setup that registers a GitHub App named
<code>${escapeHtml(manifest.name)}</code> on this deployment
(<code>${escapeHtml(new URL(c.req.url).host)}</code>).</p>

<div class="status ${status.ok ? "ok" : "missing"}">
${
  status.ok
    ? `<strong>Secrets bound.</strong> App ID: <code>${escapeHtml(
        status.appIdMasked ?? "",
      )}</code>. Setup already completed — re-running below will issue a fresh App.`
    : "<strong>Secrets missing.</strong> Once you finish the GitHub-side registration below, paste the values via <code>wrangler secret put</code> and re-deploy."
}
</div>

<h2>1. Register the App on GitHub</h2>
<p>Click the button. GitHub will prompt you to confirm the App name,
review the permissions, and choose which account / organisation
to install it under.</p>

<form action="https://github.com/settings/apps/new" method="post">
  <input type="hidden" name="manifest" value='${escapeAttribute(manifestJson)}' />
  <button class="primary" type="submit">Register annot-cloud-editor on GitHub</button>
</form>

<h2>2. Capture the App credentials</h2>
<p>After registering, GitHub redirects you to
<code>${escapeHtml(manifest.redirect_url)}</code>, which (in 5y-2,
not yet shipped) will surface the App ID, client secret, private
key (PEM), and webhook secret. For now, capture them manually from
the App's settings page on github.com.</p>

<h2>3. Bind the secrets to the Worker</h2>
<pre>wrangler secret put GITHUB_APP_ID --env production
wrangler secret put GITHUB_APP_CLIENT_ID --env production
wrangler secret put GITHUB_APP_CLIENT_SECRET --env production
wrangler secret put GITHUB_APP_WEBHOOK_SECRET --env production
wrangler secret put GITHUB_APP_PRIVATE_KEY --env production   # paste the PEM, multi-line OK</pre>

<h2>4. Verify the binding</h2>
<p><code>curl ${escapeHtml(new URL(c.req.url).origin)}/api/embed/health</code>
should return <code>"ok": true</code>.</p>

<hr />
<p>Customer self-host? See
<a href="https://github.com/ingcreators/annot/blob/main/docs/plans/annot-cloud-roadmap.md#5y-1-user-action-required">
the cloud-roadmap "5y-1 user action required" callout</a> for the
on-prem walkthrough.</p>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Conservative CSP — no JS / external resources on this page,
      // so deny everything except inline styles and the GitHub form
      // submission.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action https://github.com",
    },
  });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(s: string): string {
  // Used in `value='...'` — the JSON we embed contains double
  // quotes naturally, so use single-quoted attributes + escape any
  // stray single quotes / ampersands.
  return s.replaceAll("&", "&amp;").replaceAll("'", "&#39;");
}
