/**
 * @vitest-environment happy-dom
 *
 * The dialog stack has two parts:
 *
 *   - `<annot-dialog>` Lit element — owns the overlay / panel /
 *     title / message / actions chrome, fires `dialog-ok` /
 *     `dialog-cancel`, handles Esc + outside-click, relocates
 *     pre-slotted body content into `.app-dialog-body`.
 *   - `dialog.ts` Promise wrappers — `showPromptDialog`,
 *     `showConfirmDialog`, `showAlertDialog`. They construct the
 *     element, mount it, wire the events to a Promise, and tear
 *     down on resolve.
 *
 * Tests cover both: the element's behaviour (event dispatch,
 * Esc/outside-click rules, single-button mode, danger styling,
 * focusOk, getBody, slot relocation) and the wrappers' contract
 * (resolve values, validate hook, Enter-to-submit on prompts,
 * outside-click only on confirm/alert, removal on resolve).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotDialogElement } from "./annot-dialog.js";
import { showAlertDialog, showConfirmDialog, showPromptDialog } from "./dialog.js";

// Polyfill the next-frame scheduler — happy-dom ships
// `requestAnimationFrame` as `setTimeout(0)` already in v20, but be
// defensive: if it's missing we install a queueMicrotask shim so the
// dialog wrappers' focus-on-mount code runs.
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    queueMicrotask(() => cb(performance.now()));
    return 0;
  };
}

afterEach(() => {
  for (const child of Array.from(document.body.children)) {
    child.remove();
  }
});

/** Wait long enough for the wrapper's `requestAnimationFrame` +
 *  Lit's update queue to flush. Two macrotask hops covers both. */
async function flushFrames(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe("<annot-dialog> element", () => {
  it("registers the custom element on the global registry", () => {
    expect(customElements.get("annot-dialog")).toBe(AnnotDialogElement);
  });

  it("renders title, message, OK + Cancel buttons by default", async () => {
    const el = document.createElement("annot-dialog");
    el.title = "Title";
    el.message = "Body message";
    document.body.appendChild(el);
    await flushFrames();
    expect(el.querySelector(".app-dialog-title")!.textContent).toBe("Title");
    expect(el.querySelector(".app-dialog-message")!.textContent).toBe("Body message");
    expect(el.querySelector(".app-dialog-ok")).not.toBeNull();
    expect(el.querySelector(".app-dialog-cancel")).not.toBeNull();
  });

  it("omits the Cancel button when singleButton=true (alert mode)", async () => {
    const el = document.createElement("annot-dialog");
    el.title = "Heads up";
    el.singleButton = true;
    document.body.appendChild(el);
    await flushFrames();
    expect(el.querySelector(".app-dialog-cancel")).toBeNull();
    expect(el.querySelector(".app-dialog-ok")).not.toBeNull();
  });

  it("OK button gets primary class normally; danger class when danger=true", async () => {
    const safe = document.createElement("annot-dialog");
    safe.title = "Safe";
    document.body.appendChild(safe);
    await flushFrames();
    expect(safe.querySelector(".app-dialog-ok")!.className).toContain("app-dialog-primary");

    const danger = document.createElement("annot-dialog");
    danger.title = "Delete?";
    danger.danger = true;
    document.body.appendChild(danger);
    await flushFrames();
    expect(danger.querySelector(".app-dialog-ok")!.className).toContain("app-dialog-danger");
    expect(danger.querySelector(".app-dialog-ok")!.className).not.toContain("app-dialog-primary");
  });

  it("clicking OK fires a bubbling dialog-ok event", async () => {
    const el = document.createElement("annot-dialog");
    el.title = "Q?";
    document.body.appendChild(el);
    await flushFrames();
    const spy = vi.fn();
    el.addEventListener("dialog-ok", spy);
    el.querySelector<HTMLButtonElement>(".app-dialog-ok")!.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("clicking Cancel fires dialog-cancel", async () => {
    const el = document.createElement("annot-dialog");
    el.title = "Q?";
    document.body.appendChild(el);
    await flushFrames();
    const spy = vi.fn();
    el.addEventListener("dialog-cancel", spy);
    el.querySelector<HTMLButtonElement>(".app-dialog-cancel")!.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("Escape fires dialog-cancel (keydown listener installed on connect)", async () => {
    const el = document.createElement("annot-dialog");
    el.title = "Q?";
    document.body.appendChild(el);
    await flushFrames();
    const spy = vi.fn();
    el.addEventListener("dialog-cancel", spy);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("non-Escape keys do NOT fire cancel", async () => {
    const el = document.createElement("annot-dialog");
    el.title = "Q?";
    document.body.appendChild(el);
    await flushFrames();
    const spy = vi.fn();
    el.addEventListener("dialog-cancel", spy);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("disconnects remove the keydown listener (Escape stops cancelling)", async () => {
    const el = document.createElement("annot-dialog");
    el.title = "Q?";
    document.body.appendChild(el);
    await flushFrames();
    const spy = vi.fn();
    el.addEventListener("dialog-cancel", spy);
    el.remove();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("outside-click on overlay fires cancel ONLY when closeOnOutsideClick=true", async () => {
    const el = document.createElement("annot-dialog");
    el.title = "Q?";
    document.body.appendChild(el);
    await flushFrames();
    const spy = vi.fn();
    el.addEventListener("dialog-cancel", spy);
    const overlay = el.querySelector<HTMLElement>(".app-dialog-overlay")!;
    // Without closeOnOutsideClick, overlay-click is a no-op.
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(spy).not.toHaveBeenCalled();
    el.closeOnOutsideClick = true;
    await flushFrames();
    // Re-grab the overlay because Lit may have re-rendered it.
    const overlay2 = el.querySelector<HTMLElement>(".app-dialog-overlay")!;
    overlay2.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("clicking inside the panel (not the overlay) does NOT cancel even when closeOnOutsideClick=true", async () => {
    const el = document.createElement("annot-dialog");
    el.title = "Q?";
    el.closeOnOutsideClick = true;
    document.body.appendChild(el);
    await flushFrames();
    const spy = vi.fn();
    el.addEventListener("dialog-cancel", spy);
    const panel = el.querySelector<HTMLElement>(".app-dialog")!;
    panel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Bubbles up but the handler checks `e.target === e.currentTarget`,
    // which is the overlay; clicks bubbling from the panel have a
    // different target so they're ignored.
    expect(spy).not.toHaveBeenCalled();
  });

  it("focusOk() focuses the OK button", async () => {
    const el = document.createElement("annot-dialog");
    el.title = "Q?";
    document.body.appendChild(el);
    await flushFrames();
    el.focusOk();
    expect(document.activeElement).toBe(el.querySelector(".app-dialog-ok"));
  });

  it("getBody() returns the .app-dialog-body element", async () => {
    const el = document.createElement("annot-dialog");
    el.title = "Q?";
    document.body.appendChild(el);
    await flushFrames();
    const body = el.getBody();
    expect(body).not.toBeNull();
    expect(body!.classList.contains("app-dialog-body")).toBe(true);
  });

  it("relocates pre-slotted children into .app-dialog-body and removes the <slot> placeholder", async () => {
    const el = document.createElement("annot-dialog");
    el.title = "Prompt";
    const input = document.createElement("input");
    input.id = "preslotted";
    el.appendChild(input);
    document.body.appendChild(el);
    await flushFrames();
    const body = el.querySelector<HTMLElement>(".app-dialog-body")!;
    expect(body.querySelector("#preslotted")).toBe(input);
    // The <slot> placeholder is gone after firstUpdated.
    expect(body.querySelector("slot")).toBeNull();
  });
});

describe("showPromptDialog", () => {
  it("resolves with the trimmed input value on OK", async () => {
    const p = showPromptDialog({ title: "Name?", defaultValue: "  hello  " });
    await flushFrames();
    document.querySelector<HTMLButtonElement>(".app-dialog-ok")!.click();
    expect(await p).toBe("hello");
  });

  it("resolves null on Cancel", async () => {
    const p = showPromptDialog({ title: "Name?" });
    await flushFrames();
    document.querySelector<HTMLButtonElement>(".app-dialog-cancel")!.click();
    expect(await p).toBeNull();
  });

  it("blocks empty submit and shows an inline error", async () => {
    const p = showPromptDialog({ title: "Name?", defaultValue: "" });
    await flushFrames();
    const ok = document.querySelector<HTMLButtonElement>(".app-dialog-ok")!;
    ok.click();
    // Dialog stays open — the OK click was rejected with an error.
    expect(document.querySelector(".app-dialog-error")?.textContent).toMatch(/value/i);
    expect(document.querySelector("annot-dialog")).not.toBeNull();
    // Type something and re-submit.
    const input = document.querySelector<HTMLInputElement>(".app-dialog-input")!;
    input.value = "world";
    ok.click();
    expect(await p).toBe("world");
  });

  it("validate hook can block submit with a custom message", async () => {
    const validate = vi.fn().mockImplementation((v: string) => (v.length < 3 ? "too short" : null));
    const p = showPromptDialog({ title: "PIN", defaultValue: "ab", validate });
    await flushFrames();
    document.querySelector<HTMLButtonElement>(".app-dialog-ok")!.click();
    expect(validate).toHaveBeenCalledWith("ab");
    expect(document.querySelector(".app-dialog-error")?.textContent).toBe("too short");
    // Fix the value + retry.
    const input = document.querySelector<HTMLInputElement>(".app-dialog-input")!;
    input.value = "abcd";
    document.querySelector<HTMLButtonElement>(".app-dialog-ok")!.click();
    expect(await p).toBe("abcd");
  });

  it("Enter on the input proxies a click to the OK button", async () => {
    const p = showPromptDialog({ title: "Name?", defaultValue: "x" });
    await flushFrames();
    const input = document.querySelector<HTMLInputElement>(".app-dialog-input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(await p).toBe("x");
  });

  it("removes the dialog from the DOM after resolve", async () => {
    const p = showPromptDialog({ title: "Name?", defaultValue: "x" });
    await flushFrames();
    document.querySelector<HTMLButtonElement>(".app-dialog-ok")!.click();
    await p;
    expect(document.querySelector("annot-dialog")).toBeNull();
  });

  it("uses custom OK / Cancel labels and a placeholder when supplied", async () => {
    showPromptDialog({
      title: "Q?",
      okLabel: "Yes!",
      cancelLabel: "No way",
      placeholder: "Type here",
    });
    await flushFrames();
    expect(document.querySelector(".app-dialog-ok")!.textContent!.trim()).toBe("Yes!");
    expect(document.querySelector(".app-dialog-cancel")!.textContent!.trim()).toBe("No way");
    expect(
      document.querySelector<HTMLInputElement>(".app-dialog-input")!.placeholder,
    ).toBe("Type here");
  });
});

describe("showConfirmDialog", () => {
  it("resolves true on OK", async () => {
    const p = showConfirmDialog({ title: "Delete?" });
    await flushFrames();
    document.querySelector<HTMLButtonElement>(".app-dialog-ok")!.click();
    expect(await p).toBe(true);
  });

  it("resolves false on Cancel", async () => {
    const p = showConfirmDialog({ title: "Delete?" });
    await flushFrames();
    document.querySelector<HTMLButtonElement>(".app-dialog-cancel")!.click();
    expect(await p).toBe(false);
  });

  it("resolves false when the user clicks the overlay (closeOnOutsideClick=true by default for confirms)", async () => {
    const p = showConfirmDialog({ title: "Delete?" });
    await flushFrames();
    const overlay = document.querySelector<HTMLElement>(".app-dialog-overlay")!;
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(await p).toBe(false);
  });

  it("removes the dialog from the DOM after resolve", async () => {
    const p = showConfirmDialog({ title: "Delete?" });
    await flushFrames();
    document.querySelector<HTMLButtonElement>(".app-dialog-ok")!.click();
    await p;
    expect(document.querySelector("annot-dialog")).toBeNull();
  });
});

describe("showAlertDialog", () => {
  it("resolves on OK click", async () => {
    const p = showAlertDialog({ title: "Done" });
    await flushFrames();
    expect(document.querySelector(".app-dialog-cancel")).toBeNull(); // singleButton
    document.querySelector<HTMLButtonElement>(".app-dialog-ok")!.click();
    await expect(p).resolves.toBeUndefined();
  });

  it("resolves on Escape (alerts are dismissable)", async () => {
    const p = showAlertDialog({ title: "Done" });
    await flushFrames();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect(p).resolves.toBeUndefined();
  });

  it("resolves on overlay click (closeOnOutsideClick=true for alerts)", async () => {
    const p = showAlertDialog({ title: "Done" });
    await flushFrames();
    const overlay = document.querySelector<HTMLElement>(".app-dialog-overlay")!;
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await expect(p).resolves.toBeUndefined();
  });

  it("removes the dialog from the DOM after dismissal", async () => {
    const p = showAlertDialog({ title: "Done" });
    await flushFrames();
    document.querySelector<HTMLButtonElement>(".app-dialog-ok")!.click();
    await p;
    expect(document.querySelector("annot-dialog")).toBeNull();
  });
});
