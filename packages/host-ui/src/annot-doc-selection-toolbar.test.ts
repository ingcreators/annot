/**
 * @vitest-environment happy-dom
 *
 * `<annot-doc-selection-toolbar>` tests — Phase 3 of
 * `docs/plans/annot-html-document-ux-polish.md`.
 */

import { afterEach, describe, expect, it } from "vitest";
import "./annot-doc-selection-toolbar.js";
import {
  AnnotDocSelectionToolbarElement,
  type BlockKindChangeDetail,
  type FormatChangeDetail,
} from "./annot-doc-selection-toolbar.js";

afterEach(() => {
  AnnotDocSelectionToolbarElement.closeActive();
  document.body.innerHTML = "";
});

describe("annot-doc-selection-toolbar", () => {
  it("openFor mounts a singleton toolbar to document.body", async () => {
    AnnotDocSelectionToolbarElement.openFor({
      rect: { top: 10, left: 10, right: 110, bottom: 30 } as DOMRect,
      format: { bold: false, italic: false, underline: false },
    });
    const a = AnnotDocSelectionToolbarElement.getActive();
    expect(a).not.toBeNull();
    await a!.updateComplete;
    expect(document.body.contains(a as Node)).toBe(true);
    // Re-opening reuses the same instance (singleton semantics).
    AnnotDocSelectionToolbarElement.openFor({
      rect: { top: 50, left: 50, right: 150, bottom: 70 } as DOMRect,
      format: { bold: true, italic: false, underline: false },
    });
    expect(AnnotDocSelectionToolbarElement.getActive()).toBe(a);
  });

  it("renders B / I / U with aria-pressed reflecting `format`", async () => {
    AnnotDocSelectionToolbarElement.openFor({
      rect: { top: 0, left: 0, right: 0, bottom: 0 } as DOMRect,
      format: { bold: true, italic: false, underline: true },
    });
    const a = AnnotDocSelectionToolbarElement.getActive()!;
    await a.updateComplete;
    const bold = a.querySelector('[data-format="bold"]') as HTMLButtonElement;
    const italic = a.querySelector('[data-format="italic"]') as HTMLButtonElement;
    const underline = a.querySelector('[data-format="underline"]') as HTMLButtonElement;
    expect(bold.getAttribute("aria-pressed")).toBe("true");
    expect(italic.getAttribute("aria-pressed")).toBe("false");
    expect(underline.getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking B / I / U dispatches format-change with the right command", async () => {
    AnnotDocSelectionToolbarElement.openFor({
      rect: { top: 0, left: 0, right: 0, bottom: 0 } as DOMRect,
      format: { bold: false, italic: false, underline: false },
    });
    const a = AnnotDocSelectionToolbarElement.getActive()!;
    await a.updateComplete;
    const seen: FormatChangeDetail[] = [];
    a.addEventListener("format-change", (e) => {
      seen.push((e as CustomEvent<FormatChangeDetail>).detail);
    });
    (a.querySelector('[data-format="bold"]') as HTMLButtonElement).click();
    (a.querySelector('[data-format="italic"]') as HTMLButtonElement).click();
    (a.querySelector('[data-format="underline"]') as HTMLButtonElement).click();
    expect(seen.map((d) => d.command)).toEqual(["bold", "italic", "underline"]);
  });

  it("opens the block-kind menu on click and dispatches block-kind-change on pick", async () => {
    AnnotDocSelectionToolbarElement.openFor({
      rect: { top: 0, left: 0, right: 0, bottom: 0 } as DOMRect,
      format: { bold: false, italic: false, underline: false },
      currentBlockKindId: "paragraph",
    });
    const a = AnnotDocSelectionToolbarElement.getActive()!;
    await a.updateComplete;
    expect(a.querySelector(".annot-doc-selection-toolbar-kind-menu")).toBeNull();
    (a.querySelector(".annot-doc-selection-toolbar-kind-button") as HTMLButtonElement).click();
    await a.updateComplete;
    const menu = a.querySelector(".annot-doc-selection-toolbar-kind-menu");
    expect(menu).not.toBeNull();
    // Active block kind highlighted.
    const checked = a.querySelector('[data-kind-id="paragraph"]');
    expect(checked?.getAttribute("aria-checked")).toBe("true");

    const seen: BlockKindChangeDetail[] = [];
    a.addEventListener("block-kind-change", (e) => {
      seen.push((e as CustomEvent<BlockKindChangeDetail>).detail);
    });
    (a.querySelector('[data-kind-id="h2"]') as HTMLButtonElement).click();
    await a.updateComplete;
    expect(seen).toHaveLength(1);
    expect(seen[0]?.option.kind).toBe("heading");
    expect(seen[0]?.option.level).toBe(2);
    // Menu closes after pick.
    expect(a.querySelector(".annot-doc-selection-toolbar-kind-menu")).toBeNull();
  });

  it("closeActive removes the toolbar from the document", () => {
    AnnotDocSelectionToolbarElement.openFor({
      rect: { top: 0, left: 0, right: 0, bottom: 0 } as DOMRect,
      format: { bold: false, italic: false, underline: false },
    });
    expect(AnnotDocSelectionToolbarElement.getActive()).not.toBeNull();
    AnnotDocSelectionToolbarElement.closeActive();
    expect(AnnotDocSelectionToolbarElement.getActive()).toBeNull();
    expect(document.querySelector("annot-doc-selection-toolbar")).toBeNull();
  });
});
