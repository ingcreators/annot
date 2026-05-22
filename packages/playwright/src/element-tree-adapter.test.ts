import { describe, expect, it } from "vitest";

import {
  type AttachAttributesLocator,
  type AttachAttributesPage,
  attachAttributes,
  playwrightYamlToElementTree,
} from "./element-tree-adapter.js";

describe("playwrightYamlToElementTree", () => {
  const viewport = { width: 1280, height: 800, scale: 1 };

  it("converts a single top-level entry into root", () => {
    const yaml = "- main [ref=e1]";
    const tree = playwrightYamlToElementTree({ yaml, viewport });
    expect(tree.root.ref).toBe("e1");
    expect(tree.root.role).toBe("main");
    expect(tree.root.children).toBeUndefined();
  });

  it("builds a nested tree from container lines (trailing colon)", () => {
    const yaml = [
      "- main:",
      '  - heading "Sign in" [ref=e2]',
      "  - form [ref=e3]:",
      '    - textbox "Email" [ref=e4]',
      '    - button "Sign in" [ref=e5]',
    ].join("\n");
    const tree = playwrightYamlToElementTree({ yaml, viewport });
    expect(tree.root.role).toBe("main");
    expect(tree.root.children).toHaveLength(2);
    expect(tree.root.children?.[0]?.role).toBe("heading");
    expect(tree.root.children?.[0]?.name).toBe("Sign in");
    expect(tree.root.children?.[1]?.role).toBe("form");
    expect(tree.root.children?.[1]?.children).toHaveLength(2);
    expect(tree.root.children?.[1]?.children?.[1]?.name).toBe("Sign in");
  });

  it("captures box markers as bbox", () => {
    const yaml = '- textbox "Email" [ref=e4] [box=100,200,300,40]';
    const tree = playwrightYamlToElementTree({ yaml, viewport });
    expect(tree.root.bbox).toEqual({ x: 100, y: 200, width: 300, height: 40 });
  });

  it("captures state-style brackets as states[] (excluding ref / box)", () => {
    const yaml = '- button "Submit" [active] [level=2] [ref=e7]';
    const tree = playwrightYamlToElementTree({ yaml, viewport });
    expect(tree.root.states).toEqual(["active", "level=2"]);
  });

  it("synthesizes a ref for nodes without one", () => {
    const yaml = ["- main:", '  - heading "Sign in" [ref=e2]'].join("\n");
    const tree = playwrightYamlToElementTree({ yaml, viewport });
    // The container "main" line has no [ref=…]; the adapter
    // synthesizes a ref so every node has a unique identifier.
    expect(tree.root.ref).toMatch(/^e\d+$/);
    expect(tree.root.ref).not.toBe("e2");
  });

  it("wraps multiple top-level entries in a synthetic `generic` root", () => {
    const yaml = ["- banner [ref=e1]", "- main [ref=e2]", "- contentinfo [ref=e3]"].join("\n");
    const tree = playwrightYamlToElementTree({ yaml, viewport });
    expect(tree.root.role).toBe("generic");
    expect(tree.root.children).toHaveLength(3);
    expect(tree.root.children?.[0]?.ref).toBe("e1");
  });

  it("populates source metadata", () => {
    const tree = playwrightYamlToElementTree({
      yaml: "- main [ref=e1]",
      viewport,
      url: "https://example.com/login",
      agent: "annot-playwright@0.4.0",
      capturedAt: "2026-05-23T12:00:00Z",
    });
    expect(tree.source).toEqual({
      kind: "playwright",
      capturedAt: "2026-05-23T12:00:00Z",
      agent: "annot-playwright@0.4.0",
      url: "https://example.com/login",
    });
  });

  it("preserves viewport verbatim", () => {
    const tree = playwrightYamlToElementTree({
      yaml: "- main [ref=e1]",
      viewport: { width: 375, height: 812, scale: 2 },
    });
    expect(tree.viewport).toEqual({ width: 375, height: 812, scale: 2 });
  });

  it("handles names with internal punctuation", () => {
    const yaml = '- link "Read more →" [ref=e1]';
    const tree = playwrightYamlToElementTree({ yaml, viewport });
    expect(tree.root.name).toBe("Read more →");
  });

  it("ignores blank lines + lines that don't match the bullet pattern", () => {
    const yaml = ["# comment line", "", "- main [ref=e1]", ""].join("\n");
    const tree = playwrightYamlToElementTree({ yaml, viewport });
    expect(tree.root.role).toBe("main");
  });
});

describe("attachAttributes", () => {
  const viewport = { width: 1280, height: 800, scale: 1 };

  function pageWith(
    resolvers: Record<string, { count: number; attrs: Record<string, string> }>,
  ): AttachAttributesPage {
    return {
      getByRole(role, opts) {
        const key = `${role}|${opts.name}`;
        const spec = resolvers[key];
        const locator: AttachAttributesLocator = {
          count: async () => spec?.count ?? 0,
          evaluate: async <R>() => (spec?.attrs ?? {}) as R,
        };
        return locator;
      },
    };
  }

  it("attaches attributes to nodes that resolve uniquely", async () => {
    const tree = playwrightYamlToElementTree({
      yaml: ["- form:", '  - textbox "Email" [ref=e2]', '  - button "Sign in" [ref=e3]'].join("\n"),
      viewport,
    });
    const page = pageWith({
      "textbox|Email": { count: 1, attrs: { type: "email", required: "" } },
      "button|Sign in": { count: 1, attrs: { type: "submit" } },
    });
    await attachAttributes(tree, page, { whitelist: ["type", "required"] });
    const email = tree.root.children?.[0];
    const button = tree.root.children?.[1];
    expect(email?.attributes).toEqual({ type: "email", required: "" });
    expect(button?.attributes).toEqual({ type: "submit" });
  });

  it("skips nodes that resolve to zero or multiple elements", async () => {
    const tree = playwrightYamlToElementTree({
      yaml: ['- textbox "Email" [ref=e1]', '- textbox "Password" [ref=e2]'].join("\n"),
      viewport,
    });
    const page = pageWith({
      "textbox|Email": { count: 1, attrs: { type: "email" } },
      "textbox|Password": { count: 2, attrs: { type: "password" } }, // ambiguous
    });
    await attachAttributes(tree, page, { whitelist: ["type"] });
    const root = tree.root;
    const email = root.children?.[0];
    const pwd = root.children?.[1];
    expect(email?.attributes).toEqual({ type: "email" });
    expect(pwd?.attributes).toBeUndefined();
  });

  it("skips nodes without a name", async () => {
    const tree = playwrightYamlToElementTree({
      yaml: "- main [ref=e1]",
      viewport,
    });
    const page = pageWith({});
    await attachAttributes(tree, page, { whitelist: ["id"] });
    expect(tree.root.attributes).toBeUndefined();
  });

  it("skips nodes whose attribute collection produced no values", async () => {
    const tree = playwrightYamlToElementTree({
      yaml: '- button "Click" [ref=e1]',
      viewport,
    });
    const page = pageWith({
      "button|Click": { count: 1, attrs: {} },
    });
    await attachAttributes(tree, page, { whitelist: ["id"] });
    expect(tree.root.attributes).toBeUndefined();
  });

  it("returns the same tree reference (fluent)", async () => {
    const tree = playwrightYamlToElementTree({ yaml: "- main [ref=e1]", viewport });
    const page = pageWith({});
    const result = await attachAttributes(tree, page, { whitelist: [] });
    expect(result).toBe(tree);
  });
});
