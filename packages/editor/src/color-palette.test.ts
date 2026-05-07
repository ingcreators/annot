/**
 * @vitest-environment happy-dom
 *
 * `createColorPalette` builds the Excel-style color picker (theme
 * colors row, 5 tint rows, standard colors, "More Colors..."
 * native input). The behavioural surface:
 *
 *   - Layout: theme row + 5 tint rows + standard row + custom row.
 *   - Active highlight on the swatch matching `currentColor`
 *     (case-insensitive).
 *   - Click a swatch → fires onChange + moves the active class to it.
 *   - "More Colors..." button proxies a click into the hidden
 *     `<input type="color">`; input event → onChange + active class
 *     cleared from grid swatches (custom color isn't in the grid).
 *   - White swatch gets a visible border (otherwise it's invisible
 *     against the surrounding panel).
 *   - Each swatch has a tooltip set to its hex code.
 */

import { describe, expect, it, vi } from "vitest";
import { createColorPalette } from "./color-palette.js";

describe("createColorPalette layout", () => {
  it("returns a div.color-palette with the expected child structure", () => {
    const panel = createColorPalette({
      currentColor: "#FFFFFF",
      onChange: () => {},
    });
    expect(panel.tagName).toBe("DIV");
    expect(panel.className).toBe("color-palette");
    // Two labels: "Theme Colors" + "Standard Colors"
    const labels = panel.querySelectorAll(".color-palette-label");
    expect(labels.length).toBe(2);
    expect(labels[0]!.textContent).toBe("Theme Colors");
    expect(labels[1]!.textContent).toBe("Standard Colors");
    // Color rows: theme (1) + tints (5) + standard (1) = 7
    expect(panel.querySelectorAll(".color-palette-row").length).toBe(7);
    // Custom row + button + hidden input
    expect(panel.querySelector(".color-palette-custom")).not.toBeNull();
    expect(panel.querySelector(".color-palette-custom-btn")).not.toBeNull();
    expect(panel.querySelector<HTMLInputElement>("input[type=color]")).not.toBeNull();
  });

  it("the theme row has 10 swatches and the standard row has 10 swatches", () => {
    const panel = createColorPalette({
      currentColor: "#FFFFFF",
      onChange: () => {},
    });
    const rows = panel.querySelectorAll(".color-palette-row");
    expect(rows[0]!.querySelectorAll(".color-swatch").length).toBe(10); // theme
    expect(rows[6]!.querySelectorAll(".color-swatch").length).toBe(10); // standard (after 5 tints)
  });

  it("each swatch carries a tooltip with its hex code", () => {
    const panel = createColorPalette({
      currentColor: "#FFFFFF",
      onChange: () => {},
    });
    const first = panel.querySelector<HTMLElement>(".color-swatch")!;
    expect(first.getAttribute("data-tooltip")).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("the white swatch gets an explicit border style (otherwise invisible)", () => {
    const panel = createColorPalette({
      currentColor: "#000000",
      onChange: () => {},
    });
    // White is the FIRST theme color in our table.
    const first = panel.querySelector<HTMLElement>(".color-swatch")!;
    expect(first.getAttribute("data-tooltip")).toBe("#FFFFFF");
    expect(first.style.borderColor).toBe("var(--annot-border-color)");
  });

  it("non-white swatches do NOT receive the border override", () => {
    const panel = createColorPalette({
      currentColor: "#000000",
      onChange: () => {},
    });
    const black = panel.querySelectorAll<HTMLElement>(".color-swatch")[1]!;
    expect(black.getAttribute("data-tooltip")).toBe("#000000");
    expect(black.style.borderColor).toBe("");
  });
});

describe("createColorPalette active state", () => {
  it("marks the swatch matching currentColor as active (exact case)", () => {
    const panel = createColorPalette({
      currentColor: "#000000",
      onChange: () => {},
    });
    const active = panel.querySelectorAll(".color-swatch.active");
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).getAttribute("data-tooltip")).toBe("#000000");
  });

  it("active match is case-insensitive", () => {
    const panel = createColorPalette({
      currentColor: "#ffc000",
      onChange: () => {},
    });
    const active = panel.querySelector<HTMLElement>(".color-swatch.active");
    expect(active).not.toBeNull();
    expect(active!.getAttribute("data-tooltip")).toBe("#FFC000");
  });

  it("no swatch is highlighted when currentColor isn't in the palette", () => {
    const panel = createColorPalette({
      currentColor: "#abcdef",
      onChange: () => {},
    });
    expect(panel.querySelectorAll(".color-swatch.active").length).toBe(0);
  });
});

describe("createColorPalette swatch click", () => {
  it("clicking a swatch fires onChange with its hex value", () => {
    const onChange = vi.fn();
    const panel = createColorPalette({ currentColor: "#FFFFFF", onChange });
    const black = panel.querySelectorAll<HTMLElement>(".color-swatch")[1]!;
    black.click();
    expect(onChange).toHaveBeenCalledWith("#000000");
  });

  it("clicking a swatch moves the active class to it (single highlight)", () => {
    const panel = createColorPalette({
      currentColor: "#FFFFFF",
      onChange: () => {},
    });
    document.body.appendChild(panel);
    const swatches = panel.querySelectorAll<HTMLElement>(".color-swatch");
    expect(swatches[0]!.classList.contains("active")).toBe(true);
    swatches[1]!.click();
    expect(panel.querySelectorAll(".color-swatch.active").length).toBe(1);
    expect(swatches[1]!.classList.contains("active")).toBe(true);
    expect(swatches[0]!.classList.contains("active")).toBe(false);
    panel.remove();
  });
});

describe("createColorPalette custom-color picker", () => {
  it("'More Colors...' button click delegates to the hidden input's click()", () => {
    const panel = createColorPalette({
      currentColor: "#FFFFFF",
      onChange: () => {},
    });
    const customBtn = panel.querySelector<HTMLButtonElement>(".color-palette-custom-btn")!;
    const input = panel.querySelector<HTMLInputElement>("input[type=color]")!;
    const inputClick = vi.spyOn(input, "click");
    customBtn.click();
    expect(inputClick).toHaveBeenCalledTimes(1);
  });

  it("hidden input's `input` event fires onChange + clears the active grid swatch", () => {
    const onChange = vi.fn();
    const panel = createColorPalette({ currentColor: "#FFFFFF", onChange });
    document.body.appendChild(panel);
    expect(panel.querySelectorAll(".color-swatch.active").length).toBe(1);
    const input = panel.querySelector<HTMLInputElement>("input[type=color]")!;
    input.value = "#abcdef";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith("#abcdef");
    expect(panel.querySelectorAll(".color-swatch.active").length).toBe(0);
    panel.remove();
  });

  it("hidden input seeds its initial value from currentColor when it starts with #", () => {
    const panel = createColorPalette({
      currentColor: "#abcdef",
      onChange: () => {},
    });
    const input = panel.querySelector<HTMLInputElement>("input[type=color]")!;
    expect(input.value).toBe("#abcdef");
  });

  it("hidden input falls back to #ff0000 when currentColor doesn't start with #", () => {
    const panel = createColorPalette({
      currentColor: "transparent",
      onChange: () => {},
    });
    const input = panel.querySelector<HTMLInputElement>("input[type=color]")!;
    expect(input.value).toBe("#ff0000");
  });
});
