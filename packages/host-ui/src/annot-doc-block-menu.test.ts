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
  });
});
