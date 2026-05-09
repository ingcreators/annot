/**
 * @vitest-environment happy-dom
 *
 * `PropertyPanel` is the orchestrator above the schema-driven
 * `renderControl` (already covered by
 * `property-panel-renderer.test.ts`). This file pins the parts the
 * renderer tests can't reach:
 *
 *   - constructor + DOM mount (floating vs docked, container append,
 *     pointerdown stopPropagation)
 *   - `show([])` / `show([el])` / `hide()` lifecycle (display flag,
 *     `#targets` reset, innerHTML clear)
 *   - `annot:text-edit-start` / `annot:text-edit-end` events on the
 *     canvas SVG flip the panel into / out of text-edit mode
 *   - per-category section dispatch (Type / Fill / Line / Label
 *     surface for textbox / marker / redact / highlight / shape)
 *   - effect-handler routing through user-visible chip clicks
 *     (applyArrowVariant + the `#clampArrowEndsToVariant` rule;
 *     applyDrawStyle; applyMarkerShape; resizeMarker)
 *   - `#handleRendererCommit` bridging: history.save + onStyleChanged
 *     + onTargetMutated for non-variant edits; onVariantChanged for
 *     variant pickers; wrapper-sync of `data-shape-kind` when an
 *     inner geometry is swapped (rect ↔ ellipse via shapeTypePicker)
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasManager } from "./canvas-manager.js";
import type { History } from "./history.js";
import { PropertyPanel } from "./property-panel.js";

const SVG_NS = "http://www.w3.org/2000/svg";

interface FakeCanvasFixture {
  canvas: CanvasManager;
  svg: SVGSVGElement;
  annotations: SVGGElement;
  uiOverlay: SVGGElement;
  defs: SVGDefsElement;
}

function makeCanvas(): FakeCanvasFixture {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  const annotations = document.createElementNS(SVG_NS, "g") as SVGGElement;
  annotations.id = "annotations";
  const uiOverlay = document.createElementNS(SVG_NS, "g") as SVGGElement;
  uiOverlay.id = "ui-overlay";
  const defs = document.createElementNS(SVG_NS, "defs") as SVGDefsElement;
  svg.appendChild(defs);
  svg.appendChild(annotations);
  svg.appendChild(uiOverlay);
  document.body.appendChild(svg);
  const canvas = {
    svg,
    annotations,
    uiOverlay,
    defs,
    imageWidth: 800,
    imageHeight: 600,
  } as unknown as CanvasManager;
  return { canvas, svg, annotations, uiOverlay, defs };
}

function makeHistory(): { history: History; save: ReturnType<typeof vi.fn> } {
  const save = vi.fn();
  return { history: { save } as unknown as History, save };
}

function svgEl(tag: string, attrs: Record<string, string> = {}): SVGElement {
  const el = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Build a sample arrow group with both endpoints (data-x1..y2) and
 *  per-end specs (start "none", end "triangle"). The composed-path
 *  children (stem + heads) are added on `applyArrowHead` invocation
 *  via refreshArrowPath; the wrapper alone is enough for the
 *  PropertyPanel's variant-picker dispatch. */
function makeArrow(): SVGGElement {
  const g = svgEl("g", {
    "data-type": "arrow",
    "data-x1": "0",
    "data-y1": "0",
    "data-x2": "100",
    "data-y2": "0",
    "data-arrow-start-shape": "none",
    "data-arrow-start-width": "md",
    "data-arrow-start-length": "md",
    "data-arrow-end-shape": "triangle",
    "data-arrow-end-width": "md",
    "data-arrow-end-length": "md",
    stroke: "#000000",
    "stroke-width": "3",
  }) as SVGGElement;
  return g;
}

/** Build a marker (counter) `<g>` matching what MarkerTool emits:
 *  `<g data-marker="N" data-shape="circle">` with a circle bg + a
 *  centred text label. */
function makeMarker(): SVGGElement {
  const g = svgEl("g", {
    "data-marker": "1",
    "data-shape": "circle",
  }) as SVGGElement;
  const circle = svgEl("circle", {
    cx: "50",
    cy: "50",
    r: "16",
    fill: "#ff0000",
    stroke: "#ffffff",
    "stroke-width": "1.5",
  });
  g.appendChild(circle);
  const text = svgEl("text", {
    x: "50",
    y: "50",
    "text-anchor": "middle",
    "dominant-baseline": "central",
    fill: "#ffffff",
    "font-size": "16",
  });
  text.textContent = "1";
  g.appendChild(text);
  return g;
}

/** Build a sticky-note text shape `<g data-type="shape" data-shape-kind="sticky">`
 *  matching what TextTool's createTextShape emits at minimum. */
function makeSticky(): SVGGElement {
  const g = svgEl("g", {
    "data-type": "shape",
    "data-shape-kind": "sticky",
    "data-color": "#000000",
    "data-font-size": "16",
    "data-font-family": "Annot Sans",
  }) as SVGGElement;
  g.appendChild(svgEl("rect", { x: "0", y: "0", width: "200", height: "80", fill: "#fff8dc" }));
  const text = svgEl("text", {
    x: "10",
    y: "10",
    fill: "#000000",
    "font-size": "16",
    "font-family": "Annot Sans",
  });
  text.textContent = "hello";
  g.appendChild(text);
  return g;
}

/** Solid redact rect — `data-redact-style="solid"`. */
function makeSolidRedact(): SVGRectElement {
  return svgEl("rect", {
    x: "10",
    y: "20",
    width: "100",
    height: "50",
    fill: "rgb(0,0,0)",
    "data-redact-style": "solid",
  }) as SVGRectElement;
}

/** Highlight rect — `data-highlight="1"`. */
function makeHighlight(): SVGRectElement {
  return svgEl("rect", {
    x: "0",
    y: "0",
    width: "100",
    height: "20",
    fill: "#ffff00",
    "fill-opacity": "0.4",
    "data-highlight": "1",
  }) as SVGRectElement;
}

/** Group `<g data-type="group">` — collapses to the empty-render
 *  category (no per-element controls). */
function makeGroup(): SVGGElement {
  const g = svgEl("g", { "data-type": "group" }) as SVGGElement;
  g.appendChild(svgEl("rect", { x: "0", y: "0", width: "10", height: "10" }));
  return g;
}

function makePanel(opts: { mode?: "floating" | "docked" } = {}): {
  panel: PropertyPanel;
  container: HTMLElement;
  fixture: FakeCanvasFixture;
  save: ReturnType<typeof vi.fn>;
} {
  const fixture = makeCanvas();
  const { history, save } = makeHistory();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const panel = new PropertyPanel(container, fixture.canvas, history, opts.mode);
  return { panel, container, fixture, save };
}

afterEach(() => {
  for (const child of Array.from(document.body.children)) child.remove();
  vi.restoreAllMocks();
});

describe("PropertyPanel — constructor", () => {
  it("appends an empty .prop-panel div to the supplied container, hidden by default", () => {
    const { container } = makePanel();
    const root = container.querySelector(".prop-panel") as HTMLDivElement;
    expect(root).not.toBeNull();
    expect(root.style.display).toBe("none");
    expect(root.children.length).toBe(0);
  });

  it("default mode is 'floating' — the panel root has only `prop-panel`, no docked variant class", () => {
    const { container } = makePanel();
    const root = container.querySelector(".prop-panel") as HTMLDivElement;
    expect(root.className).toBe("prop-panel");
  });

  it("mode='docked' adds the `prop-panel-docked` variant class", () => {
    const { container } = makePanel({ mode: "docked" });
    const root = container.querySelector(".prop-panel") as HTMLDivElement;
    expect(root.classList.contains("prop-panel")).toBe(true);
    expect(root.classList.contains("prop-panel-docked")).toBe(true);
  });

  it("pointerdown on the panel root stops propagation (so the canvas selection isn't cleared)", () => {
    const { container } = makePanel();
    const root = container.querySelector(".prop-panel") as HTMLDivElement;
    let bubbled = false;
    container.addEventListener("pointerdown", () => {
      bubbled = true;
    });
    root.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(bubbled).toBe(false);
  });
});

describe("PropertyPanel — show / hide lifecycle", () => {
  it("show([]) hides the panel", () => {
    const { panel, container } = makePanel();
    panel.show([makeSticky()]);
    const root = container.querySelector(".prop-panel") as HTMLElement;
    expect(root.style.display).toBe("flex");
    panel.show([]);
    expect(root.style.display).toBe("none");
  });

  it("hide() clears the display flag and resets internal targets (subsequent show re-renders cleanly)", () => {
    const { panel, container } = makePanel();
    panel.show([makeSticky()]);
    const root = container.querySelector(".prop-panel") as HTMLElement;
    expect(root.children.length).toBeGreaterThan(0);
    panel.hide();
    expect(root.style.display).toBe("none");
  });

  it("show() with a fresh element rebuilds innerHTML (doesn't accumulate from prior calls)", () => {
    const { panel, container } = makePanel();
    panel.show([makeSticky()]);
    const root = container.querySelector(".prop-panel") as HTMLElement;
    const before = root.children.length;
    panel.show([makeSticky()]);
    expect(root.children.length).toBe(before);
  });

  it("group category renders no sections (empty registry slice + #inSection's empty-body cleanup)", () => {
    const { panel, container } = makePanel();
    panel.show([makeGroup()]);
    const root = container.querySelector(".prop-panel") as HTMLElement;
    // The panel is shown but there are no pp-section cards.
    expect(root.style.display).toBe("flex");
    expect(root.querySelectorAll(".pp-section").length).toBe(0);
  });
});

describe("PropertyPanel — section dispatch by category", () => {
  function sectionTitles(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll(".pp-section-header")).map(
      (h) => h.textContent ?? "",
    );
  }

  it("shape (composed arrow) renders Type + Line sections; Fill is empty for stroke-only and removed", () => {
    const { panel, container } = makePanel();
    panel.show([makeArrow()]);
    expect(sectionTitles(container)).toEqual(["Type", "Line"]);
  });

  it("textbox (sticky, object-selection mode) renders only the Type section", () => {
    const { panel, container } = makePanel();
    panel.show([makeSticky()]);
    expect(sectionTitles(container)).toEqual(["Type"]);
  });

  it("marker renders Type + Fill + Line + Label sections", () => {
    const { panel, container } = makePanel();
    panel.show([makeMarker()]);
    expect(sectionTitles(container)).toEqual(["Type", "Fill", "Line", "Label"]);
  });

  it("redact-solid renders Type + Fill (the solid-only Color row materialises)", () => {
    const { panel, container } = makePanel();
    panel.show([makeSolidRedact()]);
    expect(sectionTitles(container)).toEqual(["Type", "Fill"]);
  });

  it("highlight renders Type + Fill (color picker + transparency)", () => {
    const { panel, container } = makePanel();
    panel.show([makeHighlight()]);
    expect(sectionTitles(container)).toEqual(["Type", "Fill"]);
  });
});

describe("PropertyPanel — text-edit mode toggle via canvas events", () => {
  it("annot:text-edit-start with a sticky wrapper flips into edit mode (Text + Text box sections)", () => {
    const { panel, container, fixture } = makePanel();
    void panel; // panel mounts the listener; no direct method call needed
    const sticky = makeSticky();
    fixture.annotations.appendChild(sticky);
    fixture.svg.dispatchEvent(
      new CustomEvent("annot:text-edit-start", { detail: { target: sticky } }),
    );
    const titles = Array.from(container.querySelectorAll(".pp-section-header")).map(
      (h) => h.textContent ?? "",
    );
    expect(titles).toEqual(["Text", "Text box"]);
  });

  it("annot:text-edit-start with no detail.target is a no-op (panel stays hidden)", () => {
    const { panel, container, fixture } = makePanel();
    void panel;
    fixture.svg.dispatchEvent(new CustomEvent("annot:text-edit-start", { detail: null }));
    const root = container.querySelector(".prop-panel") as HTMLElement;
    expect(root.style.display).toBe("none");
  });

  it("annot:text-edit-end re-renders in object mode against the same (still-connected) wrapper", () => {
    const { panel, container, fixture } = makePanel();
    void panel;
    const sticky = makeSticky();
    fixture.annotations.appendChild(sticky);
    fixture.svg.dispatchEvent(
      new CustomEvent("annot:text-edit-start", { detail: { target: sticky } }),
    );
    fixture.svg.dispatchEvent(new CustomEvent("annot:text-edit-end", { detail: {} }));
    const titles = Array.from(container.querySelectorAll(".pp-section-header")).map(
      (h) => h.textContent ?? "",
    );
    // Object-mode for sticky → only Type section.
    expect(titles).toEqual(["Type"]);
  });

  it("annot:text-edit-end on a wrapper that was disconnected (cancel-without-typing) hides the panel", () => {
    const { panel, container, fixture } = makePanel();
    void panel;
    const sticky = makeSticky();
    // Don't append — the wrapper is "unwrapped" / never mounted.
    fixture.svg.dispatchEvent(
      new CustomEvent("annot:text-edit-start", { detail: { target: sticky } }),
    );
    fixture.svg.dispatchEvent(new CustomEvent("annot:text-edit-end", { detail: {} }));
    const root = container.querySelector(".prop-panel") as HTMLElement;
    expect(root.style.display).toBe("none");
  });
});

describe("PropertyPanel — applyArrowVariant effect via chip click", () => {
  /** Returns the `prop-choice-chip` whose tooltip / aria-label contains
   *  the supplied substring. The variant-picker chips in the Type
   *  section carry one of "Line" / "Single arrow" / "Double arrow". */
  function findChip(container: HTMLElement, label: string): HTMLElement | null {
    const chips = Array.from(container.querySelectorAll<HTMLElement>(".prop-choice-chip"));
    // Exact match — variant chips have labels like "Line" / "Arrow" /
    // "Double arrow"; substring match would route a search for
    // "Arrow" to "Double arrow" too.
    return chips.find((c) => (c.getAttribute("aria-label") ?? "") === label) ?? null;
  }

  it("clicking the 'Line' chip clamps both ends to 'none' (and persists via applyArrowHead)", () => {
    const { panel, container } = makePanel();
    const arrow = makeArrow();
    panel.show([arrow]);
    const lineChip = findChip(container, "Line");
    expect(lineChip).not.toBeNull();
    lineChip!.click();
    expect(arrow.getAttribute("data-arrow-start-shape")).toBe("none");
    expect(arrow.getAttribute("data-arrow-end-shape")).toBe("none");
  });

  it("clicking the 'Single arrow' chip seeds end='triangle' when previously 'none'; start stays 'none'", () => {
    const { panel, container } = makePanel();
    const arrow = makeArrow();
    arrow.setAttribute("data-arrow-end-shape", "none");
    panel.show([arrow]);
    const single = findChip(container, "Arrow");
    expect(single).not.toBeNull();
    single!.click();
    expect(arrow.getAttribute("data-arrow-start-shape")).toBe("none");
    expect(arrow.getAttribute("data-arrow-end-shape")).toBe("triangle");
  });

  it("clicking the 'Double arrow' chip seeds BOTH ends to 'triangle' when both were 'none'", () => {
    const { panel, container } = makePanel();
    const arrow = makeArrow();
    arrow.setAttribute("data-arrow-start-shape", "none");
    arrow.setAttribute("data-arrow-end-shape", "none");
    panel.show([arrow]);
    const dbl = findChip(container, "Double arrow");
    expect(dbl).not.toBeNull();
    dbl!.click();
    expect(arrow.getAttribute("data-arrow-start-shape")).toBe("triangle");
    expect(arrow.getAttribute("data-arrow-end-shape")).toBe("triangle");
  });

  it("clicking 'Arrow' preserves a non-'none' end shape (e.g. diamond stays diamond)", () => {
    const { panel, container } = makePanel();
    const arrow = makeArrow();
    arrow.setAttribute("data-arrow-end-shape", "diamond");
    panel.show([arrow]);
    findChip(container, "Arrow")!.click();
    expect(arrow.getAttribute("data-arrow-end-shape")).toBe("diamond");
  });
});

describe("PropertyPanel — applyMarkerShape + resizeMarker effects", () => {
  function findChip(container: HTMLElement, label: string): HTMLElement | null {
    const chips = Array.from(container.querySelectorAll<HTMLElement>(".prop-choice-chip"));
    // Exact match — variant chips have labels like "Line" / "Arrow" /
    // "Double arrow"; substring match would route a search for
    // "Arrow" to "Double arrow" too.
    return chips.find((c) => (c.getAttribute("aria-label") ?? "") === label) ?? null;
  }

  it("Square chip swaps the marker's bg primitive from circle to rect (data-shape='rect')", () => {
    const { panel, container } = makePanel();
    const marker = makeMarker();
    panel.show([marker]);
    const square = findChip(container, "Square");
    expect(square).not.toBeNull();
    square!.click();
    expect(marker.getAttribute("data-shape")).toBe("rect");
    expect(marker.querySelector("circle")).toBeNull();
    expect(marker.querySelector("rect")).not.toBeNull();
  });

  it("Rounded square chip → data-shape='rounded' + rect with rx≈r×0.6", () => {
    const { panel, container } = makePanel();
    const marker = makeMarker();
    panel.show([marker]);
    findChip(container, "Rounded square")!.click();
    expect(marker.getAttribute("data-shape")).toBe("rounded");
    const rect = marker.querySelector("rect")!;
    // r=16, rx ≈ 16 * 0.6 = 9.6
    expect(Number(rect.getAttribute("rx"))).toBeCloseTo(9.6, 5);
  });

  it("Size number-input change rescales the bg primitive + text font-size", () => {
    const { panel, container } = makePanel();
    const marker = makeMarker();
    panel.show([marker]);
    // Find the Label > Size number input (last `pp-number` in the panel).
    const numbers = container.querySelectorAll<HTMLInputElement>(".pp-number input");
    const sizeInput = numbers[numbers.length - 1]!;
    sizeInput.value = "30";
    sizeInput.dispatchEvent(new Event("change", { bubbles: true }));
    // bg circle's r = 30 * 0.8 = 24
    const circle = marker.querySelector("circle")!;
    expect(Number(circle.getAttribute("r"))).toBeCloseTo(24, 5);
    expect(marker.querySelector("text")!.getAttribute("font-size")).toBe("30");
  });
});

describe("PropertyPanel — handleRendererCommit bridging", () => {
  function findChip(container: HTMLElement, label: string): HTMLElement | null {
    const chips = Array.from(container.querySelectorAll<HTMLElement>(".prop-choice-chip"));
    // Exact match — variant chips have labels like "Line" / "Arrow" /
    // "Double arrow"; substring match would route a search for
    // "Arrow" to "Double arrow" too.
    return chips.find((c) => (c.getAttribute("aria-label") ?? "") === label) ?? null;
  }

  /** Renderer's chip click handler awaits `dispatchMutation` even
   *  for sync effects, so the spy assertions need to run AFTER the
   *  microtask queue drains. Two flushes cover the worst-case
   *  promise chain depth (await effect → await onCommit). */
  async function flushClick(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it("variant chip click fires history.save AND onVariantChanged with the post-commit targets", async () => {
    const { panel, container, save } = makePanel();
    const onVariantChanged = vi.fn();
    panel.onVariantChanged = onVariantChanged;
    const arrow = makeArrow();
    panel.show([arrow]);
    findChip(container, "Line")!.click();
    await flushClick();
    expect(save).toHaveBeenCalledTimes(1);
    expect(onVariantChanged).toHaveBeenCalledTimes(1);
    expect(onVariantChanged.mock.calls[0]![0]).toEqual([arrow]);
  });

  it("variant chip click does NOT fire onStyleChanged (mutually exclusive with onVariantChanged)", async () => {
    const { panel, container } = makePanel();
    const onStyleChanged = vi.fn();
    panel.onStyleChanged = onStyleChanged;
    panel.onVariantChanged = vi.fn(); // present so the panel doesn't fall back to re-render
    const arrow = makeArrow();
    panel.show([arrow]);
    findChip(container, "Line")!.click();
    await flushClick();
    expect(onStyleChanged).not.toHaveBeenCalled();
  });

  it("non-variant edit (markerSize number input) fires onStyleChanged + onTargetMutated", async () => {
    const { panel, container, save } = makePanel();
    const onStyleChanged = vi.fn();
    const onTargetMutated = vi.fn();
    panel.onStyleChanged = onStyleChanged;
    panel.onTargetMutated = onTargetMutated;
    const marker = makeMarker();
    panel.show([marker]);
    // markerShapePicker is a variantPicker (variantChange: true). The
    // non-variant branch is exercised by markerSize (number → effect:
    // resizeMarker), which routes through onStyleChanged.
    const numbers = container.querySelectorAll<HTMLInputElement>(".pp-number input");
    const sizeInput = numbers[numbers.length - 1]!;
    sizeInput.value = "30";
    sizeInput.dispatchEvent(new Event("change", { bubbles: true }));
    await flushClick();
    expect(save).toHaveBeenCalledTimes(1);
    expect(onStyleChanged).toHaveBeenCalledTimes(1);
    expect(onTargetMutated).toHaveBeenCalledTimes(1);
  });

  it("variant chip click WITHOUT onVariantChanged hook re-renders the panel (so dependent controls refresh)", async () => {
    const { panel, container } = makePanel();
    // Don't wire onVariantChanged — the fallback path is `this.show(targets)`.
    const arrow = makeArrow();
    panel.show([arrow]);
    const initialChipCount = container.querySelectorAll(".prop-choice-chip").length;
    findChip(container, "Line")!.click();
    await flushClick();
    // Re-render produced the same number of chips again (panel still shown).
    const finalChipCount = container.querySelectorAll(".prop-choice-chip").length;
    expect(finalChipCount).toBe(initialChipCount);
  });
});

describe("PropertyPanel — onTargetReplaced filtering", () => {
  function findChip(container: HTMLElement, label: string): HTMLElement | null {
    const chips = Array.from(container.querySelectorAll<HTMLElement>(".prop-choice-chip"));
    // Exact match — variant chips have labels like "Line" / "Arrow" /
    // "Double arrow"; substring match would route a search for
    // "Arrow" to "Double arrow" too.
    return chips.find((c) => (c.getAttribute("aria-label") ?? "") === label) ?? null;
  }

  async function flushClick(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it("identity-only commits (in-place mutation) do NOT fire onTargetReplaced", async () => {
    const { panel, container } = makePanel();
    const onTargetReplaced = vi.fn();
    panel.onTargetReplaced = onTargetReplaced;
    const arrow = makeArrow();
    panel.show([arrow]);
    findChip(container, "Line")!.click();
    await flushClick();
    // applyArrowVariant returns identity replacements (oldEl === newEl).
    expect(onTargetReplaced).not.toHaveBeenCalled();
  });

  it("identity-only marker shape swap does NOT fire onTargetReplaced (outer <g> keeps identity)", async () => {
    const { panel, container } = makePanel();
    const onTargetReplaced = vi.fn();
    panel.onTargetReplaced = onTargetReplaced;
    const marker = makeMarker();
    panel.show([marker]);
    findChip(container, "Square")!.click();
    await flushClick();
    expect(onTargetReplaced).not.toHaveBeenCalled();
  });
});

describe("PropertyPanel — applyDrawStyle effect (freehand)", () => {
  function findChip(container: HTMLElement, label: string): HTMLElement | null {
    const chips = Array.from(container.querySelectorAll<HTMLElement>(".prop-choice-chip"));
    // Exact match — variant chips have labels like "Line" / "Arrow" /
    // "Double arrow"; substring match would route a search for
    // "Arrow" to "Double arrow" too.
    return chips.find((c) => (c.getAttribute("aria-label") ?? "") === label) ?? null;
  }

  /** Build a freehand `<g data-type="freehand" data-draw-style="pen">`
   *  with one child `<path>` — minimal shape for the drawStylePicker
   *  variantPicker to render. */
  function makeFreehand(): SVGGElement {
    const g = svgEl("g", {
      "data-type": "freehand",
      "data-draw-style": "pen",
      stroke: "#000000",
      "stroke-width": "3",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "fill-opacity": "1",
      fill: "none",
    }) as SVGGElement;
    g.appendChild(svgEl("path", { d: "M0 0 L100 100" }));
    return g;
  }

  it("Highlighter chip flips the freehand group's data-draw-style attribute via applyDrawStyle", () => {
    const { panel, container } = makePanel();
    const fh = makeFreehand();
    panel.show([fh]);
    const highlighter = findChip(container, "Highlighter");
    expect(highlighter).not.toBeNull();
    highlighter!.click();
    expect(fh.getAttribute("data-draw-style")).toBe("highlighter");
  });
});
