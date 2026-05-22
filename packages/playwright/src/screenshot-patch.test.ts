import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAnnotator } from "@ingcreators/annot-annotator";
import { readEditablePngBytes } from "@ingcreators/annot-core/xmp-bytes";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type AnnotSourceResolver, annotSourceResolvers } from "./screenshot-hooks.js";
import { patchScreenshot } from "./screenshot-patch.js";

// ─── Test fixture helpers ──────────────────────────────────────────

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A real PNG via annot-annotator's own raster path. */
function makePng(width: number, height: number): Buffer {
  const dataUrl =
    "data:image/png;base64," +
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return Buffer.from(
    createAnnotator().toPng({
      originalDataUrl: dataUrl,
      annotationsSvg:
        `<svg xmlns="http://www.w3.org/2000/svg">` +
        `<rect width="${width}" height="${height}" fill="white"/>` +
        "</svg>",
      width,
      height,
    }),
  );
}

interface StubPage {
  screenshot: (opts?: unknown) => Promise<Buffer>;
}

/**
 * Build a tiny stub `Page` for unit-testing `patchScreenshot`. The
 * stub's `screenshot` MUST live on the prototype (not as an
 * instance property), so production's
 * `Object.getPrototypeOf(page).screenshot` patch lands. We track
 * invocations via a `vi.fn()` mutated onto the prototype.
 *
 * The MDX-aware stubs (snapshotYaml / `locator()` / `getByRole()`)
 * that lived in the original product-docs-astro test live with the
 * MDX resolver in Phase 2 — annot-playwright is MDX-unaware so the
 * stub stays minimal here.
 */
function makeStubPage(pngBytes: Buffer): StubPage {
  const proto: StubPage = {
    screenshot: vi.fn(async (_opts?: unknown) => pngBytes) as unknown as StubPage["screenshot"],
  };
  return Object.create(proto) as StubPage;
}

function getOriginalScreenshotMock(
  stub: StubPage,
): ReturnType<typeof vi.fn<(opts?: unknown) => Promise<Buffer>>> {
  return (Object.getPrototypeOf(stub) as Record<string, unknown>).screenshot as ReturnType<
    typeof vi.fn<(opts?: unknown) => Promise<Buffer>>
  >;
}

// ─── Resolver-registry isolation ────────────────────────────────────
//
// The registry is module-level. Tests that push into it MUST clean
// up after themselves so cross-test bleed doesn't make later cases
// fire stale resolvers.

afterEach(() => {
  annotSourceResolvers.length = 0;
});

// ─── Tests ────────────────────────────────────────────────────────

describe("patchScreenshot — pass-through behaviour", () => {
  it("calls original screenshot unchanged when annot is absent", async () => {
    const pngBytes = makePng(400, 300);
    const stub = makeStubPage(pngBytes);
    const originalSpy = getOriginalScreenshotMock(stub);
    patchScreenshot(Object.getPrototypeOf(stub));
    const result = await stub.screenshot({ path: undefined, fullPage: true });
    expect(originalSpy).toHaveBeenCalledTimes(1);
    expect(originalSpy).toHaveBeenCalledWith({ path: undefined, fullPage: true });
    const buf = result as Buffer;
    expect(Array.from(buf.subarray(0, 8))).toEqual(PNG_MAGIC);
  });

  it("`annot: true` falls through to vanilla (no contribution)", async () => {
    const pngBytes = makePng(100, 100);
    const stub = makeStubPage(pngBytes);
    const originalSpy = getOriginalScreenshotMock(stub);
    patchScreenshot(Object.getPrototypeOf(stub));
    const result = await stub.screenshot({ annot: true });
    expect(originalSpy).toHaveBeenCalledTimes(1);
    expect(originalSpy.mock.calls[0]?.[0]).toEqual({ annot: true });
    const buf = result as Buffer;
    expect(Array.from(buf.subarray(0, 8))).toEqual(PNG_MAGIC);
  });

  it("`annot: {}` (empty object) falls through to vanilla", async () => {
    const pngBytes = makePng(100, 100);
    const stub = makeStubPage(pngBytes);
    const originalSpy = getOriginalScreenshotMock(stub);
    patchScreenshot(Object.getPrototypeOf(stub));
    await stub.screenshot({ annot: {} });
    expect(originalSpy).toHaveBeenCalledTimes(1);
    expect(originalSpy.mock.calls[0]?.[0]).toEqual({ annot: {} });
  });

  it("`annot: { editable: true }` alone (no source) falls through", async () => {
    const pngBytes = makePng(100, 100);
    const stub = makeStubPage(pngBytes);
    const originalSpy = getOriginalScreenshotMock(stub);
    patchScreenshot(Object.getPrototypeOf(stub));
    await stub.screenshot({ annot: { editable: true } });
    expect(originalSpy).toHaveBeenCalledTimes(1);
  });

  it("`annot: { mdx }` with NO resolver registered falls through to vanilla", async () => {
    // Phase-1 contract: unknown fields enter `runAnnotMode`, but
    // when no resolver claims the contribution AND no known
    // source field is set, the patch falls back to the original
    // `screenshot()`. Phase 2 registers the MDX resolver in
    // annot-product-docs and this same call yields an editable
    // wrap.
    const pngBytes = makePng(100, 100);
    const stub = makeStubPage(pngBytes);
    const originalSpy = getOriginalScreenshotMock(stub);
    patchScreenshot(Object.getPrototypeOf(stub));
    // biome-ignore lint/suspicious/noExplicitAny: drilling past the public type for fall-through coverage
    await stub.screenshot({ annot: { mdx: { id: "x", path: "y" } } } as any);
    // Two calls land on `original`: the probe doesn't take a
    // screenshot, but the fall-through still flows through the
    // original. Assert exactly one invocation.
    expect(originalSpy).toHaveBeenCalledTimes(1);
  });
});

describe("patchScreenshot — annot mode", () => {
  it("`{ tags }` only writes a plain PNG + iTXt sidecar (no editable wrap)", async () => {
    const pngBytes = makePng(200, 100);
    const stub = makeStubPage(pngBytes);
    patchScreenshot(Object.getPrototypeOf(stub));
    const result = await stub.screenshot({
      annot: { tags: { source: "vrt-failure", testId: "login" } },
    });
    expect(Array.from(result.subarray(0, 8))).toEqual(PNG_MAGIC);
    expect(readEditablePngBytes(new Uint8Array(result))).toBeNull();
    const text = Array.from(new Uint8Array(result))
      .map((b) => String.fromCharCode(b))
      .join("");
    expect(text).toContain('"source":"vrt-failure"');
    expect(text).toContain('"testId":"login"');
    expect(text).not.toContain("annot:annotations");
  });

  it("`{ overlays }` writes an editable PNG (annotations + embedded original)", async () => {
    const pngBytes = makePng(400, 300);
    const stub = makeStubPage(pngBytes);
    patchScreenshot(Object.getPrototypeOf(stub));
    const result = await stub.screenshot({
      annot: {
        overlays: [
          { type: "rect", bbox: { x: 10, y: 10, width: 50, height: 30 }, intent: "warning" },
        ],
      },
    });
    expect(Array.from(result.subarray(0, 8))).toEqual(PNG_MAGIC);
    const meta = readEditablePngBytes(new Uint8Array(result));
    expect(meta).not.toBeNull();
    expect(meta!.annotationsSvg).toContain("rect");
    expect(meta!.tags).toEqual({});
  });

  it("`{ overlays, tags }` merges user tags into the editable PNG XMP", async () => {
    const pngBytes = makePng(400, 300);
    const stub = makeStubPage(pngBytes);
    patchScreenshot(Object.getPrototypeOf(stub));
    const result = await stub.screenshot({
      annot: {
        overlays: [{ type: "rect", bbox: { x: 10, y: 10, width: 50, height: 30 }, intent: "info" }],
        tags: { source: "test", capturedAt: "2026-05-21T00:00:00.000Z" },
      },
    });
    const meta = readEditablePngBytes(new Uint8Array(result));
    expect(meta!.tags).toEqual({
      source: "test",
      capturedAt: "2026-05-21T00:00:00.000Z",
    });
  });

  it("`{ overlays, editable: false }` bakes overlays into pixels (flat PNG, no XMP layer)", async () => {
    const pngBytes = makePng(400, 300);
    const stub = makeStubPage(pngBytes);
    patchScreenshot(Object.getPrototypeOf(stub));
    const result = await stub.screenshot({
      annot: {
        overlays: [
          { type: "rect", bbox: { x: 10, y: 10, width: 50, height: 30 }, intent: "error" },
        ],
        editable: false,
      },
    });
    expect(Array.from(result.subarray(0, 8))).toEqual(PNG_MAGIC);
    expect(readEditablePngBytes(new Uint8Array(result))).toBeNull();
    expect(result.length).not.toBe(pngBytes.length);
  });
});

describe("patchScreenshot — resolver registry", () => {
  it("walks the registry on `{ overlays }` but no resolver fires (overlays handled directly)", async () => {
    const calls: number[] = [];
    const resolver: AnnotSourceResolver = async () => {
      calls.push(Date.now());
      return null;
    };
    annotSourceResolvers.push(resolver);

    const pngBytes = makePng(200, 100);
    const stub = makeStubPage(pngBytes);
    patchScreenshot(Object.getPrototypeOf(stub));
    const result = await stub.screenshot({
      annot: {
        overlays: [{ type: "rect", bbox: { x: 1, y: 1, width: 10, height: 10 } }],
      },
    });
    // Resolver was probed but returned null → no contribution.
    expect(calls.length).toBe(1);
    // The output is still an editable PNG (overlays are handled
    // by the patch directly, not by a resolver).
    expect(readEditablePngBytes(new Uint8Array(result))).not.toBeNull();
  });

  it("resolver returning a contribution opts the call into annot mode (even with no known source)", async () => {
    // The contract: a resolver can claim a call based on fields
    // annot-playwright doesn't know about (e.g. `mdx`). When it
    // does, the editable wrap is produced even though there are
    // no `overlays` / `tags`.
    const resolver: AnnotSourceResolver = async () => ({
      resolveAnnotations: async () => [
        { type: "rect", bbox: { x: 5, y: 5, width: 20, height: 20 }, intent: "info" },
      ],
    });
    annotSourceResolvers.push(resolver);

    const pngBytes = makePng(100, 100);
    const stub = makeStubPage(pngBytes);
    patchScreenshot(Object.getPrototypeOf(stub));
    // biome-ignore lint/suspicious/noExplicitAny: simulating a downstream-augmented option
    const result = await stub.screenshot({ annot: { mdx: { id: "x", path: "y" } } } as any);
    const meta = readEditablePngBytes(new Uint8Array(result));
    expect(meta).not.toBeNull();
    expect(meta!.annotationsSvg).toContain("rect");
  });

  it("resolver `prepare()` hook runs before the raw screenshot is taken", async () => {
    const order: string[] = [];
    const resolver: AnnotSourceResolver = async () => ({
      prepare: async () => {
        order.push("prepare");
      },
      resolveAnnotations: async () => {
        order.push("resolveAnnotations");
        return [];
      },
    });
    annotSourceResolvers.push(resolver);

    const pngBytes = makePng(100, 100);
    const stub = makeStubPage(pngBytes);
    const originalSpy = getOriginalScreenshotMock(stub);
    // Wrap the underlying screenshot mock to log call order.
    const realImpl = originalSpy.getMockImplementation();
    originalSpy.mockImplementation(async (opts) => {
      order.push("screenshot");
      return realImpl ? await realImpl(opts) : pngBytes;
    });
    patchScreenshot(Object.getPrototypeOf(stub));

    // biome-ignore lint/suspicious/noExplicitAny: simulating a downstream-augmented option
    await stub.screenshot({ annot: { mdx: { id: "x", path: "y" } } } as any);
    expect(order).toEqual(["prepare", "screenshot", "resolveAnnotations"]);
  });
});

describe("patchScreenshot — locator screenshots", () => {
  function makeStubLocator(opts: {
    boundingBox: { x: number; y: number; width: number; height: number } | null;
    page: { screenshot: (opts?: unknown) => Promise<Buffer> };
    croppedPngBytes: Buffer;
  }) {
    interface StubLocator {
      screenshot: (opts?: unknown) => Promise<Buffer>;
      boundingBox: () => Promise<typeof opts.boundingBox>;
      page: () => typeof opts.page;
    }
    const proto: StubLocator = {
      screenshot: vi.fn(
        async (_opts?: unknown) => opts.croppedPngBytes,
      ) as unknown as StubLocator["screenshot"],
      boundingBox: async () => opts.boundingBox,
      page: () => opts.page,
    };
    return Object.create(proto) as StubLocator;
  }

  it("locator.screenshot({ annot: { overlays } }) rebases overlays into clip-space", async () => {
    const croppedPngBytes = makePng(200, 150);
    const fakePage = { screenshot: vi.fn(async () => Buffer.alloc(0)) };
    const stub = makeStubLocator({
      boundingBox: { x: 100, y: 50, width: 200, height: 150 },
      page: fakePage,
      croppedPngBytes,
    });
    patchScreenshot(Object.getPrototypeOf(stub));
    const result = await stub.screenshot({
      annot: {
        overlays: [
          { type: "rect", bbox: { x: 120, y: 60, width: 50, height: 30 }, intent: "warning" },
        ],
      },
    });
    const meta = readEditablePngBytes(new Uint8Array(result));
    expect(meta).not.toBeNull();
    expect(meta!.annotationsSvg).toMatch(/x="?20"?/);
    expect(meta!.annotationsSvg).toMatch(/y="?10"?/);
  });

  it("drops overlays whose page-space bbox falls outside the locator clip", async () => {
    const croppedPngBytes = makePng(200, 150);
    const fakePage = { screenshot: vi.fn(async () => Buffer.alloc(0)) };
    const stub = makeStubLocator({
      boundingBox: { x: 100, y: 50, width: 200, height: 150 },
      page: fakePage,
      croppedPngBytes,
    });
    patchScreenshot(Object.getPrototypeOf(stub));
    const result = await stub.screenshot({
      annot: {
        overlays: [
          { type: "rect", bbox: { x: 120, y: 60, width: 30, height: 30 } },
          { type: "rect", bbox: { x: 0, y: 0, width: 30, height: 30 } },
          { type: "rect", bbox: { x: 350, y: 60, width: 30, height: 30 } },
        ],
      },
    });
    const meta = readEditablePngBytes(new Uint8Array(result));
    expect(meta).not.toBeNull();
    const rectMatches = meta!.annotationsSvg.match(/<rect/g) ?? [];
    expect(rectMatches.length).toBeGreaterThanOrEqual(1);
    expect(meta!.annotationsSvg).not.toMatch(/x="?350"?/);
  });

  it("locator.screenshot({ annot: { tags } }) without overlays writes a tags-only sidecar", async () => {
    const croppedPngBytes = makePng(200, 150);
    const fakePage = { screenshot: vi.fn() };
    const stub = makeStubLocator({
      boundingBox: { x: 100, y: 50, width: 200, height: 150 },
      page: fakePage,
      croppedPngBytes,
    });
    patchScreenshot(Object.getPrototypeOf(stub));
    const result = await stub.screenshot({
      annot: { tags: { source: "locator-shot" } },
    });
    expect(Array.from(result.subarray(0, 8))).toEqual(PNG_MAGIC);
    expect(readEditablePngBytes(new Uint8Array(result))).toBeNull();
    const text = Array.from(new Uint8Array(result))
      .map((b) => String.fromCharCode(b))
      .join("");
    expect(text).toContain('"source":"locator-shot"');
  });

  it("throws with a friendly diagnostic when the locator has no bounding box", async () => {
    const croppedPngBytes = makePng(100, 100);
    const fakePage = { screenshot: vi.fn() };
    const stub = makeStubLocator({
      boundingBox: null,
      page: fakePage,
      croppedPngBytes,
    });
    patchScreenshot(Object.getPrototypeOf(stub));
    await expect(
      stub.screenshot({
        annot: { overlays: [{ type: "rect", bbox: { x: 0, y: 0, width: 10, height: 10 } }] },
      }),
    ).rejects.toThrow(/no bounding box/);
  });

  it("locator.screenshot WITHOUT annot falls through to original (vanilla)", async () => {
    const croppedPngBytes = makePng(100, 100);
    const fakePage = { screenshot: vi.fn() };
    const stub = makeStubLocator({
      boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      page: fakePage,
      croppedPngBytes,
    });
    const originalSpy = (Object.getPrototypeOf(stub) as { screenshot: ReturnType<typeof vi.fn> })
      .screenshot;
    patchScreenshot(Object.getPrototypeOf(stub));
    await stub.screenshot({ scale: "css" });
    expect(originalSpy).toHaveBeenCalledTimes(1);
    expect(originalSpy).toHaveBeenCalledWith({ scale: "css" });
  });
});

describe("patchScreenshot — page.screenshot({ clip })", () => {
  it("rebases overlays against an explicit clip on a Page screenshot", async () => {
    const croppedPngBytes = makePng(200, 150);
    const stub = makeStubPage(croppedPngBytes);
    patchScreenshot(Object.getPrototypeOf(stub));
    const result = await stub.screenshot({
      clip: { x: 100, y: 50, width: 200, height: 150 },
      annot: {
        overlays: [
          { type: "rect", bbox: { x: 120, y: 60, width: 30, height: 20 }, intent: "info" },
          { type: "rect", bbox: { x: 0, y: 0, width: 30, height: 20 } },
        ],
      },
    });
    const meta = readEditablePngBytes(new Uint8Array(result));
    expect(meta).not.toBeNull();
    expect(meta!.annotationsSvg).toMatch(/x="?20"?/);
    const rectMatches = meta!.annotationsSvg.match(/<rect/g) ?? [];
    expect(rectMatches.length).toBeGreaterThanOrEqual(1);
  });
});

describe("patchScreenshot — invariants", () => {
  it("is idempotent: applying twice doesn't double-wrap", async () => {
    const pngBytes = makePng(100, 100);
    const stub = makeStubPage(pngBytes);
    const proto = Object.getPrototypeOf(stub);
    const beforeFirst = proto.screenshot;
    patchScreenshot(proto);
    const afterFirst = proto.screenshot;
    expect(afterFirst).not.toBe(beforeFirst);
    patchScreenshot(proto);
    const afterSecond = proto.screenshot;
    expect(afterSecond).toBe(afterFirst);
  });

  it("writes to disk when `path` is supplied (vanilla page.screenshot semantics)", async () => {
    const pngBytes = makePng(200, 100);
    const stub = makeStubPage(pngBytes);
    patchScreenshot(Object.getPrototypeOf(stub));
    const dir = await mkdtemp(join(tmpdir(), "annot-playwright-patch-test-"));
    const outPath = join(dir, "out.png");
    const result = await stub.screenshot({
      path: outPath,
      annot: { tags: { source: "test" } },
    });
    const onDisk = await readFile(outPath);
    expect(Array.from(onDisk)).toEqual(Array.from(result));
  });
});
