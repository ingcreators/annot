// @vitest-environment happy-dom
//
// Tests for `showLinkDialog` + `sanitiseLinkUrl`. Follows the
// same imperative-dialog pattern as `showDocSettingsDialog` —
// open the dialog, query DOM, dispatch dialog-* events, await
// resolution.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sanitiseLinkUrl, showLinkDialog } from "./link-dialog.js";

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

function getInput(label: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
  if (!el) throw new Error(`no input with aria-label="${label}"`);
  return el;
}

describe("sanitiseLinkUrl", () => {
  it("returns null for empty / whitespace input", () => {
    expect(sanitiseLinkUrl("")).toBeNull();
    expect(sanitiseLinkUrl("   ")).toBeNull();
  });

  it("returns the URL verbatim when it carries an allowed scheme", () => {
    expect(sanitiseLinkUrl("https://example.com")).toBe("https://example.com/");
    expect(sanitiseLinkUrl("http://example.com/path?x=1")).toBe("http://example.com/path?x=1");
    expect(sanitiseLinkUrl("mailto:user@example.com")).toBe("mailto:user@example.com");
  });

  it("prepends https:// to scheme-less hosts (Google Docs style)", () => {
    expect(sanitiseLinkUrl("example.com")).toBe("https://example.com/");
    expect(sanitiseLinkUrl("docs.example.com/path")).toBe("https://docs.example.com/path");
  });

  it("recognises bare email addresses as mailto: links", () => {
    expect(sanitiseLinkUrl("user@example.com")).toBe("mailto:user@example.com");
  });

  it("trims whitespace", () => {
    expect(sanitiseLinkUrl("  https://example.com  ")).toBe("https://example.com/");
  });

  it("rejects unsupported schemes (javascript:, file:, etc.)", () => {
    expect(sanitiseLinkUrl("javascript:alert(1)")).toBeNull();
    expect(sanitiseLinkUrl("file:///etc/passwd")).toBeNull();
    expect(sanitiseLinkUrl("data:text/html,<h1>x</h1>")).toBeNull();
  });

  it("rejects unparseable input", () => {
    expect(sanitiseLinkUrl("not a url at all")).toBeNull();
  });
});

describe("showLinkDialog", () => {
  it("renders the field set with empty defaults", () => {
    showLinkDialog();
    findDialog();
    expect((getInput("Link display text") as HTMLInputElement).value).toBe("");
    expect((getInput("Link URL") as HTMLInputElement).value).toBe("");
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
  });

  it("pre-populates the inputs from caller-supplied defaults", () => {
    showLinkDialog({
      defaultUrl: "https://example.com",
      defaultLabel: "Example",
    });
    expect((getInput("Link URL") as HTMLInputElement).value).toBe("https://example.com");
    expect((getInput("Link display text") as HTMLInputElement).value).toBe("Example");
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
  });

  it("returns cancel action when the dialog is dismissed", async () => {
    const promise = showLinkDialog();
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    const result = await promise;
    expect(result).toEqual({ action: "cancel" });
  });

  it("returns the sanitised URL + label on OK", async () => {
    const promise = showLinkDialog();
    (getInput("Link URL") as HTMLInputElement).value = "example.com";
    (getInput("Link display text") as HTMLInputElement).value = "Example";
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    expect(result.action).toBe("save");
    if (result.action !== "save") return;
    expect(result.input.url).toBe("https://example.com/");
    expect(result.input.label).toBe("Example");
  });

  it("falls back to URL as label when label is empty", async () => {
    const promise = showLinkDialog();
    (getInput("Link URL") as HTMLInputElement).value = "https://example.com";
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    if (result.action !== "save") throw new Error("expected save");
    expect(result.input.label).toBe("https://example.com/");
  });

  it("renders a Remove button when allowRemove is true", () => {
    showLinkDialog({
      defaultUrl: "https://example.com",
      defaultLabel: "Example",
      allowRemove: true,
    });
    const removeBtn = document.querySelector(".annot-link-dialog-remove");
    expect(removeBtn).not.toBeNull();
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
  });

  it("returns remove action when the user clicks Remove", async () => {
    const promise = showLinkDialog({
      defaultUrl: "https://example.com",
      defaultLabel: "Example",
      allowRemove: true,
    });
    (document.querySelector(".annot-link-dialog-remove") as HTMLButtonElement).click();
    const result = await promise;
    expect(result).toEqual({ action: "remove" });
  });

  it("omits the Remove button by default", () => {
    showLinkDialog();
    expect(document.querySelector(".annot-link-dialog-remove")).toBeNull();
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
  });
});
