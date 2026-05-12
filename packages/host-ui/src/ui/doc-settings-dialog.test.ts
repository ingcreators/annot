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

// ---------------------------------------------------------------------------
// Phase 3b of docs/plans/_done/card-procedure-template.md — Card layout
// section (cards-per-row + default step layout for new step
// blocks).
// ---------------------------------------------------------------------------

describe("showDocSettingsDialog: card layout fields", () => {
  it("renders Cards per row + Default step layout selects", async () => {
    const promise = showDocSettingsDialog({
      defaultTitle: "Cards",
      defaultCardColumns: 2,
      defaultCardStepLayout: "image-left",
    });
    findDialog();
    expect((getInput("Cards per row") as HTMLSelectElement).value).toBe("2");
    expect((getInput("Default step layout for new step blocks") as HTMLSelectElement).value).toBe(
      "image-left",
    );
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    expect(await promise).toBeNull();
  });

  it("defaults cards-per-row to 1 (stack) when cardLayout is unset", async () => {
    const promise = showDocSettingsDialog({ defaultTitle: "Default" });
    findDialog();
    expect((getInput("Cards per row") as HTMLSelectElement).value).toBe("1");
    expect((getInput("Default step layout for new step blocks") as HTMLSelectElement).value).toBe(
      "image-top",
    );
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    await promise;
  });

  it("returns cardColumns + cardDefaultStepLayout on OK", async () => {
    const promise = showDocSettingsDialog({ defaultTitle: "X" });
    findDialog();
    (getInput("Cards per row") as HTMLSelectElement).value = "3";
    (getInput("Default step layout for new step blocks") as HTMLSelectElement).value = "image-fill";
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    expect(result?.cardColumns).toBe(3);
    expect(result?.cardDefaultStepLayout).toBe("image-fill");
  });

  it('returns cardColumns === "auto" when the user picks Auto', async () => {
    const promise = showDocSettingsDialog({ defaultTitle: "X" });
    findDialog();
    (getInput("Cards per row") as HTMLSelectElement).value = "auto";
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    expect(result?.cardColumns).toBe("auto");
  });
});

// ---------------------------------------------------------------------------
// Phase 3 of docs/plans/card-step-auto-numbering.md — Step numbering
// section (toggle + label format picker).
// ---------------------------------------------------------------------------

describe("showDocSettingsDialog: step numbering fields", () => {
  it("renders the step-numbering checkbox unchecked by default", async () => {
    const promise = showDocSettingsDialog({ defaultTitle: "X" });
    findDialog();
    const checkbox = getInput("Auto-number step blocks") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    await promise;
  });

  it("pre-checks the checkbox when defaultNumberingSteps is true", async () => {
    const promise = showDocSettingsDialog({
      defaultTitle: "X",
      defaultNumberingSteps: true,
    });
    const checkbox = getInput("Auto-number step blocks") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    await promise;
  });

  it("hides the label-format select when step numbering is off", async () => {
    const promise = showDocSettingsDialog({ defaultTitle: "X" });
    const labelSelect = getInput("Step badge label format") as HTMLSelectElement;
    expect(labelSelect.style.display).toBe("none");
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    await promise;
  });

  it("shows the label-format select when step numbering is on", async () => {
    const promise = showDocSettingsDialog({
      defaultTitle: "X",
      defaultNumberingSteps: true,
    });
    const labelSelect = getInput("Step badge label format") as HTMLSelectElement;
    expect(labelSelect.style.display).not.toBe("none");
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    await promise;
  });

  it("returns numberingSteps:false and no stepLabel when off", async () => {
    const promise = showDocSettingsDialog({ defaultTitle: "X" });
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    expect(result?.numberingSteps).toBe(false);
    expect(result?.numberingStepLabel).toBeUndefined();
  });

  it("returns numberingSteps:true and undefined stepLabel for the default %n template", async () => {
    const promise = showDocSettingsDialog({
      defaultTitle: "X",
      defaultNumberingSteps: true,
    });
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    expect(result?.numberingSteps).toBe(true);
    // %n collapses to undefined for sidecar minimality.
    expect(result?.numberingStepLabel).toBeUndefined();
  });

  it("returns numberingSteps:true and verbatim stepLabel when a preset is chosen", async () => {
    const promise = showDocSettingsDialog({
      defaultTitle: "X",
      defaultNumberingSteps: true,
    });
    (getInput("Step badge label format") as HTMLSelectElement).value = "Step %n";
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    expect(result?.numberingSteps).toBe(true);
    expect(result?.numberingStepLabel).toBe("Step %n");
  });

  it("returns the custom stepLabel input when Custom is selected", async () => {
    const promise = showDocSettingsDialog({
      defaultTitle: "X",
      defaultNumberingSteps: true,
    });
    const labelSelect = getInput("Step badge label format") as HTMLSelectElement;
    labelSelect.value = "__custom";
    labelSelect.dispatchEvent(new Event("change"));
    const custom = getInput("Custom step badge label") as HTMLInputElement;
    custom.value = "  %n / 5  ";
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    expect(result?.numberingStepLabel).toBe("%n / 5");
  });

  it("pre-populates Custom when defaultNumberingStepLabel is not a preset", async () => {
    const promise = showDocSettingsDialog({
      defaultTitle: "X",
      defaultNumberingSteps: true,
      defaultNumberingStepLabel: "Task %n of N",
    });
    const labelSelect = getInput("Step badge label format") as HTMLSelectElement;
    expect(labelSelect.value).toBe("__custom");
    const custom = getInput("Custom step badge label") as HTMLInputElement;
    expect(custom.value).toBe("Task %n of N");
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    await promise;
  });

  it("toggling the checkbox updates the label-format visibility", async () => {
    const promise = showDocSettingsDialog({ defaultTitle: "X" });
    const checkbox = getInput("Auto-number step blocks") as HTMLInputElement;
    const labelSelect = getInput("Step badge label format") as HTMLSelectElement;
    expect(labelSelect.style.display).toBe("none");
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    expect(labelSelect.style.display).not.toBe("none");
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    expect(labelSelect.style.display).toBe("none");
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    await promise;
  });
});
