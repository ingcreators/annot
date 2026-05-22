import type { ElementNode } from "@ingcreators/annot-core";
import { describe, expect, it } from "vitest";

import {
  flattenForTreeRender,
  fullDescriptionForNode,
  iconForElementNode,
  primaryLabelForNode,
  subLabelForNode,
} from "./element-node-helpers.js";

describe("iconForElementNode", () => {
  it("maps common ARIA roles to Material Symbols glyphs", () => {
    expect(iconForElementNode({ ref: "e1", role: "button" })).toBe("smart_button");
    expect(iconForElementNode({ ref: "e2", role: "link" })).toBe("link");
    expect(iconForElementNode({ ref: "e3", role: "textbox" })).toBe("edit");
    expect(iconForElementNode({ ref: "e4", role: "heading" })).toBe("title");
    expect(iconForElementNode({ ref: "e5", role: "checkbox" })).toBe("check_box");
  });

  it("falls back to widgets for unknown roles", () => {
    expect(iconForElementNode({ ref: "e1", role: "mystery" })).toBe("widgets");
  });
});

describe("primaryLabelForNode", () => {
  it("prefers name over text over ref", () => {
    expect(primaryLabelForNode({ ref: "e1", role: "button", name: "Sign in" })).toBe("Sign in");
    expect(primaryLabelForNode({ ref: "e1", role: "heading", text: "Hello" })).toBe("Hello");
    expect(primaryLabelForNode({ ref: "e1", role: "main" })).toBe("e1");
  });

  it("truncates long labels with ellipsis", () => {
    const long = "x".repeat(80);
    const result = primaryLabelForNode({ ref: "e1", role: "button", name: long });
    expect(result.length).toBeLessThanOrEqual(36);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("subLabelForNode", () => {
  it("returns just the role for leaf nodes", () => {
    expect(subLabelForNode({ ref: "e1", role: "button" })).toBe("button");
  });

  it("appends the child count for branch nodes", () => {
    const node: ElementNode = {
      ref: "e1",
      role: "form",
      children: [
        { ref: "e2", role: "textbox" },
        { ref: "e3", role: "button" },
      ],
    };
    expect(subLabelForNode(node)).toBe("form · 2");
  });
});

describe("fullDescriptionForNode", () => {
  it("composes name + role + states + href", () => {
    const node: ElementNode = {
      ref: "e1",
      role: "link",
      name: "About",
      states: ["external"],
      attributes: { href: "https://example.com" },
    };
    const desc = fullDescriptionForNode(node);
    expect(desc).toContain("About");
    expect(desc).toContain("<role=link>");
    expect(desc).toContain("[external]");
    expect(desc).toContain("→ https://example.com");
  });
});

describe("flattenForTreeRender", () => {
  it("emits a flat row per node with depth + parent-ref chain", () => {
    const root: ElementNode = {
      ref: "e0",
      role: "document",
      children: [
        { ref: "e1", role: "heading", name: "Title" },
        {
          ref: "e2",
          role: "form",
          children: [
            { ref: "e3", role: "textbox", name: "Email" },
            { ref: "e4", role: "button", name: "Submit" },
          ],
        },
      ],
    };
    const rows = flattenForTreeRender(root);
    expect(rows.map((r) => r.node.ref)).toEqual(["e0", "e1", "e2", "e3", "e4"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 2, 2]);
    expect(rows[3]?.parentRefs).toEqual(["e0", "e2"]);
  });

  it("returns just one row when the root has no children", () => {
    const root: ElementNode = { ref: "e0", role: "main" };
    const rows = flattenForTreeRender(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.depth).toBe(0);
    expect(rows[0]?.parentRefs).toEqual([]);
  });
});
