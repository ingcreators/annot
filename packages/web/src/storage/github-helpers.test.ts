/**
 * @vitest-environment happy-dom
 *
 * Pure-helper tests for `github-helpers.ts`. These cover the
 * response-parsing slice of the GitHub HTTP layer in isolation, so
 * regressions surface as 1-line failures instead of mysterious
 * contract-test diffs. happy-dom gives us `Headers`, which is the
 * only DOM-ish dependency these helpers need.
 */

import { describe, expect, it } from "vitest";
import {
  isImageFilename,
  parseGitHubErrorBody,
  parseRateLimitHeaders,
  shouldFireRateLimitWarning,
} from "./github-helpers.js";

describe("isImageFilename", () => {
  it("recognises supported extensions", () => {
    expect(isImageFilename("foo.png")).toBe(true);
    expect(isImageFilename("foo.PNG")).toBe(true);
    expect(isImageFilename("foo.jpg")).toBe(true);
    expect(isImageFilename("foo.jpeg")).toBe(true);
    expect(isImageFilename("foo.svg")).toBe(true);
  });

  it("matches the .annot.* compound extensions via the bare suffix check", () => {
    expect(isImageFilename("screenshot.annot.png")).toBe(true);
    expect(isImageFilename("page.annot.svg")).toBe(true);
  });

  it("rejects unrelated files commonly found in repos", () => {
    expect(isImageFilename("README.md")).toBe(false);
    expect(isImageFilename("index.ts")).toBe(false);
    expect(isImageFilename("foo")).toBe(false);
    expect(isImageFilename("")).toBe(false);
  });
});

describe("parseRateLimitHeaders", () => {
  it("returns nulls when headers are absent", () => {
    expect(parseRateLimitHeaders(new Headers())).toEqual({ remaining: null, resetAt: null });
  });

  it("parses remaining as an integer", () => {
    const h = new Headers({ "X-RateLimit-Remaining": "4923" });
    expect(parseRateLimitHeaders(h).remaining).toBe(4923);
  });

  it("converts reset epoch-seconds to epoch-milliseconds", () => {
    const h = new Headers({ "X-RateLimit-Reset": "1700000000" });
    expect(parseRateLimitHeaders(h).resetAt).toBe(1_700_000_000_000);
  });

  it("returns null for unparseable values", () => {
    const h = new Headers({ "X-RateLimit-Remaining": "not-a-number" });
    expect(parseRateLimitHeaders(h).remaining).toBeNull();
  });

  it("populates both fields when both headers are present", () => {
    const h = new Headers({
      "X-RateLimit-Remaining": "100",
      "X-RateLimit-Reset": "1700000000",
    });
    expect(parseRateLimitHeaders(h)).toEqual({
      remaining: 100,
      resetAt: 1_700_000_000_000,
    });
  });
});

describe("shouldFireRateLimitWarning", () => {
  it("does not fire when remaining is null", () => {
    expect(
      shouldFireRateLimitWarning({
        remaining: null,
        resetAt: 1_700_000_000_000,
        threshold: 100,
        lastWarnedFor: null,
      }),
    ).toEqual({ fire: false, nextWarnedFor: null });
  });

  it("does not fire when remaining is above the threshold", () => {
    expect(
      shouldFireRateLimitWarning({
        remaining: 500,
        resetAt: 1_700_000_000_000,
        threshold: 100,
        lastWarnedFor: null,
      }),
    ).toEqual({ fire: false, nextWarnedFor: null });
  });

  it("fires when remaining drops to the threshold for the first time in a window", () => {
    expect(
      shouldFireRateLimitWarning({
        remaining: 50,
        resetAt: 1_700_000_000_000,
        threshold: 100,
        lastWarnedFor: null,
      }),
    ).toEqual({ fire: true, nextWarnedFor: 1_700_000_000_000 });
  });

  it("does not re-fire within the same reset window", () => {
    expect(
      shouldFireRateLimitWarning({
        remaining: 30,
        resetAt: 1_700_000_000_000,
        threshold: 100,
        lastWarnedFor: 1_700_000_000_000,
      }),
    ).toEqual({ fire: false, nextWarnedFor: 1_700_000_000_000 });
  });

  it("re-fires once a new reset window starts", () => {
    expect(
      shouldFireRateLimitWarning({
        remaining: 30,
        resetAt: 1_700_003_600_000,
        threshold: 100,
        lastWarnedFor: 1_700_000_000_000,
      }),
    ).toEqual({ fire: true, nextWarnedFor: 1_700_003_600_000 });
  });

  it("treats remaining === threshold as 'fire'", () => {
    // The existing code uses `<=`, so the boundary is inclusive.
    expect(
      shouldFireRateLimitWarning({
        remaining: 100,
        resetAt: 1_700_000_000_000,
        threshold: 100,
        lastWarnedFor: null,
      }).fire,
    ).toBe(true);
  });
});

describe("parseGitHubErrorBody", () => {
  it("uses the JSON `message` field when present", () => {
    expect(parseGitHubErrorBody(404, JSON.stringify({ message: "Not Found" }))).toEqual({
      detail: "Not Found",
    });
  });

  it("falls back to the raw text (truncated to 300 chars) for non-JSON bodies", () => {
    const raw = "x".repeat(500);
    const out = parseGitHubErrorBody(500, raw);
    expect(out.detail).toBe("x".repeat(300));
  });

  it("flags 409 as a conflict", () => {
    expect(parseGitHubErrorBody(409, JSON.stringify({ message: "Conflict" }))).toEqual({
      detail: "Conflict",
      conflict: true,
    });
  });

  it("flags 422 with 'sha' in the message as a conflict (stale-SHA case)", () => {
    expect(
      parseGitHubErrorBody(
        422,
        JSON.stringify({ message: "is at fffff but expected aaaaa (sha mismatch)" }),
      ),
    ).toMatchObject({ conflict: true });
  });

  it("does NOT flag plain 422s without 'sha' in the message", () => {
    expect(parseGitHubErrorBody(422, JSON.stringify({ message: "Validation failed" }))).toEqual({
      detail: "Validation failed",
    });
  });

  it("handles malformed JSON without throwing", () => {
    const out = parseGitHubErrorBody(500, "<html><body>Bad Gateway</body></html>");
    expect(out.detail).toContain("<html>");
  });

  it("handles empty bodies", () => {
    expect(parseGitHubErrorBody(503, "")).toEqual({ detail: "" });
  });
});
