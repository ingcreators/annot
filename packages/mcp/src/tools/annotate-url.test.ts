import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Annotator } from "@ingcreators/annot-annotator";
import { describe, expect, test, vi } from "vitest";

import { type BrowserLauncher, type BrowserLike, BrowserPool } from "../browser/pool.js";
import { handleAnnotateUrl } from "./annotate-url.js";

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

/**
 * Stub Chromium pool: launches return a browser whose newContext
 * yields pages backed by a configurable locator table. The page's
 * screenshot returns a fixed PNG header — the annotator is
 * stubbed too, so the screenshot bytes only need to parse as PNG.
 */
function stubPool(opts: {
  locators: Record<string, { x: number; y: number; width: number; height: number } | null>;
  screenshotPng: Uint8Array;
}): {
  pool: BrowserPool;
  gotoSpy: ReturnType<typeof vi.fn>;
  screenshotSpy: ReturnType<typeof vi.fn>;
  contextCloseSpy: ReturnType<typeof vi.fn>;
} {
  const gotoSpy = vi.fn(async () => undefined);
  const screenshotSpy = vi.fn(async () => Buffer.from(opts.screenshotPng));
  const contextCloseSpy = vi.fn(async () => {});

  const page = {
    goto: gotoSpy,
    screenshot: screenshotSpy,
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
    close: contextCloseSpy,
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
  const pool = new BrowserPool(launcher);
  return { pool, gotoSpy, screenshotSpy, contextCloseSpy };
}

function stubAnnotator(): {
  annotator: Annotator;
  toPng: ReturnType<typeof vi.fn>;
} {
  const stubPng = new Uint8Array([0xfa, 0xce, 0xfe, 0xed]);
  const toPng = vi.fn(() => stubPng);
  const toSvg = vi.fn(() => "<svg/>");
  const toEncoded = vi.fn(async () => ({
    bytes: stubPng,
    chosen: "png" as const,
    width: 0,
    height: 0,
  }));
  return { annotator: { toPng, toSvg, toEncoded }, toPng };
}

describe("handleAnnotateUrl", () => {
  test("captures URL, resolves locators, returns annotated PNG inline", async () => {
    const pngHeader = buildPng(1024, 768);
    const { pool, gotoSpy } = stubPool({
      locators: { "button#submit": { x: 100, y: 100, width: 60, height: 30 } },
      screenshotPng: pngHeader,
    });
    const { annotator, toPng } = stubAnnotator();

    const result = await handleAnnotateUrl(
      {
        url: "https://example.com/login",
        annotations: [{ type: "rect", locator: "button#submit", intent: "error" }],
      },
      { pool, annotator },
    );
    expect(result.isError).toBeFalsy();
    expect(gotoSpy).toHaveBeenCalledWith(
      "https://example.com/login",
      expect.objectContaining({ waitUntil: "load" }),
    );
    expect(toPng).toHaveBeenCalledTimes(1);
    const call = toPng.mock.calls[0]?.[0];
    expect(call?.width).toBe(1024);
    expect(call?.height).toBe(768);
    expect(call?.annotationsSvg).toContain('<rect x="100" y="100"');
    const block = result.content[0]!;
    expect(block.type).toBe("image");
  });

  test("writes annotated PNG to disk when output set", async () => {
    const { pool } = stubPool({
      locators: { ".target": { x: 0, y: 0, width: 10, height: 10 } },
      screenshotPng: buildPng(200, 100),
    });
    const { annotator } = stubAnnotator();
    const dir = mkdtempSync(join(tmpdir(), "annot-mcp-test-"));
    const out = join(dir, "url-output.png");

    const result = await handleAnnotateUrl(
      {
        url: "https://example.com",
        annotations: [{ type: "rect", locator: ".target" }],
        output: out,
      },
      { pool, annotator },
    );
    expect(result.isError).toBeFalsy();
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain(out);
      expect(result.content[0].text).toContain("200×100");
      expect(result.content[0].text).toContain("https://example.com");
    }
    expect(Array.from(readFileSync(out))).toEqual([0xfa, 0xce, 0xfe, 0xed]);
  });

  test("surfaces locator resolution failures as MCP errors", async () => {
    const { pool, contextCloseSpy } = stubPool({
      locators: { ".nope": null },
      screenshotPng: buildPng(100, 100),
    });
    const { annotator, toPng } = stubAnnotator();
    const result = await handleAnnotateUrl(
      {
        url: "https://example.com",
        annotations: [{ type: "rect", locator: ".nope" }],
      },
      { pool, annotator },
    );
    expect(result.isError).toBe(true);
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toMatch(/LocatorResolutionError/);
      expect(result.content[0].text).toMatch(/\.nope/);
    }
    // Page is closed even on resolution failure.
    expect(contextCloseSpy).toHaveBeenCalled();
    // Annotator never called when locator resolution fails.
    expect(toPng).not.toHaveBeenCalled();
  });

  test("rejects missing url", async () => {
    const { pool } = stubPool({ locators: {}, screenshotPng: buildPng(100, 100) });
    const { annotator } = stubAnnotator();
    const result = await handleAnnotateUrl({ annotations: [] }, { pool, annotator });
    expect(result.isError).toBe(true);
  });

  test("forwards waitFor and viewport options", async () => {
    const { pool, gotoSpy } = stubPool({
      locators: {},
      screenshotPng: buildPng(800, 600),
    });
    const { annotator } = stubAnnotator();
    await handleAnnotateUrl(
      {
        url: "https://example.com",
        annotations: [],
        viewport: { width: 800, height: 600, deviceScaleFactor: 2 },
        waitFor: "networkidle",
      },
      { pool, annotator },
    );
    expect(gotoSpy).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ waitUntil: "networkidle" }),
    );
  });

  test("rejects relative output paths", async () => {
    const { pool } = stubPool({ locators: {}, screenshotPng: buildPng(100, 100) });
    const { annotator } = stubAnnotator();
    const result = await handleAnnotateUrl(
      {
        url: "https://example.com",
        annotations: [],
        output: "./oops.png",
      },
      { pool, annotator },
    );
    expect(result.isError).toBe(true);
  });

  test("passes coordinate-flavour annotations through unchanged", async () => {
    const { pool } = stubPool({ locators: {}, screenshotPng: buildPng(640, 480) });
    const { annotator, toPng } = stubAnnotator();
    await handleAnnotateUrl(
      {
        url: "https://example.com",
        annotations: [
          { type: "rect", bbox: { x: 5, y: 5, width: 50, height: 50 }, intent: "success" },
        ],
      },
      { pool, annotator },
    );
    expect(toPng.mock.calls[0]?.[0]?.annotationsSvg).toContain('<rect x="5" y="5"');
  });
});
