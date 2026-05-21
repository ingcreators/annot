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
