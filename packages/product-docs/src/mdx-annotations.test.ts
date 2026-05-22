import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildBadgeAnnotations,
  emptyAnnotationsSvg,
  parseSnapshotBoxes,
  resolveMdxAnnotations,
  svgFromBboxAnnotations,
} from "./mdx-annotations.js";
import type { OverlaySpec } from "./types.js";

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

async function makeMdxFixture(snapshotBlock: string): Promise<{ mdxPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "annot-mdx-annotations-test-"));
  const mdxPath = join(dir, "screen.mdx");
  await writeFile(mdxPath, fixtureMdx(snapshotBlock));
  return { mdxPath };
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

describe("buildBadgeAnnotations", () => {
  it("matches overlay role+name to boxed entries and assigns the overlay's number", () => {
    const overlays: OverlaySpec[] = [
      { match: { role: "textbox", name: "Email" }, intent: "required", number: 1, body: "" },
      { match: { role: "button", name: "Sign in" }, intent: "action", number: 2, body: "" },
    ];
    const boxed = parseSnapshotBoxes(
      `- textbox "Email" [ref=e1] [box=10,20,200,30]
- button "Sign in" [ref=e9] [box=100,80,120,40]`,
    );
    const ann = buildBadgeAnnotations(overlays, boxed, { width: 800, height: 600 });
    expect(ann).toHaveLength(2);
    expect(ann[0]).toMatchObject({
      type: "numberedBadge",
      bbox: { x: 10, y: 20, width: 200, height: 30 },
      number: 1,
      placement: "auto",
      imageWidth: 800,
      imageHeight: 600,
      intent: "error", // required → error
    });
    expect(ann[1]?.intent).toBe("warning"); // action → warning
  });

  it("auto-numbers overlays that omit `number`", () => {
    const overlays: OverlaySpec[] = [
      { match: { role: "textbox", name: "Email" }, body: "" },
      { match: { role: "button", name: "Sign in" }, body: "" },
    ];
    const boxed = parseSnapshotBoxes(
      `- textbox "Email" [ref=e1] [box=10,20,200,30]
- button "Sign in" [ref=e9] [box=100,80,120,40]`,
    );
    const ann = buildBadgeAnnotations(overlays, boxed, { width: 800, height: 600 });
    expect(ann.map((a) => a.number)).toEqual([1, 2]);
  });

  it("skips overlays whose match has no boxed entry", () => {
    const overlays: OverlaySpec[] = [
      { match: { role: "textbox", name: "Email" }, body: "" },
      { match: { role: "button", name: "Missing" }, body: "" },
    ];
    const boxed = parseSnapshotBoxes(`- textbox "Email" [ref=e1] [box=10,20,200,30]`);
    const ann = buildBadgeAnnotations(overlays, boxed, { width: 800, height: 600 });
    expect(ann).toHaveLength(1);
  });

  it("defaults intent to info when overlay has no intent and no required/action shorthand", () => {
    const overlays: OverlaySpec[] = [{ match: { role: "textbox", name: "Email" }, body: "" }];
    const boxed = parseSnapshotBoxes(`- textbox "Email" [ref=e1] [box=0,0,10,10]`);
    const ann = buildBadgeAnnotations(overlays, boxed, { width: 100, height: 100 });
    expect(ann[0]?.intent).toBe("info");
  });
});

describe("resolveMdxAnnotations", () => {
  it("throws on MDX without annot frontmatter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "annot-mdx-annotations-test-"));
    const mdxPath = join(dir, "plain.mdx");
    await writeFile(mdxPath, "# Just plain\n");
    await expect(
      resolveMdxAnnotations({ mdxPath, screenId: "x", dims: { width: 100, height: 100 } }),
    ).rejects.toThrow(/no `annot:` frontmatter/);
  });

  it("throws when the screen id is missing", async () => {
    const { mdxPath } = await makeMdxFixture("");
    await expect(
      resolveMdxAnnotations({
        mdxPath,
        screenId: "does-not-exist",
        dims: { width: 100, height: 100 },
      }),
    ).rejects.toThrow(/has no <Screen id="does-not-exist">/);
  });

  it("returns empty when no bbox data is in the snapshot block", async () => {
    const { mdxPath } = await makeMdxFixture("");
    const ann = await resolveMdxAnnotations({
      mdxPath,
      screenId: "login",
      dims: { width: 400, height: 300 },
    });
    expect(ann).toEqual([]);
  });

  it("resolves <Overlay> blocks against the snapshot block's [box=...] markers", async () => {
    const snapshotBlock = `{/* annot:snapshot
- textbox "Email" [ref=e1] [box=20,40,200,30]
- button "Sign in" [ref=e9] [box=150,100,80,30]
*/}`;
    const { mdxPath } = await makeMdxFixture(snapshotBlock);
    const ann = await resolveMdxAnnotations({
      mdxPath,
      screenId: "login",
      dims: { width: 400, height: 300 },
    });
    expect(ann).toHaveLength(2);
    expect(ann[0]).toMatchObject({
      type: "numberedBadge",
      bbox: { x: 20, y: 40, width: 200, height: 30 },
      number: 1,
      imageWidth: 400,
      imageHeight: 300,
      intent: "error",
    });
    expect(ann[1]).toMatchObject({
      bbox: { x: 150, y: 100, width: 80, height: 30 },
      number: 2,
      intent: "warning",
    });
  });
});

describe("svgFromBboxAnnotations / emptyAnnotationsSvg", () => {
  it("emptyAnnotationsSvg returns the empty wrapper", () => {
    expect(emptyAnnotationsSvg()).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  });

  it("svgFromBboxAnnotations returns the empty wrapper for an empty array", () => {
    expect(svgFromBboxAnnotations([])).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  });

  it("svgFromBboxAnnotations wraps the multi-root fragment in a single-root <svg>", () => {
    const svg = svgFromBboxAnnotations([
      { type: "rect", bbox: { x: 0, y: 0, width: 10, height: 10 } },
    ]);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg">')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain("<rect");
  });
});
