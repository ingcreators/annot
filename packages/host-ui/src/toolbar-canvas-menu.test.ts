/**
 * @vitest-environment happy-dom
 *
 * Canvas right-click toolbox menu — order + divider placement.
 *
 * Pins the three-section layout the toolbox menu produces:
 *
 *   1. Host extras (Scratchpad, …)
 *   2. Annotation tools (Arrow / Shape / Highlight / Text / Draw /
 *      Counter / Redact)
 *   3. Image-op tools (Crop) — destructive bitmap operations
 *
 * with a separator above sections 2 and 3 (when they're not the
 * first non-empty section). Mirrors the toolbar's left-to-right
 * grouping introduced alongside this test, so a regression in
 * either surface — e.g. accidentally re-grouping Crop with the
 * annotation tools, or stripping the divider above Scratchpad's
 * neighbour — surfaces immediately.
 */

import { TOOL_REGISTRY } from "@ingcreators/annot-core/editor";
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import type { CanvasMenuItem } from "@ingcreators/annot-editor/canvas-context-menu";
import { describe, expect, it, vi } from "vitest";

const openCanvasContextMenuMock = vi.fn();

vi.mock("@ingcreators/annot-editor/canvas-context-menu", () => ({
  openCanvasContextMenu: (opts: { items: CanvasMenuItem[] }) => {
    openCanvasContextMenuMock(opts);
  },
}));

import type { ToolDef } from "./tool-factories.js";
import {
  openCanvasRightClickMenu,
  type ToolbarCanvasMenuContext,
  type ToolbarExtraToolEntry,
} from "./toolbar-canvas-menu.js";

function emptyPreset(): ToolOptions {
  return {
    strokeColor: "#000",
    fillColor: "#fff",
    strokeWidth: 1,
    fontSize: 12,
    strokeDasharray: "",
    fillOpacity: 1,
  };
}

/** Build a `ctx.tools` map mirroring the live registry's order
 *  (which is what `Toolbar.#registerTools` produces — `Object.keys`
 *  preserves insertion order, and `TOOL_FACTORIES` covers all 8
 *  ids today). The factory is a no-op stub since the toolbox menu
 *  only ever invokes the activator hook, not the factory. */
function buildToolsMap(): Map<string, ToolDef> {
  const tools = new Map<string, ToolDef>();
  for (const id of Object.keys(TOOL_REGISTRY)) {
    const meta = TOOL_REGISTRY[id]!;
    tools.set(id, {
      label: meta.label,
      icon: meta.icon,
      factory: () => ({ activate: () => {}, deactivate: () => {} }) as never,
    });
  }
  return tools;
}

function buildCtx(extras: ToolbarExtraToolEntry[] = []): ToolbarCanvasMenuContext {
  return {
    canvas: { annotations: document.createElement("div") } as never,
    selection: {
      selectedElements: [] as SVGElement[],
      select: () => {},
    } as never,
    history: {} as never,
    tools: buildToolsMap(),
    extraTools: extras,
    getCurrentPreset: () => emptyPreset(),
    activateToolWithVariant: () => {},
  };
}

/** Fire a right-click on a non-annotation target so the toolbox
 *  menu (not the selection menu) opens. happy-dom doesn't dispatch
 *  through `MouseEvent`'s `target` field by default; pass it via
 *  `dispatchEvent` on a synthetic node we own. */
function dispatchToolboxRightClick(ctx: ToolbarCanvasMenuContext): CanvasMenuItem[] {
  openCanvasContextMenuMock.mockClear();
  const ev = new MouseEvent("contextmenu", { clientX: 50, clientY: 80 });
  // Right-click target: a node that is NOT under
  // `ctx.canvas.annotations`, so the entry-point helper routes to
  // `openToolboxMenu` instead of `openSelectionMenu`.
  const stray = document.createElement("div");
  Object.defineProperty(ev, "target", { value: stray, configurable: true });
  const pt = { x: 0, y: 0 } as DOMPoint;
  openCanvasRightClickMenu(ev, pt, ctx);
  expect(openCanvasContextMenuMock).toHaveBeenCalledTimes(1);
  return openCanvasContextMenuMock.mock.calls[0]![0].items as CanvasMenuItem[];
}

describe("openToolboxMenu — three-section layout", () => {
  const ANNOTATION_LABELS = ["Line", "Shape", "Highlight", "Text", "Draw", "Counter", "Redact"];
  const IMAGE_OP_LABELS = ["Crop"];

  it("with extras: extras → divider → annotation tools → divider → image-op tools", () => {
    const ctx = buildCtx([
      {
        id: "scratchpad",
        icon: "collections_bookmark",
        label: "Scratchpad",
        invoke: () => {},
      },
    ]);
    const items = dispatchToolboxRightClick(ctx);
    const labels = items.map((it) => it.label);
    expect(labels).toEqual(["Scratchpad", ...ANNOTATION_LABELS, ...IMAGE_OP_LABELS]);

    // Separators: above the first annotation tool (because extras
    // rendered above it) AND above the first image-op tool.
    const sepIndices = items
      .map((it, idx) => (it.separatorAbove ? idx : -1))
      .filter((idx) => idx !== -1);
    expect(sepIndices).toEqual([labels.indexOf("Line"), labels.indexOf("Crop")]);
  });

  it("without extras: annotation tools → divider → image-op tools (no leading divider)", () => {
    const items = dispatchToolboxRightClick(buildCtx([]));
    const labels = items.map((it) => it.label);
    expect(labels).toEqual([...ANNOTATION_LABELS, ...IMAGE_OP_LABELS]);

    const sepIndices = items
      .map((it, idx) => (it.separatorAbove ? idx : -1))
      .filter((idx) => idx !== -1);
    expect(sepIndices).toEqual([labels.indexOf("Crop")]);
  });

  it("Crop renders as a plain leaf row (no submenu, no badge)", () => {
    const items = dispatchToolboxRightClick(buildCtx([]));
    const crop = items.find((it) => it.label === "Crop")!;
    expect(crop).toBeDefined();
    expect(crop.submenu).toBeUndefined();
    expect(crop.badge).toBeUndefined();
  });
});
