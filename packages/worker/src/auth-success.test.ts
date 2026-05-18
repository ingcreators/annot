// Smoke tests for the `/api/auth/success` terminal page. The
// page is content-only — it's the client-side JS that does the
// `postMessage` + `window.close()` dance — so the tests verify
// the wire shape (status, Content-Type, key script lines, CSP
// header) rather than the runtime behaviour. The
// runtime-behaviour leg is covered manually via the preview
// server.

import { describe, expect, it } from "vitest";
import app from "./index.js";
import { makeMockEnv } from "./test-helpers.js";

describe("GET /api/auth/success", () => {
  it("returns a 200 HTML page", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/success", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/text\/html/);
  });

  it("never caches the page", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/success", {}, env);
    expect(res.headers.get("Cache-Control")).toMatch(/no-store/);
  });

  it("ships a tight Content-Security-Policy", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/success", {}, env);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).toMatch(/script-src 'unsafe-inline'/);
    // No external connects — the page is fully self-contained.
    expect(csp).toMatch(/connect-src 'none'/);
  });

  it("includes the postMessage + window.close() calls", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/success", {}, env);
    const html = await res.text();
    // The actual close-script logic is verified by inspecting
    // the served body — drift here would break the popup UX.
    expect(html).toMatch(/window\.opener.*postMessage/s);
    expect(html).toMatch(/annot-cloud-auth-complete/);
    expect(html).toMatch(/window\.location\.origin/);
    expect(html).toMatch(/window\.close\(\)/);
  });

  it("posts the message scoped to the page's own origin", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/success", {}, env);
    const html = await res.text();
    // The targetOrigin argument MUST be `window.location.origin`
    // (the page's own origin) and not `"*"`. The PWA's listener
    // also checks `event.origin`, but using `"*"` here would let
    // a malicious framing context observe the message — defence
    // in depth.
    expect(html).not.toMatch(/postMessage\([^,]+,\s*["']\*["']/);
  });

  it("renders fallback copy for users who land here without a popup opener", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/auth/success", {}, env);
    const html = await res.text();
    // window.close() is silently rejected when the window wasn't
    // script-opened — the fallback text covers that case.
    expect(html).toMatch(/close this window/i);
    expect(html).toMatch(/Return to Annot|href="\/"/);
  });
});
