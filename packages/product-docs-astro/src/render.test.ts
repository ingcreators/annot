// Unit tests for the Image Service's `renderAnnotatedScreen`.
//
// We avoid Playwright entirely — the renderer takes a parsed MDX
// (with stored `annot:snapshot` block) + a base PNG on disk, so
// the test can synthesise both from raw bytes.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAnnotator } from "@ingcreators/annot-annotator";

import { describe, expect, it } from "vitest";

import { createMemoryCache } from "./cache.js";
import { parseSnapshotBoxes, renderAnnotatedScreen } from "./render.js";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Produce a real PNG via annot-annotator's own raster path —
 *  same approach as `annot-playwright/fixture.test.ts:makePng`. */
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

function fixtureMdx(snapshotBlock: string): string {
  return `---
annot:
  id: SC-001
---

import { Screen, Overlay } from "@ingcreators/annot-product-docs-astro";

# Login

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

async function makeFixture(snapshotBlock: string): Promise<{ mdxPath: string; pngBytes: Buffer }> {
  const dir = await mkdtemp(join(tmpdir(), "annot-render-test-"));
  const mdxPath = join(dir, "screen.mdx");
  const pngPath = join(dir, "shot.png");
  const pngBytes = makePng(400, 300);
  await writeFile(pngPath, pngBytes);
  await writeFile(mdxPath, fixtureMdx(snapshotBlock));
  return { mdxPath, pngBytes };
}

describe("parseSnapshotBoxes", () => {
  it("returns empty for lines without box markers", () => {
    const out = parseSnapshotBoxes(`- textbox "Email" [ref=e1]
- button "Save" [ref=e2]`);
    expect(out).toEqual([]);
  });

  it("extracts role + name + ref + box for entries that have all four", () => {
    const out = parseSnapshotBoxes(
      `- textbox "Email" [ref=e1] [box=10,20,200,30]
- button "Sign in" [ref=e9] [box=100,80,120,40]`,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      role: "textbox",
      name: "Email",
      ref: "e1",
      box: { x: 10, y: 20, width: 200, height: 30 },
    });
    expect(out[1]?.box).toEqual({ x: 100, y: 80, width: 120, height: 40 });
  });

  it("accepts decimal coordinates", () => {
    const out = parseSnapshotBoxes('- textbox "Email" [ref=e1] [box=10.5,20.25,200.0,30.75]');
    expect(out[0]?.box).toEqual({ x: 10.5, y: 20.25, width: 200, height: 30.75 });
  });
});

describe("renderAnnotatedScreen", () => {
  it("throws on MDX without annot frontmatter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "annot-render-test-"));
    const mdxPath = join(dir, "plain.mdx");
    await writeFile(mdxPath, "# Just plain\n");
    await expect(renderAnnotatedScreen({ mdxPath, screenId: "x" })).rejects.toThrow(
      /no `annot:` frontmatter/,
    );
  });

  it("throws when the screen id is missing", async () => {
    const { mdxPath } = await makeFixture("");
    await expect(renderAnnotatedScreen({ mdxPath, screenId: "does-not-exist" })).rejects.toThrow(
      /has no <Screen id="does-not-exist">/,
    );
  });

  it("returns the base PNG verbatim when no bbox data is available", async () => {
    const { mdxPath, pngBytes } = await makeFixture("");
    const result = await renderAnnotatedScreen({ mdxPath, screenId: "login" });
    expect(result.hadBoundingBoxes).toBe(false);
    expect(Array.from(result.bytes.slice(0, 8))).toEqual(PNG_MAGIC);
    expect(result.bytes.length).toBe(pngBytes.length);
  });

  it("annotates the PNG when bbox markers are present", async () => {
    const snapshotBlock = `{/* annot:snapshot
- textbox "Email" [ref=e1] [box=20,40,200,30]
- button "Sign in" [ref=e9] [box=150,100,80,30]
*/}`;
    const { mdxPath, pngBytes } = await makeFixture(snapshotBlock);
    const result = await renderAnnotatedScreen({ mdxPath, screenId: "login" });
    expect(result.hadBoundingBoxes).toBe(true);
    expect(Array.from(result.bytes.slice(0, 8))).toEqual(PNG_MAGIC);
    // Annotated PNG should differ byte-wise from the base — there
    // are callouts composited on top. The exact length depends on
    // libpng / resvg variance so we only compare bytes.
    const baseArr = Array.from(pngBytes);
    const annotatedArr = Array.from(result.bytes);
    expect(annotatedArr).not.toEqual(baseArr);
  });

  it("caches by SHA — second call returns the cached buffer", async () => {
    const snapshotBlock = `{/* annot:snapshot
- textbox "Email" [ref=e1] [box=20,40,200,30]
*/}`;
    const { mdxPath } = await makeFixture(snapshotBlock);
    const cache = createMemoryCache();

    const first = await renderAnnotatedScreen({ mdxPath, screenId: "login", cache });
    expect(first.fromCache).toBe(false);

    const second = await renderAnnotatedScreen({ mdxPath, screenId: "login", cache });
    expect(second.fromCache).toBe(true);
    // Cached buffer is the same instance/contents.
    expect(Array.from(second.bytes)).toEqual(Array.from(first.bytes));
  });
});
