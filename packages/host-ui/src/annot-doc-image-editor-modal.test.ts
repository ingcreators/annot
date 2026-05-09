/**
 * @vitest-environment happy-dom
 *
 * `<annot-doc-image-editor-modal>` tests — Phase 5a of
 * `docs/plans/annot-html-document.md`.
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
    // The shell's SVG mounts inside the canvas region.
    expect(
      modal.querySelector(".annot-doc-image-editor-modal-canvas svg[data-annot-shell-root]"),
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
