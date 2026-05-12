/**
 * @vitest-environment happy-dom
 *
 * `showCreateCardDocumentDialog` tests — Phase 4 of
 * `docs/plans/_done/card-procedure-template.md`. Same imperative-dialog
 * shape as `showDocSettingsDialog`, so the assertions follow
 * the same pattern.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { showCreateCardDocumentDialog } from "./create-card-document-dialog.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.querySelectorAll("annot-dialog").forEach((d) => d.remove());
});

function findDialog(): HTMLElement {
  const dlg = document.querySelector("annot-dialog");
  if (!dlg) throw new Error("dialog not mounted");
  return dlg as HTMLElement;
}

function getInput(label: string): HTMLInputElement | HTMLSelectElement {
  const inputs = document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    `[aria-label="${label}"]`,
  );
  if (inputs.length === 0) throw new Error(`no input with aria-label="${label}"`);
  return inputs[0] as HTMLInputElement | HTMLSelectElement;
}

describe("showCreateCardDocumentDialog", () => {
  it("renders the field set with safe defaults pre-populated", async () => {
    const promise = showCreateCardDocumentDialog({ imageCount: 3 });
    findDialog();
    expect((getInput("Document title") as HTMLInputElement).value).toBe("Untitled procedure");
    expect((getInput("Per-step layout") as HTMLSelectElement).value).toBe("image-top");
    expect((getInput("Cards per row") as HTMLSelectElement).value).toBe("1");
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    expect(await promise).toBeNull();
  });

  // Phase 4 of `docs/plans/card-step-auto-numbering.md` — the
  // legacy "Step title prefill" dropdown was removed. Step
  // numbering is now a CSS counter badge controlled from Doc
  // Settings (`meta.numbering.steps`).
  it("no longer renders a step-title prefill dropdown", () => {
    showCreateCardDocumentDialog({ imageCount: 1 });
    findDialog();
    expect(document.querySelector('[aria-label="Step title prefill"]')).toBeNull();
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
  });

  it("pre-populates from caller-supplied defaults", async () => {
    const promise = showCreateCardDocumentDialog({
      imageCount: 5,
      defaultTitle: "Onboarding manual",
      defaultLayout: "image-left",
      defaultColumns: 2,
    });
    findDialog();
    expect((getInput("Document title") as HTMLInputElement).value).toBe("Onboarding manual");
    expect((getInput("Per-step layout") as HTMLSelectElement).value).toBe("image-left");
    expect((getInput("Cards per row") as HTMLSelectElement).value).toBe("2");
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    await promise;
  });

  it("reflects the image count in the dialog message", () => {
    showCreateCardDocumentDialog({ imageCount: 1 });
    const dlg = findDialog();
    // Singular: "1 image".
    expect((dlg as { message?: string }).message).toContain("1 image ready");
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
  });

  it("uses plural noun when the image count is > 1", () => {
    showCreateCardDocumentDialog({ imageCount: 7 });
    const dlg = findDialog();
    expect((dlg as { message?: string }).message).toContain("7 images ready");
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
  });

  it("returns the user's input on OK", async () => {
    const promise = showCreateCardDocumentDialog({ imageCount: 2 });
    findDialog();
    (getInput("Document title") as HTMLInputElement).value = "Manual";
    (getInput("Per-step layout") as HTMLSelectElement).value = "image-fill";
    (getInput("Cards per row") as HTMLSelectElement).value = "3";
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.title).toBe("Manual");
    expect(result.layout).toBe("image-fill");
    expect(result.columns).toBe(3);
  });

  it("returns `columns: undefined` when the user picks the 1-column default", async () => {
    const promise = showCreateCardDocumentDialog({ imageCount: 2 });
    findDialog();
    (getInput("Cards per row") as HTMLSelectElement).value = "1";
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    // `columns: 1` round-trips as undefined per parseColumns —
    // the generator + serialiser elide the field when it matches
    // the implicit default.
    expect(result?.columns).toBe(1);
  });

  it('returns columns === "auto" when the user picks Auto', async () => {
    const promise = showCreateCardDocumentDialog({ imageCount: 4 });
    findDialog();
    (getInput("Cards per row") as HTMLSelectElement).value = "auto";
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    expect(result?.columns).toBe("auto");
  });

  it("falls back to 'Untitled procedure' when the title is cleared", async () => {
    const promise = showCreateCardDocumentDialog({ imageCount: 1 });
    findDialog();
    (getInput("Document title") as HTMLInputElement).value = "   ";
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    expect(result?.title).toBe("Untitled procedure");
  });

  it("returns null on Cancel", async () => {
    const promise = showCreateCardDocumentDialog({ imageCount: 1 });
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    expect(await promise).toBeNull();
  });
});
