/**
 * @vitest-environment happy-dom
 *
 * Phase 2 of `docs/plans/rich-text-and-shape-text.md` — happy-dom
 * smoke test for the floating B / I / U mini-toolbar.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTextMiniToolbar, wrapSelectionWithStyle } from "./text-mini-toolbar.js";

let cleanup: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
});

function createHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.contentEditable = "true";
  host.textContent = "Hello world";
  document.body.appendChild(host);
  cleanup.push(() => host.remove());
  return host;
}

function selectAll(host: HTMLDivElement): void {
  const sel = window.getSelection();
  if (!sel) throw new Error("no selection api");
  sel.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(host);
  sel.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

describe("createTextMiniToolbar", () => {
  it("appends a toolbar element to <body> with B/I/U buttons + family / size / color affordances", () => {
    const host = createHost();
    const handle = createTextMiniToolbar({ host });
    cleanup.push(() => handle.close());
    const tb = document.body.querySelector(".annot-text-mini-toolbar");
    expect(tb).not.toBeNull();
    // Three flag toggles
    expect(tb!.querySelectorAll("button")).toHaveLength(3);
    // Family + size dropdowns
    expect(tb!.querySelectorAll("select")).toHaveLength(2);
    // Color picker
    expect(tb!.querySelector('input[type="color"]')).not.toBeNull();
  });

  it("each B/I/U button carries one of bold / italic / underline as data-cmd", () => {
    const host = createHost();
    const handle = createTextMiniToolbar({ host });
    cleanup.push(() => handle.close());
    const cmds = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(".annot-text-mini-toolbar button"),
    ).map((b) => b.dataset["cmd"]);
    expect(cmds.sort()).toEqual(["bold", "italic", "underline"]);
  });

  it("clicking a button fires onCommand with the right cmd id", () => {
    const host = createHost();
    const onCommand = vi.fn();
    const handle = createTextMiniToolbar({ host, onCommand });
    cleanup.push(() => handle.close());
    selectAll(host);
    const boldBtn = document.body.querySelector<HTMLButtonElement>(
      '.annot-text-mini-toolbar button[data-cmd="bold"]',
    )!;
    boldBtn.click();
    expect(onCommand).toHaveBeenCalledWith("bold");
  });

  it("close() removes the toolbar and its event listeners", () => {
    const host = createHost();
    const handle = createTextMiniToolbar({ host });
    expect(document.body.querySelector(".annot-text-mini-toolbar")).not.toBeNull();
    handle.close();
    expect(document.body.querySelector(".annot-text-mini-toolbar")).toBeNull();
    // Idempotent — second close is a no-op.
    handle.close();
  });

  it("wrapSelectionWithStyle wraps the active selection in <span style=...>", () => {
    const host = createHost();
    selectAll(host);
    const ok = wrapSelectionWithStyle(host, "color", "#ff0000");
    expect(ok).toBe(true);
    const span = host.querySelector("span");
    expect(span).not.toBeNull();
    // Browsers normalise inline style colors to `rgb(R, G, B)`;
    // happy-dom keeps the literal `#rrggbb`. Accept either so the
    // test passes under both runtimes.
    expect(["rgb(255, 0, 0)", "#ff0000"]).toContain(span!.style.color);
  });

  it("wrapSelectionWithStyle returns false when no selection lives inside the host", () => {
    const host = createHost();
    // Collapsed selection elsewhere → no-op.
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    expect(wrapSelectionWithStyle(host, "fontSize", "24px")).toBe(false);
  });

  it("font-family select fires onCommand with fontFamily + value when changed", () => {
    const host = createHost();
    const onCommand = vi.fn();
    const handle = createTextMiniToolbar({ host, onCommand });
    cleanup.push(() => handle.close());
    selectAll(host);
    const familySelect = document.body.querySelectorAll<HTMLSelectElement>(
      ".annot-text-mini-toolbar select",
    )[0]!;
    familySelect.value = "monospace";
    familySelect.dispatchEvent(new Event("change"));
    expect(onCommand).toHaveBeenCalledWith("fontFamily", "monospace");
  });

  it("ignores selections outside the host element", () => {
    const host = createHost();
    const handle = createTextMiniToolbar({ host });
    cleanup.push(() => handle.close());
    const sibling = document.createElement("p");
    sibling.textContent = "outside";
    document.body.appendChild(sibling);
    cleanup.push(() => sibling.remove());
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(sibling);
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    const tb = document.body.querySelector<HTMLElement>(".annot-text-mini-toolbar")!;
    expect(tb.style.display).toBe("none");
  });
});
