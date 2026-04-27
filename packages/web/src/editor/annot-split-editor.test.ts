/**
 * @vitest-environment happy-dom
 *
 * `<annot-split-editor>` tests covering the boundary-management
 * state machine: initial joints, add / remove / move with
 * MIN_SLICE_PX clamping + duplicate rejection, and the
 * `computeSliceHeights` plan that drives the apply pipeline.
 *
 * happy-dom doesn't decode `<img>` data URLs reliably, so the
 * tests use the `_testSeed(...)` hook to seed natural-pixel state
 * directly instead of going through `mount()`'s data-URL decode
 * path. The decode path itself is exercised by manual smoke
 * testing on the apply flow.
 */

import { describe, expect, it, vi } from "vitest";
import "./annot-split-editor.js";
import type { AnnotSplitEditorElement } from "./annot-split-editor.js";

function mount(opts: { width: number; heights: number[] }): AnnotSplitEditorElement {
  const el = document.createElement("annot-split-editor");
  document.body.appendChild(el);
  el._testSeed(opts);
  return el;
}

describe("<annot-split-editor> — boundary state machine", () => {
  it("seeds boundaries at every frame joint for a multi-frame stack", async () => {
    const el = mount({ width: 800, heights: [600, 600, 400] });
    await el.updateComplete;
    expect(el.boundaries).toEqual([600, 1200]);
    expect(el._testTotalHeight()).toBe(1600);
  });

  it("seeds an empty boundary list for a single-frame scroll capture", async () => {
    const el = mount({ width: 800, heights: [3000] });
    await el.updateComplete;
    expect(el.boundaries).toEqual([]);
  });

  it("computeSliceHeights reflects the current boundary plan", async () => {
    const el = mount({ width: 800, heights: [600, 600, 400] });
    await el.updateComplete;
    expect(el._testComputeSliceHeights()).toEqual([600, 600, 400]);
    el.boundaries = [400, 800];
    await el.updateComplete;
    expect(el._testComputeSliceHeights()).toEqual([400, 400, 800]);
  });

  it("renders the count label with split + image counts pluralised", async () => {
    const el = mount({ width: 800, heights: [600, 600, 400] });
    await el.updateComplete;
    const count = el.querySelector(".split-editor-count")?.textContent || "";
    expect(count).toBe("2 splits · 3 images");
    el.boundaries = [];
    await el.updateComplete;
    expect(el.querySelector(".split-editor-count")?.textContent).toBe("0 splits · 1 image");
    el.boundaries = [600];
    await el.updateComplete;
    expect(el.querySelector(".split-editor-count")?.textContent).toBe("1 split · 2 images");
  });

  it("renders one handle per boundary with correct data-value + position", async () => {
    const el = mount({ width: 800, heights: [600, 600]});
    await el.updateComplete;
    const handles = Array.from(el.querySelectorAll<HTMLElement>(".split-editor-handle"));
    expect(handles.length).toBe(1);
    expect(handles[0]!.getAttribute("data-value")).toBe("600");
  });

  it("clicking the handle's × button removes that boundary", async () => {
    const el = mount({ width: 800, heights: [600, 600, 400] });
    await el.updateComplete;
    const removeBtn = el.querySelector<HTMLButtonElement>(".split-editor-handle .split-editor-handle-remove");
    removeBtn!.click();
    await el.updateComplete;
    expect(el.boundaries).toEqual([1200]);
  });

  it("Delete key on a focused handle removes the boundary", async () => {
    const el = mount({ width: 800, heights: [600, 600] });
    await el.updateComplete;
    const handle = el.querySelector<HTMLElement>(".split-editor-handle")!;
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await el.updateComplete;
    expect(el.boundaries).toEqual([]);
  });

  it("ArrowUp / ArrowDown moves the focused boundary by 1 (10 with shift)", async () => {
    const el = mount({ width: 800, heights: [600, 600] });
    await el.updateComplete;
    const handle = el.querySelector<HTMLElement>(".split-editor-handle")!;
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    await el.updateComplete;
    expect(el.boundaries).toEqual([599]);
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }));
    await el.updateComplete;
    expect(el.boundaries).toEqual([609]);
  });

  it("Cancel button invokes onCancel", async () => {
    const el = mount({ width: 800, heights: [600] });
    await el.updateComplete;
    const onCancel = vi.fn();
    el.onCancel = onCancel;
    el.querySelector<HTMLButtonElement>(".split-editor-cancel")!.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Apply button forwards slice plan to onApply (canvas-encode bypassed in happy-dom)", async () => {
    const el = mount({ width: 800, heights: [600, 600] });
    await el.updateComplete;
    // happy-dom's <canvas>.toDataURL is unreliable; stub it on the
    // prototype so #computeSlices' canvas writes land on a no-op
    // and the slice plan still gets forwarded to onApply.
    const realToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,stub";
    try {
      const onApply = vi.fn().mockResolvedValue(undefined);
      el.onApply = onApply;
      el.querySelector<HTMLButtonElement>(".split-editor-apply")!.click();
      // wait for the async apply chain (microtask + tick)
      await new Promise((r) => setTimeout(r, 0));
      expect(onApply).toHaveBeenCalledTimes(1);
      const slices = onApply.mock.calls[0]![0];
      expect(slices.length).toBe(2);
      expect(slices[0]!.height).toBe(600);
      expect(slices[1]!.height).toBe(600);
      expect(slices[0]!.width).toBe(800);
    } finally {
      HTMLCanvasElement.prototype.toDataURL = realToDataURL;
    }
  });

  it("unmount() removes the element from the DOM and clears the body class", async () => {
    const el = mount({ width: 800, heights: [600] });
    await el.updateComplete;
    expect(document.body.contains(el)).toBe(true);
    document.body.classList.add("split-editor-active");
    el.unmount();
    expect(document.body.contains(el)).toBe(false);
    expect(document.body.classList.contains("split-editor-active")).toBe(false);
  });
});
