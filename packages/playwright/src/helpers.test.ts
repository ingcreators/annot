import { describe, expect, it } from "vitest";
import { arrowBetween, rectForBoundingBox, textAt } from "./helpers.js";

describe("rectForBoundingBox", () => {
  it("emits a rect with default stroke/no fill", () => {
    const svg = rectForBoundingBox({ x: 10, y: 20, width: 100, height: 50 });
    expect(svg).toContain('x="10"');
    expect(svg).toContain('y="20"');
    expect(svg).toContain('width="100"');
    expect(svg).toContain('height="50"');
    expect(svg).toContain('stroke="red"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('fill="none"');
  });

  it("honours custom options", () => {
    const svg = rectForBoundingBox(
      { x: 0, y: 0, width: 10, height: 10 },
      { stroke: "blue", strokeWidth: 4, fill: "yellow" },
    );
    expect(svg).toContain('stroke="blue"');
    expect(svg).toContain('stroke-width="4"');
    expect(svg).toContain('fill="yellow"');
  });

  it("escapes attribute values defensively", () => {
    const svg = rectForBoundingBox(
      { x: 0, y: 0, width: 10, height: 10 },
      { stroke: `red" onload="alert(1)` },
    );
    // The dangerous `"` characters in the caller-supplied stroke
    // value must be escaped to `&quot;` so the parser never sees
    // them as attribute delimiters. The literal substring
    // "onload=" survives — but inside the (still-properly-quoted)
    // stroke value, where it's inert text rather than a separate
    // attribute.
    expect(svg).toContain("&quot;");
    // Verify the rect element's attribute boundaries are intact:
    // exactly one `stroke="..."` attribute, with the unescaped
    // payload bytes INSIDE the quotes.
    const strokeMatch = /stroke="([^"]*)"/.exec(svg);
    expect(strokeMatch).not.toBeNull();
    expect(strokeMatch?.[1]).toContain("&quot;");
    expect(strokeMatch?.[1]).toContain("onload=");
  });
});

describe("arrowBetween", () => {
  it("emits a line + marker def + marker-end ref", () => {
    const svg = arrowBetween({ x: 0, y: 0 }, { x: 100, y: 100 });
    expect(svg).toContain("<defs>");
    expect(svg).toContain("<marker");
    expect(svg).toContain("</marker>");
    expect(svg).toContain('<line x1="0"');
    expect(svg).toContain('x2="100"');
    expect(svg).toContain("marker-end=");
    expect(svg).toContain('stroke="red"');
  });

  it("each call produces a unique marker id (no collisions)", () => {
    const a = arrowBetween({ x: 0, y: 0 }, { x: 10, y: 10 });
    const b = arrowBetween({ x: 0, y: 0 }, { x: 10, y: 10 });
    const idA = /id="([^"]+)"/.exec(a)?.[1];
    const idB = /id="([^"]+)"/.exec(b)?.[1];
    expect(idA).toBeDefined();
    expect(idB).toBeDefined();
    expect(idA).not.toBe(idB);
  });

  it("honours color option", () => {
    const svg = arrowBetween({ x: 0, y: 0 }, { x: 10, y: 10 }, { color: "blue" });
    expect(svg).toContain('stroke="blue"');
    expect(svg).toContain('fill="blue"');
  });
});

describe("textAt", () => {
  it("emits text element with defaults", () => {
    const svg = textAt({ x: 50, y: 50 }, "hello");
    expect(svg).toContain('x="50"');
    expect(svg).toContain('y="50"');
    expect(svg).toContain('fill="red"');
    expect(svg).toContain('font-size="14"');
    expect(svg).toContain('text-anchor="start"');
    expect(svg).toContain(">hello</text>");
  });

  it("escapes text content", () => {
    const svg = textAt({ x: 0, y: 0 }, "<script>alert(1)</script>");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("honours all options", () => {
    const svg = textAt({ x: 10, y: 20 }, "x", { color: "blue", fontSize: 24, anchor: "middle" });
    expect(svg).toContain('fill="blue"');
    expect(svg).toContain('font-size="24"');
    expect(svg).toContain('text-anchor="middle"');
  });
});

describe("composition", () => {
  it("multiple fragments concatenate into a valid SVG body", () => {
    const svg =
      rectForBoundingBox({ x: 10, y: 10, width: 100, height: 50 }, { stroke: "red" }) +
      arrowBetween({ x: 150, y: 100 }, { x: 10, y: 10 }) +
      textAt({ x: 150, y: 90 }, "here");

    expect(svg).toContain("<rect");
    expect(svg).toContain("<defs>");
    expect(svg).toContain("<marker");
    expect(svg).toContain("<line");
    expect(svg).toContain("<text");
  });
});
