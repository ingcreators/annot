// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import { walkElementTree } from "./element-tree-walker.js";

// Set the viewport size happy-dom reports. happy-dom defaults to
// 1024x768; the tests assume nothing about the size beyond that the
// captureRect / viewport are populated from these globals.
function setViewport(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

// Stub `getBoundingClientRect` on every element so the walker's
// visibility + bbox checks pass under happy-dom (which returns
// zeroed rects by default).
function stubBoundingRect(el: Element, rect: { x: number; y: number; w: number; h: number }): void {
  (el as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    ({
      x: rect.x,
      y: rect.y,
      top: rect.y,
      left: rect.x,
      width: rect.w,
      height: rect.h,
      right: rect.x + rect.w,
      bottom: rect.y + rect.h,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe("walkElementTree", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setViewport(1280, 800);
  });

  it("emits a single-root ElementTree even when the DOM has no interesting elements", () => {
    const tree = walkElementTree(null);
    expect(tree.version).toBe(1);
    expect(tree.source.kind).toBe("extension");
    expect(tree.root.role).toBe("document");
    expect(tree.root.ref).toBe("e0");
  });

  it("captures source metadata + viewport", () => {
    setViewport(800, 600);
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    const tree = walkElementTree(null);
    expect(tree.viewport).toEqual({ width: 800, height: 600, scale: 2 });
    expect(tree.source.agent).toContain("annot-extension-element-tree-walker");
    expect(typeof tree.source.url).toBe("string");
  });

  it("captures interactive elements + their bboxes", () => {
    document.body.innerHTML = `
      <main>
        <h1>Sign in</h1>
        <input id="email" type="email" placeholder="Email" required>
        <button>Sign in</button>
      </main>
    `;
    const h1 = document.querySelector("h1")!;
    const input = document.querySelector("input")!;
    const button = document.querySelector("button")!;
    stubBoundingRect(h1, { x: 100, y: 50, w: 200, h: 30 });
    stubBoundingRect(input, { x: 100, y: 100, w: 300, h: 40 });
    stubBoundingRect(button, { x: 100, y: 200, w: 100, h: 30 });

    const tree = walkElementTree(null);
    // All three interactive elements appear under root.
    expect(tree.root.children).toHaveLength(3);
    const heading = tree.root.children?.[0];
    expect(heading?.role).toBe("heading");
    expect(heading?.name).toBe("Sign in");
    expect(heading?.bbox).toEqual({ x: 100, y: 50, width: 200, height: 30 });
    expect(heading?.states).toContain("level=1");

    const textbox = tree.root.children?.[1];
    expect(textbox?.role).toBe("textbox");
    expect(textbox?.attributes?.type).toBe("email");
    expect(textbox?.states).toContain("required");

    const btn = tree.root.children?.[2];
    expect(btn?.role).toBe("button");
    expect(btn?.name).toBe("Sign in");
  });

  it("assigns unique refs in document order", () => {
    document.body.innerHTML = `
      <button>One</button>
      <button>Two</button>
      <button>Three</button>
    `;
    for (const btn of document.querySelectorAll("button")) {
      stubBoundingRect(btn, { x: 0, y: 0, w: 100, h: 30 });
    }
    const tree = walkElementTree(null);
    const refs = tree.root.children?.map((c) => c.ref) ?? [];
    expect(refs).toEqual(["e1", "e2", "e3"]);
  });

  it("rebuilds nearest-ancestor hierarchy from a flat collection", () => {
    document.body.innerHTML = `
      <main>
        <section>
          <h2>Section title</h2>
          <form>
            <input id="q" type="text" placeholder="Search">
            <button type="submit">Search</button>
          </form>
        </section>
      </main>
    `;
    for (const el of document.querySelectorAll("h2, input, button")) {
      stubBoundingRect(el, { x: 0, y: 0, w: 100, h: 30 });
    }
    const tree = walkElementTree(null);
    // No `<main>` / `<section>` / `<form>` are interactive; the
    // walker filters them. The three interactive children all hang
    // off the synthetic root since none of the intervening elements
    // are collected.
    expect(tree.root.children).toHaveLength(3);
  });

  it("narrows the captureRect when a region argument is supplied", () => {
    const tree = walkElementTree({ x: 100, y: 50, width: 600, height: 400 });
    expect(tree.root.bbox).toEqual({ x: 100, y: 50, width: 600, height: 400 });
  });

  it("captures aria-pressed / aria-expanded / disabled as states", () => {
    document.body.innerHTML = `
      <button aria-pressed="true">Toggle</button>
      <button aria-expanded="false">Menu</button>
      <button disabled>Cancel</button>
    `;
    for (const btn of document.querySelectorAll("button")) {
      stubBoundingRect(btn, { x: 0, y: 0, w: 100, h: 30 });
    }
    const tree = walkElementTree(null);
    const [toggle, menu, cancel] = tree.root.children ?? [];
    expect(toggle?.states).toContain("pressed=true");
    expect(menu?.states).toContain("expanded=false");
    expect(cancel?.states).toContain("disabled");
  });

  it("skips elements with data-annot-ui (our own overlay UI)", () => {
    document.body.innerHTML = `
      <div data-annot-ui>
        <button>Internal annot button</button>
      </div>
      <button>Real page button</button>
    `;
    for (const btn of document.querySelectorAll("button")) {
      stubBoundingRect(btn, { x: 0, y: 0, w: 100, h: 30 });
    }
    const tree = walkElementTree(null);
    expect(tree.root.children).toHaveLength(1);
    expect(tree.root.children?.[0]?.name).toBe("Real page button");
  });

  it("skips invisible elements (display:none, zero-area, aria-hidden)", () => {
    document.body.innerHTML = `
      <button style="display: none">Hidden</button>
      <button>Visible</button>
      <button aria-hidden="true">Aria-hidden</button>
    `;
    const visible = document.querySelectorAll("button")[1]!;
    stubBoundingRect(visible, { x: 0, y: 0, w: 100, h: 30 });
    // display:none + aria-hidden buttons get no bbox stub — the
    // walker's checkVisibilityCSS guard rejects them.
    const tree = walkElementTree(null);
    expect(tree.root.children).toHaveLength(1);
    expect(tree.root.children?.[0]?.name).toBe("Visible");
  });

  it("collects whitelisted attributes (id, type, href, data-testid)", () => {
    document.body.innerHTML = `
      <a href="/about" data-testid="nav-about">About</a>
    `;
    const a = document.querySelector("a")!;
    stubBoundingRect(a, { x: 0, y: 0, w: 100, h: 30 });
    const tree = walkElementTree(null);
    const link = tree.root.children?.[0];
    expect(link?.role).toBe("link");
    expect(link?.attributes?.href).toContain("/about");
    expect(link?.attributes?.["data-testid"]).toBe("nav-about");
  });

  it("nests collected children under their nearest collected ancestor", () => {
    // Heading is interesting (h2) AND has a nested button — the
    // button should land as a child of the heading in the resulting
    // tree.
    document.body.innerHTML = `
      <h2>Outer heading <button>Inline action</button></h2>
    `;
    const h2 = document.querySelector("h2")!;
    const btn = document.querySelector("button")!;
    stubBoundingRect(h2, { x: 0, y: 0, w: 200, h: 30 });
    stubBoundingRect(btn, { x: 100, y: 0, w: 80, h: 30 });
    const tree = walkElementTree(null);
    expect(tree.root.children).toHaveLength(1);
    const heading = tree.root.children?.[0];
    expect(heading?.role).toBe("heading");
    expect(heading?.children).toHaveLength(1);
    expect(heading?.children?.[0]?.role).toBe("button");
  });
});
