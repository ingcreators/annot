/// <reference lib="dom" />
// @vitest-environment happy-dom
//
// Tests for the encode strategy + the DI-driven `buildEditableImageBlob`.
// happy-dom gives us `Blob` / `fetch(data:)` / `FileReader`. The four
// heavy dependencies (renderImageRecord, encodeCaptureInWorker,
// loadEncodeOptions, createEditableImage) are stubbed so we can
// assert which branch was taken without standing up annot-render's
// canvas pipeline or the web worker.

import type { ImageRecord } from "@ingcreators/annot-core/storage";
import { describe, expect, it, vi } from "vitest";
import {
  ANNOTATIONS_SVG_MIN_CHARS,
  type BuildEditableImageDeps,
  buildEditableImageBlob,
  pickEncodeStrategy,
} from "./image-encode.js";

const SHORT_SVG = "<g/>"; // 4 chars, below the threshold
const LONG_SVG = '<g><rect width="10" height="10"/></g>'; // > 10 chars
const SOURCE_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

function record(partial: Partial<ImageRecord>): Partial<ImageRecord> {
  return partial;
}

// ─── pickEncodeStrategy ──────────────────────────────────────────────

describe("pickEncodeStrategy", () => {
  it("ANNOTATIONS_SVG_MIN_CHARS pinned at 10 (historical literal)", () => {
    expect(ANNOTATIONS_SVG_MIN_CHARS).toBe(10);
  });

  it("returns 'render-and-encode' when SVG present + format=png", () => {
    expect(
      pickEncodeStrategy(
        record({ annotationsSvg: LONG_SVG, originalDataUrl: SOURCE_DATA_URL }),
        "png",
      ),
    ).toBe("render-and-encode");
  });

  it("returns 'render-only' when SVG present + format=jpg", () => {
    expect(
      pickEncodeStrategy(
        record({ annotationsSvg: LONG_SVG, originalDataUrl: SOURCE_DATA_URL }),
        "jpg",
      ),
    ).toBe("render-only");
  });

  it("returns 'source-only' when no SVG but source URL present", () => {
    expect(pickEncodeStrategy(record({ originalDataUrl: SOURCE_DATA_URL }), "png")).toBe(
      "source-only",
    );
    // jpg behaves the same.
    expect(pickEncodeStrategy(record({ originalDataUrl: SOURCE_DATA_URL }), "jpg")).toBe(
      "source-only",
    );
  });

  it("returns 'empty' when neither SVG nor source URL", () => {
    expect(pickEncodeStrategy({}, "png")).toBe("empty");
    expect(pickEncodeStrategy({}, "jpg")).toBe("empty");
  });

  it("treats SVG strings of length ≤ ANNOTATIONS_SVG_MIN_CHARS as empty", () => {
    // 10 chars is the boundary — `<= 10` is "empty", `> 10` is "present".
    const tenChars = "x".repeat(10);
    const elevenChars = "x".repeat(11);
    expect(
      pickEncodeStrategy(
        record({ annotationsSvg: tenChars, originalDataUrl: SOURCE_DATA_URL }),
        "png",
      ),
    ).toBe("source-only");
    expect(
      pickEncodeStrategy(
        record({ annotationsSvg: elevenChars, originalDataUrl: SOURCE_DATA_URL }),
        "png",
      ),
    ).toBe("render-and-encode");
  });

  it("rejects the empty-string SVG (length 0 falls back to source-only)", () => {
    expect(
      pickEncodeStrategy(record({ annotationsSvg: "", originalDataUrl: SOURCE_DATA_URL }), "png"),
    ).toBe("source-only");
  });

  it("rejects '<g/>' (legacy 'no annotations' sentinel) as empty", () => {
    expect(
      pickEncodeStrategy(
        record({ annotationsSvg: SHORT_SVG, originalDataUrl: SOURCE_DATA_URL }),
        "png",
      ),
    ).toBe("source-only");
  });
});

// ─── buildEditableImageBlob — branch dispatch ────────────────────────

function makeDeps(): BuildEditableImageDeps & {
  __renderSpy: ReturnType<typeof vi.fn>;
  __encodeSpy: ReturnType<typeof vi.fn>;
  __optsSpy: ReturnType<typeof vi.fn>;
  __wrapSpy: ReturnType<typeof vi.fn>;
} {
  const renderSpy = vi.fn(
    async (_dataUrl: string, _svg: string, _w: number, _h: number) =>
      "data:image/png;base64,RkFLRVJFTkRFUkVE",
  );
  const encodeSpy = vi.fn(async (_dataUrl: string, _opts: unknown) => ({
    dataUrl: "data:image/png;base64,RkFLRUVOQ09ERUQ=",
  }));
  const optsSpy = vi.fn(() => ({ format: "smart" }) as unknown);
  const wrapSpy = vi.fn(async (_opts: unknown) => new Blob(["wrapped"], { type: "image/png" }));
  return {
    renderImageRecord: renderSpy as BuildEditableImageDeps["renderImageRecord"],
    // The encode worker returns a richer `EncodeResult` shape in
    // production; tests only need its `dataUrl` field, hence the
    // double `unknown` cast to satisfy TS without re-declaring
    // every field of `EncodeResult` we don't read.
    encodeCaptureInWorker: encodeSpy as unknown as BuildEditableImageDeps["encodeCaptureInWorker"],
    loadEncodeOptions: optsSpy as unknown as BuildEditableImageDeps["loadEncodeOptions"],
    createEditableImage: wrapSpy as BuildEditableImageDeps["createEditableImage"],
    __renderSpy: renderSpy,
    __encodeSpy: encodeSpy,
    __optsSpy: optsSpy,
    __wrapSpy: wrapSpy,
  };
}

describe("buildEditableImageBlob — render-and-encode branch", () => {
  it("calls renderImageRecord then encodeCaptureInWorker for SVG + PNG", async () => {
    const deps = makeDeps();
    await buildEditableImageBlob(
      record({
        annotationsSvg: LONG_SVG,
        originalDataUrl: SOURCE_DATA_URL,
        width: 200,
        height: 100,
        tags: { author: "alice" },
      }),
      "png",
      deps,
    );

    expect(deps.__renderSpy).toHaveBeenCalledTimes(1);
    expect(deps.__renderSpy).toHaveBeenCalledWith(SOURCE_DATA_URL, LONG_SVG, 200, 100);
    expect(deps.__optsSpy).toHaveBeenCalledTimes(1);
    expect(deps.__encodeSpy).toHaveBeenCalledTimes(1);
    expect(deps.__wrapSpy).toHaveBeenCalledTimes(1);
    // The wrap step receives the encoded blob + the original metadata.
    const wrapArg = deps.__wrapSpy.mock.calls[0]![0] as { format: string; tags: unknown };
    expect(wrapArg.format).toBe("png");
    expect(wrapArg.tags).toEqual({ author: "alice" });
  });

  it("falls back to the un-re-encoded rendered output when worker throws", async () => {
    const deps = makeDeps();
    deps.__encodeSpy.mockRejectedValueOnce(new Error("worker boom"));
    const out = await buildEditableImageBlob(
      record({ annotationsSvg: LONG_SVG, originalDataUrl: SOURCE_DATA_URL }),
      "png",
      deps,
    );
    // Wrap was still called — the function does not throw on worker
    // failure, it just keeps the un-re-encoded rendered bytes.
    expect(deps.__wrapSpy).toHaveBeenCalledTimes(1);
    expect(out).toBeInstanceOf(Blob);
  });
});

describe("buildEditableImageBlob — render-only branch", () => {
  it("calls renderImageRecord but NOT encodeCaptureInWorker for SVG + JPG", async () => {
    const deps = makeDeps();
    await buildEditableImageBlob(
      record({ annotationsSvg: LONG_SVG, originalDataUrl: SOURCE_DATA_URL }),
      "jpg",
      deps,
    );
    expect(deps.__renderSpy).toHaveBeenCalledTimes(1);
    // The PNG-only re-encode dance is skipped for JPEG (already small).
    expect(deps.__encodeSpy).not.toHaveBeenCalled();
    expect(deps.__optsSpy).not.toHaveBeenCalled();
    expect(deps.__wrapSpy).toHaveBeenCalledTimes(1);
    const wrapArg = deps.__wrapSpy.mock.calls[0]![0] as { format: string };
    expect(wrapArg.format).toBe("jpg");
  });
});

describe("buildEditableImageBlob — source-only branch", () => {
  it("skips render and encode, fetches the source URL directly", async () => {
    const deps = makeDeps();
    await buildEditableImageBlob(record({ originalDataUrl: SOURCE_DATA_URL }), "png", deps);
    expect(deps.__renderSpy).not.toHaveBeenCalled();
    expect(deps.__encodeSpy).not.toHaveBeenCalled();
    expect(deps.__wrapSpy).toHaveBeenCalledTimes(1);
  });

  it("treats short SVG as 'source-only' even when format=png", async () => {
    const deps = makeDeps();
    await buildEditableImageBlob(
      record({ annotationsSvg: SHORT_SVG, originalDataUrl: SOURCE_DATA_URL }),
      "png",
      deps,
    );
    expect(deps.__renderSpy).not.toHaveBeenCalled();
  });
});

describe("buildEditableImageBlob — empty branch", () => {
  it("wraps an empty Blob when neither SVG nor source URL", async () => {
    const deps = makeDeps();
    await buildEditableImageBlob({}, "png", deps);
    expect(deps.__renderSpy).not.toHaveBeenCalled();
    expect(deps.__encodeSpy).not.toHaveBeenCalled();
    expect(deps.__wrapSpy).toHaveBeenCalledTimes(1);
    const wrapArg = deps.__wrapSpy.mock.calls[0]![0] as { renderedBlob: Blob };
    expect(wrapArg.renderedBlob.size).toBe(0);
  });
});

describe("buildEditableImageBlob — wrap call shape", () => {
  it("forwards every metadata field with documented defaults", async () => {
    const deps = makeDeps();
    await buildEditableImageBlob({}, "jpg", deps);
    const arg = deps.__wrapSpy.mock.calls[0]![0] as {
      originalDataUrl: string;
      annotationsSvg: string;
      width: number;
      height: number;
      tags: Record<string, string>;
      format: "jpg" | "png";
    };
    // Defaults: empty strings + 0 dims + empty tags + supplied format.
    expect(arg.originalDataUrl).toBe("");
    expect(arg.annotationsSvg).toBe("");
    expect(arg.width).toBe(0);
    expect(arg.height).toBe(0);
    expect(arg.tags).toEqual({});
    expect(arg.format).toBe("jpg");
  });

  it("returns the Blob produced by createEditableImage", async () => {
    const deps = makeDeps();
    const sentinel = new Blob(["x"], { type: "image/png" });
    deps.__wrapSpy.mockResolvedValueOnce(sentinel);
    const out = await buildEditableImageBlob({}, "png", deps);
    expect(out).toBe(sentinel);
  });
});
