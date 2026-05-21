import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAnnotator } from "@ingcreators/annot-annotator";
import { readEditablePngBytes } from "@ingcreators/annot-core/xmp-bytes";
import { describe, expect, it, vi } from "vitest";

import { patchScreenshot } from "./fixture.js";

// ─── Test fixture helpers ──────────────────────────────────────────

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A real PNG via annot-annotator's own raster path (matches the
 *  pattern from `render.test.ts:makePng`). */
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

/**
 * Build a tiny stub `Page` for unit-testing `patchScreenshot`. The
 * stub's `screenshot` + `locator` MUST live on the prototype (not as
 * instance properties), so production's
 * `Object.getPrototypeOf(page).screenshot` patch lands. We track
 * invocations via a `vi.fn()` mutated onto the prototype.
 */
interface StubPage {
  screenshot: (opts?: unknown) => Promise<Buffer>;
  locator: (...args: unknown[]) => unknown;
  getByRole: (...args: unknown[]) => unknown;
}

function makeStubPage(opts: { snapshotYaml: string; pngBytes: Buffer }): StubPage {
  // Build a fresh prototype per stub so the per-instance `vi.fn()`
  // counters don't bleed across tests.
  //
  // The stub mocks just enough of Playwright's `Page` surface for
  // `captureScreen` from `@ingcreators/annot-product-docs` to run
  // headlessly: `locator()`, `getByRole()`, and `screenshot()`.
  // Returned "locators" support the `ariaSnapshot()` /
  // `evaluate()` / `first()` calls captureScreen makes.
  const locatorLike = {
    ariaSnapshot: async () => opts.snapshotYaml,
    evaluate: async () => null,
    first() {
      return this;
    },
    count: async () => 0,
  };
  const proto: StubPage = {
    screenshot: vi.fn(
      async (_opts?: unknown) => opts.pngBytes,
    ) as unknown as StubPage["screenshot"],
    locator: () => locatorLike,
    getByRole: () => locatorLike,
  };
  return Object.create(proto) as StubPage;
}

/**
 * Read the original (un-patched) `screenshot` `vi.fn()` mock off the
 * stub's prototype. The pass-through tests use this to assert call
 * counts AFTER the patch wraps the proto method.
 */
function getOriginalScreenshotMock(
  stub: StubPage,
): ReturnType<typeof vi.fn<(opts?: unknown) => Promise<Buffer>>> {
  return (Object.getPrototypeOf(stub) as Record<string, unknown>).screenshot as ReturnType<
    typeof vi.fn<(opts?: unknown) => Promise<Buffer>>
  >;
}

function fixtureMdx(snapshotBlock: string): string {
  return `---
annot:
  id: SC-001
---

import { Screen, Overlay } from "@ingcreators/annot-product-docs-astro";

# Test

<Screen id="login" src="./shot.png">
<Overlay match={{ role: "textbox", name: "Email" }} intent="required" number={1}>
Email
</Overlay>
<Overlay match={{ role: "button", name: "Sign in" }} intent="action" number={2}>
Sign in
</Overlay>
</Screen>

${snapshotBlock}
`;
}

async function makeMdxFixture(snapshotBlock: string): Promise<{ mdxPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "annot-playwright-fixture-test-"));
  const mdxPath = join(dir, "screen.mdx");
  await writeFile(mdxPath, fixtureMdx(snapshotBlock));
  return { mdxPath };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("patchScreenshot — pass-through behaviour", () => {
  it("calls original screenshot unchanged when annot is absent", async () => {
    const pngBytes = makePng(400, 300);
    const stub = makeStubPage({ snapshotYaml: "", pngBytes });
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
    const stub = makeStubPage({ snapshotYaml: "", pngBytes });
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
    const stub = makeStubPage({ snapshotYaml: "", pngBytes });
    const originalSpy = getOriginalScreenshotMock(stub);
    patchScreenshot(Object.getPrototypeOf(stub));
    await stub.screenshot({ annot: {} });
    expect(originalSpy).toHaveBeenCalledTimes(1);
    expect(originalSpy.mock.calls[0]?.[0]).toEqual({ annot: {} });
  });

  it("`annot: { editable: true }` alone (no source) falls through", async () => {
    const pngBytes = makePng(100, 100);
    const stub = makeStubPage({ snapshotYaml: "", pngBytes });
    const originalSpy = getOriginalScreenshotMock(stub);
    patchScreenshot(Object.getPrototypeOf(stub));
    await stub.screenshot({ annot: { editable: true } });
    expect(originalSpy).toHaveBeenCalledTimes(1);
  });
});

describe("patchScreenshot — annot mode", () => {
  it("`{ tags }` only writes a plain PNG + iTXt sidecar (no editable wrap)", async () => {
    const pngBytes = makePng(200, 100);
    const stub = makeStubPage({ snapshotYaml: "", pngBytes });
    patchScreenshot(Object.getPrototypeOf(stub));
    const result = await stub.screenshot({
      annot: { tags: { source: "vrt-failure", testId: "login" } },
    });
    // It's still a valid PNG.
    expect(Array.from(result.subarray(0, 8))).toEqual(PNG_MAGIC);
    // But NOT a re-editable Annot PNG — no <annot:annotations>.
    expect(readEditablePngBytes(new Uint8Array(result))).toBeNull();
    // The tag values appear in the iTXt chunk bytes.
    const text = Array.from(new Uint8Array(result))
      .map((b) => String.fromCharCode(b))
      .join("");
    expect(text).toContain('"source":"vrt-failure"');
    expect(text).toContain('"testId":"login"');
    expect(text).not.toContain("annot:annotations");
  });

  it("`{ overlays }` writes an editable PNG (annotations + embedded original)", async () => {
    const pngBytes = makePng(400, 300);
    const stub = makeStubPage({ snapshotYaml: "", pngBytes });
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
    // No tags supplied → empty tags object on read.
    expect(meta!.tags).toEqual({});
  });

  it("`{ overlays, tags }` merges user tags into the editable PNG XMP", async () => {
    const pngBytes = makePng(400, 300);
    const stub = makeStubPage({ snapshotYaml: "", pngBytes });
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
    const stub = makeStubPage({ snapshotYaml: "", pngBytes });
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
    // No re-editable Annot record.
    expect(readEditablePngBytes(new Uint8Array(result))).toBeNull();
    // Output differs from the raw input (overlay baked in).
    expect(result.length).not.toBe(pngBytes.length);
  });
});

describe("patchScreenshot — MDX source", () => {
  it("`{ mdx }` refreshes the MDX snapshot and writes an editable PNG", async () => {
    // Start with an MDX that has no snapshot block.
    const { mdxPath } = await makeMdxFixture("");
    const pngBytes = makePng(400, 300);
    // Stub returns a YAML snapshot with bbox markers for both overlays.
    const snapshotYaml =
      "- generic\n" +
      '  - textbox "Email" [ref=e1] [box=10,20,200,30]\n' +
      '  - button "Sign in" [ref=e9] [box=150,100,80,30]';
    const stub = makeStubPage({ snapshotYaml, pngBytes });
    patchScreenshot(Object.getPrototypeOf(stub));

    const result = await stub.screenshot({
      annot: { mdx: { id: "login", path: mdxPath } },
    });
    // 1. The PNG carries an editable XMP record.
    const meta = readEditablePngBytes(new Uint8Array(result));
    expect(meta).not.toBeNull();
    expect(meta!.annotationsSvg).toContain("rect"); // badge primitives
    // 2. The MDX file was rewritten with the snapshot YAML.
    const mdxAfter = await readFile(mdxPath, "utf8");
    expect(mdxAfter).toContain("annot:snapshot");
    expect(mdxAfter).toContain("[box=10,20,200,30]");
  });

  it("`{ mdx, overlays }` merges MDX-derived + inline overlays in the same SVG", async () => {
    const { mdxPath } = await makeMdxFixture(
      `{/* annot:snapshot
- textbox "Email" [ref=e1] [box=10,20,200,30]
- button "Sign in" [ref=e9] [box=150,100,80,30]
*/}`,
    );
    const pngBytes = makePng(400, 300);
    // The stub's ariaSnapshot return is what `captureScreen` writes;
    // for this test we want the MDX snapshot block as-is, so the
    // captureScreen rewrite still happens but doesn't change the
    // bbox content (same yaml).
    const snapshotYaml =
      "- generic\n" +
      '  - textbox "Email" [ref=e1] [box=10,20,200,30]\n' +
      '  - button "Sign in" [ref=e9] [box=150,100,80,30]';
    const stub = makeStubPage({ snapshotYaml, pngBytes });
    patchScreenshot(Object.getPrototypeOf(stub));

    const result = await stub.screenshot({
      annot: {
        mdx: { id: "login", path: mdxPath },
        overlays: [
          { type: "rect", bbox: { x: 300, y: 200, width: 50, height: 50 }, intent: "info" },
        ],
      },
    });
    const meta = readEditablePngBytes(new Uint8Array(result));
    expect(meta).not.toBeNull();
    // Two badge primitives (from MDX) PLUS the inline rect.
    const svg = meta!.annotationsSvg;
    expect(svg).toContain("rect"); // inline rect
    // Badge primitives render as `<rect>` + `<text>` etc. — count
    // text occurrences as a proxy for badge presence (each badge
    // emits a text element with its number).
    const textTagCount = (svg.match(/<text/g) ?? []).length;
    expect(textTagCount).toBeGreaterThanOrEqual(2);
  });

  it("`{ mdx }` with no MDX-resolved overlays still produces an editable wrap (Open Question 5)", async () => {
    // MDX without snapshot block → buildBadgeAnnotations returns [].
    const { mdxPath } = await makeMdxFixture("");
    const pngBytes = makePng(400, 300);
    // Stub returns empty snapshot — no bbox markers → 0 resolved overlays.
    const stub = makeStubPage({ snapshotYaml: "", pngBytes });
    patchScreenshot(Object.getPrototypeOf(stub));

    const result = await stub.screenshot({
      annot: { mdx: { id: "login", path: mdxPath } },
    });
    // Even with no overlays, the editable wrap exists.
    const meta = readEditablePngBytes(new Uint8Array(result));
    expect(meta).not.toBeNull();
    // Empty annotations layer.
    expect(meta!.annotationsSvg).toMatch(/<svg[^>]*><\/svg>/);
  });
});

describe("patchScreenshot — locator screenshots (Phase 2)", () => {
  /**
   * Build a stub Locator with a configurable boundingBox + page()
   * accessor and a `screenshot` mock returning the cropped bytes.
   * The patch lands on the prototype just like for Pages.
   */
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
          // In page-space: bbox at (120,60) — INSIDE the locator clip.
          { type: "rect", bbox: { x: 120, y: 60, width: 50, height: 30 }, intent: "warning" },
        ],
      },
    });
    const meta = readEditablePngBytes(new Uint8Array(result));
    expect(meta).not.toBeNull();
    // Rebased: x=120-100=20, y=60-50=10. SVG should reference these.
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
          // INSIDE
          { type: "rect", bbox: { x: 120, y: 60, width: 30, height: 30 } },
          // OUTSIDE (left of clip)
          { type: "rect", bbox: { x: 0, y: 0, width: 30, height: 30 } },
          // OUTSIDE (right of clip)
          { type: "rect", bbox: { x: 350, y: 60, width: 30, height: 30 } },
        ],
      },
    });
    const meta = readEditablePngBytes(new Uint8Array(result));
    expect(meta).not.toBeNull();
    // Only the in-clip rect survives. Count rect tags in the svg.
    const rectMatches = meta!.annotationsSvg.match(/<rect/g) ?? [];
    // The annotator may add additional rects internally; assert
    // at least one (the kept one) and that the dropped coords
    // (0,0 / 350,60) are NOT present.
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
    // No re-editable record (tags-only).
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
    // The stub returns the cropped bytes directly — Playwright would
    // ordinarily perform the cropping itself when `clip` is set.
    const stub = makeStubPage({ snapshotYaml: "", pngBytes: croppedPngBytes });
    patchScreenshot(Object.getPrototypeOf(stub));
    const result = await stub.screenshot({
      clip: { x: 100, y: 50, width: 200, height: 150 },
      annot: {
        overlays: [
          { type: "rect", bbox: { x: 120, y: 60, width: 30, height: 20 }, intent: "info" },
          { type: "rect", bbox: { x: 0, y: 0, width: 30, height: 20 } }, // outside
        ],
      },
    });
    const meta = readEditablePngBytes(new Uint8Array(result));
    expect(meta).not.toBeNull();
    // Inside rect rebased: x=20, y=10
    expect(meta!.annotationsSvg).toMatch(/x="?20"?/);
    // Outside rect dropped
    const rectMatches = meta!.annotationsSvg.match(/<rect/g) ?? [];
    expect(rectMatches.length).toBeGreaterThanOrEqual(1);
  });
});

describe("patchScreenshot — invariants", () => {
  it("is idempotent: applying twice doesn't double-wrap", async () => {
    const pngBytes = makePng(100, 100);
    const stub = makeStubPage({ snapshotYaml: "", pngBytes });
    const proto = Object.getPrototypeOf(stub);
    const beforeFirst = proto.screenshot;
    patchScreenshot(proto);
    const afterFirst = proto.screenshot;
    expect(afterFirst).not.toBe(beforeFirst);
    patchScreenshot(proto);
    const afterSecond = proto.screenshot;
    // Second patch is a no-op — same wrapped function as after first.
    expect(afterSecond).toBe(afterFirst);
  });

  it("writes to disk when `path` is supplied (vanilla page.screenshot semantics)", async () => {
    const pngBytes = makePng(200, 100);
    const stub = makeStubPage({ snapshotYaml: "", pngBytes });
    patchScreenshot(Object.getPrototypeOf(stub));
    const dir = await mkdtemp(join(tmpdir(), "annot-playwright-fixture-test-"));
    const outPath = join(dir, "out.png");
    const result = await stub.screenshot({
      path: outPath,
      annot: { tags: { source: "test" } },
    });
    // Returned bytes match what was written.
    const onDisk = await readFile(outPath);
    expect(Array.from(onDisk)).toEqual(Array.from(result));
  });
});
