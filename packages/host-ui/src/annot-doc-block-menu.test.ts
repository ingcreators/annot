/**
 * @vitest-environment happy-dom
 *
 * `<annot-doc-block-menu>` tests — Phase 4b of
 * `docs/plans/annot-html-document.md`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "./annot-doc-block-menu.js";
import {
  AnnotDocBlockMenuElement,
  type BlockMenuItem,
  type BlockMenuSelectDetail,
  DEFAULT_BLOCK_MENU_ITEMS,
} from "./annot-doc-block-menu.js";

function makeAnchor(): HTMLElement {
  const a = document.createElement("p");
  a.contentEditable = "true";
  a.style.position = "absolute";
  a.style.top = "100px";
  a.style.left = "200px";
  a.style.width = "300px";
  a.style.height = "30px";
  a.textContent = "anchor";
  document.body.appendChild(a);
  return a;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  AnnotDocBlockMenuElement.closeActive();
});

describe("annot-doc-block-menu: open / render", () => {
  it("openFor mounts a menu anchored to the target", async () => {
    const anchor = makeAnchor();
    const menu = AnnotDocBlockMenuElement.openFor(anchor);
    await menu.updateComplete;
    expect(document.body.contains(menu)).toBe(true);
    expect(menu.anchor).toBe(anchor);
    expect(menu.querySelectorAll(".annot-doc-block-menu-item")).toHaveLength(
      DEFAULT_BLOCK_MENU_ITEMS.length,
    );
  });

  it("closes the previous menu when openFor runs twice", async () => {
    const anchor1 = makeAnchor();
    const anchor2 = makeAnchor();
    const first = AnnotDocBlockMenuElement.openFor(anchor1);
    await first.updateComplete;
    const second = AnnotDocBlockMenuElement.openFor(anchor2);
    await second.updateComplete;
    expect(document.body.contains(first)).toBe(false);
    expect(document.body.contains(second)).toBe(true);
  });

  it("custom items override the default catalog", async () => {
    const anchor = makeAnchor();
    const items: BlockMenuItem[] = [{ id: "x", label: "Custom", kind: "paragraph" }];
    const menu = AnnotDocBlockMenuElement.openFor(anchor, { items });
    await menu.updateComplete;
    expect(menu.querySelectorAll(".annot-doc-block-menu-item")).toHaveLength(1);
    expect(menu.querySelector(".annot-doc-block-menu-label")?.textContent).toBe("Custom");
  });

  it("flips upwards when the anchor is too close to the bottom of the viewport", async () => {
    // Bug surfaced in production: insert-bar at the bottom of a
    // long doc opened the menu below the trigger and the menu
    // overflowed the viewport unrendered.
    const anchor = makeAnchor();
    Object.defineProperty(anchor, "getBoundingClientRect", {
      value: () => ({
        top: 780,
        bottom: 800,
        left: 100,
        right: 300,
        width: 200,
        height: 20,
        x: 100,
        y: 780,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(window, "innerHeight", { value: 812, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    const menu = AnnotDocBlockMenuElement.openFor(anchor);
    await menu.updateComplete;
    // Force a real reposition pass — happy-dom doesn't report
    // a meaningful bounding rect for the menu itself, so the
    // helper falls back to the 360 max-height. Wait one
    // microtask for the queueMicrotask pass to fire.
    await new Promise<void>((r) => queueMicrotask(r));
    const top = Number.parseFloat(menu.style.top);
    // With viewport 812 + bar bottom at 800, only 12 px space
    // below — definitely flipped above.
    expect(top).toBeLessThan(780);
  });

  it("anchors below when there's room", async () => {
    const anchor = makeAnchor();
    Object.defineProperty(anchor, "getBoundingClientRect", {
      value: () => ({
        top: 100,
        bottom: 130,
        left: 100,
        right: 300,
        width: 200,
        height: 30,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(window, "innerHeight", { value: 812, configurable: true });
    const menu = AnnotDocBlockMenuElement.openFor(anchor);
    await menu.updateComplete;
    await new Promise<void>((r) => queueMicrotask(r));
    const top = Number.parseFloat(menu.style.top);
    // Below the anchor (~bottom + 4 px = 134), clamped only if
    // necessary.
    expect(top).toBeGreaterThanOrEqual(130);
  });
});

describe("annot-doc-block-menu: keyboard navigation", () => {
  it("ArrowDown / ArrowUp move the active highlight", async () => {
    const anchor = makeAnchor();
    const menu = AnnotDocBlockMenuElement.openFor(anchor);
    await menu.updateComplete;
    expect(menu.activeIndex).toBe(0);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    await menu.updateComplete;
    expect(menu.activeIndex).toBe(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    await menu.updateComplete;
    expect(menu.activeIndex).toBe(2);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    await menu.updateComplete;
    expect(menu.activeIndex).toBe(1);
  });

  it("Enter selects the active item + closes the menu", async () => {
    const anchor = makeAnchor();
    const menu = AnnotDocBlockMenuElement.openFor(anchor);
    await menu.updateComplete;
    let detail: BlockMenuSelectDetail | null = null;
    menu.addEventListener("block-menu-select", (e) => {
      detail = (e as CustomEvent<BlockMenuSelectDetail>).detail;
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    await menu.updateComplete;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await Promise.resolve();
    expect(detail).not.toBeNull();
    // ArrowDown twice would land on Heading 2, but I only pressed
    // once; we landed on Heading 2 (index 1).
    expect(detail!.item.id).toBe("h2");
    expect(document.body.contains(menu)).toBe(false);
  });

  it("Esc closes the menu without dispatching select", async () => {
    const anchor = makeAnchor();
    const menu = AnnotDocBlockMenuElement.openFor(anchor);
    await menu.updateComplete;
    let selected = false;
    menu.addEventListener("block-menu-select", () => {
      selected = true;
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await Promise.resolve();
    expect(selected).toBe(false);
    expect(document.body.contains(menu)).toBe(false);
  });
});

describe("annot-doc-block-menu: mouse interaction", () => {
  it("clicking an item selects it", async () => {
    const anchor = makeAnchor();
    const menu = AnnotDocBlockMenuElement.openFor(anchor);
    await menu.updateComplete;
    let detail: BlockMenuSelectDetail | null = null;
    menu.addEventListener("block-menu-select", (e) => {
      detail = (e as CustomEvent<BlockMenuSelectDetail>).detail;
    });
    const codeBtn = menu.querySelector('[data-block-menu-id="code"]') as HTMLButtonElement;
    codeBtn.click();
    expect(detail).not.toBeNull();
    expect(detail!.item.kind).toBe("code");
  });

  it("clicking outside closes the menu", async () => {
    const anchor = makeAnchor();
    const menu = AnnotDocBlockMenuElement.openFor(anchor);
    await menu.updateComplete;
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await Promise.resolve();
    expect(document.body.contains(menu)).toBe(false);
  });
});

describe("annot-doc-block-menu: catalog", () => {
  it("DEFAULT_BLOCK_MENU_ITEMS covers every v1 slash-menu kind", () => {
    const kinds = new Set(DEFAULT_BLOCK_MENU_ITEMS.map((i) => i.kind));
    expect(kinds).toContain("heading");
    expect(kinds).toContain("paragraph");
    expect(kinds).toContain("list");
    expect(kinds).toContain("code");
    expect(kinds).toContain("quote");
    expect(kinds).toContain("callout");
    expect(kinds).toContain("divider");
    expect(kinds).toContain("image");
  });

  it("includes the Image entry with the documented metadata", () => {
    const image = DEFAULT_BLOCK_MENU_ITEMS.find((i) => i.id === "image");
    expect(image).toBeDefined();
    expect(image?.label).toBe("Image");
    expect(image?.kind).toBe("image");
    expect(image?.description).toBe("From file");
  });
});
