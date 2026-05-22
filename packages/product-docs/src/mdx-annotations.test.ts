import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AnnotationSpec } from "./annotations-yaml.js";
import {
  type BoxedEntry,
  buildBadgeAnnotations,
  buildShapeAnnotationsFromYaml,
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

// ─── Phase 3c — buildShapeAnnotationsFromYaml ──────────────────

const BOXED: BoxedEntry[] = [
  { role: "textbox", name: "Email", ref: "e1", box: { x: 20, y: 40, width: 200, height: 30 } },
  { role: "textbox", name: "Password", ref: "e2", box: { x: 20, y: 90, width: 200, height: 30 } },
  { role: "button", name: "Sign in", ref: "e9", box: { x: 150, y: 150, width: 80, height: 30 } },
  { role: "heading", name: "Sign in", ref: "e10", box: { x: 10, y: 0, width: 380, height: 25 } },
];
const DIMS = { width: 400, height: 300 };

describe("Phase 3c — buildShapeAnnotationsFromYaml", () => {
  it("returns empty for empty input", () => {
    expect(buildShapeAnnotationsFromYaml([], BOXED, DIMS)).toEqual([]);
  });

  it("maps rect (match) to a BboxRectAnnotation at the element bbox", () => {
    const spec: AnnotationSpec = {
      id: "r1",
      kind: "rect",
      match: { role: "textbox", name: "Email" },
      intent: "info",
    };
    const out = buildShapeAnnotationsFromYaml([spec], BOXED, DIMS);
    expect(out).toEqual([
      {
        type: "rect",
        bbox: { x: 20, y: 40, width: 200, height: 30 },
        intent: "info",
      },
    ]);
  });

  it("maps rect (coversElements) to the bbox union", () => {
    const spec: AnnotationSpec = {
      id: "r1",
      kind: "rect",
      coversElements: [
        { role: "textbox", name: "Email" },
        { role: "textbox", name: "Password" },
      ],
    };
    const out = buildShapeAnnotationsFromYaml([spec], BOXED, DIMS);
    expect(out[0]).toMatchObject({
      type: "rect",
      bbox: { x: 20, y: 40, width: 200, height: 80 }, // 40 → 120 = height 80
    });
  });

  it("maps rect (bbox) to a free-coord rect", () => {
    const spec: AnnotationSpec = {
      id: "r1",
      kind: "rect",
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      stroke: "#abcdef",
      strokeWidth: 5,
    };
    const out = buildShapeAnnotationsFromYaml([spec], BOXED, DIMS);
    expect(out[0]).toMatchObject({
      type: "rect",
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      stroke: "#abcdef",
      strokeWidth: 5,
    });
  });

  it("skips entries whose match doesn't resolve", () => {
    const spec: AnnotationSpec = {
      id: "r1",
      kind: "rect",
      match: { role: "textbox", name: "Missing" },
    };
    expect(buildShapeAnnotationsFromYaml([spec], BOXED, DIMS)).toEqual([]);
  });

  it("maps circle (match) → center + radius from the element bbox", () => {
    const spec: AnnotationSpec = {
      id: "c1",
      kind: "circle",
      match: { role: "button", name: "Sign in" },
    };
    const [c] = buildShapeAnnotationsFromYaml([spec], BOXED, DIMS);
    // bbox = (150, 150, 80x30) → center = (190, 165), radius = max(80,30)/2 = 40
    expect(c).toMatchObject({
      type: "circle",
      center: { x: 190, y: 165 },
      radius: 40,
    });
  });

  it("maps circle (center + radius) verbatim", () => {
    const spec: AnnotationSpec = {
      id: "c1",
      kind: "circle",
      center: { x: 100, y: 200 },
      radius: 12,
    };
    expect(buildShapeAnnotationsFromYaml([spec], BOXED, DIMS)[0]).toMatchObject({
      type: "circle",
      center: { x: 100, y: 200 },
      radius: 12,
    });
  });

  it("maps arrow (match → match) to center-to-center endpoints", () => {
    const spec: AnnotationSpec = {
      id: "a1",
      kind: "arrow",
      from: { match: { role: "textbox", name: "Email" } },
      to: { match: { role: "button", name: "Sign in" } },
      intent: "action",
    };
    const [a] = buildShapeAnnotationsFromYaml([spec], BOXED, DIMS);
    // Email bbox center: (120, 55), Sign in bbox center: (190, 165)
    expect(a).toMatchObject({
      type: "arrow",
      from: { x: 120, y: 55 },
      to: { x: 190, y: 165 },
      intent: "warning", // action → warning per the mapping
    });
  });

  it("maps arrow (match → point) to a mixed-endpoint arrow", () => {
    const spec: AnnotationSpec = {
      id: "a1",
      kind: "arrow",
      from: { point: { x: 0, y: 0 } },
      to: { match: { role: "button", name: "Sign in" } },
    };
    const [a] = buildShapeAnnotationsFromYaml([spec], BOXED, DIMS);
    expect(a).toMatchObject({
      type: "arrow",
      from: { x: 0, y: 0 },
      to: { x: 190, y: 165 },
    });
  });

  it("maps text (anchor: above) to a centred point above the element", () => {
    const spec: AnnotationSpec = {
      id: "t1",
      kind: "text",
      text: "Sign-in form",
      anchor: { match: { role: "heading", name: "Sign in" }, position: "above" },
    };
    const [t] = buildShapeAnnotationsFromYaml([spec], BOXED, DIMS);
    // heading bbox = (10, 0, 380x25) → center x = 200, above-y = 0 - 8 = -8
    expect(t).toMatchObject({
      type: "text",
      content: "Sign-in form",
      at: { x: 200, y: -8 },
      anchor: "middle",
    });
  });

  it("maps text (at) to a free-coord label", () => {
    const spec: AnnotationSpec = {
      id: "t1",
      kind: "text",
      text: "label",
      at: { x: 100, y: 100 },
      fontSize: 18,
      color: "#ff0000",
    };
    expect(buildShapeAnnotationsFromYaml([spec], BOXED, DIMS)[0]).toMatchObject({
      type: "text",
      content: "label",
      at: { x: 100, y: 100 },
      fontSize: 18,
      color: "#ff0000",
    });
  });

  it("maps callout (target.match) to a callout with the element bbox as target", () => {
    const spec: AnnotationSpec = {
      id: "ca1",
      kind: "callout",
      text: "Authenticates.",
      target: { match: { role: "button", name: "Sign in" } },
      at: { x: 50, y: 50 },
    };
    expect(buildShapeAnnotationsFromYaml([spec], BOXED, DIMS)[0]).toMatchObject({
      type: "callout",
      at: { x: 50, y: 50 },
      targetBbox: { x: 150, y: 150, width: 80, height: 30 },
      content: "Authenticates.",
    });
  });

  it("maps freehand verbatim with default fill: none + intent default", () => {
    const spec: AnnotationSpec = {
      id: "fh1",
      kind: "freehand",
      path: "M0,0 L10,10",
      intent: "info",
    };
    expect(buildShapeAnnotationsFromYaml([spec], BOXED, DIMS)[0]).toMatchObject({
      type: "freehand",
      path: "M0,0 L10,10",
      intent: "info",
    });
  });

  it("maps redact (match) to a filled rect with neutral censor-bar defaults", () => {
    const spec: AnnotationSpec = {
      id: "rd1",
      kind: "redact",
      match: { role: "textbox", name: "Email" },
      style: "solid",
    };
    expect(buildShapeAnnotationsFromYaml([spec], BOXED, DIMS)[0]).toMatchObject({
      type: "rect",
      bbox: { x: 20, y: 40, width: 200, height: 30 },
      fill: "#222222",
      stroke: "none",
      strokeWidth: 0,
    });
  });

  it("maps redact (bbox + explicit fill) honours the override", () => {
    const spec: AnnotationSpec = {
      id: "rd1",
      kind: "redact",
      bbox: { x: 0, y: 0, width: 50, height: 10 },
      fill: "#ff00ff",
    };
    expect(buildShapeAnnotationsFromYaml([spec], BOXED, DIMS)[0]).toMatchObject({
      type: "rect",
      bbox: { x: 0, y: 0, width: 50, height: 10 },
      fill: "#ff00ff",
    });
  });

  it("maps focusMask (match + padding) with expanded cutout + image dims", () => {
    const spec: AnnotationSpec = {
      id: "fm1",
      kind: "focusMask",
      cutout: { match: { role: "button", name: "Sign in" }, padding: 8 },
    };
    expect(buildShapeAnnotationsFromYaml([spec], BOXED, DIMS)[0]).toMatchObject({
      type: "focusMask",
      cutout: { x: 142, y: 142, width: 96, height: 46 }, // 150-8, 150-8, 80+16, 30+16
      imageWidth: 400,
      imageHeight: 300,
    });
  });

  it("maps focusMask (bbox + dimColor) with explicit cutout + override", () => {
    const spec: AnnotationSpec = {
      id: "fm1",
      kind: "focusMask",
      cutout: { bbox: { x: 0, y: 0, width: 100, height: 100 } },
      dimColor: "rgba(0,0,0,0.7)",
    };
    expect(buildShapeAnnotationsFromYaml([spec], BOXED, DIMS)[0]).toMatchObject({
      type: "focusMask",
      cutout: { x: 0, y: 0, width: 100, height: 100 },
      imageWidth: 400,
      imageHeight: 300,
      dimColor: "rgba(0,0,0,0.7)",
    });
  });

  it("composes multiple annotations preserving input order", () => {
    const specs: AnnotationSpec[] = [
      { id: "r1", kind: "rect", match: { role: "textbox", name: "Email" } },
      {
        id: "fh1",
        kind: "freehand",
        path: "M0,0 L10,10",
      },
      {
        id: "a1",
        kind: "arrow",
        from: { point: { x: 0, y: 0 } },
        to: { point: { x: 100, y: 100 } },
      },
    ];
    const out = buildShapeAnnotationsFromYaml(specs, BOXED, DIMS);
    expect(out.map((a) => a.type)).toEqual(["rect", "freehand", "arrow"]);
  });
});
