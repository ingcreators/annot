// Tests for `embed/page.ts` — Phase 6 follow-up 5y-3.

import { describe, expect, it } from "vitest";
import app from "../index.js";
import { makeMockEnv } from "../test-helpers.js";
import { renderEmbedPage } from "./page.js";

describe("renderEmbedPage", () => {
  it("renders the shell mount + bundle script tag", () => {
    const html = renderEmbedPage({
      secretsBound: true,
      bundleUrl: "/embed/shell.js",
      requestUrl:
        "https://annot.work/embed?repo=foo%2Fbar&pngPath=a.png&annotationsPath=a.yaml&return=https%3A%2F%2Fdocs%2Eexample%2Ecom%2Fp",
    });
    expect(html).toContain("<annot-embed-shell");
    expect(html).toContain('id="embed-mount"');
    expect(html).toContain("data-embed-params=");
    expect(html).toContain('src="/embed/shell.js"');
  });

  it("escapes the params JSON inside the attribute", () => {
    const html = renderEmbedPage({
      secretsBound: true,
      bundleUrl: "/embed/shell.js",
      requestUrl:
        "https://annot.work/embed?repo=foo%2Fbar&pngPath=a%3C.png&annotationsPath=a.yaml&return=https%3A%2F%2Fdocs%2Eexample%2Ecom%2Fp",
    });
    // The literal `<` from the decoded pngPath becomes `&lt;`
    expect(html).toContain("a&lt;.png");
    expect(html).not.toMatch(/data-embed-params='[^']*</);
  });

  it("renders the missing-config notice when secrets aren't bound", () => {
    const html = renderEmbedPage({
      secretsBound: false,
      bundleUrl: "/embed/shell.js",
      requestUrl: "https://annot.work/embed",
    });
    expect(html).toContain("isn't fully configured");
    expect(html).toContain("/api/embed/setup");
  });

  it("hides the notice when secrets are bound", () => {
    const html = renderEmbedPage({
      secretsBound: true,
      bundleUrl: "/embed/shell.js",
      requestUrl: "https://annot.work/embed",
    });
    expect(html).not.toContain("isn't fully configured");
  });
});

describe("/embed route", () => {
  it("serves HTML with CSP allowing inline-mode iframing", async () => {
    const env = makeMockEnv();
    const res = await app.request(
      "https://annot.work/embed?repo=a%2Fb&pngPath=p&annotationsPath=p&return=https%3A%2F%2Fdocs.example.com%2Fx",
      {},
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const csp = res.headers.get("content-security-policy");
    expect(csp).toContain("frame-ancestors *");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("script-src 'self'");
  });

  it("honours EMBED_SHELL_BUNDLE_URL override", async () => {
    const env = makeMockEnv({
      EMBED_SHELL_BUNDLE_URL: "https://cdn.example.com/annot/embed-shell.js",
    });
    const res = await app.request("https://annot.work/embed", {}, env);
    const html = await res.text();
    expect(html).toContain('src="https://cdn.example.com/annot/embed-shell.js"');
  });

  it("falls back to the relative /embed/shell.js path", async () => {
    const env = makeMockEnv();
    const res = await app.request("https://annot.work/embed", {}, env);
    const html = await res.text();
    expect(html).toContain('src="/embed/shell.js"');
  });
});
