/// <reference lib="dom" />
// @vitest-environment happy-dom
//
// `image-thumbnail.ts` wraps the createImageBitmap + OffscreenCanvas
// resize pipeline. happy-dom doesn't ship a working OffscreenCanvas
// implementation, so these tests exercise the FAILURE paths
// (graceful empty-string fallback) and the public surface
// (constants, contract). The successful happy-path is exercised
// end-to-end by the MSW-backed contract tests of GitHubStore /
// DeviceStore / GoogleDriveStore.

import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THUMBNAIL_WIDTH,
  generateThumbnailFromBlob,
  generateThumbnailFromDataUrl,
  THUMBNAIL_JPEG_QUALITY,
} from "./image-thumbnail.js";

describe("constants", () => {
  it("DEFAULT_THUMBNAIL_WIDTH matches the historical literal of 480", () => {
    expect(DEFAULT_THUMBNAIL_WIDTH).toBe(480);
  });

  it("THUMBNAIL_JPEG_QUALITY matches the historical literal of 0.85", () => {
    expect(THUMBNAIL_JPEG_QUALITY).toBe(0.85);
  });
});

describe("generateThumbnailFromBlob — error paths", () => {
  it("returns '' when createImageBitmap throws (e.g. unsupported blob)", async () => {
    // happy-dom has no real createImageBitmap implementation — calling
    // it on an arbitrary blob throws under default conditions, which is
    // exactly the failure mode the helper must swallow.
    const blob = new Blob([new Uint8Array([0, 1, 2, 3]) as BlobPart], {
      type: "application/octet-stream",
    });
    expect(await generateThumbnailFromBlob(blob)).toBe("");
  });

  it("does not throw — always resolves to a string", async () => {
    const out = await generateThumbnailFromBlob(new Blob([]));
    expect(typeof out).toBe("string");
  });
});

describe("generateThumbnailFromDataUrl — error paths", () => {
  it("returns '' when fetch rejects", async () => {
    // Stub global fetch to reject so we exercise the outer try/catch
    // path without depending on happy-dom's data-URL fetch behavior.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network"));
    try {
      const out = await generateThumbnailFromDataUrl("data:image/png;base64,AAAA");
      expect(out).toBe("");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("forwards through to generateThumbnailFromBlob, returning '' on resize failure", async () => {
    // Real fetch on a data URL returns a Blob, then the helper hits
    // the same createImageBitmap-throws path as the prior test.
    const out = await generateThumbnailFromDataUrl(
      "data:application/octet-stream;base64,AAECAw==",
    );
    expect(out).toBe("");
  });
});
