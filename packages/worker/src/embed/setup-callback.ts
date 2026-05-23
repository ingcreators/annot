// Manifest-flow setup callback — Phase 6 follow-up 5y-6.
//
// After the operator clicks "Register annot-cloud-editor on GitHub"
// on the 5y-1 setup page, GitHub posts the manifest to
// `https://github.com/settings/apps/new` and (on success) redirects
// the operator to the App's `redirect_url` — which the manifest
// declares as `${origin}/api/embed/setup/callback`.
//
// The redirect carries `?code=<single-use>&state=<echo>`. We
// exchange the code at
// `POST https://api.github.com/app-manifests/:code/conversions`
// (no auth required; the code is single-use + ~10 min TTL) to
// receive the App's credentials:
//   { id, client_id, client_secret, webhook_secret, pem, html_url }
//
// The credentials are SURFACED ONCE on the resulting HTML page so
// the operator can paste them into `wrangler secret put`. We do
// NOT persist them Worker-side (the manifest flow's whole appeal
// is that the customer's GitHub App credentials stay on the
// customer's machine — the Worker only knows them when they've
// been bound via `wrangler secret put` afterwards).
//
// When GitHub also appends `?installation_id=<n>` (which happens
// after the operator installs the App on an account, not just
// after registration), we additionally upsert the
// `github_installations` row so the row exists before 5z-1's
// PATCH endpoint claims it for a workspace.

import type { Context } from "hono";
import type { Env } from "../index.js";
import { upsertGitHubInstallation } from "./github-app.js";

interface ManifestConversion {
  id?: number;
  client_id?: string;
  client_secret?: string;
  webhook_secret?: string;
  pem?: string;
  html_url?: string;
  owner?: { login?: string; type?: string };
}

/**
 * `GET /api/embed/setup/callback?code=&state=&installation_id=` —
 * manifest-flow redirect target. Always renders an HTML page; the
 * page either confirms success (with copy-pasteable secret
 * commands) or surfaces the error returned by the GitHub
 * conversions API.
 */
export async function handleEmbedSetupCallback(
  c: Context<{ Bindings: Env }>,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");
  const installationIdRaw = url.searchParams.get("installation_id");
  const installationId =
    installationIdRaw && Number.isFinite(Number.parseInt(installationIdRaw, 10))
      ? Number.parseInt(installationIdRaw, 10)
      : null;

  if (!code) {
    return renderErrorPage(
      "Missing manifest code",
      "GitHub did not include a `code` query parameter. Re-run the setup page and try again.",
    );
  }

  const conversionRes = await fetchImpl(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "annot-cloud-editor",
      },
    },
  );

  if (!conversionRes.ok) {
    const body = await safeReadText(conversionRes);
    return renderErrorPage(
      `GitHub manifest conversion failed (HTTP ${conversionRes.status})`,
      body || "GitHub returned no body. The code may have expired or already been used.",
    );
  }

  let conversion: ManifestConversion;
  try {
    conversion = (await conversionRes.json()) as ManifestConversion;
  } catch {
    return renderErrorPage(
      "Invalid manifest conversion response",
      "GitHub returned a non-JSON body. Re-run the setup page to retry.",
    );
  }

  if (!conversion.id || !conversion.client_id || !conversion.pem || !conversion.webhook_secret) {
    return renderErrorPage(
      "Manifest conversion response missing fields",
      "GitHub returned a response without one of the required fields (id / client_id / pem / webhook_secret). Re-run setup.",
    );
  }

  // If GitHub also included an installation_id, the operator
  // installed the App in the same flow. Seed the row so the
  // dashboard's claim step can bind it immediately.
  if (installationId !== null) {
    try {
      await upsertGitHubInstallation(c.env.DB, {
        id: installationId,
        accountLogin: conversion.owner?.login ?? "",
        accountType: conversion.owner?.type === "Organization" ? "Organization" : "User",
      });
    } catch (err) {
      console.warn("[embed-setup-callback] upsertGitHubInstallation failed:", err);
    }
  }

  return renderSuccessPage({
    appId: String(conversion.id),
    clientId: conversion.client_id,
    clientSecret: conversion.client_secret ?? "",
    webhookSecret: conversion.webhook_secret,
    pem: conversion.pem,
    htmlUrl: conversion.html_url ?? "",
    installationId,
    origin: `${url.protocol}//${url.host}`,
  });
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function renderErrorPage(title: string, detail: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Annot Cloud — Embed editor setup error</title>
<style>${SETUP_PAGE_CSS}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="error">${escapeHtml(detail)}</p>
<p><a href="/api/embed/setup">← Back to setup</a></p>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": SETUP_PAGE_CSP,
    },
  });
}

function renderSuccessPage(opts: {
  appId: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  pem: string;
  htmlUrl: string;
  installationId: number | null;
  origin: string;
}): Response {
  const installLink = opts.htmlUrl ? `${opts.htmlUrl.replace(/\/$/, "")}/installations/new` : "";
  const installationNotice =
    opts.installationId !== null
      ? `<p class="ok">Installation <code>${escapeHtml(
          String(opts.installationId),
        )}</code> recorded. Bind it to a workspace via <code>PATCH /api/embed/installations/${escapeHtml(
          String(opts.installationId),
        )}</code> once you've completed the secret-binding step below.</p>`
      : "<p>Once secrets are bound, install the App on an account via the link above. The first webhook GitHub sends will populate <code>github_installations</code> automatically.</p>";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Annot Cloud — Embed editor setup complete</title>
<style>${SETUP_PAGE_CSS}</style>
</head>
<body>
<h1>App registered</h1>
<p class="ok">GitHub created the App and returned its credentials below.
<strong>This page is shown ONCE</strong> — copy every value before navigating away.</p>

<h2>1. Bind the secrets</h2>
<p>Run each command, pasting the value when <code>wrangler</code> prompts.
The PEM is multi-line; <code>wrangler secret put</code> reads stdin so paste then Ctrl-D / Ctrl-Z.</p>
<pre>wrangler secret put GITHUB_APP_ID --env production
wrangler secret put GITHUB_APP_CLIENT_ID --env production
wrangler secret put GITHUB_APP_CLIENT_SECRET --env production
wrangler secret put GITHUB_APP_WEBHOOK_SECRET --env production
wrangler secret put GITHUB_APP_PRIVATE_KEY --env production</pre>

<h2>2. Values to paste</h2>
<table class="creds">
  <tr><th>GITHUB_APP_ID</th><td><code>${escapeHtml(opts.appId)}</code></td></tr>
  <tr><th>GITHUB_APP_CLIENT_ID</th><td><code>${escapeHtml(opts.clientId)}</code></td></tr>
  <tr><th>GITHUB_APP_CLIENT_SECRET</th><td><code>${escapeHtml(opts.clientSecret)}</code></td></tr>
  <tr><th>GITHUB_APP_WEBHOOK_SECRET</th><td><code>${escapeHtml(opts.webhookSecret)}</code></td></tr>
</table>
<h3>GITHUB_APP_PRIVATE_KEY (PEM)</h3>
<pre class="pem">${escapeHtml(opts.pem)}</pre>

<h2>3. Install the App on an account</h2>
${
  installLink
    ? `<p><a class="primary" href="${escapeAttribute(installLink)}">Install on GitHub →</a></p>`
    : `<p>Open the App's settings page on GitHub and click <em>Install App</em>.</p>`
}
${installationNotice}

<h2>4. Verify</h2>
<p>After redeploying with the new secrets, hit
<code>curl ${escapeHtml(opts.origin)}/api/embed/health</code> and confirm
<code>"ok": true</code>.</p>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Never cache — the credentials shown on this page are
      // one-time-displayed; an intermediate cache holding a copy
      // would defeat the privacy posture.
      "Cache-Control": "no-store",
      "Content-Security-Policy": SETUP_PAGE_CSP,
    },
  });
}

const SETUP_PAGE_CSS = `
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #222; }
  h1, h2, h3 { line-height: 1.2; }
  code, pre { background: #f5f5f5; padding: 0.15rem 0.4rem; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre { padding: 0.75rem 1rem; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
  pre.pem { font-size: 0.85rem; }
  table.creds { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
  table.creds th, table.creds td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #eee; vertical-align: top; }
  table.creds th { width: 14rem; font-weight: 600; }
  .ok { background: #e7f7ec; color: #166534; padding: 0.75rem 1rem; border-radius: 6px; }
  .error { background: #fee2e2; color: #991b1b; padding: 0.75rem 1rem; border-radius: 6px; }
  a.primary { display: inline-block; font-size: 1rem; padding: 0.6rem 1.2rem; background: #2563eb; color: #fff; border: 0; border-radius: 6px; text-decoration: none; }
  a.primary:hover { background: #1d4ed8; }
`;

const SETUP_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'";

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}
