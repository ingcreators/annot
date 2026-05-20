import { describe, expect, test } from "vitest";

import type { BBox, LocatorAnnotation } from "../dsl/types.js";
import {
  type LocatorLike,
  LocatorResolutionError,
  type PageLike,
  resolveLocator,
  resolveLocatorAnnotation,
  resolveLocatorAnnotations,
} from "./resolve-locator.js";

/**
 * Build a stub `PageLike` whose `locator(s)` returns a
 * `LocatorLike` that yields a preset bbox (or `null`) from a
 * lookup table.
 */
function stubPage(bboxes: Record<string, BBox | null>): PageLike {
  return {
    locator(selector: string): LocatorLike {
      return {
        async boundingBox() {
          return bboxes[selector] ?? null;
        },
      };
    },
  };
}

describe("resolveLocator", () => {
  test("returns the bbox for a matching locator", async () => {
    const page = stubPage({ "button#submit": { x: 10, y: 20, width: 100, height: 40 } });
    expect(await resolveLocator(page, "button#submit")).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 40,
    });
  });

  test("throws LocatorResolutionError when boundingBox returns null", async () => {
    const page = stubPage({ "button#missing": null });
    await expect(resolveLocator(page, "button#missing")).rejects.toThrowError(
      LocatorResolutionError,
    );
  });

  test("error message mentions the offending selector", async () => {
    const page = stubPage({});
    await expect(resolveLocator(page, "[data-testid='nope']")).rejects.toThrowError(
      /data-testid='nope'/,
    );
  });
});

describe("resolveLocatorAnnotation", () => {
  test("rect: bbox path stays as-is", async () => {
    const page = stubPage({});
    const out = await resolveLocatorAnnotation(page, {
      type: "rect",
      bbox: { x: 1, y: 2, width: 3, height: 4 },
      intent: "error",
    });
    expect(out).toEqual({
      type: "rect",
      bbox: { x: 1, y: 2, width: 3, height: 4 },
      intent: "error",
    });
  });

  test("rect: locator path resolves bbox", async () => {
    const page = stubPage({ "button.primary": { x: 5, y: 6, width: 7, height: 8 } });
    const out = await resolveLocatorAnnotation(page, {
      type: "rect",
      locator: "button.primary",
      intent: "warning",
    });
    expect(out).toEqual({
      type: "rect",
      bbox: { x: 5, y: 6, width: 7, height: 8 },
      intent: "warning",
    });
  });

  test("circle: locator path → centroid + min-axis radius", async () => {
    const page = stubPage({ ".badge": { x: 100, y: 200, width: 50, height: 30 } });
    const out = await resolveLocatorAnnotation(page, {
      type: "circle",
      locator: ".badge",
    });
    // centroid: (125, 215); radius: min(50, 30) / 2 = 15
    expect(out).toEqual({
      type: "circle",
      center: { x: 125, y: 215 },
      radius: 15,
    });
  });

  test("circle: explicit center + radius beat locator", async () => {
    const page = stubPage({});
    const out = await resolveLocatorAnnotation(page, {
      type: "circle",
      center: { x: 50, y: 50 },
      radius: 10,
    });
    expect(out).toEqual({
      type: "circle",
      center: { x: 50, y: 50 },
      radius: 10,
    });
  });

  test("arrow: locator endpoints → centroid", async () => {
    const page = stubPage({
      ".source": { x: 0, y: 0, width: 100, height: 100 },
      ".target": { x: 200, y: 200, width: 50, height: 50 },
    });
    const out = await resolveLocatorAnnotation(page, {
      type: "arrow",
      fromLocator: ".source",
      toLocator: ".target",
      intent: "info",
    });
    expect(out).toEqual({
      type: "arrow",
      from: { x: 50, y: 50 }, // centroid of source
      to: { x: 225, y: 225 }, // centroid of target
      intent: "info",
    });
  });

  test("arrow: mixed coordinate + locator endpoints", async () => {
    const page = stubPage({ ".target": { x: 200, y: 200, width: 50, height: 50 } });
    const out = await resolveLocatorAnnotation(page, {
      type: "arrow",
      from: { x: 10, y: 10 },
      toLocator: ".target",
    });
    expect(out).toEqual({
      type: "arrow",
      from: { x: 10, y: 10 },
      to: { x: 225, y: 225 },
    });
  });

  test("text: locator path → bbox top-left raised by font size", async () => {
    const page = stubPage({ ".label": { x: 100, y: 100, width: 50, height: 20 } });
    const out = await resolveLocatorAnnotation(page, {
      type: "text",
      locator: ".label",
      content: "tag",
      fontSize: 12,
    });
    // y: max(0, 100 - 14) = 86. x: bbox.x = 100.
    expect(out.type).toBe("text");
    if (out.type === "text") {
      expect(out.at).toEqual({ x: 100, y: 86 });
      expect(out.content).toBe("tag");
      expect(out.fontSize).toBe(12);
    }
  });

  test("text: locator path clamps y to 0 near top of viewport", async () => {
    const page = stubPage({ "#top": { x: 100, y: 5, width: 50, height: 20 } });
    const out = await resolveLocatorAnnotation(page, {
      type: "text",
      locator: "#top",
      content: "x",
    });
    if (out.type === "text") {
      expect(out.at.y).toBe(0);
    }
  });

  test("callout: locator paths for both anchor and target", async () => {
    const page = stubPage({
      ".caption-anchor": { x: 10, y: 10, width: 20, height: 20 },
      ".target-region": { x: 100, y: 100, width: 50, height: 30 },
    });
    const out = await resolveLocatorAnnotation(page, {
      type: "callout",
      atLocator: ".caption-anchor",
      targetLocator: ".target-region",
      content: "hello",
    });
    if (out.type === "callout") {
      expect(out.at).toEqual({ x: 20, y: 20 }); // anchor centroid
      expect(out.targetBbox).toEqual({ x: 100, y: 100, width: 50, height: 30 });
      expect(out.content).toBe("hello");
    }
  });

  test("raw annotation passes through unchanged", async () => {
    const page = stubPage({});
    const out = await resolveLocatorAnnotation(page, {
      type: "raw",
      svgFragment: "<g/>",
    });
    expect(out).toEqual({ type: "raw", svgFragment: "<g/>" });
  });

  test("preserves intent + style overrides", async () => {
    const page = stubPage({ ".a": { x: 1, y: 2, width: 3, height: 4 } });
    const out = await resolveLocatorAnnotation(page, {
      type: "rect",
      locator: ".a",
      intent: "success",
      stroke: "lime",
      strokeWidth: 5,
      fill: "rgba(0,255,0,0.1)",
    });
    expect(out).toMatchObject({
      type: "rect",
      intent: "success",
      stroke: "lime",
      strokeWidth: 5,
      fill: "rgba(0,255,0,0.1)",
    });
  });
});

describe("resolveLocatorAnnotations", () => {
  test("resolves a mixed list in order", async () => {
    const page = stubPage({
      ".one": { x: 1, y: 1, width: 10, height: 10 },
      ".two": { x: 20, y: 20, width: 10, height: 10 },
    });
    const annotations: LocatorAnnotation[] = [
      { type: "rect", locator: ".one" },
      { type: "rect", locator: ".two" },
      { type: "raw", svgFragment: "<text/>" },
    ];
    const resolved = await resolveLocatorAnnotations(page, annotations);
    expect(resolved).toHaveLength(3);
    expect(resolved[0]?.type).toBe("rect");
    expect(resolved[2]?.type).toBe("raw");
  });

  test("propagates the first failure", async () => {
    const page = stubPage({ ".ok": { x: 1, y: 1, width: 10, height: 10 } });
    const annotations: LocatorAnnotation[] = [
      { type: "rect", locator: ".ok" },
      { type: "rect", locator: ".missing" },
    ];
    await expect(resolveLocatorAnnotations(page, annotations)).rejects.toThrowError(
      LocatorResolutionError,
    );
  });
});
