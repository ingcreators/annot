/**
 * Phase 5b of `docs/plans/living-spec-authoring-roadmap.md`.
 * URL-callback codec round-trip + edge-case coverage.
 */

import { describe, expect, it } from "vitest";
import {
  EmbedRequestUrlError,
  type EmbedReturnSignal,
  encodeEmbedRequestUrl,
  encodeEmbedReturnHash,
  MAX_EMBED_REQUEST_URL_BYTES,
  parseEmbedReturnHash,
} from "./url-callback.js";

describe("encodeEmbedRequestUrl", () => {
  it("builds a complete cloud-editor URL with default mode", () => {
    const url = encodeEmbedRequestUrl({
      cloudUrl: "https://annot.work",
      repo: "ingcreators/annot",
      pngPath: "docs/shots/login.png",
      annotationsPath: "docs/annotations/login.annotations.yaml",
      returnUrl: "https://docs.example.com/login",
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://annot.work");
    expect(parsed.pathname).toBe("/embed");
    expect(parsed.searchParams.get("repo")).toBe("ingcreators/annot");
    expect(parsed.searchParams.get("pngPath")).toBe("docs/shots/login.png");
    expect(parsed.searchParams.get("annotationsPath")).toBe(
      "docs/annotations/login.annotations.yaml",
    );
    expect(parsed.searchParams.get("return")).toBe("https://docs.example.com/login");
    expect(parsed.searchParams.get("mode")).toBe("newTab");
    expect(parsed.searchParams.get("v")).toBe("1");
  });

  it("respects the explicit mode prop", () => {
    const url = encodeEmbedRequestUrl({
      cloudUrl: "https://annot.work",
      repo: "ingcreators/annot",
      pngPath: "a.png",
      annotationsPath: "a.annotations.yaml",
      returnUrl: "https://docs.example.com/a",
      mode: "inline",
    });
    expect(new URL(url).searchParams.get("mode")).toBe("inline");
  });

  it("strips trailing slash on cloudUrl", () => {
    const a = encodeEmbedRequestUrl({
      cloudUrl: "https://annot.work/",
      repo: "owner/repo",
      pngPath: "a.png",
      annotationsPath: "a.annotations.yaml",
      returnUrl: "https://docs.example.com/a",
    });
    const b = encodeEmbedRequestUrl({
      cloudUrl: "https://annot.work",
      repo: "owner/repo",
      pngPath: "a.png",
      annotationsPath: "a.annotations.yaml",
      returnUrl: "https://docs.example.com/a",
    });
    expect(a).toBe(b);
  });

  it("survives on-prem cloudUrl with custom subpath", () => {
    const url = encodeEmbedRequestUrl({
      cloudUrl: "https://annot.internal.example.com",
      repo: "internal/docs",
      pngPath: "shots/payment-form.png",
      annotationsPath: "annotations/payment-form.annotations.yaml",
      returnUrl: "https://docs.internal.example.com/manual/payment",
    });
    expect(new URL(url).origin).toBe("https://annot.internal.example.com");
  });

  it("percent-encodes paths that contain special characters", () => {
    const url = encodeEmbedRequestUrl({
      cloudUrl: "https://annot.work",
      repo: "owner/repo",
      pngPath: "docs/screens/日本語.png",
      annotationsPath: "docs/annotations/日本語.annotations.yaml",
      returnUrl: "https://docs.example.com/path?q=test#existing",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("pngPath")).toBe("docs/screens/日本語.png");
    expect(parsed.searchParams.get("return")).toBe("https://docs.example.com/path?q=test#existing");
  });

  it("rejects missing required fields", () => {
    expect(() =>
      encodeEmbedRequestUrl({
        cloudUrl: "",
        repo: "owner/repo",
        pngPath: "a.png",
        annotationsPath: "a.annotations.yaml",
        returnUrl: "https://docs.example.com/a",
      }),
    ).toThrow(EmbedRequestUrlError);
    expect(() =>
      encodeEmbedRequestUrl({
        cloudUrl: "https://annot.work",
        repo: "",
        pngPath: "a.png",
        annotationsPath: "a.annotations.yaml",
        returnUrl: "https://docs.example.com/a",
      }),
    ).toThrow(EmbedRequestUrlError);
    expect(() =>
      encodeEmbedRequestUrl({
        cloudUrl: "https://annot.work",
        repo: "owner/repo",
        pngPath: "",
        annotationsPath: "a.annotations.yaml",
        returnUrl: "https://docs.example.com/a",
      }),
    ).toThrow(EmbedRequestUrlError);
    expect(() =>
      encodeEmbedRequestUrl({
        cloudUrl: "https://annot.work",
        repo: "owner/repo",
        pngPath: "a.png",
        annotationsPath: "",
        returnUrl: "https://docs.example.com/a",
      }),
    ).toThrow(EmbedRequestUrlError);
    expect(() =>
      encodeEmbedRequestUrl({
        cloudUrl: "https://annot.work",
        repo: "owner/repo",
        pngPath: "a.png",
        annotationsPath: "a.annotations.yaml",
        returnUrl: "",
      }),
    ).toThrow(EmbedRequestUrlError);
  });

  it("rejects a non-URL cloudUrl", () => {
    expect(() =>
      encodeEmbedRequestUrl({
        cloudUrl: "not-a-url",
        repo: "owner/repo",
        pngPath: "a.png",
        annotationsPath: "a.annotations.yaml",
        returnUrl: "https://docs.example.com/a",
      }),
    ).toThrow(EmbedRequestUrlError);
  });

  it("rejects a relative returnUrl", () => {
    expect(() =>
      encodeEmbedRequestUrl({
        cloudUrl: "https://annot.work",
        repo: "owner/repo",
        pngPath: "a.png",
        annotationsPath: "a.annotations.yaml",
        returnUrl: "/path/relative",
      }),
    ).toThrow(EmbedRequestUrlError);
  });

  it("throws when the encoded URL exceeds the 2 KB ceiling", () => {
    const longPath = "x".repeat(MAX_EMBED_REQUEST_URL_BYTES);
    expect(() =>
      encodeEmbedRequestUrl({
        cloudUrl: "https://annot.work",
        repo: "owner/repo",
        pngPath: longPath,
        annotationsPath: "a.annotations.yaml",
        returnUrl: "https://docs.example.com/a",
      }),
    ).toThrow(/exceeds/);
  });
});

describe("parseEmbedReturnHash", () => {
  it("parses an edit-complete hash with a leading `#`", () => {
    const signal = parseEmbedReturnHash("#edit-complete=abc123");
    expect(signal).toEqual({ kind: "complete", editId: "abc123" });
  });

  it("parses an edit-complete hash without a leading `#`", () => {
    const signal = parseEmbedReturnHash("edit-complete=abc123");
    expect(signal).toEqual({ kind: "complete", editId: "abc123" });
  });

  it("parses an edit-abandoned hash without a reason", () => {
    const signal = parseEmbedReturnHash("#edit-abandoned=1");
    expect(signal).toEqual({ kind: "abandoned" });
  });

  it("parses an edit-abandoned hash with a reason", () => {
    const signal = parseEmbedReturnHash("#edit-abandoned=1&reason=userCancelled");
    expect(signal).toEqual({ kind: "abandoned", reason: "userCancelled" });
  });

  it("returns null for an empty hash", () => {
    expect(parseEmbedReturnHash("")).toBeNull();
    expect(parseEmbedReturnHash("#")).toBeNull();
  });

  it("returns null when no embed-protocol key is present", () => {
    expect(parseEmbedReturnHash("#some-other-anchor")).toBeNull();
    expect(parseEmbedReturnHash("#foo=bar")).toBeNull();
  });

  it("returns null for an edit-complete with an empty value", () => {
    expect(parseEmbedReturnHash("#edit-complete=")).toBeNull();
  });

  it("returns null for an edit-abandoned with a value other than `1`", () => {
    // The signal is intentionally strict — only `1` is a valid
    // boolean-ish for the abandoned signal.
    expect(parseEmbedReturnHash("#edit-abandoned=0")).toBeNull();
    expect(parseEmbedReturnHash("#edit-abandoned=true")).toBeNull();
    expect(parseEmbedReturnHash("#edit-abandoned=")).toBeNull();
  });

  it("URL-decodes percent-encoded edit-complete IDs", () => {
    const signal = parseEmbedReturnHash("#edit-complete=abc%2F123");
    expect(signal).toEqual({ kind: "complete", editId: "abc/123" });
  });
});

describe("encodeEmbedReturnHash", () => {
  it("encodes an edit-complete signal", () => {
    const hash = encodeEmbedReturnHash({ kind: "complete", editId: "abc123" });
    expect(hash).toBe("#edit-complete=abc123");
  });

  it("encodes an edit-abandoned signal without a reason", () => {
    const hash = encodeEmbedReturnHash({ kind: "abandoned" });
    expect(hash).toBe("#edit-abandoned=1");
  });

  it("encodes an edit-abandoned signal with a reason", () => {
    const hash = encodeEmbedReturnHash({
      kind: "abandoned",
      reason: "userCancelled",
    });
    expect(hash).toBe("#edit-abandoned=1&reason=userCancelled");
  });

  it("percent-encodes editId characters that need it", () => {
    const hash = encodeEmbedReturnHash({ kind: "complete", editId: "abc/123" });
    expect(hash).toBe("#edit-complete=abc%2F123");
  });
});

describe("URL-callback round-trip", () => {
  it("parse(encode(signal)) is byte-equivalent for every signal", () => {
    const signals: EmbedReturnSignal[] = [
      { kind: "complete", editId: "abc123" },
      { kind: "complete", editId: "id-with-special/chars+stuff" },
      { kind: "abandoned" },
      { kind: "abandoned", reason: "userCancelled" },
      { kind: "abandoned", reason: "rateLimited" },
    ];
    for (const signal of signals) {
      const encoded = encodeEmbedReturnHash(signal);
      const parsed = parseEmbedReturnHash(encoded);
      expect(parsed).toEqual(signal);
    }
  });
});
