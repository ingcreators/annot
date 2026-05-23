// Tests for `embed/setup-callback.ts` — Phase 6 follow-up 5y-6.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../index.js";
import { makeMockD1Sqlite, makeMockEnv } from "../test-helpers.js";
import { findGitHubInstallationById } from "./github-app.js";
import { handleEmbedSetupCallback } from "./setup-callback.js";

interface ConversionMock {
  status?: number;
  body?: unknown;
  bodyText?: string;
}

/** Build a Hono app wired to invoke the callback with a stubbed
 *  `fetch` so the GitHub manifest-conversion API can be simulated. */
function buildApp(mock: ConversionMock) {
  const inner = new Hono<{ Bindings: Env }>();
  inner.get("/api/embed/setup/callback", (c) =>
    handleEmbedSetupCallback(c, (async (input: Request | URL | string) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.startsWith("https://api.github.com/app-manifests/")) {
        const status = mock.status ?? 200;
        const body = mock.bodyText !== undefined ? mock.bodyText : JSON.stringify(mock.body ?? {});
        return new Response(body, {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not-mocked", { status: 599 });
    }) as typeof fetch),
  );
  return inner;
}

describe("/api/embed/setup/callback", () => {
  it("renders an error page when ?code is missing", async () => {
    const env = makeMockEnv({ DB: makeMockD1Sqlite() });
    const inner = buildApp({});
    const res = await inner.request("https://annot.work/api/embed/setup/callback", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Missing manifest code");
  });

  it("surfaces a clean error when GitHub conversions returns 4xx", async () => {
    const env = makeMockEnv({ DB: makeMockD1Sqlite() });
    const inner = buildApp({ status: 404, bodyText: "Not Found" });
    const res = await inner.request(
      "https://annot.work/api/embed/setup/callback?code=abc",
      {},
      env,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("HTTP 404");
    expect(html).toContain("Not Found");
  });

  it("rejects responses missing required fields", async () => {
    const env = makeMockEnv({ DB: makeMockD1Sqlite() });
    const inner = buildApp({
      body: { id: 1, client_id: "cid" /* no pem / no webhook_secret */ },
    });
    const res = await inner.request(
      "https://annot.work/api/embed/setup/callback?code=abc",
      {},
      env,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("missing fields");
  });

  it("renders the wrangler-secret-put recipe on success", async () => {
    const env = makeMockEnv({ DB: makeMockD1Sqlite() });
    const inner = buildApp({
      body: {
        id: 999111,
        client_id: "Iv1.testclient",
        client_secret: "test-secret",
        webhook_secret: "test-wh-secret",
        pem: "-----BEGIN PRIVATE KEY-----\nMIIBOgIBAAJB\n-----END PRIVATE KEY-----\n",
        html_url: "https://github.com/apps/annot-cloud-editor",
      },
    });
    const res = await inner.request(
      "https://annot.work/api/embed/setup/callback?code=abc",
      {},
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("App registered");
    expect(html).toContain("wrangler secret put GITHUB_APP_ID");
    expect(html).toContain("999111");
    expect(html).toContain("Iv1.testclient");
    expect(html).toContain("test-wh-secret");
    expect(html).toContain("BEGIN PRIVATE KEY");
    expect(html).toContain("https://github.com/apps/annot-cloud-editor/installations/new");
  });

  it("upserts the installation row when ?installation_id is supplied", async () => {
    const db = makeMockD1Sqlite();
    const env = makeMockEnv({ DB: db });
    const inner = buildApp({
      body: {
        id: 999222,
        client_id: "Iv1.testclient",
        client_secret: "test-secret",
        webhook_secret: "test-wh-secret",
        pem: "-----BEGIN PRIVATE KEY-----\nMIIBOgIBAAJB\n-----END PRIVATE KEY-----\n",
        html_url: "https://github.com/apps/annot-cloud-editor",
        owner: { login: "octocat-org", type: "Organization" },
      },
    });
    const res = await inner.request(
      "https://annot.work/api/embed/setup/callback?code=abc&installation_id=42",
      {},
      env,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Installation <code>42</code>");
    const row = await findGitHubInstallationById(db, 42);
    expect(row?.account_login).toBe("octocat-org");
    expect(row?.account_type).toBe("Organization");
  });

  it("sets a restrictive Content-Security-Policy", async () => {
    const env = makeMockEnv({ DB: makeMockD1Sqlite() });
    const inner = buildApp({});
    const res = await inner.request("https://annot.work/api/embed/setup/callback", {}, env);
    const csp = res.headers.get("content-security-policy");
    expect(csp).toContain("default-src 'none'");
  });
});
