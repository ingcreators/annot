/**
 * @vitest-environment happy-dom
 *
 * `<annot-tag-editor>` tests covering the visible states the
 * element can land in: empty / populated chip rows, the add-input
 * popover lifecycle, commit + cancel paths, and the
 * `annot-tag-change` event the host listens for.
 */

import { describe, expect, it, vi } from "vitest";
import "./annot-tag-editor.js";
import type { AnnotTagEditorElement } from "./annot-tag-editor.js";

async function mount(tags: Record<string, string> = {}): Promise<AnnotTagEditorElement> {
  const el = document.createElement("annot-tag-editor");
  el.tags = tags;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function getChipLabels(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll(".tag-chip-label")).map((n) => n.textContent || "");
}

describe("<annot-tag-editor>", () => {
  it("renders an empty chip row plus the add button when tags is empty", async () => {
    const el = await mount({});
    expect(getChipLabels(el)).toEqual([]);
    expect(el.querySelector(".tag-add-btn")).not.toBeNull();
    // The input row only renders on demand.
    expect(el.querySelector(".tag-input-row")).toBeNull();
  });

  it("renders one chip per entry in tags, in iteration order", async () => {
    const el = await mount({ author: "alice", status: "reviewing" });
    expect(getChipLabels(el)).toEqual(["author: alice", "status: reviewing"]);
  });

  it("clicking the add button opens the input row and focuses the key input", async () => {
    const el = await mount();
    el.querySelector<HTMLButtonElement>(".tag-add-btn")!.click();
    await el.updateComplete;
    const row = el.querySelector(".tag-input-row");
    expect(row).not.toBeNull();
    const keyInput = el.querySelector<HTMLInputElement>(".tag-input-key");
    expect(document.activeElement).toBe(keyInput);
  });

  it("commits a new tag on OK click and dispatches annot-tag-change", async () => {
    const el = await mount({ author: "alice" });
    const onChange = vi.fn();
    el.addEventListener("annot-tag-change", (e) => onChange((e as CustomEvent).detail));

    el.querySelector<HTMLButtonElement>(".tag-add-btn")!.click();
    await el.updateComplete;
    const keyInput = el.querySelector<HTMLInputElement>(".tag-input-key")!;
    const valInput = el.querySelector<HTMLInputElement>(".tag-input-value")!;
    keyInput.value = "status";
    keyInput.dispatchEvent(new Event("input"));
    valInput.value = "reviewing";
    valInput.dispatchEvent(new Event("input"));

    el.querySelector<HTMLButtonElement>(".tag-ok-btn")!.click();
    await el.updateComplete;

    expect(el.tags).toEqual({ author: "alice", status: "reviewing" });
    expect(onChange).toHaveBeenCalledWith({
      tags: { author: "alice", status: "reviewing" },
    });
    // The popover dismisses after a successful commit.
    expect(el.querySelector(".tag-input-row")).toBeNull();
  });

  it("commits on Enter and dismisses the input row", async () => {
    const el = await mount();
    el.querySelector<HTMLButtonElement>(".tag-add-btn")!.click();
    await el.updateComplete;
    const keyInput = el.querySelector<HTMLInputElement>(".tag-input-key")!;
    keyInput.value = "k";
    keyInput.dispatchEvent(new Event("input"));
    keyInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await el.updateComplete;
    expect(el.tags).toEqual({ k: "" });
    expect(el.querySelector(".tag-input-row")).toBeNull();
  });

  it("cancel button dismisses the row without mutating tags", async () => {
    const el = await mount({ author: "alice" });
    const onChange = vi.fn();
    el.addEventListener("annot-tag-change", onChange);

    el.querySelector<HTMLButtonElement>(".tag-add-btn")!.click();
    await el.updateComplete;
    el.querySelector<HTMLInputElement>(".tag-input-key")!.value = "ignored";
    el.querySelector<HTMLButtonElement>(".tag-cancel-btn")!.click();
    await el.updateComplete;

    expect(el.tags).toEqual({ author: "alice" });
    expect(onChange).not.toHaveBeenCalled();
    expect(el.querySelector(".tag-input-row")).toBeNull();
  });

  it("Escape key cancels the input row", async () => {
    const el = await mount();
    el.querySelector<HTMLButtonElement>(".tag-add-btn")!.click();
    await el.updateComplete;
    const keyInput = el.querySelector<HTMLInputElement>(".tag-input-key")!;
    keyInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await el.updateComplete;
    expect(el.tags).toEqual({});
    expect(el.querySelector(".tag-input-row")).toBeNull();
  });

  it("commit with empty key is a no-op (just dismiss)", async () => {
    const el = await mount({ author: "alice" });
    const onChange = vi.fn();
    el.addEventListener("annot-tag-change", onChange);

    el.querySelector<HTMLButtonElement>(".tag-add-btn")!.click();
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>(".tag-ok-btn")!.click();
    await el.updateComplete;

    expect(el.tags).toEqual({ author: "alice" });
    expect(onChange).not.toHaveBeenCalled();
    expect(el.querySelector(".tag-input-row")).toBeNull();
  });

  it("clicking a chip's delete button removes that tag and dispatches annot-tag-change", async () => {
    const el = await mount({ author: "alice", status: "reviewing" });
    const onChange = vi.fn();
    el.addEventListener("annot-tag-change", (e) => onChange((e as CustomEvent).detail));

    // Find the delete button inside the chip whose label starts with "status".
    const chips = Array.from(el.querySelectorAll<HTMLElement>(".tag-chip"));
    const statusChip = chips.find((c) => c.textContent?.includes("status"))!;
    statusChip.querySelector<HTMLButtonElement>(".tag-chip-delete")!.click();
    await el.updateComplete;

    expect(el.tags).toEqual({ author: "alice" });
    expect(onChange).toHaveBeenCalledWith({ tags: { author: "alice" } });
    expect(getChipLabels(el)).toEqual(["author: alice"]);
  });

  it("re-assigning .tags from outside re-renders the chip row", async () => {
    const el = await mount({ author: "alice" });
    expect(getChipLabels(el)).toEqual(["author: alice"]);
    el.tags = { team: "design" };
    await el.updateComplete;
    expect(getChipLabels(el)).toEqual(["team: design"]);
  });
});
