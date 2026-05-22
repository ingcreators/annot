import type { BboxAnnotation } from "@ingcreators/annot-annotator";
import { describe, expect, it } from "vitest";

import { type Clip, describeAnnotation, rebaseAnnotations } from "./rebase.js";

const CLIP: Clip = { x: 100, y: 50, width: 200, height: 150 };

describe("rebaseAnnotations — bbox shapes", () => {
  it("translates a rect that fits inside the clip", () => {
    const ann: BboxAnnotation = {
      type: "rect",
      bbox: { x: 120, y: 60, width: 50, height: 30 },
      intent: "warning",
    };
    const { kept, dropped } = rebaseAnnotations([ann], CLIP);
    expect(dropped).toEqual([]);
    expect(kept).toEqual([
      {
        type: "rect",
        bbox: { x: 20, y: 10, width: 50, height: 30 },
        intent: "warning",
      },
    ]);
  });

  it("drops a rect whose left edge is outside the clip", () => {
    const ann: BboxAnnotation = {
      type: "rect",
      bbox: { x: 50, y: 60, width: 200, height: 50 },
    };
    const { kept, dropped } = rebaseAnnotations([ann], CLIP);
    expect(kept).toEqual([]);
    expect(dropped).toEqual([ann]);
  });

  it("drops a rect whose right edge extends past the clip", () => {
    const ann: BboxAnnotation = {
      type: "rect",
      bbox: { x: 280, y: 60, width: 50, height: 30 },
    };
    const { kept, dropped } = rebaseAnnotations([ann], CLIP);
    expect(kept).toEqual([]);
    expect(dropped).toEqual([ann]);
  });

  it("rebases a numberedBadge and updates imageWidth/imageHeight to clip dims", () => {
    const ann: BboxAnnotation = {
      type: "numberedBadge",
      bbox: { x: 120, y: 60, width: 80, height: 30 },
      number: 1,
      placement: "auto",
      imageWidth: 1920,
      imageHeight: 1080,
    };
    const { kept, dropped } = rebaseAnnotations([ann], CLIP);
    expect(dropped).toEqual([]);
    expect(kept).toEqual([
      {
        type: "numberedBadge",
        bbox: { x: 20, y: 10, width: 80, height: 30 },
        number: 1,
        placement: "auto",
        imageWidth: 200,
        imageHeight: 150,
      },
    ]);
  });
});

describe("rebaseAnnotations — circle / arrow / text / callout", () => {
  it("rebases a circle that fits inside the clip", () => {
    const ann: BboxAnnotation = {
      type: "circle",
      center: { x: 200, y: 100 },
      radius: 20,
    };
    const { kept, dropped } = rebaseAnnotations([ann], CLIP);
    expect(dropped).toEqual([]);
    expect(kept).toEqual([{ type: "circle", center: { x: 100, y: 50 }, radius: 20 }]);
  });

  it("drops a circle whose bounding square exceeds the clip", () => {
    const ann: BboxAnnotation = {
      type: "circle",
      center: { x: 110, y: 60 }, // top-left near clip edge
      radius: 50, // → bbox extends beyond
    };
    const { kept, dropped } = rebaseAnnotations([ann], CLIP);
    expect(kept).toEqual([]);
    expect(dropped).toEqual([ann]);
  });

  it("rebases an arrow whose both endpoints fit", () => {
    const ann: BboxAnnotation = {
      type: "arrow",
      from: { x: 110, y: 60 },
      to: { x: 250, y: 180 },
    };
    const { kept, dropped } = rebaseAnnotations([ann], CLIP);
    expect(dropped).toEqual([]);
    expect(kept).toEqual([{ type: "arrow", from: { x: 10, y: 10 }, to: { x: 150, y: 130 } }]);
  });

  it("drops an arrow with one endpoint outside the clip", () => {
    const ann: BboxAnnotation = {
      type: "arrow",
      from: { x: 110, y: 60 },
      to: { x: 350, y: 100 }, // x past clip right edge
    };
    const { kept, dropped } = rebaseAnnotations([ann], CLIP);
    expect(kept).toEqual([]);
    expect(dropped).toEqual([ann]);
  });

  it("rebases a text annotation", () => {
    const ann: BboxAnnotation = {
      type: "text",
      at: { x: 150, y: 80 },
      content: "Hello",
    };
    const { kept, dropped } = rebaseAnnotations([ann], CLIP);
    expect(dropped).toEqual([]);
    expect(kept[0]).toMatchObject({
      type: "text",
      at: { x: 50, y: 30 },
      content: "Hello",
    });
  });

  it("rebases a callout (both targetBbox and at)", () => {
    const ann: BboxAnnotation = {
      type: "callout",
      at: { x: 150, y: 80 },
      targetBbox: { x: 200, y: 100, width: 30, height: 20 },
      content: "Click me",
    };
    const { kept, dropped } = rebaseAnnotations([ann], CLIP);
    expect(dropped).toEqual([]);
    expect(kept[0]).toMatchObject({
      type: "callout",
      at: { x: 50, y: 30 },
      targetBbox: { x: 100, y: 50, width: 30, height: 20 },
      content: "Click me",
    });
  });

  it("drops a callout whose target bbox is outside the clip", () => {
    const ann: BboxAnnotation = {
      type: "callout",
      at: { x: 150, y: 80 },
      targetBbox: { x: 350, y: 100, width: 30, height: 20 },
      content: "X",
    };
    const { kept, dropped } = rebaseAnnotations([ann], CLIP);
    expect(kept).toEqual([]);
    expect(dropped).toEqual([ann]);
  });
});

describe("rebaseAnnotations — RawAnnotation handling", () => {
  it("keeps raw SVG fragments unchanged (caller responsibility)", () => {
    const ann: BboxAnnotation = {
      type: "raw",
      svgFragment: '<rect x="50" y="50" width="100" height="20"/>',
    };
    const { kept, dropped } = rebaseAnnotations([ann], CLIP);
    expect(dropped).toEqual([]);
    expect(kept).toEqual([ann]);
  });
});

describe("rebaseAnnotations — mixed batches", () => {
  it("partitions a batch into kept + dropped correctly", () => {
    const annotations: BboxAnnotation[] = [
      // inside
      { type: "rect", bbox: { x: 120, y: 60, width: 30, height: 20 } },
      // outside (left)
      { type: "rect", bbox: { x: 0, y: 0, width: 30, height: 20 } },
      // inside (text)
      { type: "text", at: { x: 200, y: 100 }, content: "ok" },
      // outside (arrow endpoint past right)
      { type: "arrow", from: { x: 150, y: 80 }, to: { x: 500, y: 80 } },
    ];
    const { kept, dropped } = rebaseAnnotations(annotations, CLIP);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(2);
    // Kept are translated.
    expect(kept[0]).toMatchObject({
      type: "rect",
      bbox: { x: 20, y: 10, width: 30, height: 20 },
    });
    expect(kept[1]).toMatchObject({ type: "text", at: { x: 100, y: 50 } });
    // Dropped are returned verbatim.
    expect(dropped[0]).toMatchObject({ type: "rect", bbox: { x: 0, y: 0 } });
  });

  it("returns empty arrays for an empty input", () => {
    const out = rebaseAnnotations([], CLIP);
    expect(out.kept).toEqual([]);
    expect(out.dropped).toEqual([]);
  });
});

describe("describeAnnotation", () => {
  it("produces a stable short identifier per shape", () => {
    expect(describeAnnotation({ type: "rect", bbox: { x: 1, y: 2, width: 3, height: 4 } })).toBe(
      "rect@(1,2,3,4)",
    );
    expect(
      describeAnnotation({
        type: "numberedBadge",
        bbox: { x: 10, y: 20, width: 30, height: 40 },
        number: 5,
      }),
    ).toBe("numberedBadge@(10,20,30,40)");
    expect(describeAnnotation({ type: "circle", center: { x: 5, y: 6 }, radius: 7 })).toBe(
      "circle@(5,6,r=7)",
    );
    expect(
      describeAnnotation({
        type: "arrow",
        from: { x: 1, y: 2 },
        to: { x: 3, y: 4 },
      }),
    ).toBe("arrow@(1,2)→(3,4)");
    expect(describeAnnotation({ type: "text", at: { x: 9, y: 8 }, content: "" })).toBe(
      "text@(9,8)",
    );
    expect(describeAnnotation({ type: "raw", svgFragment: "" })).toBe("raw[<svg fragment>]");
  });
});
