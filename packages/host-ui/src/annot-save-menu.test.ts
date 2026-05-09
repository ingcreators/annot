/**
 * @vitest-environment happy-dom
 *
 * `<annot-save-menu>` tests covering the orchestration the
 * element absorbed from the pre-Phase-6b
 * `openToolbarSaveMenu` helper: items + actions assembly,
 * anchor-relative positioning, the toggle-close behaviour, and
 * the action dispatch on menu-item click.
 *
 * Phase 9 of `desktop-electron-migration.md` collapsed the prior
 * Tauri-specific branch (system save dialog +
 * `saveAsEditableImage`) — every host now downloads via
 * `downloadAsImage` (which produces XMP'd output through
 * `createEditableImage`).
 *
 * The export helpers (`saveToFile` / `downloadAsImage` / …) are
 * mocked so the tests don't need a real `CanvasManager`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const exportMocks = vi.hoisted(() => ({
  saveToFile: vi.fn(),
  downloadAsImage: vi.fn(),
  exportPptx: vi.fn(),
}));

vi.mock("@ingcreators/annot-editor", () => ({
  saveToFile: exportMocks.saveToFile,
  downloadAsImage: exportMocks.downloadAsImage,
  exportPptx: exportMocks.exportPptx,
}));

const { saveToFile, downloadAsImage, exportPptx } = exportMocks;

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
    exportPptx.mockClear();
  });

  it("creates a menu with the four browser-style download items", async () => {
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

  it("clicking JPG/PNG runs downloadAsImage with the requested format", async () => {
    const anchor = makeAnchor();
    AnnotSaveMenuElement.openFor(anchor, fakeCtx());
    const menu = document.querySelector("annot-save-menu") as AnnotSaveMenuElement;
    await menu.updateComplete;
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>(".copy-dropdown-item"));
    items[1]!.click();
    expect(downloadAsImage).toHaveBeenLastCalledWith(expect.anything(), "jpg", "doc.png");
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
    expect(Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
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
