// @vitest-environment happy-dom

/**
 * `showCaptureScreenDialog()` happy-dom tests — opens the dialog,
 * simulates the relevant clicks, and asserts the Promise resolves
 * to the expected result.
 */

import { afterEach, describe, expect, it } from "vitest";
import { showCaptureScreenDialog } from "./capture-screen-dialog.js";

afterEach(() => {
  // Drop any leftover dialog elements between tests so a failing
  // run doesn't leak state into the next.
  document.body.querySelectorAll("annot-capture-screen-dialog").forEach((el) => el.remove());
  localStorage.clear();
});

function findDialog(): HTMLElement {
  const el = document.querySelector("annot-capture-screen-dialog");
  if (!el) throw new Error("dialog not mounted");
  return el as HTMLElement;
}

function clickStart(): void {
  const btn = findDialog().querySelector<HTMLButtonElement>(".capture-dialog-btn-primary");
  if (!btn) throw new Error("Start button not found");
  btn.click();
}

function clickCancel(): void {
  const buttons = findDialog().querySelectorAll<HTMLButtonElement>(".capture-dialog-btn");
  // The first non-primary button is Cancel (the primary one carries
  // the `-primary` modifier and we walk past it explicitly).
  for (const btn of buttons) {
    if (!btn.classList.contains("capture-dialog-btn-primary")) {
      btn.click();
      return;
    }
  }
  throw new Error("Cancel button not found");
}

describe("showCaptureScreenDialog", () => {
  it("resolves with mode 'once' and the chosen cursor on confirm", async () => {
    const promise = showCaptureScreenDialog({ mode: "once", cursor: "motion" });
    // Wait one microtask for the element to mount + render.
    await Promise.resolve();
    clickStart();
    expect(await promise).toEqual({
      mode: "once",
      cursor: "motion",
      saveSizePreset: "standard",
    });
  });

  it("resolves to null when the user clicks Cancel", async () => {
    const promise = showCaptureScreenDialog({ mode: "once" });
    await Promise.resolve();
    clickCancel();
    expect(await promise).toBeNull();
  });

  it("removes the dialog element from the DOM after confirm", async () => {
    const promise = showCaptureScreenDialog({ mode: "once" });
    await Promise.resolve();
    clickStart();
    await promise;
    expect(document.querySelector("annot-capture-screen-dialog")).toBeNull();
  });

  it("removes the dialog element from the DOM after cancel", async () => {
    const promise = showCaptureScreenDialog({ mode: "once" });
    await Promise.resolve();
    clickCancel();
    await promise;
    expect(document.querySelector("annot-capture-screen-dialog")).toBeNull();
  });

  it("Start button is always enabled (every chip is a valid choice)", async () => {
    const promise = showCaptureScreenDialog({ mode: "auto" });
    await Promise.resolve();
    const btn = findDialog().querySelector<HTMLButtonElement>(".capture-dialog-btn-primary");
    expect(btn?.disabled).toBe(false);
    clickCancel();
    await promise;
  });

  it("falls back to localStorage defaults when no initial provided", async () => {
    localStorage.setItem("annot-capture-mode", "once");
    localStorage.setItem("annot-capture-cursor", "never");
    const promise = showCaptureScreenDialog();
    await Promise.resolve();
    clickStart();
    expect(await promise).toEqual({
      mode: "once",
      cursor: "never",
      saveSizePreset: "standard",
    });
  });

  it("persists the chosen saveSizePreset back to localStorage on confirm", async () => {
    const promise = showCaptureScreenDialog({ mode: "once", cursor: "always" });
    await Promise.resolve();
    // Switch the size preset via the select.
    const select = findDialog().querySelectorAll<HTMLSelectElement>(".capture-dialog-select")[0];
    if (!select) throw new Error("save-size select not found");
    select.value = "light";
    select.dispatchEvent(new Event("change"));
    clickStart();
    const result = await promise;
    expect(result?.saveSizePreset).toBe("light");
    // Verify it landed in the shared encode-options blob so future
    // captures use it too.
    const stored = JSON.parse(localStorage.getItem("annot-encode-options") || "{}");
    expect(stored.saveSizePreset).toBe("light");
  });

  it("Advanced section is collapsed by default (spec §6.6)", async () => {
    const promise = showCaptureScreenDialog({ mode: "auto" });
    await Promise.resolve();
    const details = findDialog().querySelector<HTMLDetailsElement>(".capture-dialog-advanced");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    clickCancel();
    await promise;
  });

  it("renders Auto Capture advanced controls only when mode === 'auto'", async () => {
    // Auto mode: Auto Capture group present.
    const promiseAuto = showCaptureScreenDialog({ mode: "auto" });
    await Promise.resolve();
    const dlg = findDialog();
    const details = dlg.querySelector<HTMLDetailsElement>(".capture-dialog-advanced");
    if (!details) throw new Error("advanced details element missing");
    details.open = true;
    // Force a re-render so the conditional groups land.
    await Promise.resolve();
    const groupTitlesAuto = Array.from(
      dlg.querySelectorAll(".capture-dialog-advanced .capture-dialog-section-title"),
    ).map((el) => el.textContent?.trim());
    expect(groupTitlesAuto).toContain("Auto Capture");
    clickCancel();
    await promiseAuto;

    // Once mode: Auto Capture group absent.
    const promiseOnce = showCaptureScreenDialog({ mode: "once" });
    await Promise.resolve();
    const dlg2 = findDialog();
    const details2 = dlg2.querySelector<HTMLDetailsElement>(".capture-dialog-advanced");
    if (!details2) throw new Error("advanced details element missing");
    details2.open = true;
    await Promise.resolve();
    const groupTitlesOnce = Array.from(
      dlg2.querySelectorAll(".capture-dialog-advanced .capture-dialog-section-title"),
    ).map((el) => el.textContent?.trim());
    expect(groupTitlesOnce).not.toContain("Auto Capture");
    expect(groupTitlesOnce).toContain("Image encoding");
    clickCancel();
    await promiseOnce;
  });

  it("persists Auto Capture advanced settings to the shared blob on confirm", async () => {
    const promise = showCaptureScreenDialog({ mode: "auto" });
    await Promise.resolve();
    // Programmatically flip the dialog's auto-capture properties
    // (simulates the user changing the selects inside the
    // Advanced section).
    const dlg = findDialog() as unknown as {
      autoInterval: string;
      autoSensitivity: string;
      autoStableWait: string;
      autoIgnoreCursorOnlyChanges: boolean;
    };
    dlg.autoInterval = "fast";
    dlg.autoSensitivity = "major";
    dlg.autoStableWait = "long";
    dlg.autoIgnoreCursorOnlyChanges = false;
    clickStart();
    await promise;
    const stored = JSON.parse(localStorage.getItem("annot-auto-capture-options") || "{}");
    expect(stored).toEqual({
      interval: "fast",
      sensitivity: "major",
      stableWait: "long",
      ignoreCursorOnlyChanges: false,
    });
  });

  it("persists encode advanced settings to the shared blob on confirm", async () => {
    const promise = showCaptureScreenDialog({ mode: "once" });
    await Promise.resolve();
    const dlg = findDialog() as unknown as {
      format: string;
      smartFallback: string;
      jpegPercent: number;
    };
    dlg.format = "jpeg";
    dlg.smartFallback = "jpeg";
    dlg.jpegPercent = 75;
    clickStart();
    await promise;
    const stored = JSON.parse(localStorage.getItem("annot-encode-options") || "{}");
    expect(stored.format).toBe("jpeg");
    expect(stored.smartFallback).toBe("jpeg");
    expect(stored.jpegPercent).toBe(75);
  });
});
