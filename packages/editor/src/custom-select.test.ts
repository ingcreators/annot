/**
 * @vitest-environment happy-dom
 *
 * `createCustomSelect` is a PowerPoint-style dropdown the
 * PropertyPanel + toolbar use for icon-bearing option lists.
 * Behavioural surface:
 *
 *   - Renders the current option's preview HTML / label inside the
 *     button.
 *   - Click opens an anchored popover whose options carry tooltips
 *     + click handlers.
 *   - Selecting an option fires `onChange(value)` and updates the
 *     button's preview without rebuilding.
 *   - Programmatic `setValue(value)` updates the preview but does
 *     NOT fire onChange (rubber-band refresh path).
 *   - `onOpen` callback fires when the popover opens (caller can
 *     refresh disabled states).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { type CustomSelectOption, createCustomSelect } from "./custom-select.js";

const OPTIONS: CustomSelectOption[] = [
  { value: "solid", label: "Solid", preview: "<i>solid</i>" },
  { value: "dash", label: "Dash", preview: "<i>dashed</i>" },
  { value: "dot", label: "Dot" }, // no preview — falls back to label
];

afterEach(() => {
  for (const child of Array.from(document.body.children)) {
    child.remove();
  }
});

describe("createCustomSelect button", () => {
  it("returns a button with the pp-select class + a caret", () => {
    const btn = createCustomSelect({
      options: OPTIONS,
      current: "solid",
      onChange: () => {},
    });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.className).toBe("pp-select");
    expect(btn.querySelector(".pp-select-caret")).not.toBeNull();
    expect(btn.querySelector(".pp-select-preview")).not.toBeNull();
  });

  it("renders the current option's preview HTML in the button", () => {
    const btn = createCustomSelect({
      options: OPTIONS,
      current: "dash",
      onChange: () => {},
    });
    const preview = btn.querySelector(".pp-select-preview")!;
    expect(preview.innerHTML).toContain("<i>dashed</i>");
  });

  it("falls back to the label as text when the option has no preview", () => {
    const btn = createCustomSelect({
      options: OPTIONS,
      current: "dot",
      onChange: () => {},
    });
    const preview = btn.querySelector(".pp-select-preview")!;
    expect(preview.textContent).toBe("Dot");
  });

  it("falls back to the first option when the current value isn't in the list", () => {
    const btn = createCustomSelect({
      options: OPTIONS,
      current: "unknown-value",
      onChange: () => {},
    });
    // First option is "Solid" with preview "<i>solid</i>"
    expect(btn.querySelector(".pp-select-preview")!.innerHTML).toContain("solid");
  });

  it("wires the ariaLabel to both aria-label + setTooltip (data-tooltip)", () => {
    const btn = createCustomSelect({
      options: OPTIONS,
      current: "solid",
      onChange: () => {},
      ariaLabel: "Stroke style",
    });
    expect(btn.getAttribute("aria-label")).toBe("Stroke style");
    expect(btn.getAttribute("data-tooltip")).toBe("Stroke style");
  });

  it("renders empty preview when options array is empty (defensive — no crash)", () => {
    const btn = createCustomSelect({
      options: [],
      current: "anything",
      onChange: () => {},
    });
    expect(btn.querySelector(".pp-select-preview")!.textContent).toBe("");
  });
});

describe("createCustomSelect popup", () => {
  it("opens a popover on click with one item per option", () => {
    document.body.appendChild(
      createCustomSelect({
        options: OPTIONS,
        current: "solid",
        onChange: () => {},
      }),
    );
    const btn = document.body.querySelector("button.pp-select") as HTMLButtonElement;
    btn.click();
    const popup = document.body.querySelector(".pp-select-popup");
    expect(popup).not.toBeNull();
    expect(popup!.querySelectorAll(".pp-select-item").length).toBe(OPTIONS.length);
  });

  it("marks the current value's item with the active class", () => {
    document.body.appendChild(
      createCustomSelect({
        options: OPTIONS,
        current: "dash",
        onChange: () => {},
      }),
    );
    const btn = document.body.querySelector("button.pp-select") as HTMLButtonElement;
    btn.click();
    const items = document.body.querySelectorAll(".pp-select-item");
    expect(items[0]!.className).not.toContain("active");
    expect(items[1]!.className).toContain("active");
    expect(items[2]!.className).not.toContain("active");
  });

  it("applies popupWidth as min-width style on the popup root", () => {
    document.body.appendChild(
      createCustomSelect({
        options: OPTIONS,
        current: "solid",
        onChange: () => {},
        popupWidth: 240,
      }),
    );
    const btn = document.body.querySelector("button.pp-select") as HTMLButtonElement;
    btn.click();
    const popup = document.body.querySelector<HTMLElement>(".pp-select-popup")!;
    expect(popup.style.minWidth).toBe("240px");
  });

  it("applies columns as grid-template-columns on the grid", () => {
    document.body.appendChild(
      createCustomSelect({
        options: OPTIONS,
        current: "solid",
        onChange: () => {},
        columns: 3,
      }),
    );
    const btn = document.body.querySelector("button.pp-select") as HTMLButtonElement;
    btn.click();
    const grid = document.body.querySelector<HTMLElement>(".pp-select-grid")!;
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, 1fr)");
  });

  it("invokes onOpen each time the popup opens", () => {
    const onOpen = vi.fn();
    document.body.appendChild(
      createCustomSelect({
        options: OPTIONS,
        current: "solid",
        onChange: () => {},
        onOpen,
      }),
    );
    const btn = document.body.querySelector("button.pp-select") as HTMLButtonElement;
    btn.click(); // opens
    btn.click(); // toggles closed (no onOpen)
    btn.click(); // opens again
    expect(onOpen).toHaveBeenCalledTimes(3); // each click before openAnchoredPopover decides to toggle-close
  });
});

describe("createCustomSelect selection", () => {
  it("clicking an option fires onChange with that option's value", () => {
    const onChange = vi.fn();
    document.body.appendChild(createCustomSelect({ options: OPTIONS, current: "solid", onChange }));
    const btn = document.body.querySelector("button.pp-select") as HTMLButtonElement;
    btn.click();
    const items = document.body.querySelectorAll<HTMLButtonElement>(".pp-select-item");
    items[1]!.click(); // "dash"
    expect(onChange).toHaveBeenCalledWith("dash");
  });

  it("after selection, the button's preview reflects the new value", () => {
    document.body.appendChild(
      createCustomSelect({
        options: OPTIONS,
        current: "solid",
        onChange: () => {},
      }),
    );
    const btn = document.body.querySelector("button.pp-select") as HTMLButtonElement;
    btn.click();
    const items = document.body.querySelectorAll<HTMLButtonElement>(".pp-select-item");
    items[1]!.click(); // "dash"
    const preview = btn.querySelector(".pp-select-preview")!;
    expect(preview.innerHTML).toContain("dashed");
  });

  it("after selection, the popup is removed (the helper drops it on click)", () => {
    document.body.appendChild(
      createCustomSelect({
        options: OPTIONS,
        current: "solid",
        onChange: () => {},
      }),
    );
    const btn = document.body.querySelector("button.pp-select") as HTMLButtonElement;
    btn.click();
    const items = document.body.querySelectorAll<HTMLButtonElement>(".pp-select-item");
    items[0]!.click();
    expect(document.body.querySelector(".pp-select-popup")).toBeNull();
  });
});

describe("createCustomSelect.setValue (rubber-band refresh)", () => {
  it("updates the button preview without firing onChange", () => {
    const onChange = vi.fn();
    const btn = createCustomSelect({
      options: OPTIONS,
      current: "solid",
      onChange,
    }) as HTMLElement & { setValue?: (v: string) => void };
    btn.setValue!("dash");
    expect(onChange).not.toHaveBeenCalled();
    expect(btn.querySelector(".pp-select-preview")!.innerHTML).toContain("dashed");
  });
});
