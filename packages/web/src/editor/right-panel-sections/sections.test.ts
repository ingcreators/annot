/**
 * @vitest-environment happy-dom
 *
 * Phase 3 tests for the right-panel section modules. The full
 * `EditorRightPanel` host construction requires a Toolbar +
 * PropertyPanel + CanvasManager + History + SelectionManager —
 * heavy mocks that don't add much beyond what these per-section
 * unit tests already exercise. Section-level tests cover:
 *   - `visible(ctx)` predicates against the deps closure
 *   - mount → lifecycle round-trip (function vs object shape)
 *   - dynamic title via `ctx.setTitle` from inside mount
 *   - update path re-evaluates state through the deps closure
 *
 * The section host's compose / sort / filter / dispose loop is
 * structurally identical to the drawer's (Phase 2 covered it
 * end-to-end in `file-details-drawer.test.ts`); the duplication
 * isn't worth re-asserting through a mock-heavy harness.
 */

import type { Toolbar } from "@ingcreators/annot-core";
import { describe, expect, it, vi } from "vitest";
import type { UISectionContext } from "../../app/plugin-host.js";
import { BUILTIN_RIGHT_PANEL_SECTION_IDS } from "../right-panel.js";
import { createPageElementsSection } from "./page-elements-section.js";
import { createSelectionPropertiesSection } from "./selection-properties-section.js";
import { createToolPropertiesSection } from "./tool-properties-section.js";

function fakeCtx(overrides: Partial<UISectionContext> = {}): UISectionContext {
  return {
    path: "",
    mode: "",
    tags: {},
    setTitle: () => {},
    ...overrides,
  };
}

function fakeToolbar(): Toolbar {
  // Minimal Toolbar stub — only the methods the tool-properties
  // section calls on mount / update.
  return {
    renderToolProperties: vi.fn(),
    getToolDisplayTitle: vi.fn((id: string) => `Display: ${id}`),
  } as unknown as Toolbar;
}

describe("BUILTIN_RIGHT_PANEL_SECTION_IDS", () => {
  it("lists the three built-in ids in priority order", () => {
    expect(BUILTIN_RIGHT_PANEL_SECTION_IDS).toEqual([
      "right-panel.tool-properties",
      "right-panel.selection-properties",
      "right-panel.page-elements",
    ]);
  });
});

describe("tool-properties section", () => {
  it("hides itself in Select mode (toolId === null)", () => {
    const section = createToolPropertiesSection({
      getActiveToolId: () => null,
      getToolbar: fakeToolbar,
    });
    expect(section.visible?.(fakeCtx())).toBe(false);
  });

  it("hides itself for the crop tool (no adjustable properties)", () => {
    const section = createToolPropertiesSection({
      getActiveToolId: () => "crop",
      getToolbar: fakeToolbar,
    });
    expect(section.visible?.(fakeCtx())).toBe(false);
  });

  it("renders + sets the dynamic title from the toolbar's display name on mount", () => {
    const tb = fakeToolbar();
    const section = createToolPropertiesSection({
      getActiveToolId: () => "rectangle",
      getToolbar: () => tb,
    });
    const setTitle = vi.fn();
    const container = document.createElement("div");
    const lifecycle = section.mount(container, fakeCtx({ setTitle }));
    expect(tb.renderToolProperties).toHaveBeenCalledWith("rectangle", container);
    expect(setTitle).toHaveBeenCalledWith("Display: rectangle");
    expect(typeof lifecycle).toBe("object");
  });

  it("update(ctx) re-renders with the latest active tool", () => {
    const tb = fakeToolbar();
    let activeTool: string | null = "rectangle";
    const section = createToolPropertiesSection({
      getActiveToolId: () => activeTool,
      getToolbar: () => tb,
    });
    const setTitle = vi.fn();
    const container = document.createElement("div");
    const lifecycle = section.mount(container, fakeCtx({ setTitle })) as {
      update?(ctx: UISectionContext): void;
      unmount(): void;
    };
    activeTool = "arrow";
    lifecycle.update?.(fakeCtx({ setTitle }));
    expect(tb.renderToolProperties).toHaveBeenLastCalledWith("arrow", container);
    expect(setTitle).toHaveBeenLastCalledWith("Display: arrow");
  });
});

describe("selection-properties section", () => {
  it("hides itself when selection is empty", () => {
    const section = createSelectionPropertiesSection({
      getSelection: () => [],
      getPropPanelHost: () => document.createElement("div"),
      showPropPanel: () => {},
      hidePropPanel: () => {},
      computeTitle: () => "n/a",
    });
    expect(section.visible?.(fakeCtx())).toBe(false);
  });

  it("attaches the PropPanel host on mount + computes the title", () => {
    const propPanelHost = document.createElement("div");
    propPanelHost.id = "fake-prop-panel-host";
    const sel = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    const showSpy = vi.fn();
    const hideSpy = vi.fn();
    const titleSpy = vi.fn(() => "Selected Rectangle");
    const setTitle = vi.fn();
    const section = createSelectionPropertiesSection({
      getSelection: () => [sel],
      getPropPanelHost: () => propPanelHost,
      showPropPanel: showSpy,
      hidePropPanel: hideSpy,
      computeTitle: titleSpy,
    });
    const container = document.createElement("div");
    const lifecycle = section.mount(container, fakeCtx({ setTitle })) as {
      unmount(): void;
    };
    // Host element attached to section container.
    expect(propPanelHost.parentElement).toBe(container);
    expect(showSpy).toHaveBeenCalledWith([sel]);
    expect(setTitle).toHaveBeenCalledWith("Selected Rectangle");
    // Unmount detaches the prop-panel host so the next section
    // mount can attach it cleanly.
    lifecycle.unmount();
    expect(hideSpy).toHaveBeenCalled();
    expect(propPanelHost.parentElement).not.toBe(container);
  });
});

describe("page-elements section", () => {
  // Minimal PageMetadata factory — just the fields the section
  // consults on visible() / mount().
  function pageMeta(elements: number, overrides: Record<string, unknown> = {}) {
    return {
      version: 1,
      url: "https://example.test",
      viewport: { width: 800, height: 600 },
      devicePixelRatio: 1,
      scrollOffset: { x: 0, y: 0 },
      captureRect: { x: 0, y: 0, width: 800, height: 600 },
      capturedAt: "2026-01-01T00:00:00Z",
      elements: Array.from({ length: elements }, (_, i) => ({
        id: `el-${i}`,
        tag: "button",
        text: `Button ${i}`,
        bbox: [10, 10, 100, 30] as [number, number, number, number],
        visible: true,
      })),
      ...overrides,
    } as unknown as Parameters<typeof createPageElementsSection>[0] extends {
      getPageMetadata(): infer T;
    }
      ? T
      : never;
  }

  it("hides itself when there's no metadata", () => {
    const section = createPageElementsSection({
      getPageMetadata: () => null,
      getCanvas: () => ({ svg: {} as SVGSVGElement, annotations: {} as SVGGElement }) as never,
      getHistory: () => ({ save: () => {} }) as never,
      getSelection: () => ({ select: () => {} }) as never,
    });
    expect(section.visible?.(fakeCtx())).toBe(false);
  });

  it("hides itself when the metadata has zero elements", () => {
    const section = createPageElementsSection({
      getPageMetadata: () => pageMeta(0),
      getCanvas: () => ({ svg: {} as SVGSVGElement, annotations: {} as SVGGElement }) as never,
      getHistory: () => ({ save: () => {} }) as never,
      getSelection: () => ({ select: () => {} }) as never,
    });
    expect(section.visible?.(fakeCtx())).toBe(false);
  });

  it("renders an interactive list when metadata carries elements", () => {
    const section = createPageElementsSection({
      getPageMetadata: () => pageMeta(3),
      getCanvas: () => ({ svg: {} as SVGSVGElement, annotations: {} as SVGGElement }) as never,
      getHistory: () => ({ save: () => {} }) as never,
      getSelection: () => ({ select: () => {} }) as never,
    });
    expect(section.visible?.(fakeCtx())).toBe(true);
    const container = document.createElement("div");
    section.mount(container, fakeCtx());
    // Three element rows + the search input + the hint paragraph.
    expect(container.querySelectorAll(".editor-right-panel-element-row").length).toBe(3);
    expect(container.querySelector("input[type=search]")).not.toBeNull();
  });
});
