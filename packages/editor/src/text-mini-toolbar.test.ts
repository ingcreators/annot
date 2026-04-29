/**
 * @vitest-environment happy-dom
 *
 * Phase 2 of `docs/plans/rich-text-and-shape-text.md` — happy-dom
 * smoke test for the floating B / I / U mini-toolbar.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTextMiniToolbar } from "./text-mini-toolbar.js";

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
  it("appends a toolbar element to <body>", () => {
    const host = createHost();
    const handle = createTextMiniToolbar({ host });
    cleanup.push(() => handle.close());
    const tb = document.body.querySelector(".annot-text-mini-toolbar");
    expect(tb).not.toBeNull();
    expect(tb!.querySelectorAll("button")).toHaveLength(3);
  });

  it("each button carries one of bold / italic / underline as data-cmd", () => {
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
