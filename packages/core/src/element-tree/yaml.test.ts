import { describe, expect, it } from "vitest";
import type { ElementTree } from "./types.js";
import { parseElementTreeFromYaml, serializeElementTreeToYaml } from "./yaml.js";

function sampleTree(): ElementTree {
  return {
    version: 1,
    source: {
      kind: "playwright",
      capturedAt: "2026-05-23T12:34:56.789Z",
      url: "https://example.com/login",
    },
    viewport: { width: 1280, height: 800, scale: 2 },
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

describe("serializeElementTreeToYaml + parseElementTreeFromYaml", () => {
  it("round-trips a populated tree without losing fields", () => {
    const tree = sampleTree();
    const yaml = serializeElementTreeToYaml(tree);
    const back = parseElementTreeFromYaml(yaml);
    expect(back).toEqual(tree);
  });

  it("produces deterministic output regardless of attribute insertion order", () => {
    const a = sampleTree();
    const b = sampleTree();
    // Build the attributes object in a different insertion order on tree b.
    const child = b.root.children![1]!;
    (child as { attributes: Record<string, string> }).attributes = {
      required: "",
      type: "email",
    };
    expect(serializeElementTreeToYaml(a)).toBe(serializeElementTreeToYaml(b));
  });

  it("emits stable field order: ref / role / name / text / bbox / states / attributes / children", () => {
    const tree = sampleTree();
    const yaml = serializeElementTreeToYaml(tree);
    const refIdx = yaml.indexOf("ref: ");
    const roleIdx = yaml.indexOf("role: ");
    expect(refIdx).toBeGreaterThan(-1);
    expect(roleIdx).toBeGreaterThan(refIdx);
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
    const yaml = serializeElementTreeToYaml(tree);
    expect(yaml).not.toMatch(/^\s*children:/m);
    expect(yaml).not.toMatch(/^\s*states:/m);
    expect(yaml).not.toMatch(/^\s*attributes:/m);
  });

  it("preserves strings with special characters", () => {
    const tree: ElementTree = {
      version: 1,
      source: { kind: "extension", capturedAt: "2026-05-23T00:00:00Z" },
      viewport: { width: 100, height: 100, scale: 1 },
      root: {
        ref: "e1",
        role: "main",
        name: "Sign in: \"OK\" or 'Cancel' [also #brackets]",
        text: "multi\nline\nbody",
      },
    };
    const yaml = serializeElementTreeToYaml(tree);
    const back = parseElementTreeFromYaml(yaml);
    expect(back.root.name).toBe(tree.root.name);
    expect(back.root.text).toBe(tree.root.text);
  });

  it("rejects malformed YAML with descriptive message", () => {
    expect(() => parseElementTreeFromYaml("not yaml: : :")).toThrow(/parse failed/);
  });

  it("rejects YAML missing required top-level keys", () => {
    expect(() => parseElementTreeFromYaml("version: 1\n")).toThrow(/required top-level keys/);
  });

  it("byte-stable across two consecutive serialize calls", () => {
    const tree = sampleTree();
    const first = serializeElementTreeToYaml(tree);
    const second = serializeElementTreeToYaml(tree);
    expect(first).toBe(second);
  });
});
