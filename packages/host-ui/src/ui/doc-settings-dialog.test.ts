/**
 * @vitest-environment happy-dom
 *
 * `showDocSettingsDialog` tests — Phase 11 of
 * `docs/plans/annot-html-document-ux-polish.md`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { showDocSettingsDialog } from "./doc-settings-dialog.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  // Force-cleanup any orphaned dialog from a failing test.
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

describe("showDocSettingsDialog", () => {
  it("renders the field set with defaults pre-populated", async () => {
    const promise = showDocSettingsDialog({
      defaultTitle: "Onboarding",
      defaultLang: "ja",
      defaultAuthor: "Naoki",
      defaultTheme: "dark",
      defaultMaxWidth: "wide",
    });
    findDialog();
    expect((getInput("Document title") as HTMLInputElement).value).toBe("Onboarding");
    expect((getInput("Document language") as HTMLSelectElement).value).toBe("ja");
    expect((getInput("Author") as HTMLInputElement).value).toBe("Naoki");
    expect((getInput("Theme") as HTMLSelectElement).value).toBe("dark");
    expect((getInput("Article width") as HTMLSelectElement).value).toBe("wide");
    // Cancel to settle the promise.
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    expect(await promise).toBeNull();
  });

  it("returns the user's edits on OK", async () => {
    const promise = showDocSettingsDialog({
      defaultTitle: "Original",
      defaultLang: "en",
    });
    findDialog();
    (getInput("Document title") as HTMLInputElement).value = "  Renamed  ";
    (getInput("Theme") as HTMLSelectElement).value = "light";
    (getInput("Article width") as HTMLSelectElement).value = "narrow";
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.title).toBe("Renamed");
    expect(result.theme).toBe("light");
    expect(result.maxWidth).toBe("narrow");
  });

  it("falls back to 'Untitled' when the title field is cleared", async () => {
    const promise = showDocSettingsDialog({ defaultTitle: "Anything" });
    findDialog();
    (getInput("Document title") as HTMLInputElement).value = "   ";
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    expect(result?.title).toBe("Untitled");
  });

  it("uses the custom-language input when 'Other' is selected", async () => {
    const promise = showDocSettingsDialog({ defaultLang: "pt-BR" });
    // The dialog auto-switches to "Other" because pt-BR isn't in
    // the common list.
    expect((getInput("Document language") as HTMLSelectElement).value).toBe("__custom");
    expect((getInput("Custom language code") as HTMLInputElement).value).toBe("pt-BR");
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    expect(result?.lang).toBe("pt-BR");
  });

  it("returns null on Cancel", async () => {
    const promise = showDocSettingsDialog({ defaultTitle: "X" });
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    expect(await promise).toBeNull();
  });

  it("drops author when the field is left empty", async () => {
    const promise = showDocSettingsDialog({ defaultTitle: "X" });
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    expect(result?.author).toBeUndefined();
  });
});
