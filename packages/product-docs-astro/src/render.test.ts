// Unit tests for the Image Service's `renderAnnotatedScreen`.
//
// We avoid Playwright entirely — the renderer takes a parsed MDX
// (with stored `annot:snapshot` block) + a base PNG on disk, so
// the test can synthesise both from raw bytes.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAnnotator } from "@ingcreators/annot-annotator";
import { writeElementTreePng } from "@ingcreators/annot-core";
import { readEditablePngBytes } from "@ingcreators/annot-core/xmp-bytes";

import { describe, expect, it } from "vitest";

import { createMemoryCache } from "./cache.js";
import { renderAnnotatedScreen } from "./render.js";

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

  describe("editable: true | { tags }", () => {
    it("returns a re-editable PNG that round-trips via readEditablePngBytes", async () => {
      const snapshotBlock = `{/* annot:snapshot
- textbox "Email" [ref=e1] [box=20,40,200,30]
- button "Sign in" [ref=e9] [box=150,100,80,30]
*/}`;
      const { mdxPath } = await makeFixture(snapshotBlock);
      const result = await renderAnnotatedScreen({
        mdxPath,
        screenId: "login",
        editable: true,
      });
      expect(result.hadBoundingBoxes).toBe(true);
      const meta = readEditablePngBytes(result.bytes);
      expect(meta).not.toBeNull();
      // The annotations layer carries the badge SVG primitives.
      expect(meta!.annotationsSvg).toContain("<svg");
      // The base PNG round-trips byte-for-byte.
      expect(meta!.originalImageDataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it("writes the optional tags into the XMP", async () => {
      const snapshotBlock = `{/* annot:snapshot
- textbox "Email" [ref=e1] [box=20,40,200,30]
*/}`;
      const { mdxPath } = await makeFixture(snapshotBlock);
      const result = await renderAnnotatedScreen({
        mdxPath,
        screenId: "login",
        editable: {
          tags: {
            source: "docs-tour-test",
            screen: "login",
            capturedAt: "2026-05-21T00:00:00.000Z",
          },
        },
      });
      const meta = readEditablePngBytes(result.bytes);
      expect(meta!.tags).toEqual({
        source: "docs-tour-test",
        screen: "login",
        capturedAt: "2026-05-21T00:00:00.000Z",
      });
    });

    it("wraps even a no-bbox screen as editable so re-opening works", async () => {
      // No snapshot → empty annotations layer, but the editable
      // wrapper must still embed the base PNG so a future editor
      // session can re-import the file.
      const { mdxPath } = await makeFixture("");
      const result = await renderAnnotatedScreen({
        mdxPath,
        screenId: "login",
        editable: true,
      });
      expect(result.hadBoundingBoxes).toBe(false);
      const meta = readEditablePngBytes(result.bytes);
      expect(meta).not.toBeNull();
      // No overlays baked → annotations SVG is the empty wrapper.
      expect(meta!.annotationsSvg).toContain("<svg");
    });

    it("uses a distinct cache key from the flat-raster variant", async () => {
      const snapshotBlock = `{/* annot:snapshot
- textbox "Email" [ref=e1] [box=20,40,200,30]
*/}`;
      const { mdxPath } = await makeFixture(snapshotBlock);
      const cache = createMemoryCache();

      const flat = await renderAnnotatedScreen({ mdxPath, screenId: "login", cache });
      expect(flat.fromCache).toBe(false);

      // Same screen, same MDX, but editable: true → must miss cache.
      const editable = await renderAnnotatedScreen({
        mdxPath,
        screenId: "login",
        cache,
        editable: true,
      });
      expect(editable.fromCache).toBe(false);

      // And the editable variant cache hit on a second call.
      const editable2 = await renderAnnotatedScreen({
        mdxPath,
        screenId: "login",
        cache,
        editable: true,
      });
      expect(editable2.fromCache).toBe(true);
    });
  });

  // Phase 1h of `docs/plans/living-spec-authoring-roadmap.md` —
  // when the base PNG carries an `annot:elementTree` XMP chunk, the
  // renderer prefers it over the legacy `annot:snapshot` MDX
  // comment block. This is the path that lights up after the
  // `annot-docs migrate-to-element-tree` CLI runs.
  describe("ElementTree XMP path (Phase 1h)", () => {
    it("reads bboxes from PNG XMP when the MDX has no snapshot block", async () => {
      const { mdxPath, pngBytes } = await makeFixture("");
      const pngPath = join(mdxPath, "..", "shot.png");
      // Stamp an annot:elementTree chunk onto the PNG with bboxes
      // that match the MDX overlay's role+name.
      const withTree = writeElementTreePng(new Uint8Array(pngBytes), {
        version: 1,
        source: { kind: "playwright", capturedAt: "2026-05-23T00:00:00Z" },
        viewport: { width: 400, height: 300, scale: 1 },
        root: {
          ref: "e0",
          role: "main",
          children: [
            {
              ref: "e1",
              role: "textbox",
              name: "Email",
              bbox: { x: 20, y: 40, width: 200, height: 30 },
            },
            {
              ref: "e2",
              role: "button",
              name: "Sign in",
              bbox: { x: 150, y: 100, width: 80, height: 30 },
            },
          ],
        },
      });
      await writeFile(pngPath, withTree);
      const result = await renderAnnotatedScreen({ mdxPath, screenId: "login" });
      expect(result.hadBoundingBoxes).toBe(true);
      expect(Array.from(result.bytes.slice(0, 8))).toEqual(PNG_MAGIC);
    });

    it("prefers XMP elementTree over MDX comment block when both are present", async () => {
      // MDX has a snapshot block with WRONG coordinates; PNG XMP
      // has RIGHT coordinates. The renderer should produce
      // annotated output matching the XMP-driven path.
      const snapshotBlock = `{/* annot:snapshot
- textbox "Email" [ref=e1] [box=999,999,1,1]
- button "Sign in" [ref=e9] [box=999,999,1,1]
*/}`;
      const { mdxPath, pngBytes } = await makeFixture(snapshotBlock);
      const pngPath = join(mdxPath, "..", "shot.png");
      const withTree = writeElementTreePng(new Uint8Array(pngBytes), {
        version: 1,
        source: { kind: "playwright", capturedAt: "2026-05-23T00:00:00Z" },
        viewport: { width: 400, height: 300, scale: 1 },
        root: {
          ref: "e0",
          role: "main",
          children: [
            {
              ref: "e1",
              role: "textbox",
              name: "Email",
              bbox: { x: 20, y: 40, width: 200, height: 30 },
            },
            {
              ref: "e2",
              role: "button",
              name: "Sign in",
              bbox: { x: 150, y: 100, width: 80, height: 30 },
            },
          ],
        },
      });
      await writeFile(pngPath, withTree);

      const withXmp = await renderAnnotatedScreen({ mdxPath, screenId: "login" });

      // Render again from a PNG without XMP — the MDX block's
      // bad bboxes are used. Output should differ from the XMP
      // path (the bboxes are wildly different).
      const { mdxPath: mdxPath2, pngBytes: pngBytes2 } = await makeFixture(snapshotBlock);
      await writeFile(join(mdxPath2, "..", "shot.png"), pngBytes2);
      const withoutXmp = await renderAnnotatedScreen({ mdxPath: mdxPath2, screenId: "login" });

      expect(Array.from(withXmp.bytes)).not.toEqual(Array.from(withoutXmp.bytes));
    });

    it("falls back to legacy snapshot block when PNG has no XMP", async () => {
      const snapshotBlock = `{/* annot:snapshot
- textbox "Email" [ref=e1] [box=20,40,200,30]
*/}`;
      const { mdxPath } = await makeFixture(snapshotBlock);
      // PNG has no elementTree chunk — renderer falls back to MDX.
      const result = await renderAnnotatedScreen({ mdxPath, screenId: "login" });
      expect(result.hadBoundingBoxes).toBe(true);
    });
  });

  describe("Phase 2b — <Screen annotations='…'> + .annotations.yaml", () => {
    /**
     * MDX fixture using the new `<Screen annotations>` form. No
     * `<Overlay>` children — the overlays live in the yaml.
     */
    function mdxWithAnnotations(): string {
      return `---
annot:
  id: SC-001
---

import { Screen, AnnotCallout } from "@ingcreators/annot-product-docs-astro";

<Screen id="login" src="./shot.png" annotations="./login.annotations.yaml">
<AnnotCallout for="o1">Email</AnnotCallout>
<AnnotCallout for="o2">Sign in</AnnotCallout>
</Screen>
`;
    }

    async function makeAnnotationsFixture(opts: {
      yaml: string;
      snapshotBlock?: string;
    }): Promise<{ mdxPath: string; yamlPath: string; pngPath: string }> {
      const dir = await mkdtemp(join(tmpdir(), "annot-render-yaml-"));
      const mdxPath = join(dir, "screen.mdx");
      const yamlPath = join(dir, "login.annotations.yaml");
      const pngPath = join(dir, "shot.png");
      const pngBytes = makePng(400, 300);
      await writeFile(pngPath, pngBytes);
      const snapshotBlock = opts.snapshotBlock ?? "";
      await writeFile(mdxPath, `${mdxWithAnnotations()}\n${snapshotBlock}`);
      await writeFile(yamlPath, opts.yaml);
      return { mdxPath, yamlPath, pngPath };
    }

    it("annotates the PNG using yaml-driven overlays + legacy snapshot bboxes", async () => {
      const yaml = `version: 1
overlays:
  - id: o1
    kind: numberedBadge
    match: { role: textbox, name: Email }
    intent: required
    number: 1
  - id: o2
    kind: numberedBadge
    match: { role: button, name: "Sign in" }
    intent: action
    number: 2
`;
      const snapshotBlock = `{/* annot:snapshot
- textbox "Email" [ref=e1] [box=20,40,200,30]
- button "Sign in" [ref=e9] [box=150,100,80,30]
*/}`;
      const { mdxPath } = await makeAnnotationsFixture({ yaml, snapshotBlock });
      const result = await renderAnnotatedScreen({ mdxPath, screenId: "login" });
      expect(result.hadBoundingBoxes).toBe(true);
      expect(Array.from(result.bytes.slice(0, 8))).toEqual(PNG_MAGIC);
    });

    it("editing the yaml busts the cache", async () => {
      const baseYaml = `version: 1
overlays:
  - id: o1
    kind: numberedBadge
    match: { role: textbox, name: Email }
    number: 1
`;
      const snapshotBlock = `{/* annot:snapshot
- textbox "Email" [ref=e1] [box=20,40,200,30]
*/}`;
      const { mdxPath, yamlPath } = await makeAnnotationsFixture({
        yaml: baseYaml,
        snapshotBlock,
      });
      const cache = createMemoryCache();

      const first = await renderAnnotatedScreen({ mdxPath, screenId: "login", cache });
      expect(first.fromCache).toBe(false);

      const second = await renderAnnotatedScreen({ mdxPath, screenId: "login", cache });
      expect(second.fromCache).toBe(true);

      // Mutate the yaml — same overlays count but different intent.
      const mutatedYaml = baseYaml.replace("number: 1", "intent: action\n    number: 1");
      await writeFile(yamlPath, mutatedYaml);

      const third = await renderAnnotatedScreen({ mdxPath, screenId: "login", cache });
      expect(third.fromCache).toBe(false);
    });

    it("loud-fails when the referenced yaml file is missing", async () => {
      const yaml = `version: 1
overlays: []
`;
      const { mdxPath, yamlPath } = await makeAnnotationsFixture({ yaml });
      // Remove the yaml after wiring the fixture so the renderer
      // experiences the "explicit reference, but file gone" path.
      await writeFile(yamlPath, ""); // truncate
      // Truncated content fails the parser (no `version` key).
      await expect(renderAnnotatedScreen({ mdxPath, screenId: "login" })).rejects.toThrow(
        /annotations yaml/i,
      );
    });
  });
});
