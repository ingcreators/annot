import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { InvalidImageInputError, resolveImageInput } from "./read-image.js";

// Same small-PNG-header builder used by `png-dimensions.test.ts`,
// but extended with the minimum IDAT + IEND so the bytes form a
// fully valid PNG (helpful for tests that pipe the output through
// downstream consumers).
function buildPngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

describe("resolveImageInput", () => {
  test("accepts a valid PNG data URL", async () => {
    const png = buildPngHeader(640, 480);
    const dataUrl = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
    const resolved = await resolveImageInput(dataUrl);
    expect(resolved.dimensions).toEqual({ width: 640, height: 480 });
    expect(resolved.dataUrl).toBe(dataUrl);
    expect(resolved.bytes.byteLength).toBe(png.byteLength);
  });

  test("accepts an absolute filesystem path to a PNG", async () => {
    const dir = mkdtempSync(join(tmpdir(), "annot-mcp-test-"));
    const path = join(dir, "screenshot.png");
    const png = buildPngHeader(800, 600);
    writeFileSync(path, png);
    const resolved = await resolveImageInput(path);
    expect(resolved.dimensions).toEqual({ width: 800, height: 600 });
    expect(resolved.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(resolved.bytes.byteLength).toBe(png.byteLength);
  });

  test("rejects empty strings", async () => {
    await expect(resolveImageInput("")).rejects.toThrowError(InvalidImageInputError);
  });

  test("rejects non-PNG data URLs", async () => {
    await expect(resolveImageInput("data:image/jpeg;base64,/9j/4AAQ")).rejects.toThrowError(
      /data:image\/png/,
    );
  });

  test("rejects data URLs with PNG label but bad bytes", async () => {
    const dataUrl = "data:image/png;base64,SGVsbG8gd29ybGQ="; // "Hello world"
    await expect(resolveImageInput(dataUrl)).rejects.toThrowError(/PNG signature|PNG header/);
  });

  test("rejects relative filesystem paths", async () => {
    await expect(resolveImageInput("./relative.png")).rejects.toThrowError(/not absolute/);
  });

  test("rejects missing files with a useful message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "annot-mcp-test-"));
    const missing = join(dir, "does-not-exist.png");
    await expect(resolveImageInput(missing)).rejects.toThrowError(/Failed to read/);
  });
});
