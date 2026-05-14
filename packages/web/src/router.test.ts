/**
 * @vitest-environment happy-dom
 *
 * `parseRoute` / `editUrl` / `docUrl` tests — covers the
 * `/edit/img/<store>/<path>` + `/edit/doc/<store>/<path>` shape
 * introduced when resource types were grouped under a single
 * `/edit/` namespace. Legacy `/edit/<store>/<path>` and
 * `/doc/<store>/<path>` URLs 404 to gallery — asserted explicitly
 * so the policy doesn't regress.
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

describe("parseRoute: /edit/img/... routes", () => {
  it("/edit/img/<store>/<path> → { type: 'edit', store, path }", () => {
    setHref("/edit/img/browser/Inbox/foo.annot.png");
    const r = parseRoute();
    expect(r.type).toBe("edit");
    expect(r.store).toBe("browser");
    expect(r.path).toBe("Inbox/foo.annot.png");
  });

  it("decodes percent-encoded segments + preserves '/' boundaries", () => {
    setHref("/edit/img/browser/Inbox/%E6%97%A5%E6%9C%AC%E8%AA%9E.png");
    const r = parseRoute();
    expect(r.path).toBe("Inbox/日本語.png");
  });

  it("/edit/img/<store> with no path → empty path (bulk-editor entry)", () => {
    setHref("/edit/img/browser");
    const r = parseRoute();
    // `/edit/img/<store>` with no path is the bulk-editor entry —
    // typically paired with `?session=<id>` to filter the session.
    expect(r.type).toBe("edit");
    expect(r.store).toBe("browser");
    expect(r.path).toBe("");
  });

  it("captures extId on img routes", () => {
    setHref("/edit/img/extension/foo.png?extId=abc");
    const r = parseRoute();
    expect(r.type).toBe("edit");
    expect(r.extId).toBe("abc");
  });

  it("captures session on img routes", () => {
    setHref("/edit/img/browser/foo.png?session=sess-1");
    const r = parseRoute();
    expect(r.type).toBe("edit");
    expect(r.session).toBe("sess-1");
  });
});

describe("parseRoute: /edit/doc/... routes", () => {
  it("/edit/doc/<store>/<path> → { type: 'doc', store, path }", () => {
    setHref("/edit/doc/browser/Manuals/onboarding.annot.html");
    const r = parseRoute();
    expect(r.type).toBe("doc");
    expect(r.store).toBe("browser");
    expect(r.path).toBe("Manuals/onboarding.annot.html");
  });

  it("decodes percent-encoded segments + preserves '/' boundaries", () => {
    setHref("/edit/doc/browser/Manuals/%E6%97%A5%E6%9C%AC%E8%AA%9E.annot.html");
    const r = parseRoute();
    expect(r.path).toBe("Manuals/日本語.annot.html");
  });

  it("/edit/doc/<store> with no path → empty path", () => {
    setHref("/edit/doc/browser");
    const r = parseRoute();
    // Matches the old `/doc/<store>` contract — parser returns the
    // doc shape; the router-host gates the actual dispatch on
    // `route.path` being non-empty.
    expect(r.type).toBe("doc");
    expect(r.path).toBe("");
  });

  it("captures extId on doc routes", () => {
    setHref("/edit/doc/browser/Manuals/x.annot.html?extId=abc");
    const r = parseRoute();
    expect(r.type).toBe("doc");
    expect(r.extId).toBe("abc");
  });
});

describe("parseRoute: legacy URLs fall through to gallery", () => {
  it("legacy /edit/<store>/<path> (no img/doc segment) → gallery", () => {
    setHref("/edit/browser/Inbox/foo.png");
    const r = parseRoute();
    expect(r.type).toBe("gallery");
  });

  it("legacy /doc/<store>/<path> (top-level) → gallery", () => {
    setHref("/doc/browser/Manuals/x.annot.html");
    const r = parseRoute();
    expect(r.type).toBe("gallery");
  });

  it("/edit/foo/... with unknown resource segment → gallery", () => {
    setHref("/edit/video/browser/x.mp4");
    const r = parseRoute();
    expect(r.type).toBe("gallery");
  });
});

describe("editUrl builder", () => {
  it("produces /edit/img/<store>/<encoded path>", () => {
    expect(editUrl("browser", "Inbox/foo.annot.png")).toBe("/edit/img/browser/Inbox/foo.annot.png");
  });

  it("encodes per-segment + preserves /", () => {
    expect(editUrl("browser", "Inbox/日本語.png")).toBe(
      "/edit/img/browser/Inbox/%E6%97%A5%E6%9C%AC%E8%AA%9E.png",
    );
  });

  it("appends ?extId when provided", () => {
    expect(editUrl("extension", "foo.png", "abc")).toBe("/edit/img/extension/foo.png?extId=abc");
  });

  it("empty path yields /edit/img/<store>", () => {
    expect(editUrl("browser", "")).toBe("/edit/img/browser");
  });

  it("editUrl + parseRoute round-trip", () => {
    const url = editUrl("browser", "Inbox/Section A/file.png");
    setHref(url);
    const r = parseRoute();
    expect(r.type).toBe("edit");
    expect(r.store).toBe("browser");
    expect(r.path).toBe("Inbox/Section A/file.png");
  });
});

describe("docUrl builder", () => {
  it("produces /edit/doc/<store>/<encoded path>", () => {
    expect(docUrl("browser", "Manuals/onboarding.annot.html")).toBe(
      "/edit/doc/browser/Manuals/onboarding.annot.html",
    );
  });

  it("encodes per-segment + preserves /", () => {
    expect(docUrl("browser", "Manuals/日本語.annot.html")).toBe(
      "/edit/doc/browser/Manuals/%E6%97%A5%E6%9C%AC%E8%AA%9E.annot.html",
    );
  });

  it("appends ?extId when provided", () => {
    expect(docUrl("extension", "x.annot.html", "abc")).toBe(
      "/edit/doc/extension/x.annot.html?extId=abc",
    );
  });

  it("empty path yields /edit/doc/<store>", () => {
    expect(docUrl("browser", "")).toBe("/edit/doc/browser");
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
