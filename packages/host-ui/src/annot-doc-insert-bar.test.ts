/**
 * @vitest-environment happy-dom
 *
 * `<annot-doc-insert-bar>` tests — Phase 2 of
 * `docs/plans/annot-html-document-ux-polish.md`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "./annot-doc-insert-bar.js";
import { AnnotDocBlockMenuElement } from "./annot-doc-block-menu.js";
import type { AnnotDocInsertBarElement, InsertBlockDetail } from "./annot-doc-insert-bar.js";

async function mount(insertAt = 0): Promise<AnnotDocInsertBarElement> {
  const el = document.createElement("annot-doc-insert-bar") as AnnotDocInsertBarElement;
  el.insertAt = insertAt;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  // The bar's click handler opens a body-mounted block menu;
  // make sure it's torn down between tests so document.body
  // queries below stay clean.
  AnnotDocBlockMenuElement.closeActive();
});

describe("annot-doc-insert-bar", () => {
  it("renders an accessible button labelled by `insertAt`", async () => {
    const el = await mount(2);
    const button = el.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("Insert block at position 3");
  });

  it("renders the configurable label inside the pill", async () => {
    const el = await mount(0);
    el.label = "Add block";
    await el.updateComplete;
    expect(el.textContent?.includes("Add block")).toBe(true);
  });

  it("opens the block menu on click and dispatches insert-block on pick", async () => {
    const el = await mount(3);
    const captured: InsertBlockDetail[] = [];
    el.addEventListener("insert-block", (e) => {
      captured.push((e as CustomEvent<InsertBlockDetail>).detail);
    });
    (el.querySelector("button") as HTMLButtonElement).click();
    // Menu mounts to document.body via static `openFor`.
    const menu = document.querySelector("annot-doc-block-menu") as AnnotDocBlockMenuElement;
    expect(menu).not.toBeNull();
    // Lit defers child render until the next update tick — wait
    // for the menu's items to materialise before clicking one.
    await menu.updateComplete;
    // Pick the first item by simulating a `block-menu-select`
    // dispatch — the bar's handler is `{once: true}` so a real
    // user click on the menu button works the same way.
    const firstItem = menu.querySelector(".annot-doc-block-menu-item") as HTMLButtonElement;
    expect(firstItem).not.toBeNull();
    firstItem.click();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.insertAt).toBe(3);
    expect(captured[0]?.item.kind).toBe("heading");
  });

  it("does not dispatch insert-block when the menu closes without a pick", async () => {
    const el = await mount(0);
    const captured: InsertBlockDetail[] = [];
    el.addEventListener("insert-block", (e) => {
      captured.push((e as CustomEvent<InsertBlockDetail>).detail);
    });
    (el.querySelector("button") as HTMLButtonElement).click();
    AnnotDocBlockMenuElement.closeActive();
    expect(captured).toHaveLength(0);
  });
});
