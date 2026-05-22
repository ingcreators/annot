import { describe, expect, it } from "vitest";

import type { ElementNode, ElementTree } from "./types.js";
import { findByMatch, findByRef, flattenTree, walkTree } from "./walk.js";

function tree(): ElementTree {
  return {
    version: 1,
    source: { kind: "playwright", capturedAt: "2026-05-23T00:00:00Z" },
    viewport: { width: 1280, height: 800, scale: 1 },
    root: {
      ref: "e1",
      role: "main",
      children: [
        {
          ref: "e2",
          role: "heading",
          name: "Sign in",
        },
        {
          ref: "e3",
          role: "form",
          children: [
            { ref: "e4", role: "textbox", name: "Email" },
            { ref: "e5", role: "textbox", name: "Password" },
            { ref: "e6", role: "button", name: "Sign in" },
          ],
        },
      ],
    },
  };
}

describe("walkTree", () => {
  it("visits every node in depth-first document order", () => {
    const visited: string[] = [];
    walkTree(tree(), (node) => {
      visited.push(node.ref);
    });
    expect(visited).toEqual(["e1", "e2", "e3", "e4", "e5", "e6"]);
  });

  it("passes ancestor chain to visitor (root excluded for root)", () => {
    const ancestorRefs: Record<string, string[]> = {};
    walkTree(tree(), (node, parents) => {
      ancestorRefs[node.ref] = parents.map((p) => p.ref);
    });
    expect(ancestorRefs.e1).toEqual([]);
    expect(ancestorRefs.e2).toEqual(["e1"]);
    expect(ancestorRefs.e4).toEqual(["e1", "e3"]);
    expect(ancestorRefs.e6).toEqual(["e1", "e3"]);
  });

  it("stops early when visitor returns false", () => {
    const visited: string[] = [];
    walkTree(tree(), (node) => {
      visited.push(node.ref);
      if (node.ref === "e3") return false;
    });
    expect(visited).toEqual(["e1", "e2", "e3"]);
  });
});

describe("findByRef", () => {
  it("returns the node when ref matches", () => {
    const found = findByRef(tree(), "e4");
    expect(found?.name).toBe("Email");
  });

  it("returns null when no node has the ref", () => {
    expect(findByRef(tree(), "e999")).toBeNull();
  });

  it("finds the root", () => {
    expect(findByRef(tree(), "e1")?.role).toBe("main");
  });
});

describe("findByMatch", () => {
  it("returns nodes matching both role and name", () => {
    const matches = findByMatch(tree(), { role: "textbox", name: "Email" });
    expect(matches.map((n) => n.ref)).toEqual(["e4"]);
  });

  it("returns multiple matches when ambiguous", () => {
    // Both heading "Sign in" and button "Sign in" — only the button has role:button,
    // so matching by name only returns both.
    const matches = findByMatch(tree(), { name: "Sign in" });
    expect(matches.map((n) => n.ref)).toEqual(["e2", "e6"]);
  });

  it("filters by role alone when name omitted", () => {
    const matches = findByMatch(tree(), { role: "textbox" });
    expect(matches.map((n) => n.ref)).toEqual(["e4", "e5"]);
  });

  it("returns empty when both role and name unset (defensive)", () => {
    const matches = findByMatch(tree(), {});
    expect(matches).toEqual([]);
  });

  it("returns empty when no nodes match", () => {
    const matches = findByMatch(tree(), { role: "dialog" });
    expect(matches).toEqual([]);
  });
});

describe("flattenTree", () => {
  it("returns every node in depth-first document order", () => {
    const flat = flattenTree(tree());
    expect(flat.map((n: ElementNode) => n.ref)).toEqual(["e1", "e2", "e3", "e4", "e5", "e6"]);
  });

  it("returns live references (not copies)", () => {
    const t = tree();
    const flat = flattenTree(t);
    expect(flat[0]).toBe(t.root);
  });
});
