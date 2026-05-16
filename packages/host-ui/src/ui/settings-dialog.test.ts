/**
 * @vitest-environment happy-dom
 *
 * `showSettingsDialog` — app-level Settings dialog. Today's only
 * row is Theme (System / Light / Dark); the test pins that the
 * dialog initial-populates from the persisted mode, persists +
 * applies on OK, and leaves storage untouched on Cancel.
 */

import { THEME_STORAGE_KEY } from "@ingcreators/annot-editor";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { showSettingsDialog } from "./settings-dialog.js";

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.classList.remove("light");
  globalThis.localStorage?.clear();
});

afterEach(() => {
  document.querySelectorAll("annot-dialog").forEach((d) => d.remove());
  document.documentElement.classList.remove("light");
  globalThis.localStorage?.clear();
});

function findDialog(): HTMLElement {
  const dlg = document.querySelector("annot-dialog");
  if (!dlg) throw new Error("dialog not mounted");
  return dlg as HTMLElement;
}

function getThemeSelect(): HTMLSelectElement {
  const el = document.querySelector<HTMLSelectElement>("[data-annot-settings-theme]");
  if (!el) throw new Error("theme select not found");
  return el;
}

describe("showSettingsDialog", () => {
  it("defaults the theme select to 'system' on a fresh install", async () => {
    const promise = showSettingsDialog();
    findDialog();
    expect(getThemeSelect().value).toBe("system");
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    expect(await promise).toBeNull();
  });

  it("pre-populates the theme select from the persisted mode", async () => {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const promise = showSettingsDialog();
    findDialog();
    expect(getThemeSelect().value).toBe("light");
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    await promise;
  });

  it("accepts a defaultTheme override (used by Storybook)", async () => {
    const promise = showSettingsDialog({ defaultTheme: "dark" });
    findDialog();
    expect(getThemeSelect().value).toBe("dark");
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    await promise;
  });

  it("persists + applies the chosen theme on OK", async () => {
    const promise = showSettingsDialog();
    findDialog();
    getThemeSelect().value = "light";
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    const result = await promise;
    expect(result).toEqual({ theme: "light" });
    expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("leaves persisted state untouched on Cancel", async () => {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const promise = showSettingsDialog();
    findDialog();
    getThemeSelect().value = "light";
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    const result = await promise;
    expect(result).toBeNull();
    expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("exposes all three theme options", async () => {
    const promise = showSettingsDialog();
    findDialog();
    const opts = Array.from(getThemeSelect().options).map((o) => o.value);
    expect(opts).toEqual(["system", "light", "dark"]);
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    await promise;
  });

  it("removes the dialog element from the DOM on OK", async () => {
    const promise = showSettingsDialog();
    findDialog();
    findDialog().dispatchEvent(new CustomEvent("dialog-ok"));
    await promise;
    expect(document.querySelector("annot-dialog")).toBeNull();
  });

  it("removes the dialog element from the DOM on Cancel", async () => {
    const promise = showSettingsDialog();
    findDialog();
    findDialog().dispatchEvent(new CustomEvent("dialog-cancel"));
    await promise;
    expect(document.querySelector("annot-dialog")).toBeNull();
  });
});
