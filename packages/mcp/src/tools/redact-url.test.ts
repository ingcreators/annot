import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, test, vi } from "vitest";

import { type BrowserLauncher, type BrowserLike, BrowserPool } from "../browser/pool.js";
import { readPngDimensions } from "../io/png-dimensions.js";
import { handleRedactUrl } from "./redact-url.js";

function whitePng(width: number, height: number): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  const buf = canvas.toBuffer("image/png");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function stubPool(opts: {
  locators: Record<string, { x: number; y: number; width: number; height: number } | null>;
  screenshotPng: Uint8Array;
}): BrowserPool {
  const page = {
    async goto() {},
    async screenshot() {
      return Buffer.from(opts.screenshotPng);
    },
    locator(selector: string) {
      return {
        async boundingBox() {
          return opts.locators[selector] ?? null;
        },
      };
    },
  };
  const context = {
    async newPage() {
      return page;
    },
    async close() {},
  };
  const browser: BrowserLike & { newContext: () => Promise<typeof context> } = {
    close: vi.fn(async () => {}),
    newContext: vi.fn(async () => context),
  };
  const launcher: BrowserLauncher = {
    async launch() {
      return browser;
    },
  };
  return new BrowserPool(launcher);
}

describe("handleRedactUrl", () => {
  test("captures URL, resolves locator regions, burns redaction", async () => {
    const pool = stubPool({
      locators: { ".password": { x: 100, y: 100, width: 200, height: 30 } },
      screenshotPng: whitePng(800, 600),
    });
    const result = await handleRedactUrl(
      {
        url: "https://example.com",
        regions: [{ locator: ".password", style: "blur" }],
      },
      { pool },
    );
    expect(result.isError).toBeFalsy();
    if (result.content[0]?.type === "image") {
      const bytes = Uint8Array.from(Buffer.from(result.content[0].data, "base64"));
      expect(readPngDimensions(bytes)).toEqual({ width: 800, height: 600 });
    }
  });

  test("accepts bbox-flavour regions", async () => {
    const pool = stubPool({ locators: {}, screenshotPng: whitePng(200, 200) });
    const result = await handleRedactUrl(
      {
        url: "https://example.com",
        regions: [{ bbox: { x: 10, y: 10, width: 50, height: 50 }, style: "solid", color: "#000" }],
      },
      { pool },
    );
    expect(result.isError).toBeFalsy();
  });

  test("surfaces locator failures as MCP errors", async () => {
    const pool = stubPool({
      locators: { ".missing": null },
      screenshotPng: whitePng(100, 100),
    });
    const result = await handleRedactUrl(
      { url: "https://example.com", regions: [{ locator: ".missing" }] },
      { pool },
    );
    expect(result.isError).toBe(true);
  });

  test("rejects missing url", async () => {
    const pool = stubPool({ locators: {}, screenshotPng: whitePng(50, 50) });
    const result = await handleRedactUrl({ regions: [] }, { pool });
    expect(result.isError).toBe(true);
  });
});
