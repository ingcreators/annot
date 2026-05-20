import type { Annotator } from "@ingcreators/annot-annotator";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, test, vi } from "vitest";

import { handleCompareScreenshots } from "./compare-screenshots.js";

function paintedPng(
  width: number,
  height: number,
  paint: (ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>) => void,
): { dataUrl: string; bytes: Uint8Array } {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  paint(ctx);
  const buf = canvas.toBuffer("image/png");
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
  return { dataUrl, bytes };
}

function stubAnnotator(): { annotator: Annotator; toPng: ReturnType<typeof vi.fn> } {
  const stub = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  const toPng = vi.fn(() => stub);
  const toEncoded = vi.fn(async () => ({
    bytes: stub,
    chosen: "png" as const,
    width: 0,
    height: 0,
  }));
  return {
    annotator: { toPng, toSvg: vi.fn(() => "<svg/>"), toEncoded },
    toPng,
  };
}

describe("handleCompareScreenshots", () => {
  test("identical inputs → empty annotation list", async () => {
    const before = paintedPng(100, 100, () => {});
    const after = paintedPng(100, 100, () => {});
    const { annotator, toPng } = stubAnnotator();
    const result = await handleCompareScreenshots(
      { before: before.dataUrl, after: after.dataUrl },
      { annotator },
    );
    expect(result.isError).toBeFalsy();
    expect(toPng).toHaveBeenCalledTimes(1);
    const annotationsSvg = toPng.mock.calls[0]?.[0]?.annotationsSvg;
    expect(annotationsSvg).toBe("");
  });

  test("different region produces a warning rect", async () => {
    const before = paintedPng(100, 100, () => {});
    const after = paintedPng(100, 100, (ctx) => {
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(20, 30, 25, 15);
    });
    const { annotator, toPng } = stubAnnotator();
    await handleCompareScreenshots({ before: before.dataUrl, after: after.dataUrl }, { annotator });
    const annotationsSvg = toPng.mock.calls[0]?.[0]?.annotationsSvg ?? "";
    expect(annotationsSvg).toContain("<rect");
    // Warning intent maps to #f59e0b.
    expect(annotationsSvg).toContain('stroke="#f59e0b"');
  });

  test("dimension mismatch surfaces as MCP error", async () => {
    const before = paintedPng(100, 50, () => {});
    const after = paintedPng(100, 80, () => {});
    const { annotator } = stubAnnotator();
    const result = await handleCompareScreenshots(
      { before: before.dataUrl, after: after.dataUrl },
      { annotator },
    );
    expect(result.isError).toBe(true);
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toMatch(/different dimensions/);
    }
  });

  test("includeChangeList appends a text summary", async () => {
    const before = paintedPng(80, 60, () => {});
    const after = paintedPng(80, 60, (ctx) => {
      ctx.fillStyle = "#0000ff";
      ctx.fillRect(10, 10, 20, 20);
    });
    const { annotator } = stubAnnotator();
    const result = await handleCompareScreenshots(
      { before: before.dataUrl, after: after.dataUrl, includeChangeList: true },
      { annotator },
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(2);
    expect(result.content[0]?.type).toBe("image");
    expect(result.content[1]?.type).toBe("text");
    if (result.content[1]?.type === "text") {
      expect(result.content[1].text).toMatch(/changed region/);
    }
  });

  test("rejects missing input", async () => {
    const { annotator } = stubAnnotator();
    const result = await handleCompareScreenshots({ before: "" } as Record<string, unknown>, {
      annotator,
    });
    expect(result.isError).toBe(true);
  });
});
