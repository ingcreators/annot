/**
 * @vitest-environment happy-dom
 *
 * `showTemplatePickerDialog` — Phase 8d of
 * `docs/plans/annot-html-document.md`. Promise wrapper around
 * `<annot-template-picker>` with full-viewport overlay chrome,
 * dismissal triggers (Esc / overlay-click / Cancel), and
 * resolution on `template-selected`.
 *
 * Same contract as `showSaveAsTemplateDialog`'s tests: the
 * helper builds the DOM, mounts it, hooks events, resolves the
 * Promise, and tears down on close.
 */

import { afterEach, describe, expect, it } from "vitest";
import "../annot-template-picker.js";
import type {
  AnnotTemplatePickerElement,
  TemplateSelectedDetail,
} from "../annot-template-picker.js";
import { showTemplatePickerDialog } from "./template-picker-dialog.js";

if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    queueMicrotask(() => cb(performance.now()));
    return 0;
  };
}

afterEach(() => {
  // Tear down anything mounted on body. The dialog's
  // `installStyles` injects a `<style>` into <head> with a
  // dedupe `id`; leave that intact between tests so subsequent
  // mounts don't re-inject.
  for (const child of Array.from(document.body.children)) {
    child.remove();
  }
});

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe("showTemplatePickerDialog", () => {
  it("mounts an overlay with the picker and a Cancel button", async () => {
    showTemplatePickerDialog({});
    await flush();
    expect(document.querySelector(".annot-template-picker-dialog-overlay")).not.toBeNull();
    expect(document.querySelector(".annot-template-picker-dialog-panel")).not.toBeNull();
    expect(document.querySelector("annot-template-picker")).not.toBeNull();
    const footerBtn = document.querySelector<HTMLButtonElement>(
      ".annot-template-picker-dialog-footer button",
    );
    expect(footerBtn?.textContent?.trim()).toBe("Cancel");
  });

  it("propagates userTemplates / builtinTemplates / loadingUser to the picker", async () => {
    showTemplatePickerDialog({
      userTemplates: [{ path: "Templates/x.annot.html", title: "X" }],
      builtinTemplates: [{ id: "manual", title: "Manual" }],
      loadingUser: true,
      recentKey: "annot-template-picker-dialog-test-1",
    });
    await flush();
    const picker = document.querySelector<AnnotTemplatePickerElement>("annot-template-picker")!;
    expect(picker.userTemplates).toEqual([{ path: "Templates/x.annot.html", title: "X" }]);
    expect(picker.builtinTemplates).toEqual([{ id: "manual", title: "Manual" }]);
    expect(picker.loadingUser).toBe(true);
  });

  it("uses a custom title when supplied", async () => {
    showTemplatePickerDialog({ title: "Pick a starter" });
    await flush();
    const header = document.querySelector(".annot-template-picker-dialog-header");
    expect(header?.textContent?.trim()).toBe("Pick a starter");
  });

  it("resolves null when Cancel is clicked", async () => {
    const p = showTemplatePickerDialog({});
    await flush();
    document
      .querySelector<HTMLButtonElement>(".annot-template-picker-dialog-footer button")!
      .click();
    expect(await p).toBeNull();
    expect(document.querySelector(".annot-template-picker-dialog-overlay")).toBeNull();
  });

  it("resolves null when Esc is pressed", async () => {
    const p = showTemplatePickerDialog({});
    await flush();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(await p).toBeNull();
    expect(document.querySelector(".annot-template-picker-dialog-overlay")).toBeNull();
  });

  it("resolves null when the overlay backdrop is clicked", async () => {
    const p = showTemplatePickerDialog({});
    await flush();
    const overlay = document.querySelector<HTMLElement>(".annot-template-picker-dialog-overlay")!;
    // Click on the overlay itself (not a descendant).
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(await p).toBeNull();
  });

  it("does NOT resolve when a click bubbles up from inside the panel", async () => {
    const p = showTemplatePickerDialog({});
    await flush();
    const panel = document.querySelector<HTMLElement>(".annot-template-picker-dialog-panel")!;
    panel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Race the next macrotask — if the dialog had closed,
    // the overlay would be gone by now.
    await flush();
    expect(document.querySelector(".annot-template-picker-dialog-overlay")).not.toBeNull();
    // Tear down.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(await p).toBeNull();
  });

  it("resolves with the selected user template's detail", async () => {
    const p = showTemplatePickerDialog({
      userTemplates: [{ path: "Templates/x.annot.html", title: "X" }],
      recentKey: "annot-template-picker-dialog-test-resolve-user",
    });
    await flush();
    const card = document.querySelector<HTMLButtonElement>(
      '.annot-template-picker-card[data-template-source="user"]',
    )!;
    card.click();
    expect(await p).toEqual<TemplateSelectedDetail>({
      kind: "user",
      path: "Templates/x.annot.html",
    });
    expect(document.querySelector(".annot-template-picker-dialog-overlay")).toBeNull();
  });

  it("resolves with the selected built-in template's detail", async () => {
    const p = showTemplatePickerDialog({
      builtinTemplates: [{ id: "manual", title: "Manual" }],
      recentKey: "annot-template-picker-dialog-test-resolve-builtin",
    });
    await flush();
    const card = document.querySelector<HTMLButtonElement>(
      '.annot-template-picker-card[data-template-source="builtin"]',
    )!;
    card.click();
    expect(await p).toEqual<TemplateSelectedDetail>({
      kind: "builtin",
      id: "manual",
    });
  });

  it("removes the overlay from the DOM after resolve", async () => {
    const p = showTemplatePickerDialog({});
    await flush();
    document
      .querySelector<HTMLButtonElement>(".annot-template-picker-dialog-footer button")!
      .click();
    await p;
    expect(document.querySelector(".annot-template-picker-dialog-overlay")).toBeNull();
  });

  it("ignores duplicate close paths (only one Promise resolution)", async () => {
    // If a card click + Esc fire in the same macrotask, the
    // helper must resolve once. Without the `resolved` guard
    // the Promise would reject the second resolve internally.
    const p = showTemplatePickerDialog({
      userTemplates: [{ path: "Templates/x.annot.html", title: "X" }],
      recentKey: "annot-template-picker-dialog-test-dup",
    });
    await flush();
    document
      .querySelector<HTMLButtonElement>('.annot-template-picker-card[data-template-source="user"]')!
      .click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(await p).toEqual({ kind: "user", path: "Templates/x.annot.html" });
  });
});
