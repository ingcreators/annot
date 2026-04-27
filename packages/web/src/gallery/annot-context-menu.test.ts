/**
 * @vitest-environment happy-dom
 *
 * `<annot-context-menu>` tests covering the function-call API
 * preserved from the pre-Lit module: opening at (x, y) with
 * `items`, closing on action click / Escape / outside click /
 * `closeContextMenu()`, and the "only one menu open at a time"
 * singleton invariant.
 */

import { describe, expect, it, vi } from "vitest";
import { closeContextMenu, openContextMenu } from "./annot-context-menu.js";

function activeMenuEl(): HTMLElement | null {
  return document.querySelector("annot-context-menu");
}

describe("<annot-context-menu> — openContextMenu / closeContextMenu", () => {
  it("opening creates an annot-context-menu element with one button per item", async () => {
    const action = vi.fn();
    openContextMenu({
      x: 50,
      y: 50,
      items: [
        { icon: "open_in_new", label: "Open", action },
        { icon: "delete", label: "Delete", action: () => {}, danger: true },
      ],
    });
    const menu = activeMenuEl();
    expect(menu).not.toBeNull();
    await (menu as unknown as { updateComplete: Promise<void> }).updateComplete;
    const buttons = menu!.querySelectorAll<HTMLButtonElement>(".context-menu-item");
    expect(buttons.length).toBe(2);
    expect(buttons[0]?.textContent?.trim()).toMatch(/Open/);
    expect(buttons[1]?.classList.contains("context-menu-item-danger")).toBe(true);
    closeContextMenu();
  });

  it("clicking an item runs the action and removes the menu from the DOM", async () => {
    const action = vi.fn();
    openContextMenu({
      x: 0,
      y: 0,
      items: [{ icon: "open_in_new", label: "Open", action }],
    });
    const menu = activeMenuEl()!;
    await (menu as unknown as { updateComplete: Promise<void> }).updateComplete;
    menu.querySelector<HTMLButtonElement>(".context-menu-item")!.click();
    // Wait microtask for the async item handler to await.
    await new Promise((r) => setTimeout(r, 0));
    expect(action).toHaveBeenCalledTimes(1);
    expect(activeMenuEl()).toBeNull();
  });

  it("closeContextMenu() removes the menu and is idempotent", () => {
    openContextMenu({ x: 0, y: 0, items: [{ icon: "open", label: "Open", action: () => {} }] });
    expect(activeMenuEl()).not.toBeNull();
    closeContextMenu();
    expect(activeMenuEl()).toBeNull();
    closeContextMenu();
    expect(activeMenuEl()).toBeNull();
  });

  it("opening a second menu closes the first (singleton invariant)", async () => {
    openContextMenu({
      x: 0,
      y: 0,
      items: [{ icon: "a", label: "A", action: () => {} }],
    });
    expect(document.querySelectorAll("annot-context-menu").length).toBe(1);
    openContextMenu({
      x: 0,
      y: 0,
      items: [{ icon: "b", label: "B", action: () => {} }],
    });
    const menus = document.querySelectorAll("annot-context-menu");
    expect(menus.length).toBe(1);
    await (menus[0] as unknown as { updateComplete: Promise<void> }).updateComplete;
    expect(menus[0]?.textContent).toMatch(/B/);
    closeContextMenu();
  });

  it("position is clamped inside the viewport (8px margin)", async () => {
    // Open at a position that would overflow the bottom-right.
    openContextMenu({
      x: window.innerWidth - 10,
      y: window.innerHeight - 10,
      items: [{ icon: "open", label: "Open", action: () => {} }],
    });
    const menu = activeMenuEl()!;
    await (menu as unknown as { updateComplete: Promise<void> }).updateComplete;
    // Allow firstUpdated's positioning to settle.
    expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
    expect(parseFloat(menu.style.top)).toBeGreaterThanOrEqual(8);
    closeContextMenu();
  });

  it("Escape key closes the menu (after the deferred listener attach)", async () => {
    openContextMenu({
      x: 0,
      y: 0,
      items: [{ icon: "open", label: "Open", action: () => {} }],
    });
    const menu = activeMenuEl()!;
    await (menu as unknown as { updateComplete: Promise<void> }).updateComplete;
    // Wait for requestAnimationFrame so the listener is registered.
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(activeMenuEl()).toBeNull();
  });

  it("ArrowDown / ArrowUp moves focus across menu items", async () => {
    openContextMenu({
      x: 0,
      y: 0,
      items: [
        { icon: "a", label: "A", action: () => {} },
        { icon: "b", label: "B", action: () => {} },
        { icon: "c", label: "C", action: () => {} },
      ],
    });
    const menu = activeMenuEl()!;
    await (menu as unknown as { updateComplete: Promise<void> }).updateComplete;
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>(".context-menu-item"));
    expect(document.activeElement).toBe(items[0]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(document.activeElement).toBe(items[1]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(document.activeElement).toBe(items[2]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(document.activeElement).toBe(items[1]);
    closeContextMenu();
  });
});
