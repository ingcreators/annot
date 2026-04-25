/**
 * @vitest-environment happy-dom
 *
 * `<annot-toolbar-button>` regression test for the synchronous
 * `getButton()` contract.
 *
 * Phase 5b moved the toolbar's per-tool button into a Lit element
 * but kept the imperative wiring path in `Toolbar.#render`: the
 * Toolbar class queries `el.getButton()` immediately after
 * `document.createElement` + `shell.appendChild(...)` to attach
 * click handlers and store inner-button refs. Lit's first render
 * is microtask-scheduled, so the inner button doesn't exist yet —
 * `getButton()` returned null, the `!` non-null assertion at the
 * call site silently lied, and `addEventListener` on null threw,
 * breaking the editor's header + sidebar + toolbar build.
 *
 * The fix has `getButton()` flush a synchronous render via
 * `performUpdate()` when the button hasn't been rendered yet.
 * This test asserts the inner button is queryable IMMEDIATELY
 * after `appendChild`, before any microtask boundary.
 */

import { describe, expect, it } from "vitest";
import "./annot-toolbar.js";

describe("<annot-toolbar-button> — synchronous getButton() contract", () => {
  it("returns the inner button immediately after appendChild (no microtask wait)", () => {
    const el = document.createElement("annot-toolbar-button");
    el.icon = "shapes";
    el.tooltip = "Shape";
    el.dataTool = "shape";
    document.body.appendChild(el);

    // Pre-fix this returned `null` because Lit's first render
    // happens on the next microtask. Post-fix `getButton()` calls
    // `performUpdate()` to flush the pending render synchronously
    // when the inner button isn't found.
    const btn = el.getButton();
    expect(btn).not.toBeNull();
    expect(btn?.classList.contains("toolbar-btn")).toBe(true);
    expect(btn?.dataset["tool"]).toBe("shape");
    expect(btn?.getAttribute("aria-label")).toBe("Shape");
    expect(btn?.textContent?.trim()).toBe("shapes");

    el.remove();
  });

  it("returns the SAME inner button on repeated calls (no DOM churn)", () => {
    const el = document.createElement("annot-toolbar-button");
    el.icon = "north_east";
    el.tooltip = "Arrow";
    document.body.appendChild(el);

    const first = el.getButton();
    const second = el.getButton();
    expect(first).toBe(second);

    el.remove();
  });

  it("reflects reactive `active` updates onto the inner button class", async () => {
    const el = document.createElement("annot-toolbar-button");
    el.icon = "shapes";
    el.tooltip = "Shape";
    document.body.appendChild(el);

    const btn = el.getButton();
    expect(btn?.classList.contains("active")).toBe(false);
    el.active = true;
    await el.updateComplete;
    expect(btn?.classList.contains("active")).toBe(true);

    el.remove();
  });
});
