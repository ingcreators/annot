import { describe, expect, it } from "vitest";

import { parseElementTreeFromJson, serializeElementTreeToJson } from "./json.js";
import type { ElementTree } from "./types.js";

function sampleTree(): ElementTree {
  return {
    version: 1,
    source: {
      kind: "playwright",
      capturedAt: "2026-05-23T12:34:56.789Z",
      agent: "annot-playwright@0.4.0",
      url: "https://example.com/login",
    },
    viewport: { width: 1280, height: 800, scale: 1 },
    root: {
      ref: "e1",
      role: "main",
      bbox: { x: 0, y: 0, width: 1280, height: 800 },
      children: [
        {
          ref: "e2",
          role: "heading",
          name: "Sign in",
          text: "Sign in",
          bbox: { x: 100, y: 50, width: 200, height: 30 },
        },
        {
          ref: "e3",
          role: "textbox",
          name: "Email",
          bbox: { x: 100, y: 100, width: 300, height: 40 },
          states: ["required"],
          attributes: { type: "email", required: "" },
        },
      ],
    },
  };
}

describe("serializeElementTreeToJson + parseElementTreeFromJson", () => {
  it("round-trips a populated tree without losing fields", () => {
    const tree = sampleTree();
    const json = serializeElementTreeToJson(tree);
    const back = parseElementTreeFromJson(json);
    expect(back).toEqual(tree);
  });

  it("omits empty children / states / attributes from output", () => {
    const tree: ElementTree = {
      version: 1,
      source: { kind: "extension", capturedAt: "2026-05-23T00:00:00Z" },
      viewport: { width: 100, height: 100, scale: 1 },
      root: {
        ref: "e1",
        role: "generic",
        children: [],
        states: [],
        attributes: {},
      },
    };
    const json = serializeElementTreeToJson(tree);
    expect(json).not.toContain("children");
    expect(json).not.toContain("states");
    expect(json).not.toContain("attributes");
  });

  it("supports compact (single-line) output", () => {
    const tree = sampleTree();
    const compact = serializeElementTreeToJson(tree, { compact: true });
    expect(compact).not.toContain("\n");
    const back = parseElementTreeFromJson(compact);
    expect(back).toEqual(tree);
  });
});

describe("parseElementTreeFromJson validation", () => {
  it("rejects malformed JSON with a descriptive message", () => {
    expect(() => parseElementTreeFromJson("not json {")).toThrow(/parse failed/);
  });

  it("rejects missing top-level keys", () => {
    expect(() => parseElementTreeFromJson("{}")).toThrow(/required top-level keys/);
  });

  it("rejects wrong version", () => {
    const tree = sampleTree() as { version: number };
    tree.version = 2;
    expect(() => parseElementTreeFromJson(JSON.stringify(tree))).toThrow(/required top-level keys/);
  });

  it("rejects invalid ref format", () => {
    const tree = sampleTree();
    (tree.root as { ref: string }).ref = "node-1";
    expect(() => parseElementTreeFromJson(JSON.stringify(tree))).toThrow(/invalid ref/);
  });

  it("rejects non-string attribute values", () => {
    const tree = sampleTree();
    const child = tree.root.children![1]! as unknown as {
      attributes: Record<string, unknown>;
    };
    child.attributes.required = 123;
    expect(() => parseElementTreeFromJson(JSON.stringify(tree))).toThrow(/must be a string/);
  });

  it("rejects bbox with non-finite numbers", () => {
    const tree = sampleTree();
    (tree.root.bbox as { x: number }).x = Number.NaN;
    expect(() => parseElementTreeFromJson(JSON.stringify(tree))).toThrow(/finite number/);
  });

  it("recursively validates nested children", () => {
    const tree = sampleTree();
    const grandchild: unknown = { ref: "broken", role: "generic" };
    (tree.root.children![0] as { children?: unknown[] }).children = [grandchild];
    expect(() => parseElementTreeFromJson(JSON.stringify(tree))).toThrow(
      /root.children\[0\].children\[0\].*invalid ref/s,
    );
  });
});
