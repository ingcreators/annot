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
  it("renders three action buttons by default", async () => {
    const el = mount();
    await el.updateComplete;
    const buttons = el.querySelectorAll("button.block-action");
    expect(buttons).toHaveLength(3);
    expect(buttons[0]?.getAttribute("aria-label")).toBe("Move up");
    expect(buttons[1]?.getAttribute("aria-label")).toBe("Move down");
    expect(buttons[2]?.getAttribute("aria-label")).toBe("Delete block");
  });

  it("dispatches block-action with the right payload on click", async () => {
    const el = mount();
    await el.updateComplete;
    const captured: BlockToolbarActionDetail[] = [];
    el.addEventListener("block-action", (e) => {
      captured.push((e as CustomEvent<BlockToolbarActionDetail>).detail);
    });
    (el.querySelector('[aria-label="Move up"]') as HTMLButtonElement).click();
    (el.querySelector('[aria-label="Move down"]') as HTMLButtonElement).click();
    (el.querySelector('[aria-label="Delete block"]') as HTMLButtonElement).click();
    expect(captured.map((d) => d.action)).toEqual(["moveUp", "moveDown", "delete"]);
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
    // Delete stays enabled — the only block in the document still
    // gets a delete affordance.
    const del = el.querySelector('[aria-label="Delete block"]') as HTMLButtonElement;
    expect(del.disabled).toBe(false);
  });
});
