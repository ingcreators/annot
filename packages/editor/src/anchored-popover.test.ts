/**
 * @vitest-environment happy-dom
 *
 * `openAnchoredPopover` is the single shared popover-positioning
 * helper used by the toolbar, custom-select, and PropertyPanel.
 * Behavioural surface worth pinning:
 *
 *   - Mounts to `<body>` with position:fixed (escapes ancestor
 *     overflow:hidden).
 *   - Toggle semantics — second click on the same anchor closes
 *     instead of stacking a new one underneath.
 *   - Outside-click dismiss (with the opening-click guard via
 *     setTimeout(0) so it doesn't immediately close).
 *   - Escape dismiss.
 *   - Returned `cleanup()` lets the caller dismiss from inside
 *     the popover content (e.g. after a chip click).
 *   - Window resize / scroll triggers a reposition.
 */

import { afterEach, describe, expect, it } from "vitest";
import { openAnchoredPopover } from "./anchored-popover.js";

function makeAnchor(): HTMLButtonElement {
  const btn = document.createElement("button");
  document.body.appendChild(btn);
  return btn;
}

afterEach(() => {
  // Clear out any stray popovers + anchors so subsequent tests
  // start clean.
  for (const child of Array.from(document.body.children)) {
    child.remove();
  }
});

describe("openAnchoredPopover mount", () => {
  it("appends a div with position:fixed to document.body", () => {
    const anchor = makeAnchor();
    openAnchoredPopover(anchor, () => {});
    const popover = document.body.querySelector<HTMLElement>("[data-anchor-popover]");
    expect(popover).not.toBeNull();
    expect(popover!.style.position).toBe("fixed");
    expect(popover!.style.zIndex).toBe("1000");
    expect(popover!.classList.contains("tool-flyout")).toBe(true);
  });

  it("merges a custom className onto the popover", () => {
    const anchor = makeAnchor();
    openAnchoredPopover(anchor, () => {}, { className: "pp-select-popup" });
    const popover = document.body.querySelector<HTMLElement>("[data-anchor-popover]");
    expect(popover!.className).toContain("tool-flyout");
    expect(popover!.className).toContain("pp-select-popup");
  });

  it("invokes `fill` with the popover root so callers can append children", () => {
    const anchor = makeAnchor();
    openAnchoredPopover(anchor, (root) => {
      const span = document.createElement("span");
      span.id = "filled-content";
      root.appendChild(span);
    });
    expect(document.body.querySelector("#filled-content")).not.toBeNull();
  });

  it("stamps a popoverId on the anchor's dataset", () => {
    const anchor = makeAnchor();
    openAnchoredPopover(anchor, () => {});
    expect(anchor.dataset["popoverId"]).toBeTruthy();
  });
});

describe("openAnchoredPopover toggle semantics", () => {
  it("a second call on the same anchor closes the existing popover and returns a no-op cleanup", () => {
    const anchor = makeAnchor();
    openAnchoredPopover(anchor, () => {});
    expect(document.body.querySelectorAll("[data-anchor-popover]").length).toBe(1);
    const second = openAnchoredPopover(anchor, () => {});
    expect(document.body.querySelectorAll("[data-anchor-popover]").length).toBe(0);
    // The toggle-close path returns a no-op closer.
    expect(typeof second).toBe("function");
    second();
  });

  it("clears the anchor's popoverId after the toggle-close", () => {
    const anchor = makeAnchor();
    openAnchoredPopover(anchor, () => {});
    expect(anchor.dataset["popoverId"]).toBeTruthy();
    openAnchoredPopover(anchor, () => {});
    expect(anchor.dataset["popoverId"]).toBe("");
  });

  it("two different anchors get two independent popovers", () => {
    const a = makeAnchor();
    const b = makeAnchor();
    openAnchoredPopover(a, () => {});
    openAnchoredPopover(b, () => {});
    expect(document.body.querySelectorAll("[data-anchor-popover]").length).toBe(2);
  });
});

describe("openAnchoredPopover dismissal", () => {
  it("returned cleanup() removes the popover from the DOM", () => {
    const anchor = makeAnchor();
    const close = openAnchoredPopover(anchor, () => {});
    expect(document.body.querySelector("[data-anchor-popover]")).not.toBeNull();
    close();
    expect(document.body.querySelector("[data-anchor-popover]")).toBeNull();
  });

  it("Escape key dismisses the popover (after the opening-click guard tick)", async () => {
    const anchor = makeAnchor();
    openAnchoredPopover(anchor, () => {});
    // Wait one task so the setTimeout(...,0) installs the keydown
    // listener.
    await new Promise((r) => setTimeout(r, 0));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.body.querySelector("[data-anchor-popover]")).toBeNull();
  });

  it("non-Escape keys do NOT dismiss the popover", async () => {
    const anchor = makeAnchor();
    openAnchoredPopover(anchor, () => {});
    await new Promise((r) => setTimeout(r, 0));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(document.body.querySelector("[data-anchor-popover]")).not.toBeNull();
  });

  it("click outside the popover + outside the anchor dismisses", async () => {
    const anchor = makeAnchor();
    openAnchoredPopover(anchor, () => {});
    await new Promise((r) => setTimeout(r, 0));
    const elsewhere = document.createElement("div");
    document.body.appendChild(elsewhere);
    elsewhere.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.body.querySelector("[data-anchor-popover]")).toBeNull();
  });

  it("click inside the popover does NOT dismiss", async () => {
    const anchor = makeAnchor();
    openAnchoredPopover(anchor, (root) => {
      const inner = document.createElement("button");
      inner.id = "inside-click";
      root.appendChild(inner);
    });
    await new Promise((r) => setTimeout(r, 0));
    const inner = document.body.querySelector("#inside-click") as HTMLElement;
    inner.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.body.querySelector("[data-anchor-popover]")).not.toBeNull();
  });

  it("click on the anchor itself does NOT dismiss (the toggle-close path is the caller's responsibility)", async () => {
    const anchor = makeAnchor();
    openAnchoredPopover(anchor, () => {});
    await new Promise((r) => setTimeout(r, 0));
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.body.querySelector("[data-anchor-popover]")).not.toBeNull();
  });
});

describe("openAnchoredPopover placement", () => {
  it("default placement is 'right' (caller doesn't pass opts)", () => {
    const anchor = makeAnchor();
    openAnchoredPopover(anchor, () => {});
    const popover = document.body.querySelector<HTMLElement>("[data-anchor-popover]");
    // Position is computed against happy-dom's getBoundingClientRect
    // (returns zeros) — both placements emit a top + left, so we just
    // assert the styles exist as expected for the right-placement path.
    expect(popover!.style.top).toMatch(/^\d+px$/);
    expect(popover!.style.left).toMatch(/^\d+px$/);
  });

  it("'below' placement also emits a top + left", () => {
    const anchor = makeAnchor();
    openAnchoredPopover(anchor, () => {}, { placement: "below" });
    const popover = document.body.querySelector<HTMLElement>("[data-anchor-popover]");
    expect(popover!.style.top).toMatch(/^\d+px$/);
    expect(popover!.style.left).toMatch(/^\d+px$/);
  });
});
