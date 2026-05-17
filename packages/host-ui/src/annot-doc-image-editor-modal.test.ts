/**
 * @vitest-environment happy-dom
 *
 * `<annot-doc-image-editor-modal>` tests — Phase 5a of
 * `docs/plans/_done/annot-html-document.md`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "./annot-doc-image-editor-modal.js";
import {
  AnnotDocImageEditorModalElement,
  type ImageEditorModalInput,
  type ImageEditorModalResult,
} from "./annot-doc-image-editor-modal.js";

const PNG_PIXEL =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function makeInput(overrides: Partial<ImageEditorModalInput> = {}): ImageEditorModalInput {
  return {
    id: "test-img",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 200 100" width="200" height="100"><image href="${PNG_PIXEL}" width="200" height="100"/><g id="annotations"></g></svg>`,
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  AnnotDocImageEditorModalElement.closeActive();
});

describe("annot-doc-image-editor-modal: lifecycle", () => {
  it("openFor mounts the modal + an EditorShell-backed canvas", async () => {
    const promise = AnnotDocImageEditorModalElement.openFor(makeInput());
    const modal = document.querySelector(
      "annot-doc-image-editor-modal",
    ) as AnnotDocImageEditorModalElement;
    expect(modal).not.toBeNull();
    await modal.updateComplete;
    // The shell's SVG mounts as a direct child of the canvas
    // wrap — the previous intermediate `.canvas` flex div was
    // dropped so `CanvasManager.fitToView` reads the wrap's
    // real clientHeight.
    expect(
      modal.querySelector(".annot-doc-image-editor-modal-canvas-wrap > svg[data-annot-shell-root]"),
    ).not.toBeNull();
    // Cancel so the test cleanly resolves.
    modal
      .querySelector<HTMLButtonElement>(".annot-doc-image-editor-modal-footer button:not(.primary)")
      ?.click();
    const result = await promise;
    expect(result.kind).toBe("cancel");
  });

  it("clicking Cancel resolves with kind=cancel + tears down", async () => {
    const promise = AnnotDocImageEditorModalElement.openFor(makeInput());
    const modal = document.querySelector(
      "annot-doc-image-editor-modal",
    ) as AnnotDocImageEditorModalElement;
    await modal.updateComplete;
    modal
      .querySelector<HTMLButtonElement>(".annot-doc-image-editor-modal-footer button:not(.primary)")
      ?.click();
    const result = await promise;
    expect(result.kind).toBe("cancel");
    expect(document.querySelector("annot-doc-image-editor-modal")).toBeNull();
  });

  it("Esc cancels the modal", async () => {
    const promise = AnnotDocImageEditorModalElement.openFor(makeInput());
    const modal = document.querySelector(
      "annot-doc-image-editor-modal",
    ) as AnnotDocImageEditorModalElement;
    await modal.updateComplete;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const result = await promise;
    expect(result.kind).toBe("cancel");
  });

  it("clicking the overlay backdrop cancels", async () => {
    const promise = AnnotDocImageEditorModalElement.openFor(makeInput());
    const modal = document.querySelector(
      "annot-doc-image-editor-modal",
    ) as AnnotDocImageEditorModalElement;
    await modal.updateComplete;
    const overlay = modal.querySelector(".annot-doc-image-editor-modal-overlay") as HTMLElement;
    overlay.click();
    const result = await promise;
    expect(result.kind).toBe("cancel");
  });

  it("opening twice closes the previous modal", async () => {
    const first = AnnotDocImageEditorModalElement.openFor(makeInput({ id: "a" }));
    await new Promise<void>((r) => queueMicrotask(r));
    const second = AnnotDocImageEditorModalElement.openFor(makeInput({ id: "b" }));
    const firstResult = await first;
    expect(firstResult.kind).toBe("cancel");
    // The second modal exists; cancel it to clean up.
    AnnotDocImageEditorModalElement.closeActive();
    const secondResult = await second;
    expect(secondResult.kind).toBe("cancel");
  });
});

describe("annot-doc-image-editor-modal: save", () => {
  it("clicking Save resolves with the canvas's serialized SVG", async () => {
    const promise = AnnotDocImageEditorModalElement.openFor(makeInput());
    const modal = document.querySelector(
      "annot-doc-image-editor-modal",
    ) as AnnotDocImageEditorModalElement;
    await modal.updateComplete;
    modal
      .querySelector<HTMLButtonElement>(".annot-doc-image-editor-modal-footer button.primary")
      ?.click();
    const result = (await promise) as ImageEditorModalResult & { kind: "save" };
    expect(result.kind).toBe("save");
    expect(result.svg).toContain("<svg");
    expect(result.svg).toContain('data-annot-version="1"');
    expect(result.svg).toContain(PNG_PIXEL);
  });
});

// ---------------------------------------------------------------------------
// Phase 6 of `annot-html-document-ux-polish.md` — image flow polish.
// ---------------------------------------------------------------------------

describe("annot-doc-image-editor-modal: phase 6 header", () => {
  it("renders 'Editing image N of M' when position + total are provided", async () => {
    const promise = AnnotDocImageEditorModalElement.openFor(
      makeInput({ positionInImages: 2, totalImages: 5 }),
    );
    const modal = document.querySelector(
      "annot-doc-image-editor-modal",
    ) as AnnotDocImageEditorModalElement;
    await modal.updateComplete;
    const header = modal.querySelector(".annot-doc-image-editor-modal-header");
    expect(header?.textContent ?? "").toContain("Editing image 2 of 5");
    AnnotDocImageEditorModalElement.closeActive();
    await promise;
  });

  it("falls back to 'Edit image' when position / total are absent", async () => {
    const promise = AnnotDocImageEditorModalElement.openFor(makeInput());
    const modal = document.querySelector(
      "annot-doc-image-editor-modal",
    ) as AnnotDocImageEditorModalElement;
    await modal.updateComplete;
    const header = modal.querySelector(".annot-doc-image-editor-modal-header");
    expect(header?.textContent ?? "").toContain("Edit image");
    expect(header?.textContent ?? "").not.toContain("Editing image");
    AnnotDocImageEditorModalElement.closeActive();
    await promise;
  });

  it("doesn't show the 'Unsaved changes' pill at open time", async () => {
    const promise = AnnotDocImageEditorModalElement.openFor(makeInput());
    const modal = document.querySelector(
      "annot-doc-image-editor-modal",
    ) as AnnotDocImageEditorModalElement;
    await modal.updateComplete;
    expect(modal.querySelector(".annot-doc-image-editor-modal-dirty")).toBeNull();
    AnnotDocImageEditorModalElement.closeActive();
    await promise;
  });
});

// ---------------------------------------------------------------------------
// Phase 5 of `card-document-image-gallery-link-sync.md` — link badge +
// Unlink action.
// ---------------------------------------------------------------------------

describe("annot-doc-image-editor-modal: link badge (Phase 5)", () => {
  it("renders the linked badge when sourceImagePath is set", async () => {
    const promise = AnnotDocImageEditorModalElement.openFor(
      makeInput({ sourceImagePath: "Screenshots/foo.png" }),
    );
    const modal = document.querySelector(
      "annot-doc-image-editor-modal",
    ) as AnnotDocImageEditorModalElement;
    await modal.updateComplete;
    const badge = modal.querySelector(".annot-doc-image-editor-modal-link-badge");
    expect(badge).not.toBeNull();
    // File-name extracted from the path for compact display.
    expect(badge?.textContent ?? "").toContain("foo.png");
    expect(badge?.querySelector("button.unlink")).not.toBeNull();
    AnnotDocImageEditorModalElement.closeActive();
    await promise;
  });

  it("does NOT render the linked badge when sourceImagePath is absent", async () => {
    const promise = AnnotDocImageEditorModalElement.openFor(makeInput());
    const modal = document.querySelector(
      "annot-doc-image-editor-modal",
    ) as AnnotDocImageEditorModalElement;
    await modal.updateComplete;
    expect(modal.querySelector(".annot-doc-image-editor-modal-link-badge")).toBeNull();
    AnnotDocImageEditorModalElement.closeActive();
    await promise;
  });

  it("Save with no Unlink interaction omits the unlinked field", async () => {
    const promise = AnnotDocImageEditorModalElement.openFor(
      makeInput({ sourceImagePath: "Screenshots/foo.png" }),
    );
    const modal = document.querySelector(
      "annot-doc-image-editor-modal",
    ) as AnnotDocImageEditorModalElement;
    await modal.updateComplete;
    modal
      .querySelector<HTMLButtonElement>(".annot-doc-image-editor-modal-footer button.primary")
      ?.click();
    const result = (await promise) as ImageEditorModalResult;
    expect(result.kind).toBe("save");
    if (result.kind === "save") {
      expect(result.unlinked).toBeUndefined();
    }
  });

  it("Unlink button + confirm dialog hides the badge AND surfaces unlinked: true on Save", async () => {
    const promise = AnnotDocImageEditorModalElement.openFor(
      makeInput({ sourceImagePath: "Screenshots/foo.png" }),
    );
    const modal = document.querySelector(
      "annot-doc-image-editor-modal",
    ) as AnnotDocImageEditorModalElement;
    await modal.updateComplete;
    // Click Unlink — opens an `<annot-dialog>` confirm.
    modal
      .querySelector<HTMLButtonElement>(".annot-doc-image-editor-modal-link-badge button.unlink")
      ?.click();
    // Walk through the same-tick dialog mount and accept it.
    await Promise.resolve();
    const dialog = document.querySelector("annot-dialog");
    expect(dialog).not.toBeNull();
    dialog?.dispatchEvent(new CustomEvent("dialog-ok"));
    // Flush the Promise chain `dialog-ok → resolve(true) →
    // showConfirmDialog await landing → this.unlinked = true`,
    // then let Lit re-render.
    await Promise.resolve();
    await Promise.resolve();
    await modal.updateComplete;
    // Badge is hidden after confirm.
    expect(modal.querySelector(".annot-doc-image-editor-modal-link-badge")).toBeNull();
    // Save → modal returns unlinked: true.
    modal
      .querySelector<HTMLButtonElement>(".annot-doc-image-editor-modal-footer button.primary")
      ?.click();
    const result = (await promise) as ImageEditorModalResult;
    expect(result.kind).toBe("save");
    if (result.kind === "save") {
      expect(result.unlinked).toBe(true);
    }
  });

  it("Unlink cancel dialog keeps the badge AND leaves unlinked absent on Save", async () => {
    const promise = AnnotDocImageEditorModalElement.openFor(
      makeInput({ sourceImagePath: "Screenshots/foo.png" }),
    );
    const modal = document.querySelector(
      "annot-doc-image-editor-modal",
    ) as AnnotDocImageEditorModalElement;
    await modal.updateComplete;
    modal
      .querySelector<HTMLButtonElement>(".annot-doc-image-editor-modal-link-badge button.unlink")
      ?.click();
    await Promise.resolve();
    const dialog = document.querySelector("annot-dialog");
    dialog?.dispatchEvent(new CustomEvent("dialog-cancel"));
    await modal.updateComplete;
    // Badge survives.
    expect(modal.querySelector(".annot-doc-image-editor-modal-link-badge")).not.toBeNull();
    modal
      .querySelector<HTMLButtonElement>(".annot-doc-image-editor-modal-footer button.primary")
      ?.click();
    const result = (await promise) as ImageEditorModalResult;
    if (result.kind === "save") {
      expect(result.unlinked).toBeUndefined();
    }
  });
});
