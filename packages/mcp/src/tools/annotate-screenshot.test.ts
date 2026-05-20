// Tests for `annot_annotate_screenshot`. The handler is exercised
// directly with a stub `Annotator` so the test runs in pure Node
// without loading resvg-js's native rasteriser. End-to-end
// transport tests (real `StdioServerTransport` paired against an
// in-memory `Client`) land in Phase 3b when the locator-driven
// happy path needs proving.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Annotator } from "@ingcreators/annot-annotator";
import { describe, expect, test, vi } from "vitest";

import { handleAnnotateScreenshot } from "./annotate-screenshot.js";

function buildPng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function buildPngDataUrl(width: number, height: number): string {
  return `data:image/png;base64,${Buffer.from(buildPng(width, height)).toString("base64")}`;
}

function stubAnnotator(): { annotator: Annotator; toPng: ReturnType<typeof vi.fn> } {
  const stubPng = new Uint8Array([0xfa, 0xce, 0xfe, 0xed]);
  const toPng = vi.fn(() => stubPng);
  const toSvg = vi.fn(() => "<svg/>");
  const toEncoded = vi.fn(async () => ({
    bytes: stubPng,
    chosen: "png" as const,
    width: 0,
    height: 0,
  }));
  const annotator: Annotator = { toPng, toSvg, toEncoded };
  return { annotator, toPng };
}

describe("handleAnnotateScreenshot", () => {
  test("returns annotated PNG as an MCP image content block", async () => {
    const { annotator, toPng } = stubAnnotator();
    const result = await handleAnnotateScreenshot(
      {
        image: buildPngDataUrl(640, 480),
        annotations: [{ type: "rect", bbox: { x: 0, y: 0, width: 10, height: 10 } }],
      },
      { annotator },
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    const block = result.content[0]!;
    expect(block.type).toBe("image");
    if (block.type === "image") {
      expect(block.mimeType).toBe("image/png");
      // base64 of [0xfa, 0xce, 0xfe, 0xed] = "+s7+7Q=="
      expect(block.data).toBe("+s7+7Q==");
    }
    // Annotator was called with the resolved data URL + IHDR dimensions.
    expect(toPng).toHaveBeenCalledTimes(1);
    const call = toPng.mock.calls[0]?.[0];
    expect(call?.width).toBe(640);
    expect(call?.height).toBe(480);
    expect(call?.annotationsSvg).toContain('<rect x="0" y="0"');
  });

  test("writes annotated PNG to disk when `output` is set", async () => {
    const { annotator } = stubAnnotator();
    const dir = mkdtempSync(join(tmpdir(), "annot-mcp-test-"));
    const out = join(dir, "annotated.png");
    const result = await handleAnnotateScreenshot(
      {
        image: buildPngDataUrl(100, 50),
        annotations: [],
        output: out,
      },
      { annotator },
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain(out);
      expect(result.content[0].text).toContain("100×50");
    }
    const written = readFileSync(out);
    expect(Array.from(written)).toEqual([0xfa, 0xce, 0xfe, 0xed]);
  });

  test("reports invalid image input as an MCP error block", async () => {
    const { annotator, toPng } = stubAnnotator();
    const result = await handleAnnotateScreenshot(
      { image: "data:image/jpeg;base64,abc", annotations: [] },
      { annotator },
    );
    expect(result.isError).toBe(true);
    expect(toPng).not.toHaveBeenCalled();
  });

  test("reports missing files as an MCP error block", async () => {
    const { annotator } = stubAnnotator();
    const dir = mkdtempSync(join(tmpdir(), "annot-mcp-test-"));
    const path = join(dir, "missing.png");
    const result = await handleAnnotateScreenshot({ image: path, annotations: [] }, { annotator });
    expect(result.isError).toBe(true);
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toMatch(/Failed to read/);
    }
  });

  test("rejects relative output paths", async () => {
    const { annotator } = stubAnnotator();
    const result = await handleAnnotateScreenshot(
      {
        image: buildPngDataUrl(10, 10),
        annotations: [],
        output: "./relative-output.png",
      },
      { annotator },
    );
    expect(result.isError).toBe(true);
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toMatch(/must be absolute/);
    }
  });

  test("rejects malformed input shape (annotations not array)", async () => {
    const { annotator } = stubAnnotator();
    const result = await handleAnnotateScreenshot(
      // Bypass JSON-schema validation to simulate a buggy client.
      { image: buildPngDataUrl(10, 10), annotations: "oops" as unknown as never },
      { annotator },
    );
    expect(result.isError).toBe(true);
  });

  test("passes filesystem-input PNG to the annotator", async () => {
    const { annotator, toPng } = stubAnnotator();
    const dir = mkdtempSync(join(tmpdir(), "annot-mcp-test-"));
    const path = join(dir, "input.png");
    writeFileSync(path, buildPng(123, 456));
    const result = await handleAnnotateScreenshot({ image: path, annotations: [] }, { annotator });
    expect(result.isError).toBeFalsy();
    const call = toPng.mock.calls[0]?.[0];
    expect(call?.width).toBe(123);
    expect(call?.height).toBe(456);
    expect(call?.originalDataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
