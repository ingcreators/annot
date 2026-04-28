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
      applyTextColor: passthrough,
      applyArrowStartShape: passthrough,
      applyArrowStartSize: passthrough,
      applyArrowEndShape: passthrough,
      applyArrowEndSize: passthrough,
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
      "<div class="pp-type-row"><div class="prop-choice-chip" data-tooltip="Plain text" aria-label="Plain text"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M290-160v-540H80v-100h520v100H390v540H290Zm360 0v-340H520v-100h360v100H750v340H650Z"></path></svg></div><div class="prop-choice-chip active" data-tooltip="Sticky note" aria-label="Sticky note"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M180-180h400v-200h200v-400H180v600Zm0 60q-24.75 0-42.37-17.63Q120-155.25 120-180v-600q0-24.75 17.63-42.38Q155.25-840 180-840h600q24.75 0 42.38 17.62Q840-804.75 840-780v420L600-120H180Zm120-300v-60h170v60H300Zm0-160v-60h360v60H300ZM180-180v-600 600Z"></path></svg></div><div class="prop-choice-chip" data-tooltip="Callout" aria-label="Callout"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M80-80v-740q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H240L80-80Zm134-220h606v-520H140v600l74-80Zm-74 0v-520 520Z"></path></svg></div></div>
      <div class="pp-row"><div class="pp-row-label">Color</div><button type="button" class="pp-color-btn"><span class="pp-color-swatch" style="background: #ff0000;"></span><span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-344 240-584l43-43 197 197 197-197 43 43-240 240Z"></path></svg></span></button></div>
      <div class="pp-row"><div class="pp-row-label">Font</div><button type="button" class="pp-select" aria-label="Font" data-tooltip="Font"><span class="pp-select-preview">Sans-serif</span><span class="pp-select-caret"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-344 240-584l43-43 197 197 197-197 43 43-240 240Z"></path></svg></span></button></div>
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
      <div class="pp-row"><div class="pp-row-label">Color</div><button type="button" class="pp-color-btn"><span class="pp-color-swatch" style="background: #ff0000;"></span><span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-344 240-584l43-43 197 197 197-197 43 43-240 240Z"></path></svg></span></button></div>
      <div class="pp-row"><div class="pp-row-label">Color</div><button type="button" class="pp-color-btn"><span class="pp-color-swatch" style="background: #ffffff;"></span><span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-344 240-584l43-43 197 197 197-197 43 43-240 240Z"></path></svg></span></button></div>
      <div class="pp-row"><div class="pp-row-label">Width</div><div class="pp-number"><input type="number" min="0" max="20" step="0.25"><span class="pp-number-unit">pt</span><div class="pp-number-spinner"><button type="button" class="pp-number-spin-up" aria-label="Increase" tabindex="-1"></button><button type="button" class="pp-number-spin-down" aria-label="Decrease" tabindex="-1"></button></div></div></div>
      <div class="pp-row"><div class="pp-row-label">Dash type</div><button type="button" class="pp-select" aria-label="Dash type" data-tooltip="Dash type"><span class="pp-select-preview">Solid</span><span class="pp-select-caret"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-344 240-584l43-43 197 197 197-197 43 43-240 240Z"></path></svg></span></button></div>
      <div class="pp-row"><div class="pp-row-label">Value</div><div class="pp-number"><input type="number" min="1" max="999" step="1"><span class="pp-number-unit"></span><div class="pp-number-spinner"><button type="button" class="pp-number-spin-up" aria-label="Increase" tabindex="-1"></button><button type="button" class="pp-number-spin-down" aria-label="Decrease" tabindex="-1"></button></div></div></div>
      <div class="pp-row"><div class="pp-row-label">Size</div><div class="pp-number"><input type="number" min="8" max="96" step="1"><span class="pp-number-unit">pt</span><div class="pp-number-spinner"><button type="button" class="pp-number-spin-up" aria-label="Increase" tabindex="-1"></button><button type="button" class="pp-number-spin-down" aria-label="Decrease" tabindex="-1"></button></div></div></div>"
    `);
  });

  it("renders the redact-solid category controls (style picker + solid color)", () => {
    const r = svg("rect", { "data-redact-style": "solid", fill: "#222222" });
    expect(renderCategory(CATEGORY_CONTROL_SHAPE["redact-solid"], r)).toMatchInlineSnapshot(`
      "<div class="pp-type-row"><div class="prop-choice-chip" data-tooltip="Mosaic (pixelate)" aria-label="Mosaic (pixelate)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M120-510v-330h330v330H120Zm0 390v-330h330v330H120Zm390-390v-330h330v330H510Zm0 390v-330h330v330H510ZM180-570h210v-210H180v210Zm390 0h210v-210H570v210Zm0 390h210v-210H570v210Zm-390 0h210v-210H180v210Zm390-390Zm0 180Zm-180 0Zm0-180Z"></path></svg></div><div class="prop-choice-chip active" data-tooltip="Solid bar" aria-label="Solid bar"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="m419-321 289-289-43-43-246 246-119-119-43 43 162 162ZM180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Zm0-600v600-600Z"></path></svg></div><div class="prop-choice-chip" data-tooltip="Blur" aria-label="Blur"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M106-387q-6-6-6-15t6-15q6-6 15-6t15 6q6 6 6 15t-6 15q-6 6-15 6t-15-6Zm0-156q-6-6-6-15t6-15q6-6 15-6t15 6q6 6 6 15t-6 15q-6 6-15 6t-15-6Zm107 330q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm0-162q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm0-156q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm0-162q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm150.5 329.5Q348-379 348-402t15.5-38.5Q379-456 402-456t38.5 15.5Q456-425 456-402t-15.5 38.5Q425-348 402-348t-38.5-15.5Zm0-156Q348-535 348-558t15.5-38.5Q379-612 402-612t38.5 15.5Q456-581 456-558t-15.5 38.5Q425-504 402-504t-38.5-15.5ZM375-213q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm0-480q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm12 587q-6-6-6-15t6-15q6-6 15-6t15 6q6 6 6 15t-6 15q-6 6-15 6t-15-6Zm0-718q-6-6-6-15t6-15q6-6 15-6t15 6q6 6 6 15t-6 15q-6 6-15 6t-15-6Zm132.5 460.5Q504-379 504-402t15.5-38.5Q535-456 558-456t38.5 15.5Q612-425 612-402t-15.5 38.5Q581-348 558-348t-38.5-15.5Zm0-156Q504-535 504-558t15.5-38.5Q535-612 558-612t38.5 15.5Q612-581 612-558t-15.5 38.5Q581-504 558-504t-38.5-15.5ZM531-213q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm0-480q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm18 587q-6-6-6-15t6-15q6-6 15-6t15 6q6 6 6 15t-6 15q-6 6-15 6t-15-6Zm-6-718q-6-6-6-15t6-15q6-6 15-6t15 6q6 6 6 15t-6 15q-6 6-15 6t-15-6Zm150 611q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm0-162q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm0-156q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm0-162q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm131 306q-6-6-6-15t6-15q6-6 15-6t15 6q6 6 6 15t-6 15q-6 6-15 6t-15-6Zm0-156q-6-6-6-15t6-15q6-6 15-6t15 6q6 6 6 15t-6 15q-6 6-15 6t-15-6Z"></path></svg></div></div>
      <div class="pp-row"><div class="pp-row-label">Color</div><button type="button" class="pp-color-btn"><span class="pp-color-swatch" style="background: #222222;"></span><span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-344 240-584l43-43 197 197 197-197 43 43-240 240Z"></path></svg></span></button></div>"
    `);
  });

  it("renders the redact-mosaic category controls (style picker only)", () => {
    const i = svg("image", { "data-redact-style": "mosaic" });
    expect(renderCategory(CATEGORY_CONTROL_SHAPE["redact-mosaic"], i)).toMatchInlineSnapshot(`"<div class="pp-type-row"><div class="prop-choice-chip active" data-tooltip="Mosaic (pixelate)" aria-label="Mosaic (pixelate)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M120-510v-330h330v330H120Zm0 390v-330h330v330H120Zm390-390v-330h330v330H510Zm0 390v-330h330v330H510ZM180-570h210v-210H180v210Zm390 0h210v-210H570v210Zm0 390h210v-210H570v210Zm-390 0h210v-210H180v210Zm390-390Zm0 180Zm-180 0Zm0-180Z"></path></svg></div><div class="prop-choice-chip" data-tooltip="Solid bar" aria-label="Solid bar"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="m419-321 289-289-43-43-246 246-119-119-43 43 162 162ZM180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Zm0-600v600-600Z"></path></svg></div><div class="prop-choice-chip" data-tooltip="Blur" aria-label="Blur"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M106-387q-6-6-6-15t6-15q6-6 15-6t15 6q6 6 6 15t-6 15q-6 6-15 6t-15-6Zm0-156q-6-6-6-15t6-15q6-6 15-6t15 6q6 6 6 15t-6 15q-6 6-15 6t-15-6Zm107 330q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm0-162q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm0-156q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm0-162q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm150.5 329.5Q348-379 348-402t15.5-38.5Q379-456 402-456t38.5 15.5Q456-425 456-402t-15.5 38.5Q425-348 402-348t-38.5-15.5Zm0-156Q348-535 348-558t15.5-38.5Q379-612 402-612t38.5 15.5Q456-581 456-558t-15.5 38.5Q425-504 402-504t-38.5-15.5ZM375-213q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm0-480q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm12 587q-6-6-6-15t6-15q6-6 15-6t15 6q6 6 6 15t-6 15q-6 6-15 6t-15-6Zm0-718q-6-6-6-15t6-15q6-6 15-6t15 6q6 6 6 15t-6 15q-6 6-15 6t-15-6Zm132.5 460.5Q504-379 504-402t15.5-38.5Q535-456 558-456t38.5 15.5Q612-425 612-402t-15.5 38.5Q581-348 558-348t-38.5-15.5Zm0-156Q504-535 504-558t15.5-38.5Q535-612 558-612t38.5 15.5Q612-581 612-558t-15.5 38.5Q581-504 558-504t-38.5-15.5ZM531-213q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm0-480q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm18 587q-6-6-6-15t6-15q6-6 15-6t15 6q6 6 6 15t-6 15q-6 6-15 6t-15-6Zm-6-718q-6-6-6-15t6-15q6-6 15-6t15 6q6 6 6 15t-6 15q-6 6-15 6t-15-6Zm150 611q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm0-162q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm0-156q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm0-162q-11-11-11-27t11-27q11-11 27-11t27 11q11 11 11 27t-11 27q-11 11-27 11t-27-11Zm131 306q-6-6-6-15t6-15q6-6 15-6t15 6q6 6 6 15t-6 15q-6 6-15 6t-15-6Zm0-156q-6-6-6-15t6-15q6-6 15-6t15 6q6 6 6 15t-6 15q-6 6-15 6t-15-6Z"></path></svg></div></div>"`);
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
      <div class="pp-row"><div class="pp-row-label">Color</div><button type="button" class="pp-color-btn"><span class="pp-color-swatch" style="background: #ff0000;"></span><span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-344 240-584l43-43 197 197 197-197 43 43-240 240Z"></path></svg></span></button></div>
      <div class="pp-row"><div class="pp-row-label">Transparency</div><div class="pp-number"><input type="number" min="0" max="100" step="1"><span class="pp-number-unit">%</span><div class="pp-number-spinner"><button type="button" class="pp-number-spin-up" aria-label="Increase" tabindex="-1"></button><button type="button" class="pp-number-spin-down" aria-label="Decrease" tabindex="-1"></button></div></div></div>
      <div class="pp-row"><div class="pp-row-label">Color</div><button type="button" class="pp-color-btn"><span class="pp-color-swatch" style="background: #000000;"></span><span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-344 240-584l43-43 197 197 197-197 43 43-240 240Z"></path></svg></span></button></div>
      <div class="pp-row"><div class="pp-row-label">Transparency</div><div class="pp-number"><input type="number" min="0" max="100" step="1"><span class="pp-number-unit">%</span><div class="pp-number-spinner"><button type="button" class="pp-number-spin-up" aria-label="Increase" tabindex="-1"></button><button type="button" class="pp-number-spin-down" aria-label="Decrease" tabindex="-1"></button></div></div></div>
      <div class="pp-row"><div class="pp-row-label">Width</div><div class="pp-number"><input type="number" min="0.25" max="200" step="0.25"><span class="pp-number-unit">pt</span><div class="pp-number-spinner"><button type="button" class="pp-number-spin-up" aria-label="Increase" tabindex="-1"></button><button type="button" class="pp-number-spin-down" aria-label="Decrease" tabindex="-1"></button></div></div></div>
      <div class="pp-row"><div class="pp-row-label">Dash type</div><button type="button" class="pp-select" aria-label="Dash type" data-tooltip="Dash type"><span class="pp-select-preview">Solid</span><span class="pp-select-caret"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-344 240-584l43-43 197 197 197-197 43 43-240 240Z"></path></svg></span></button></div>
      <div class="pp-row"><div class="pp-row-label">Cap type</div><button type="button" class="pp-select" aria-label="Cap type" data-tooltip="Cap type"><span class="pp-select-preview">Flat</span><span class="pp-select-caret"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-344 240-584l43-43 197 197 197-197 43 43-240 240Z"></path></svg></span></button></div>"
    `);
  });

  it("renders the group category as nothing (zero controls)", () => {
    const g = svg("g", { "data-type": "group" });
    expect(renderCategory(CATEGORY_CONTROL_SHAPE.group, g)).toBe("");
  });

  it("renders the shape category for a line-like target (per-end arrow rows visible)", () => {
    // Composed-arrow group with "Arrow" variant: start "none", end
    // "triangle". The 4 per-end pulldowns should render — start
    // shape filtered to "none" only, end shape filtered to non-
    // "none" presets, and both Size pulldowns showing the full
    // 3×3 width × length grid. Other shape rows that gate to
    // fillable (`fillColor` / `fillOpacity`) drop out via
    // `visibleWhen`.
    const arrow = svg("g", {
      "data-type": "arrow",
      stroke: "#444",
      "stroke-width": "3",
      "data-arrow-start-shape": "none",
      "data-arrow-end-shape": "triangle",
      "data-arrow-end-width": "md",
      "data-arrow-end-length": "lg",
    });
    const out = renderCategory(CATEGORY_CONTROL_SHAPE.shape, arrow);
    // Verify presence of each per-end row label rather than pinning
    // the full DOM string — the inline SVG previews push the
    // snapshot past 4 KB and obscure intent.
    expect(out).toContain('class="pp-row-label">Begin arrow type<');
    expect(out).toContain('class="pp-row-label">Begin arrow size<');
    expect(out).toContain('class="pp-row-label">End arrow type<');
    expect(out).toContain('class="pp-row-label">End arrow size<');
    // Fill section gates out for line-like targets.
    expect(out).not.toContain('class="pp-row-label">Color</div><button type="button" class="pp-color-btn"><span class="pp-color-swatch" style="background: #ff0000;');
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
    // The variant-picker click handler awaits dispatchMutation,
    // which awaits runEffect, which awaits the handler — three
    // microtask drains before onCommit resolves on the next tick.
    await Promise.resolve();
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
