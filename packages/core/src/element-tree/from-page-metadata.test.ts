import { describe, expect, it } from "vitest";

import { type LegacyPageMetadataLike, pageMetadataToElementTree } from "./from-page-metadata.js";

function samplePageMetadata(): LegacyPageMetadataLike {
  return {
    url: "https://example.com/login",
    viewport: { width: 1280, height: 800 },
    devicePixelRatio: 2,
    scrollOffset: { x: 0, y: 0 },
    captureRect: { x: 0, y: 0, width: 1280, height: 800 },
    capturedAt: "2026-05-23T12:00:00.000Z",
    elements: [
      {
        id: "e0",
        tag: "h1",
        role: "heading",
        text: "Sign in",
        bbox: [100, 50, 200, 30],
      },
      {
        id: "e1",
        tag: "input",
        role: "textbox",
        ariaLabel: "Email",
        inputType: "email",
        placeholder: "you@example.com",
        domId: "email",
        bbox: [100, 100, 300, 40],
      },
      {
        id: "e2",
        tag: "a",
        role: "link",
        text: "Forgot password?",
        href: "https://example.com/reset",
        bbox: [100, 160, 150, 20],
      },
    ],
  };
}

describe("pageMetadataToElementTree", () => {
  it("produces a single-root tree with one direct child per legacy element", () => {
    const tree = pageMetadataToElementTree(samplePageMetadata());
    expect(tree.version).toBe(1);
    expect(tree.root.role).toBe("document");
    expect(tree.root.children).toHaveLength(3);
  });

  it("populates source metadata from the legacy snapshot", () => {
    const tree = pageMetadataToElementTree(samplePageMetadata());
    expect(tree.source.kind).toBe("extension");
    expect(tree.source.url).toBe("https://example.com/login");
    expect(tree.source.capturedAt).toBe("2026-05-23T12:00:00.000Z");
    expect(tree.source.agent).toContain("page-metadata");
  });

  it("maps devicePixelRatio to viewport.scale", () => {
    const tree = pageMetadataToElementTree(samplePageMetadata());
    expect(tree.viewport).toEqual({ width: 1280, height: 800, scale: 2 });
  });

  it("converts bbox array to bbox object", () => {
    const tree = pageMetadataToElementTree(samplePageMetadata());
    expect(tree.root.children?.[0]?.bbox).toEqual({ x: 100, y: 50, width: 200, height: 30 });
  });

  it("prefers ariaLabel over text for the name field", () => {
    const tree = pageMetadataToElementTree(samplePageMetadata());
    const textbox = tree.root.children?.[1];
    // textbox has ariaLabel: "Email", no text — ariaLabel wins.
    expect(textbox?.name).toBe("Email");
  });

  it("collapses inputType / placeholder / href / domId into attributes", () => {
    const tree = pageMetadataToElementTree(samplePageMetadata());
    const textbox = tree.root.children?.[1];
    expect(textbox?.attributes).toEqual({
      id: "email",
      placeholder: "you@example.com",
      type: "email",
    });
    const link = tree.root.children?.[2];
    expect(link?.attributes).toEqual({ href: "https://example.com/reset" });
  });

  it("preserves legacy `e<n>` ids as refs", () => {
    const tree = pageMetadataToElementTree(samplePageMetadata());
    const refs = tree.root.children?.map((c) => c.ref) ?? [];
    expect(refs).toEqual(["e0", "e1", "e2"]);
  });

  it("renumbers non-conforming ids", () => {
    const pm = samplePageMetadata();
    pm.elements = [{ ...pm.elements[0]!, id: "uuid-foo-bar" }];
    const tree = pageMetadataToElementTree(pm);
    expect(tree.root.children?.[0]?.ref).toMatch(/^e\d+$/);
  });

  it("falls back to role=generic when role is unset", () => {
    const pm = samplePageMetadata();
    pm.elements = [{ ...pm.elements[0]!, role: undefined }];
    const tree = pageMetadataToElementTree(pm);
    expect(tree.root.children?.[0]?.role).toBe("generic");
  });

  it("emits no children array when the input has no elements", () => {
    const pm: LegacyPageMetadataLike = { ...samplePageMetadata(), elements: [] };
    const tree = pageMetadataToElementTree(pm);
    expect(tree.root.children).toBeUndefined();
  });
});
