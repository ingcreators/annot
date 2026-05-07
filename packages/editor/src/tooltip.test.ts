/**
 * @vitest-environment happy-dom
 *
 * `setTooltip` / `getTooltip` are the project-wide replacement for
 * `el.title = "..."`. They write `data-tooltip` (CSS tooltip) +
 * `aria-label` (a11y), but NEVER `title` — the module header
 * documents why. The tests pin that triple invariant.
 */

import { describe, expect, it } from "vitest";
import { getTooltip, setTooltip } from "./tooltip.js";

describe("setTooltip", () => {
  it("writes data-tooltip + aria-label, NOT title", () => {
    const el = document.createElement("button");
    setTooltip(el, "Hello");
    expect(el.getAttribute("data-tooltip")).toBe("Hello");
    expect(el.getAttribute("aria-label")).toBe("Hello");
    expect(el.hasAttribute("title")).toBe(false);
  });

  it("clears both attributes when text is empty", () => {
    const el = document.createElement("button");
    setTooltip(el, "Hello");
    setTooltip(el, "");
    expect(el.hasAttribute("data-tooltip")).toBe(false);
    expect(el.hasAttribute("aria-label")).toBe(false);
  });

  it("overwrites a previous tooltip rather than appending", () => {
    const el = document.createElement("button");
    setTooltip(el, "First");
    setTooltip(el, "Second");
    expect(el.getAttribute("data-tooltip")).toBe("Second");
    expect(el.getAttribute("aria-label")).toBe("Second");
  });

  it("works on any element type (not just buttons)", () => {
    const div = document.createElement("div");
    setTooltip(div, "Tooltip on a div");
    expect(div.getAttribute("data-tooltip")).toBe("Tooltip on a div");
  });
});

describe("getTooltip", () => {
  it("returns the data-tooltip value when set", () => {
    const el = document.createElement("button");
    setTooltip(el, "Hi");
    expect(getTooltip(el)).toBe("Hi");
  });

  it("falls back to aria-label when data-tooltip is absent", () => {
    const el = document.createElement("button");
    el.setAttribute("aria-label", "Aria only");
    expect(getTooltip(el)).toBe("Aria only");
  });

  it("returns empty string when neither attribute is set", () => {
    const el = document.createElement("button");
    expect(getTooltip(el)).toBe("");
  });

  it("prefers data-tooltip over aria-label when both are set with different values", () => {
    const el = document.createElement("button");
    el.setAttribute("data-tooltip", "Tooltip text");
    el.setAttribute("aria-label", "Aria text");
    expect(getTooltip(el)).toBe("Tooltip text");
  });
});
