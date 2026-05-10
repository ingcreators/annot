/**
 * @vitest-environment happy-dom
 *
 * `parseRoute` / `editUrl` / `docUrl` tests — focused on the
 * `/doc/<store>/<path>` shape introduced by Phase 6b of
 * `docs/plans/annot-html-document.md`. Other route shapes
 * (`/edit/...`, `/folder/...`, `/handoff/...`) are exercised
 * through end-to-end navigation in `web` and aren't re-tested
 * here.
 */

import { afterEach, describe, expect, it } from "vitest";
import { docUrl, editUrl, parseRoute } from "./router.js";

function setHref(href: string): void {
  // happy-dom's location.href is a writable property in current
  // versions; assign and then read back via parseRoute.
  window.history.replaceState({}, "", href);
}

afterEach(() => {
  setHref("/");
});

describe("parseRoute: doc routes", () => {
  it("/doc/<store>/<path> → { type: 'doc', store, path }", () => {
    setHref("/doc/browser/Manuals/onboarding.annot.html");
    const r = parseRoute();
    expect(r.type).toBe("doc");
    expect(r.store).toBe("browser");
    expect(r.path).toBe("Manuals/onboarding.annot.html");
  });

  it("decodes percent-encoded segments + preserves '/' boundaries", () => {
    setHref("/doc/browser/Manuals/%E6%97%A5%E6%9C%AC%E8%AA%9E.annot.html");
    const r = parseRoute();
    expect(r.path).toBe("Manuals/日本語.annot.html");
  });

  it("/doc/<store> with no path → empty path", () => {
    setHref("/doc/browser");
    const r = parseRoute();
    expect(r.type).toBe("doc");
    expect(r.path).toBe("");
  });

  it("/doc with no store falls through to gallery", () => {
    setHref("/doc");
    const r = parseRoute();
    expect(r.type).toBe("gallery");
  });

  it("captures extId on doc routes", () => {
    setHref("/doc/browser/Manuals/x.annot.html?extId=abc");
    const r = parseRoute();
    expect(r.type).toBe("doc");
    expect(r.extId).toBe("abc");
  });
});

describe("docUrl builder", () => {
  it("produces /doc/<store>/<encoded path>", () => {
    expect(docUrl("browser", "Manuals/onboarding.annot.html")).toBe(
      "/doc/browser/Manuals/onboarding.annot.html",
    );
  });

  it("encodes per-segment + preserves /", () => {
    expect(docUrl("browser", "Manuals/日本語.annot.html")).toBe(
      "/doc/browser/Manuals/%E6%97%A5%E6%9C%AC%E8%AA%9E.annot.html",
    );
  });

  it("appends ?extId when provided", () => {
    expect(docUrl("extension", "x.annot.html", "abc")).toBe(
      "/doc/extension/x.annot.html?extId=abc",
    );
  });

  it("empty path yields /doc/<store>", () => {
    expect(docUrl("browser", "")).toBe("/doc/browser");
  });

  it("docUrl + parseRoute round-trip", () => {
    const url = docUrl("browser", "Manuals/Section A/file.annot.html");
    setHref(url);
    const r = parseRoute();
    expect(r.type).toBe("doc");
    expect(r.store).toBe("browser");
    expect(r.path).toBe("Manuals/Section A/file.annot.html");
  });
});

describe("editUrl is unchanged by Phase 6b", () => {
  it("still produces /edit/<store>/<path>", () => {
    expect(editUrl("browser", "Inbox/foo.annot.png")).toBe("/edit/browser/Inbox/foo.annot.png");
  });
});
