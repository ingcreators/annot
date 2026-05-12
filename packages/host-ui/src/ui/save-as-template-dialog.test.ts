/**
 * @vitest-environment happy-dom
 *
 * `showSaveAsTemplateDialog` — Phase 8b of
 * `docs/plans/_done/annot-html-document.md`. Same shape as the
 * `showPromptDialog` / `showConfirmDialog` tests in
 * `dialog.test.ts`: exercise the Promise wrapper end-to-end via
 * the resulting DOM (mounted `<annot-dialog>` chrome + the three
 * field inputs we append to its body).
 */

import { afterEach, describe, expect, it } from "vitest";
import { showSaveAsTemplateDialog } from "./save-as-template-dialog.js";

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

async function flushFrames(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/** Locate the inputs inside the mounted dialog. The dialog
 *  appends the fields wrapper as a direct child of
 *  `<annot-dialog>`; the dialog's `firstUpdated` then relocates
 *  them into `.app-dialog-body`. Either way `querySelector` from
 *  the document root finds them. */
function getInputs(): {
  name: HTMLInputElement;
  description: HTMLTextAreaElement;
  tags: HTMLInputElement;
  ok: HTMLButtonElement;
  cancel: HTMLButtonElement;
} {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(".app-dialog-input"));
  // The textarea reuses `.app-dialog-input`; filter by tagName.
  const name = inputs.find(
    (el) => el.tagName === "INPUT" && el.getAttribute("aria-label") === "Template name",
  )!;
  const tags = inputs.find(
    (el) => el.tagName === "INPUT" && el.getAttribute("aria-label") === "Template tags",
  )!;
  const description = document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Template description"]',
  )!;
  const ok = document.querySelector<HTMLButtonElement>(".app-dialog-ok")!;
  const cancel = document.querySelector<HTMLButtonElement>(".app-dialog-cancel")!;
  return { name, description, tags, ok, cancel };
}

describe("showSaveAsTemplateDialog", () => {
  it("resolves with name + description + tags on OK", async () => {
    const p = showSaveAsTemplateDialog({
      defaultName: "manual",
      defaultDescription: "step-by-step",
      defaultTags: ["onboarding", "manual"],
    });
    await flushFrames();
    const { name, description, tags, ok } = getInputs();
    expect(name.value).toBe("manual");
    expect(description.value).toBe("step-by-step");
    expect(tags.value).toBe("onboarding, manual");
    ok.click();
    const out = await p;
    expect(out).toEqual({
      name: "manual",
      description: "step-by-step",
      tags: ["onboarding", "manual"],
    });
  });

  it("resolves null on Cancel", async () => {
    const p = showSaveAsTemplateDialog({ defaultName: "x" });
    await flushFrames();
    getInputs().cancel.click();
    expect(await p).toBeNull();
  });

  it("trims the name and tag entries", async () => {
    const p = showSaveAsTemplateDialog({
      defaultName: "  manual  ",
      defaultTags: ["  bundled  ", "  manual  "],
    });
    await flushFrames();
    getInputs().ok.click();
    const out = await p;
    expect(out).toEqual({
      name: "manual",
      tags: ["bundled", "manual"],
    });
  });

  it("drops empty tag entries (consecutive commas, trailing comma)", async () => {
    const p = showSaveAsTemplateDialog({ defaultName: "x" });
    await flushFrames();
    const { tags, ok } = getInputs();
    tags.value = "alpha,, beta, , gamma,";
    ok.click();
    const out = await p;
    expect(out?.tags).toEqual(["alpha", "beta", "gamma"]);
  });

  it("omits description from the result when blank", async () => {
    const p = showSaveAsTemplateDialog({ defaultName: "x" });
    await flushFrames();
    const { description, ok } = getInputs();
    description.value = "   ";
    ok.click();
    const out = await p;
    expect(out).toEqual({ name: "x", tags: [] });
    expect(out).not.toHaveProperty("description");
  });

  it("blocks an empty name with an inline error", async () => {
    const p = showSaveAsTemplateDialog({ defaultName: "" });
    await flushFrames();
    const { name, ok } = getInputs();
    expect(name.value).toBe("");
    ok.click();
    // Dialog stays open; error message visible.
    expect(document.querySelector("annot-dialog")).not.toBeNull();
    expect(document.querySelector(".app-dialog-error")?.textContent).toMatch(/required/i);
    // Fill it and resubmit.
    name.value = "manual";
    ok.click();
    const out = await p;
    expect(out).toEqual({ name: "manual", tags: [] });
  });

  it("rejects names containing path separators or '..'", async () => {
    const p = showSaveAsTemplateDialog({ defaultName: "subdir/manual" });
    await flushFrames();
    const { name, ok } = getInputs();
    ok.click();
    expect(document.querySelector("annot-dialog")).not.toBeNull();
    expect(document.querySelector(".app-dialog-error")?.textContent).toMatch(/can't contain/i);
    // Try the other forbidden characters.
    name.value = "..\\bad";
    ok.click();
    expect(document.querySelector(".app-dialog-error")?.textContent).toMatch(/can't contain/i);
    // Then accept a clean value.
    name.value = "clean-name";
    ok.click();
    expect(await p).toEqual({ name: "clean-name", tags: [] });
  });

  it("clears the inline error when the user starts typing", async () => {
    const p = showSaveAsTemplateDialog({ defaultName: "" });
    await flushFrames();
    const { name, ok } = getInputs();
    ok.click();
    const errEl = document.querySelector<HTMLElement>(".app-dialog-error")!;
    expect(errEl.style.display).toBe("");
    name.value = "x";
    name.dispatchEvent(new Event("input"));
    expect(errEl.style.display).toBe("none");
    ok.click();
    expect(await p).toEqual({ name: "x", tags: [] });
  });

  it("Enter on the name input proxies a click to OK", async () => {
    const p = showSaveAsTemplateDialog({ defaultName: "x" });
    await flushFrames();
    const { name } = getInputs();
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(await p).toEqual({ name: "x", tags: [] });
  });

  it("removes the dialog from the DOM after resolve", async () => {
    const p = showSaveAsTemplateDialog({ defaultName: "x" });
    await flushFrames();
    getInputs().ok.click();
    await p;
    expect(document.querySelector("annot-dialog")).toBeNull();
  });
});
