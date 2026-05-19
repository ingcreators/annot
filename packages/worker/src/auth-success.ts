// `/api/auth/success` — terminal page for OAuth popups.
//
// Both the GitHub and Google callback handlers redirect here after
// minting the session cookie. The page does three things, in
// order:
//
//   1. Posts a message to `window.opener` so the PWA can
//      short-circuit its `/api/auth/me` polling loop and resolve
//      the cloud-connect dialog immediately.
//   2. Closes the popup window.
//   3. Falls back to a "you can close this window" message + a
//      link to `/` for users who hit the OAuth flow in the
//      top-level tab (no `window.opener`).
//
// All inlined — no external CSS / JS, no Workers Static Assets
// binding. Keeping the page byte-tiny keeps the worker bundle
// small and makes auditing the closing behaviour trivial.
//
// CSP: The page allows ONLY a single inline script (`script-src
// 'unsafe-inline'`). Tightening to a nonce or hash would require
// generating per-request CSP — not worth the complexity for a
// terminal page that closes itself in <50ms.

import type { Context } from "hono";
import type { Env } from "./index.js";

/** Body of the post-OAuth success page. Inlined to avoid a
 *  worker static-assets binding for one 60-line file. Carefully
 *  contained — no user-supplied substitution. */
const SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Signed in to Annot Cloud</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
    }
    main {
      min-height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 32px;
      box-sizing: border-box;
      text-align: center;
    }
    h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
    }
    p {
      margin: 0;
      font-size: 14px;
      color: #94a3b8;
      max-width: 36ch;
    }
    a {
      color: #60a5fa;
      text-decoration: none;
    }
    a:hover { text-decoration: underline; }
    .ok {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #16a34a;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      line-height: 1;
    }
  </style>
</head>
<body>
  <main>
    <div class="ok" aria-hidden="true">✓</div>
    <h1>Signed in to Annot Cloud</h1>
    <p id="msg">You can close this window. <a href="/app/">Return to Annot</a></p>
  </main>
  <script>
    // Notify the PWA opener so it can short-circuit its polling
    // loop and resolve the cloud-connect dialog immediately. The
    // origin check on the receiving side is what makes this safe;
    // we post with the page's own origin so cross-origin opener
    // contexts can't read the message.
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          { type: "annot-cloud-auth-complete" },
          window.location.origin,
        );
      }
    } catch (e) {
      // Cross-origin opener / blocked postMessage. Fall through
      // to the close attempt below; PWA polling picks up the
      // session via the new cookie within ~1.5s.
    }
    // Best-effort window.close(). Browsers only permit this when
    // the window was opened by script (which is the popup case);
    // top-level tabs the user navigated to manually fail the
    // close() silently. The "you can close this window" message
    // covers that branch.
    try {
      window.close();
    } catch {
      /* ignore */
    }
  </script>
</body>
</html>`;

export function handleAuthSuccess(_c: Context<{ Bindings: Env }>): Response {
  return new Response(SUCCESS_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Don't cache the page — the body is tiny, and a future
      // change to the close-script logic should ship without
      // intermediaries holding the old version.
      "Cache-Control": "no-store",
      // Tight CSP. `script-src 'unsafe-inline'` is required for
      // the inline close script; no `script-src 'self'` because
      // we don't serve any external scripts at all.
      "Content-Security-Policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
