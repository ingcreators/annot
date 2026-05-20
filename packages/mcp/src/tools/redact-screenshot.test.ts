import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, test } from "vitest";

import { readPngDimensions } from "../io/png-dimensions.js";
import { handleRedactScreenshot } from "./redact-screenshot.js";

function whitePngBuffer(width: number, height: number): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png");
}

function whitePngDataUrl(width: number, height: number): string {
  return `data:image/png;base64,${whitePngBuffer(width, height).toString("base64")}`;
}

describe("handleRedactScreenshot", () => {
  test("returns redacted PNG as an MCP image content block", async () => {
    const result = await handleRedactScreenshot({
      image: whitePngDataUrl(64, 48),
      regions: [{ bbox: { x: 10, y: 10, width: 20, height: 20 }, style: "solid", color: "#000" }],
    });
    expect(result.isError).toBeFalsy();
    const block = result.content[0]!;
    expect(block.type).toBe("image");
    if (block.type === "image") {
      expect(block.mimeType).toBe("image/png");
      const bytes = Uint8Array.from(Buffer.from(block.data, "base64"));
      expect(readPngDimensions(bytes)).toEqual({ width: 64, height: 48 });
    }
  });

  test("writes to disk when output set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "annot-mcp-test-"));
    const out = join(dir, "redacted.png");
    const result = await handleRedactScreenshot({
      image: whitePngDataUrl(40, 20),
      regions: [{ bbox: { x: 0, y: 0, width: 10, height: 10 }, style: "solid" }],
      output: out,
    });
    expect(result.isError).toBeFalsy();
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain(out);
    }
    const bytes = readFileSync(out);
    expect(readPngDimensions(new Uint8Array(bytes))).toEqual({ width: 40, height: 20 });
  });

  test("zero regions short-circuits to input PNG (still emits content)", async () => {
    const dataUrl = whitePngDataUrl(20, 20);
    const result = await handleRedactScreenshot({ image: dataUrl, regions: [] });
    expect(result.isError).toBeFalsy();
    if (result.content[0]?.type === "image") {
      const bytes = Uint8Array.from(Buffer.from(result.content[0].data, "base64"));
      expect(readPngDimensions(bytes)).toEqual({ width: 20, height: 20 });
    }
  });

  test("reports invalid image as MCP error", async () => {
    const result = await handleRedactScreenshot({
      image: "data:image/jpeg;base64,abc",
      regions: [],
    });
    expect(result.isError).toBe(true);
  });

  test("rejects relative output paths", async () => {
    const result = await handleRedactScreenshot({
      image: whitePngDataUrl(10, 10),
      regions: [],
      output: "./out.png",
    });
    expect(result.isError).toBe(true);
  });
});
