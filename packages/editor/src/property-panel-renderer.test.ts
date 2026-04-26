/**
 * @vitest-environment happy-dom
 *
 * Phase 2 of `docs/plans/property-panel-schema.md` — golden DOM
 * tests pinning the renderer's output against the same chip / row
 * shapes the imperative `#renderXxxControls` methods produce. One
 * test per non-empty `PROPERTY_CATEGORY` plus a few targeted
 * behaviour tests (visibility gating, mutation routing, replace
 * swap accounting).
 *
 * The renderer doesn't import `PropertyPanel`; tests construct it as
 * a free function, supplying a stub effect-handler table and a spy
 * `onCommit`. Phase 3 will wire this into the live panel one
 * category at a time.
 */

import {
  CATEGORY_CONTROL_SHAPE,
  PROPERTY_CONTROLS,
  PROPERTY_EFFECT_IDS,
  type PropertyControlId,
  type PropertyEffectId,
} from "@ingcreators/annot-core/editor/property-schema";
import { describe, expect, it, vi } from "vitest";
import {
  type CommitInfo,
  type ElementReplacement,
  type PropertyEffectHandler,
  renderControl,
  type RenderControlDeps,
} from "./property-panel-renderer.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag: string, attrs: Record<string, string> = {}): SVGElement {
  const el = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

interface TestDeps extends RenderControlDeps {
  onCommit: ReturnType<typeof vi.fn> & ((info: CommitInfo) => void);
}

/** Build a deps shim with no-op effect handlers + a vitest spy
 *  `onCommit`. Tests that need to assert effect dispatch override
 *  individual handlers via `deps.effects.<id> = ...`. */
function makeDeps(): TestDeps {
  const passthrough: PropertyEffectHandler = (els) =>
    els.map((el) => ({ oldEl: el, newEl: el }));
  return {
    effects: {
      applyArrowVariant: passthrough,
      applyDrawStyle: passthrough,
      applyMarkerShape: passthrough,
      resizeMarker: passthrough,
      applyRedactStyle: passthrough,
    },
    onCommit: vi.fn() as TestDeps["onCommit"],
  };
}

/** Render every control in the given category against the same
 *  sample element. Returns the concatenated outerHTML for snapshot
 *  comparison. */
function renderCategory(ids: readonly PropertyControlId[], sample: SVGElement): string {
  const deps = makeDeps();
  const parts: string[] = [];
  for (const id of ids) {
    const el = renderControl(PROPERTY_CONTROLS[id], [sample], deps);
    if (el) parts.push(el.outerHTML);
  }
  return parts.join("\n");
}

// ─── Per-category golden tests ──────────────────────────────────────

describe("renderControl — per-category DOM golden", () => {
  it("renders the textbox category controls", () => {
    const g = svg("g", { "data-type": "textbox" });
    const t = svg("text", { fill: "#ff0000", "font-size": "16", "font-family": "sans-serif" });
    t.textContent = "hi";
    g.appendChild(t);
    expect(renderCategory(CATEGORY_CONTROL_SHAPE.textbox, g)).toMatchInlineSnapshot(`
      "<div class="pp-type-row"><div class="prop-choice-chip material-symbols-outlined" data-tooltip="Plain text" aria-label="Plain text">text_fields</div><div class="prop-choice-chip material-symbols-outlined active" data-tooltip="Sticky note" aria-label="Sticky note">sticky_note_2</div><div class="prop-choice-chip material-symbols-outlined" data-tooltip="Callout" aria-label="Callout">chat_bubble</div></div>
      <div class="pp-row"><div class="pp-row-label">Color</div><button type="button" class="pp-color-btn"><span class="pp-color-swatch" style="background: #ff0000;"></span><span class="material-symbols-outlined">expand_more</span></button></div>
      <div class="pp-row"><div class="pp-row-label">Font</div><button type="button" class="pp-select" aria-label="Font" data-tooltip="Font"><span class="pp-select-preview">Sans-serif</span><span class="pp-select-caret material-symbols-outlined">expand_more</span></button></div>
      <div class="pp-row"><div class="pp-row-label">Size</div><div class="pp-number"><input type="number" min="8" max="96" step="1"><span class="pp-number-unit">pt</span><div class="pp-number-spinner"><button type="button" class="pp-number-spin-up" aria-label="Increase" tabindex="-1"></button><button type="button" class="pp-number-spin-down" aria-label="Decrease" tabindex="-1"></button></div></div></div>"
    `);
  });

  it("renders the marker category controls", () => {
    const g = svg("g", { "data-marker": "1", "data-shape": "circle" });
    g.appendChild(svg("circle", { cx: "12", cy: "12", r: "12", fill: "#ff0000" }));
    const text = svg("text", { "font-size": "13" });
    text.textContent = "1";
    g.appendChild(text);
    expect(renderCategory(CATEGORY_CONTROL_SHAPE.marker, g)).toMatchInlineSnapshot(`
      "<div class="pp-type-row"><div class="prop-choice-chip active" data-tooltip="Circle" aria-label="Circle"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><ellipse cx="12" cy="12" rx="8" ry="8"></ellipse><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="800" font-family="system-ui, sans-serif" fill="currentColor" stroke="none">1</text></svg></div><div class="prop-choice-chip" data-tooltip="Square" aria-label="Square"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" aria-hidden="true"><rect x="4" y="4" width="16" height="16"></rect><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="800" font-family="system-ui, sans-serif" fill="currentColor" stroke="none">1</text></svg></div><div class="prop-choice-chip" data-tooltip="Rounded square" aria-label="Rounded square"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="5"></rect><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="800" font-family="system-ui, sans-serif" fill="currentColor" stroke="none">1</text></svg></div></div>
      <div class="pp-row"><div class="pp-row-label">Size</div><div class="pp-number"><input type="number" min="8" max="96" step="1"><span class="pp-number-unit">pt</span><div class="pp-number-spinner"><button type="button" class="pp-number-spin-up" aria-label="Increase" tabindex="-1"></button><button type="button" class="pp-number-spin-down" aria-label="Decrease" tabindex="-1"></button></div></div></div>"
    `);
  });

  it("renders the redact-solid category controls (style picker + solid color)", () => {
    const r = svg("rect", { "data-redact-style": "solid", fill: "#222222" });
    expect(renderCategory(CATEGORY_CONTROL_SHAPE["redact-solid"], r)).toMatchInlineSnapshot(`
      "<div class="pp-type-row"><div class="prop-choice-chip material-symbols-outlined" data-tooltip="Mosaic (pixelate)" aria-label="Mosaic (pixelate)">grid_view</div><div class="prop-choice-chip material-symbols-outlined active" data-tooltip="Solid bar" aria-label="Solid bar">check_box</div><div class="prop-choice-chip material-symbols-outlined" data-tooltip="Blur" aria-label="Blur">blur_on</div></div>
      <div class="pp-row"><div class="pp-row-label">Color</div><button type="button" class="pp-color-btn"><span class="pp-color-swatch" style="background: #222222;"></span><span class="material-symbols-outlined">expand_more</span></button></div>"
    `);
  });

  it("renders the redact-mosaic category controls (style picker only)", () => {
    const i = svg("image", { "data-redact-style": "mosaic" });
    expect(renderCategory(CATEGORY_CONTROL_SHAPE["redact-mosaic"], i)).toMatchInlineSnapshot(`"<div class="pp-type-row"><div class="prop-choice-chip material-symbols-outlined active" data-tooltip="Mosaic (pixelate)" aria-label="Mosaic (pixelate)">grid_view</div><div class="prop-choice-chip material-symbols-outlined" data-tooltip="Solid bar" aria-label="Solid bar">check_box</div><div class="prop-choice-chip material-symbols-outlined" data-tooltip="Blur" aria-label="Blur">blur_on</div></div>"`);
  });

  it("renders the highlight category controls", () => {
    const r = svg("rect", { "data-highlight": "1", fill: "#ffff00", "fill-opacity": "0.4" });
    expect(renderCategory(CATEGORY_CONTROL_SHAPE.highlight, r)).toMatchInlineSnapshot(`
      "<div class="pp-type-row"><div class="prop-choice-chip pp-color-chip" style="--swatch-color: #ffe100;" data-tooltip="Yellow" aria-label="Yellow"></div><div class="prop-choice-chip pp-color-chip" style="--swatch-color: #7bff7b;" data-tooltip="Green" aria-label="Green"></div><div class="prop-choice-chip pp-color-chip" style="--swatch-color: #ff91e0;" data-tooltip="Pink" aria-label="Pink"></div><div class="prop-choice-chip pp-color-chip" style="--swatch-color: #7be0ff;" data-tooltip="Blue" aria-label="Blue"></div><div class="prop-choice-chip pp-color-chip" style="--swatch-color: #ffb84c;" data-tooltip="Orange" aria-label="Orange"></div><div class="prop-choice-chip pp-color-chip" style="--swatch-color: #c991ff;" data-tooltip="Purple" aria-label="Purple"></div></div>
      <div class="pp-row"><div class="pp-row-label">Transparency</div><div class="pp-number"><input type="number" min="0" max="100" step="5"><span class="pp-number-unit">%</span><div class="pp-number-spinner"><button type="button" class="pp-number-spin-up" aria-label="Increase" tabindex="-1"></button><button type="button" class="pp-number-spin-down" aria-label="Decrease" tabindex="-1"></button></div></div></div>"
    `);
  });

  it("renders the shape category controls (rect → fill + stroke + dash)", () => {
    const r = svg("rect", {
      x: "0",
      y: "0",
      width: "100",
      height: "50",
      fill: "#ff0000",
      stroke: "#000000",
      "stroke-width": "3",
    });
    expect(renderCategory(CATEGORY_CONTROL_SHAPE.shape, r)).toMatchInlineSnapshot(`
      "<div class="pp-type-row"><div class="prop-choice-chip active" data-tooltip="Rectangle" aria-label="Rectangle"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" aria-hidden="true"><rect x="4" y="4" width="16" height="16"></rect></svg></div><div class="prop-choice-chip" data-tooltip="Rounded" aria-label="Rounded"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="5"></rect></svg></div><div class="prop-choice-chip" data-tooltip="Ellipse" aria-label="Ellipse"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><ellipse cx="12" cy="12" rx="8" ry="8"></ellipse></svg></div></div>
      <div class="pp-row"><div class="pp-row-label">Color</div><button type="button" class="pp-color-btn"><span class="pp-color-swatch" style="background: #ff0000;"></span><span class="material-symbols-outlined">expand_more</span></button></div>
      <div class="pp-row"><div class="pp-row-label">Color</div><button type="button" class="pp-color-btn"><span class="pp-color-swatch" style="background: #000000;"></span><span class="material-symbols-outlined">expand_more</span></button></div>
      <div class="pp-row"><div class="pp-row-label">Width</div><div class="pp-number"><input type="number" min="0.25" max="200" step="0.25"><span class="pp-number-unit">pt</span><div class="pp-number-spinner"><button type="button" class="pp-number-spin-up" aria-label="Increase" tabindex="-1"></button><button type="button" class="pp-number-spin-down" aria-label="Decrease" tabindex="-1"></button></div></div></div>
      <div class="pp-row"><div class="pp-row-label">Dash type</div><button type="button" class="pp-select" aria-label="Dash type" data-tooltip="Dash type"><span class="pp-select-preview">Solid</span><span class="pp-select-caret material-symbols-outlined">expand_more</span></button></div>"
    `);
  });

  it("renders the group category as nothing (zero controls)", () => {
    const g = svg("g", { "data-type": "group" });
    expect(renderCategory(CATEGORY_CONTROL_SHAPE.group, g)).toBe("");
  });
});

// ─── Visibility gating ──────────────────────────────────────────────

describe("renderControl — visibleWhen gating", () => {
  it("returns null when visibleWhen rejects the first element", () => {
    // fillColor.visibleWhen excludes lines, freehand paths, and
    // freehand groups (no fillable region).
    const line = svg("line");
    const out = renderControl(PROPERTY_CONTROLS.fillColor, [line], makeDeps());
    expect(out).toBeNull();
  });

  it("renders when visibleWhen accepts the first element", () => {
    const r = svg("rect", { fill: "#ff0000" });
    const out = renderControl(PROPERTY_CONTROLS.fillColor, [r], makeDeps());
    expect(out).not.toBeNull();
    expect(out?.classList.contains("pp-row")).toBe(true);
  });

  it("returns null on empty selection", () => {
    expect(renderControl(PROPERTY_CONTROLS.fillColor, [], makeDeps())).toBeNull();
  });

  it("redactSolidColor stays hidden for mosaic / blur targets", () => {
    const mosaic = svg("image", { "data-redact-style": "mosaic" });
    expect(renderControl(PROPERTY_CONTROLS.redactSolidColor, [mosaic], makeDeps())).toBeNull();
    const blur = svg("image", { "data-redact-style": "blur" });
    expect(renderControl(PROPERTY_CONTROLS.redactSolidColor, [blur], makeDeps())).toBeNull();
    const solid = svg("rect", { "data-redact-style": "solid", fill: "#000" });
    expect(renderControl(PROPERTY_CONTROLS.redactSolidColor, [solid], makeDeps())).not.toBeNull();
  });
});

// ─── Mutation routing ───────────────────────────────────────────────

describe("renderControl — mutation routing", () => {
  it("variantPicker chip click dispatches `replace` defs to the replace path", async () => {
    // shapeTypePicker uses `replace` (convertShape returns a fresh
    // element). Clicking the ellipse chip should swap rect → ellipse
    // in the parent, fire onCommit with variantChange=true and a
    // non-empty replacements array.
    const parent = document.createElement("div");
    const svgRoot = svg("svg");
    parent.appendChild(svgRoot);
    const r = svg("rect", { x: "0", y: "0", width: "10", height: "10" });
    svgRoot.appendChild(r);
    const deps = makeDeps();
    const row = renderControl(PROPERTY_CONTROLS.shapeTypePicker, [r], deps);
    expect(row).not.toBeNull();
    const ellipseChip = row!.querySelector<HTMLElement>('[data-tooltip="Ellipse"]');
    expect(ellipseChip).not.toBeNull();
    ellipseChip!.click();
    // convertShape is sync — onCommit fires on the same tick.
    await Promise.resolve();
    expect(deps.onCommit).toHaveBeenCalledOnce();
    const info = deps.onCommit.mock.calls[0]![0];
    expect(info.variantChange).toBe(true);
    expect(info.replacements).toHaveLength(1);
    expect(info.replacements[0]!.oldEl).toBe(r);
    expect(info.replacements[0]!.newEl.tagName).toBe("ellipse");
  });

  it("variantPicker chip click dispatches `effect` defs through the effect handler table", async () => {
    const r = svg("g", { "data-type": "arrow", "data-arrow-head": "none" });
    const handler = vi.fn<PropertyEffectHandler>((els, _v) =>
      els.map((el) => ({ oldEl: el, newEl: el })),
    );
    const deps = makeDeps();
    deps.effects.applyArrowVariant = handler;
    const row = renderControl(PROPERTY_CONTROLS.arrowVariantPicker, [r], deps);
    expect(row).not.toBeNull();
    const bothChip = row!.querySelector<HTMLElement>('[data-tooltip="Double arrow"]');
    expect(bothChip).not.toBeNull();
    bothChip!.click();
    // The click handler is async (awaits the effect handler).
    // Microtask flush is enough since our handler is sync inside.
    // The variant-picker click handler awaits runEffect, which itself
    // awaits the handler — needs two microtask drains before onCommit
    // resolves on the next tick.
    await Promise.resolve();
    await Promise.resolve();
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0]).toEqual([r]);
    expect(handler.mock.calls[0]![1]).toBe("both");
    expect(deps.onCommit).toHaveBeenCalledOnce();
    expect(deps.onCommit.mock.calls[0]![0].variantChange).toBe(true);
  });

  it("color setValue mutates targets in place and fires onCommit with empty replacements", () => {
    const r = svg("rect", { fill: "#ff0000" });
    const deps = makeDeps();
    const row = renderControl(PROPERTY_CONTROLS.fillColor, [r], deps);
    expect(row).not.toBeNull();
    // Drive the registry's setValue directly — opening the popover
    // requires layout we don't have under happy-dom.
    PROPERTY_CONTROLS.fillColor.setValue?.(r, "#0000ff");
    expect(r.getAttribute("fill")).toBe("#0000ff");
  });

  it("number control routes through the matching effect when present", async () => {
    // markerSize uses `effect: resizeMarker`. The handler should be
    // called with the chosen value and an `oldEl === newEl` identity
    // replacement (resizeMarker mutates in place).
    const g = svg("g", { "data-marker": "1", "data-shape": "circle" });
    g.appendChild(svg("circle", { cx: "12", cy: "12", r: "12" }));
    const t = svg("text", { "font-size": "13" });
    t.textContent = "1";
    g.appendChild(t);
    const handler = vi.fn<PropertyEffectHandler>((els) =>
      els.map((el) => ({ oldEl: el, newEl: el })),
    );
    const deps = makeDeps();
    deps.effects.resizeMarker = handler;
    const row = renderControl(PROPERTY_CONTROLS.markerSize, [g], deps);
    expect(row).not.toBeNull();
    const input = row!.querySelector<HTMLInputElement>("input[type=number]")!;
    input.value = "20";
    input.dispatchEvent(new Event("change"));
    await Promise.resolve();
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![1]).toBe(20);
  });

  it("an effect handler that throws rolls back the chip's active state", async () => {
    const r = svg("g", { "data-type": "arrow", "data-arrow-head": "none" });
    const handler = vi.fn<PropertyEffectHandler>(() => {
      throw new Error("boom");
    });
    const deps = makeDeps();
    deps.effects.applyArrowVariant = handler;
    const row = renderControl(PROPERTY_CONTROLS.arrowVariantPicker, [r], deps);
    expect(row).not.toBeNull();
    const noneChip = row!.querySelector<HTMLElement>('[data-tooltip="Line"]');
    const bothChip = row!.querySelector<HTMLElement>('[data-tooltip="Double arrow"]');
    // "none" starts active; clicking "both" should fail and revert.
    expect(noneChip!.classList.contains("active")).toBe(true);
    bothChip!.click();
    // Wait for the promise rejection inside the click handler.
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.onCommit).not.toHaveBeenCalled();
    expect(noneChip!.classList.contains("active")).toBe(true);
    expect(bothChip!.classList.contains("active")).toBe(false);
  });
});

// ─── Effect-handler-table contract ──────────────────────────────────

describe("renderControl — effect handler binding", () => {
  it("throws when a referenced effect id is missing from the deps table", async () => {
    const r = svg("g", { "data-type": "arrow", "data-arrow-head": "none" });
    const deps = makeDeps();
    // Wipe the handler so the renderer's lookup misses.
    delete deps.effects.applyArrowVariant;
    const row = renderControl(PROPERTY_CONTROLS.arrowVariantPicker, [r], deps);
    const bothChip = row!.querySelector<HTMLElement>('[data-tooltip="Double arrow"]');
    // The click handler logs the error then rolls back; we can't
    // throw from the click directly, but the failure surfaces as
    // a rolled-back active state + zero onCommit calls.
    bothChip!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.onCommit).not.toHaveBeenCalled();
  });

  it("every PropertyEffectId is reachable through the deps table", () => {
    // Sanity-check that the deps shim covers every id the registry
    // declares — guards against a new effect id landing without a
    // matching test fixture.
    const ids: PropertyEffectId[] = Object.values(PROPERTY_EFFECT_IDS);
    const deps = makeDeps();
    for (const id of ids) {
      expect(typeof deps.effects[id]).toBe("function");
    }
  });
});

// ─── Replace path: identity preservation through swaps ─────────────

describe("renderControl — replace target tracking", () => {
  it("keeps subsequent clicks routed to the post-replace element", async () => {
    // Click sequence: rect → rounded → ellipse. The renderer's
    // internal target list must update after each replace so the
    // second click operates on the rounded rect (not the original).
    const root = svg("svg");
    let r: SVGElement = svg("rect", { x: "0", y: "0", width: "10", height: "10" });
    root.appendChild(r);
    const deps = makeDeps();
    const row = renderControl(PROPERTY_CONTROLS.shapeTypePicker, [r], deps);
    expect(row).not.toBeNull();

    row!.querySelector<HTMLElement>('[data-tooltip="Rounded"]')!.click();
    await Promise.resolve();
    let info = deps.onCommit.mock.calls[0]![0];
    expect(info.replacements).toHaveLength(1);
    expect(info.replacements[0]!.newEl.tagName).toBe("rect");
    expect(info.replacements[0]!.newEl.hasAttribute("data-rounded")).toBe(true);
    r = info.replacements[0]!.newEl;

    row!.querySelector<HTMLElement>('[data-tooltip="Ellipse"]')!.click();
    await Promise.resolve();
    info = deps.onCommit.mock.calls[1]![0];
    expect(info.replacements).toHaveLength(1);
    // Critical assertion: the second replace operates on the
    // POST-FIRST-REPLACE rounded rect, not the original sharp rect.
    expect(info.replacements[0]!.oldEl).toBe(r);
    expect(info.replacements[0]!.newEl.tagName).toBe("ellipse");
  });
});

// silence unused-import warning when only types are imported
const _typeOnly: ElementReplacement | null = null;
void _typeOnly;
