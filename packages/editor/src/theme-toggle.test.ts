/**
 * @vitest-environment happy-dom
 *
 * `createThemeToggle` is the single source of truth for the
 * light/dark mode toggle button (previously duplicated between
 * the toolbar and the gallery header). The behavioural contract
 * is small but real:
 *
 *   - Initial render reflects the *current* documentElement state,
 *     not a hard-coded "dark" assumption (the previously-broken
 *     toolbar copy always rendered the dark icon).
 *   - Click toggles the `light` class on `documentElement` and
 *     updates the icon + `aria-pressed` accordingly.
 *   - Tooltip + accessible label are wired through `setTooltip`.
 *   - Caller can override the className for surface integration.
 */

import { afterEach, describe, expect, it } from "vitest";
import { createThemeToggle } from "./theme-toggle.js";

afterEach(() => {
  // Each test toggles the documentElement class — leave the env clean
  // for any later test in the suite.
  document.documentElement.classList.remove("light");
  // localStorage persistence side-effect from `persistThemeChoice` —
  // clear so other tests don't see stale state.
  try {
    localStorage.clear();
  } catch {
    // happy-dom may not support localStorage in some envs; non-fatal.
  }
});

describe("createThemeToggle initial render", () => {
  it("returns a button with the supplied className", () => {
    const btn = createThemeToggle("custom-class");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.type).toBe("button");
    expect(btn.className).toBe("custom-class");
  });

  it("defaults the className to 'toolbar-btn'", () => {
    const btn = createThemeToggle();
    expect(btn.className).toBe("toolbar-btn");
  });

  it("wires the tooltip via setTooltip (data-tooltip + aria-label)", () => {
    const btn = createThemeToggle();
    expect(btn.getAttribute("data-tooltip")).toBe("Toggle light / dark theme");
    expect(btn.getAttribute("aria-label")).toBe("Toggle light / dark theme");
  });

  it("renders the dark_mode icon + aria-pressed=false in dark mode", () => {
    document.documentElement.classList.remove("light");
    const btn = createThemeToggle();
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(btn.innerHTML).toContain("svg"); // sanity: an SVG was rendered
  });

  it("renders aria-pressed=true when documentElement already has the 'light' class", () => {
    document.documentElement.classList.add("light");
    const btn = createThemeToggle();
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("createThemeToggle click behaviour", () => {
  it("toggles the 'light' class on documentElement", () => {
    document.documentElement.classList.remove("light");
    const btn = createThemeToggle();
    btn.click();
    expect(document.documentElement.classList.contains("light")).toBe(true);
    btn.click();
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("updates aria-pressed on each toggle to match the new state", () => {
    document.documentElement.classList.remove("light");
    const btn = createThemeToggle();
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    btn.click();
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    btn.click();
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("re-renders the icon on each toggle (different glyph for each state)", () => {
    document.documentElement.classList.remove("light");
    const btn = createThemeToggle();
    const dark = btn.innerHTML;
    btn.click();
    const light = btn.innerHTML;
    expect(light).not.toBe(dark);
    btn.click();
    expect(btn.innerHTML).toBe(dark);
  });
});
