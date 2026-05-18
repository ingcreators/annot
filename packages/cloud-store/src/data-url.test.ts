import { describe, expect, it } from "vitest";
import { bytesToDataUrl, dataUrlToBytes } from "./data-url.js";

describe("dataUrlToBytes / bytesToDataUrl", () => {
  it("round-trips PNG bytes through base64", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    const url = bytesToDataUrl(png, "image/png");
    const { bytes, mimeType } = dataUrlToBytes(url);
    expect(mimeType).toBe("image/png");
    expect(bytes).toEqual(png);
  });

  it("handles SVG sourced as a base64 data URL", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const url = bytesToDataUrl(new TextEncoder().encode(svg), "image/svg+xml");
    const { bytes, mimeType } = dataUrlToBytes(url);
    expect(mimeType).toBe("image/svg+xml");
    expect(new TextDecoder().decode(bytes)).toBe(svg);
  });

  it("handles URL-encoded (non-base64) data URLs", () => {
    const url = "data:image/svg+xml,%3Csvg%2F%3E";
    const { bytes, mimeType } = dataUrlToBytes(url);
    expect(mimeType).toBe("image/svg+xml");
    expect(new TextDecoder().decode(bytes)).toBe("<svg/>");
  });

  it("throws on malformed input", () => {
    expect(() => dataUrlToBytes("not a data url")).toThrow();
  });

  it("doesn't blow the stack on large byte arrays", () => {
    // 100 KB array — historically tripped fromCharCode(...) callers.
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
    const url = bytesToDataUrl(bytes, "application/octet-stream");
    const round = dataUrlToBytes(url);
    expect(round.bytes).toEqual(bytes);
  });
});
