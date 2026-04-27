/**
 * @vitest-environment happy-dom
 *
 * `<annot-save-menu>` tests covering the orchestration the
 * element absorbed from the pre-Phase-6b
 * `openToolbarSaveMenu` helper: items + actions assembly
 * branches on `isTauri`, anchor-relative positioning, the
 * toggle-close behaviour, and the action dispatch on
 * menu-item click.
 *
 * The export helpers (`saveToFile` / `downloadAsImage` / …) are
 * mocked so the tests don't need a real `CanvasManager`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const exportMocks = vi.hoisted(() => ({
  saveToFile: vi.fn(),
  downloadAsImage: vi.fn(),
  saveAsEditableImage: vi.fn(),
  exportPptx: vi.fn(),
}));

vi.mock("@ingcreators/annot-editor", () => ({
  saveToFile: exportMocks.saveToFile,
  downloadAsImage: exportMocks.downloadAsImage,
  saveAsEditableImage: exportMocks.saveAsEditableImage,
  exportPptx: exportMocks.exportPptx,
}));

const tauriBridge = vi.hoisted(() => ({ isTauri: false }));
vi.mock("@ingcreators/annot-core/tauri-bridge", () => tauriBridge);

const { saveToFile, downloadAsImage, saveAsEditableImage, exportPptx } = exportMocks;

import "./annot-save-menu.js";
import {
  AnnotSaveMenuElement,
  type SaveMenuContext,
} from "./annot-save-menu.js";

function makeAnchor(): HTMLElement {
  const a = document.createElement("button");
  a.style.position = "absolute";
  a.style.top = "100px";
  a.style.left = "200px";
  a.style.width = "60px";
  a.style.height = "30px";
  document.body.appendChild(a);
  return a;
}

function fakeCtx(): SaveMenuContext {
  return {
    canvas: {} as SaveMenuContext["canvas"],
    getCurrentFilename: () => "doc.png",
  };
}

describe("AnnotSaveMenuElement.openFor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    saveToFile.mockClear();
    downloadAsImage.mockClear();
    saveAsEditableImage.mockClear();
    exportPptx.mockClear();
    tauriBridge.isTauri = false;
  });

  it("creates a menu with browser-side items (download paths)", async () => {
    const anchor = makeAnchor();
    AnnotSaveMenuElement.openFor(anchor, fakeCtx());
    const menu = document.querySelector("annot-save-menu") as AnnotSaveMenuElement;
    await menu.updateComplete;
    const labels = Array.from(
      menu.querySelectorAll<HTMLButtonElement>(".copy-dropdown-item"),
    ).map((b) => b.textContent?.trim());
    expect(labels).toEqual([
      "Download SVG",
      "Download JPG (re-editable)",
      "Download PNG (re-editable)",
      "Download PPTX (PowerPoint)",
    ]);
  });

  it("clicking SVG runs saveToFile and closes the menu", async () => {
    const anchor = makeAnchor();
    AnnotSaveMenuElement.openFor(anchor, fakeCtx());
    const menu = document.querySelector("annot-save-menu") as AnnotSaveMenuElement;
    await menu.updateComplete;
    const svgBtn = menu.querySelector<HTMLButtonElement>(".copy-dropdown-item")!;
    svgBtn.click();
    expect(saveToFile).toHaveBeenCalledTimes(1);
    expect(document.querySelector("annot-save-menu")).toBeNull();
  });

  it("clicking PPTX runs exportPptx", async () => {
    const anchor = makeAnchor();
    AnnotSaveMenuElement.openFor(anchor, fakeCtx());
    const menu = document.querySelector("annot-save-menu") as AnnotSaveMenuElement;
    await menu.updateComplete;
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>(".copy-dropdown-item"));
    items[3]!.click();
    expect(exportPptx).toHaveBeenCalledTimes(1);
  });

  it("Tauri host swaps download paths for saveAsEditableImage", async () => {
    tauriBridge.isTauri = true;
    const anchor = makeAnchor();
    AnnotSaveMenuElement.openFor(anchor, fakeCtx());
    const menu = document.querySelector("annot-save-menu") as AnnotSaveMenuElement;
    await menu.updateComplete;
    const labels = Array.from(
      menu.querySelectorAll<HTMLButtonElement>(".copy-dropdown-item"),
    ).map((b) => b.textContent?.trim());
    expect(labels).toContain("Save as JPG (re-editable)");
    expect(labels).toContain("Save as PNG (re-editable)");
    // JPG path now goes through saveAsEditableImage
    const jpgBtn = Array.from(menu.querySelectorAll<HTMLButtonElement>(".copy-dropdown-item")).find(
      (b) => b.textContent?.includes("JPG"),
    )!;
    jpgBtn.click();
    expect(saveAsEditableImage).toHaveBeenCalledWith(expect.anything(), "jpg", "doc.png");
  });

  it("a second openFor with an open menu toggles it closed", async () => {
    const anchor = makeAnchor();
    AnnotSaveMenuElement.openFor(anchor, fakeCtx());
    expect(document.querySelectorAll("annot-save-menu").length).toBe(1);
    AnnotSaveMenuElement.openFor(anchor, fakeCtx());
    expect(document.querySelectorAll("annot-save-menu").length).toBe(0);
  });

  it("positions the menu below the anchor with viewport clamping", async () => {
    const anchor = makeAnchor();
    AnnotSaveMenuElement.openFor(anchor, fakeCtx());
    const menu = document.querySelector("annot-save-menu") as AnnotSaveMenuElement;
    await menu.updateComplete;
    expect(menu.style.position).toBe("fixed");
    expect(parseFloat(menu.style.top)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
  });

  it("close() removes the singleton", async () => {
    const anchor = makeAnchor();
    AnnotSaveMenuElement.openFor(anchor, fakeCtx());
    const menu = document.querySelector("annot-save-menu") as AnnotSaveMenuElement;
    await menu.updateComplete;
    menu.close();
    expect(document.querySelector("annot-save-menu")).toBeNull();
  });
});
