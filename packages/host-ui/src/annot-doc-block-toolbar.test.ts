/**
 * @vitest-environment happy-dom
 *
 * `<annot-doc-block-toolbar>` tests — Phase 4a of
 * `docs/plans/annot-html-document.md`.
 */

import { beforeEach, describe, expect, it } from "vitest";
import "./annot-doc-block-toolbar.js";
import type {
  AnnotDocBlockToolbarElement,
  BlockToolbarActionDetail,
} from "./annot-doc-block-toolbar.js";

function mount(): AnnotDocBlockToolbarElement {
  const el = document.createElement("annot-doc-block-toolbar") as AnnotDocBlockToolbarElement;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("annot-doc-block-toolbar", () => {
  it("renders six action buttons + a non-interactive drag handle", async () => {
    const el = mount();
    await el.updateComplete;
    // The drag handle is a `<span>` with role="img" — counted via
    // `.block-action` to confirm the layout slot exists, but
    // EXCLUDED from the button-only NodeList below because Phase
    // 7 will turn it into a real drag source rather than a button.
    const handle = el.querySelector(".block-action-handle");
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute("aria-label")).toBe("Drag to reorder");
    const buttons = el.querySelectorAll("button.block-action");
    expect(buttons).toHaveLength(6);
    expect(buttons[0]?.getAttribute("aria-label")).toBe("Insert block above");
    expect(buttons[1]?.getAttribute("aria-label")).toBe("Insert block below");
    expect(buttons[2]?.getAttribute("aria-label")).toBe("Insert image below");
    expect(buttons[3]?.getAttribute("aria-label")).toBe("Move up");
    expect(buttons[4]?.getAttribute("aria-label")).toBe("Move down");
    expect(buttons[5]?.getAttribute("aria-label")).toBe("Delete block");
  });

  it("dispatches block-action with the right payload on click", async () => {
    const el = mount();
    await el.updateComplete;
    const captured: BlockToolbarActionDetail[] = [];
    el.addEventListener("block-action", (e) => {
      captured.push((e as CustomEvent<BlockToolbarActionDetail>).detail);
    });
    (el.querySelector('[aria-label="Insert block above"]') as HTMLButtonElement).click();
    (el.querySelector('[aria-label="Insert block below"]') as HTMLButtonElement).click();
    (el.querySelector('[aria-label="Insert image below"]') as HTMLButtonElement).click();
    (el.querySelector('[aria-label="Move up"]') as HTMLButtonElement).click();
    (el.querySelector('[aria-label="Move down"]') as HTMLButtonElement).click();
    (el.querySelector('[aria-label="Delete block"]') as HTMLButtonElement).click();
    expect(captured.map((d) => d.action)).toEqual([
      "insertAbove",
      "insertBelow",
      "insertImage",
      "moveUp",
      "moveDown",
      "delete",
    ]);
  });

  it("disables move-up / move-down via canMoveUp / canMoveDown", async () => {
    const el = mount();
    el.canMoveUp = false;
    el.canMoveDown = false;
    await el.updateComplete;
    const up = el.querySelector('[aria-label="Move up"]') as HTMLButtonElement;
    const down = el.querySelector('[aria-label="Move down"]') as HTMLButtonElement;
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(true);
    // Insert + image-insert + delete stay enabled — moving may
    // not be possible but inserting a sibling and deleting always
    // are.
    const above = el.querySelector('[aria-label="Insert block above"]') as HTMLButtonElement;
    const below = el.querySelector('[aria-label="Insert block below"]') as HTMLButtonElement;
    const image = el.querySelector('[aria-label="Insert image below"]') as HTMLButtonElement;
    const del = el.querySelector('[aria-label="Delete block"]') as HTMLButtonElement;
    expect(above.disabled).toBe(false);
    expect(below.disabled).toBe(false);
    expect(image.disabled).toBe(false);
    expect(del.disabled).toBe(false);
  });
});
