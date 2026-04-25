// Pure-Node tests for the public surface of service-worker-helpers.
// Constants are imported and pinned (any change is a deliberate
// behaviour change that should be reviewed). The URL helpers cover
// the empty / malformed / multi-component cases.

import { describe, expect, it } from "vitest";
import {
  ANNOTATION_URL,
  buildEditUrl,
  CLICK_CAPTURE_MAX_FRAMES,
  CLICK_CAPTURE_MIN_INTERVAL_MS,
  HOTKEY_CAPTURE_MIN_INTERVAL_MS,
  IDB_MAX_AGE_MS,
  isCapturableUrl,
  MAX_CANVAS_DIMENSION,
  POST_HIDE_PAINT_MS,
  urlTags,
} from "./service-worker-helpers.js";

describe("constants", () => {
  it("exposes a max canvas dimension matching the legacy hard cap", () => {
    expect(MAX_CANVAS_DIMENSION).toBe(32767);
  });

  it("retains images for 7 days (IDB_MAX_AGE_MS)", () => {
    expect(IDB_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("exposes paint / debounce timing constants as positive integers", () => {
    expect(POST_HIDE_PAINT_MS).toBeGreaterThan(0);
    expect(CLICK_CAPTURE_MIN_INTERVAL_MS).toBeGreaterThan(0);
    expect(HOTKEY_CAPTURE_MIN_INTERVAL_MS).toBeGreaterThan(0);
    expect(CLICK_CAPTURE_MAX_FRAMES).toBeGreaterThan(0);
  });

  it("ANNOTATION_URL points at a valid http(s) origin", () => {
    expect(() => new URL(ANNOTATION_URL)).not.toThrow();
    expect(/^https?:/.test(ANNOTATION_URL)).toBe(true);
  });
});

describe("isCapturableUrl", () => {
  it("returns true for http(s) URLs", () => {
    expect(isCapturableUrl("http://example.com/")).toBe(true);
    expect(isCapturableUrl("https://example.com/")).toBe(true);
  });

  it("returns true for file:// and ftp:// URLs", () => {
    expect(isCapturableUrl("file:///tmp/x.html")).toBe(true);
    expect(isCapturableUrl("ftp://ftp.example.com/")).toBe(true);
  });

  it("returns false for chrome:// / about: / extension URLs", () => {
    expect(isCapturableUrl("chrome://newtab/")).toBe(false);
    expect(isCapturableUrl("chrome-extension://abc/index.html")).toBe(false);
    expect(isCapturableUrl("about:blank")).toBe(false);
  });

  it("returns false for empty / undefined inputs", () => {
    expect(isCapturableUrl(undefined)).toBe(false);
    expect(isCapturableUrl("")).toBe(false);
  });
});

describe("urlTags", () => {
  it("returns an empty object for missing / unparseable input", () => {
    expect(urlTags(undefined)).toEqual({});
    expect(urlTags(null)).toEqual({});
    expect(urlTags("not a url")).toEqual({});
  });

  it("extracts only the host for a bare-host URL", () => {
    expect(urlTags("https://example.com/")).toEqual({ host: "example.com" });
  });

  it("extracts host + path when path is non-trivial", () => {
    expect(urlTags("https://example.com/blog/post")).toEqual({
      host: "example.com",
      path: "/blog/post",
    });
  });

  it("extracts query without the leading '?'", () => {
    expect(urlTags("https://example.com/?q=hello&p=1")).toEqual({
      host: "example.com",
      query: "q=hello&p=1",
    });
  });

  it("extracts fragment without the leading '#'", () => {
    expect(urlTags("https://example.com/#section")).toEqual({
      host: "example.com",
      fragment: "section",
    });
  });

  it("returns all four components for a fully-loaded URL", () => {
    const tags = urlTags("https://docs.example.com/path/to/page?ref=foo#anchor");
    expect(tags).toEqual({
      host: "docs.example.com",
      path: "/path/to/page",
      query: "ref=foo",
      fragment: "anchor",
    });
  });
});

describe("buildEditUrl", () => {
  it("URL-encodes each path segment so slashes survive but reserved chars don't", () => {
    const url = buildEditUrl("folder/sub/file with space.png", "ext-id");
    // Each segment is encoded separately; "/" between them is preserved.
    expect(url).toContain("/edit/extension/folder/sub/file%20with%20space.png");
  });

  it("URL-encodes the extension id", () => {
    const url = buildEditUrl("a.png", "ext id with space");
    expect(url).toContain("extId=ext%20id%20with%20space");
  });

  it("includes the configured ANNOTATION_URL prefix", () => {
    const url = buildEditUrl("a.png", "x");
    expect(url.startsWith(ANNOTATION_URL)).toBe(true);
  });
});
