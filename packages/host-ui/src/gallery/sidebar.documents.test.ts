/**
 * @vitest-environment happy-dom
 *
 * `<annot-sidebar>` "New Document" entry tests — Phase 6c of
 * `docs/plans/annot-html-document.md`. The sidebar's New menu is
 * extensible via host- / plugin-supplied items and via the new
 * built-in `onNewDocument` callback (added in Phase 6c). The
 * test exercises both presence + hidden states without exercising
 * the rest of the sidebar's surface (storage chips, folder tree,
 * tabs) — those have their own coverage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./sidebar.js";
import type { AnnotSidebarElement } from "./sidebar.js";

function mount(): AnnotSidebarElement {
  const el = document.createElement("annot-sidebar") as AnnotSidebarElement;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("annot-sidebar: New Document entry", () => {
  it("does NOT render the New Document button when onNewDocument is omitted", async () => {
    const el = mount();
    el.callbacks = {
      onStorageSelect: () => {},
      onStorageReselect: () => {},
      onFolderSelect: () => {},
      onNewFolder: () => {},
      onUploadImage: () => {},
      onCaptureScreen: () => {},
      onTimedCapture: () => {},
      onPasteClipboard: () => {},
      // onNewDocument intentionally omitted
    };
    el.newMenuOpen = true;
    await el.updateComplete;
    const buttons = Array.from(el.querySelectorAll(".new-menu button"));
    const labels = buttons.map((b) => b.textContent?.trim());
    expect(labels).not.toContain("New Document");
  });

  it("renders the New Document button when onNewDocument is supplied", async () => {
    const el = mount();
    const onNewDocument = vi.fn();
    el.callbacks = {
      onStorageSelect: () => {},
      onStorageReselect: () => {},
      onFolderSelect: () => {},
      onNewFolder: () => {},
      onUploadImage: () => {},
      onCaptureScreen: () => {},
      onTimedCapture: () => {},
      onPasteClipboard: () => {},
      onNewDocument,
    };
    el.newMenuOpen = true;
    await el.updateComplete;
    const newDocBtn = Array.from(el.querySelectorAll(".new-menu button")).find(
      (b) => b.textContent?.trim() === "New Document",
    ) as HTMLButtonElement | undefined;
    expect(newDocBtn).toBeDefined();
    newDocBtn?.click();
    expect(onNewDocument).toHaveBeenCalledTimes(1);
  });
});
