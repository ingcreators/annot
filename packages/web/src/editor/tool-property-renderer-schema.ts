/**
 * Schema-driven Tool-side property panel renderer. Phase 2 of
 * `docs/plans/tool-property-renderer-schema.md` — lands alongside
 * the imperative `tool-property-renderer.ts` so the two surfaces can
 * be diffed via happy-dom golden snapshots before Phase 3 swaps the
 * live callsite over.
 *
 * Inputs:
 *   - `TOOL_REGISTRY[toolId].panelControls` (Tier B, lives in
 *     `@ingcreators/annot-core`) supplies the per-tool control list
 *     + section grouping.
 *   - `TOOL_PANEL_ADAPTERS` (also Tier B) supplies the
 *     `(preset, value, toolId) => void` mutation routed by each
 *     control id.
 *
 * Outputs (DOM byte-equivalent to the imperative renderer):
 *   - One `pp-section` per consecutive run of entries with the same
 *     `section`, in the order encoded by the registry array.
 *   - Per-control rows constructed via the same shared primitives
 *     the imperative renderer uses (`createColorPullButton`,
 *     `createNumberInput`, `createCustomSelect`, etc.) so the
 *     resulting class names + attribute shapes match exactly.
 *   - Type chip row: standard `prop-choice-chip` icon/svg chips for
 *     most tools; `pp-color-chip` swatches for Highlight (matches
 *     the imperative's per-tool branching).
 *   - Freehand: `pp-done-row` button appended to `menu` AFTER all
 *     pp-sections, NOT inside one (matches the imperative output).
 *
 * Per-(toolId, id) metadata (number-input min/max/step, color
 * fallbacks, dash/cap/font option lists) is HARDCODED here in
 * Phase 2. Phase 4 of the plan replaces those tables with reads
 * against `PROPERTY_CONTROLS` + `selectionDef`-keyed metadata so a
 * UX edit becomes one entry in the SELECTION registry that flows
 * through to both surfaces. Phase 2 deliberately keeps the scope
 * small: data-driven dispatch + behaviour-preserving rendering.
 */

import {
  HIGHLIGHT_COLORS,
  PROPERTY_CONTROL_IDS,
  TOOL_REGISTRY,
  type ToolPanelAdapterId,
  type ToolPanelControlDef,
  type ToolPanelSection,
} from "@ingcreators/annot-core/editor";
import type { CanvasManager } from "@ingcreators/annot-editor";
import type {
  ArrowDim,
  ArrowShape,
  LineCap,
  ToolOptions,
} from "@ingcreators/annot-core/editor/tool-options";
import { computeDasharray } from "@ingcreators/annot-core/utils";
import { createCustomSelect } from "@ingcreators/annot-editor/custom-select";
import { setTooltip } from "@ingcreators/annot-editor/tooltip";
import {
  createArrowEndsRows,
  createColorPullButton,
  createNumberInput,
  createPropertyRow,
  createPropertySection,
} from "@ingcreators/annot-editor/property-controls";
import type { FreehandTool } from "@ingcreators/annot-editor/tools/freehand-tool";

// ─── Public surface ──────────────────────────────────────────────────

/**
 * Hooks the renderer needs from the owning toolbar — narrowed copy
 * of the imperative renderer's context type so callers can swap
 * between the two without changing the call shape.
 */
export interface ToolPropertyRendererContext {
  /** Active editor canvas. Used by the freehand "Done drawing"
   *  button to commit the active drawing session. */
  canvas: CanvasManager;
  /** Live `ToolOptions` reference owned by the toolbar. Mutated in
   *  place after each control commit so the active tool picks up
   *  preset changes on the next pointer event. */
  options: ToolOptions;
  /** Read the current preset (variant-keyed) for `toolId`. */
  getCurrentPreset: (toolId: string) => ToolOptions;
  /** Persist a preset back into the toolbar's preset map. */
  saveCurrentPreset: (toolId: string, preset: ToolOptions) => void;
  /** Switch the variant for `toolId`. The toolbar handles seeding
   *  the new preset, syncing the badge, and re-rendering the panel. */
  handlePanelVariantChange: (toolId: string, value: string, preset: ToolOptions) => void;
}

/**
 * Render the per-tool properties panel into `menu` from the
 * declarative `TOOL_REGISTRY[toolId].panelControls` array. Caller is
 * responsible for clearing `menu` between invocations.
 *
 * Tools without `panelControls` (currently only `crop`, which has a
 * transient overlay rather than a persistent side panel) leave the
 * menu empty. Tools whose registry exists but lists an empty array
 * also produce an empty render — consistent with "panelControls is
 * the source of truth for the side panel".
 */
export function populateToolPropertyPanelFromRegistry(
  toolId: string,
  menu: HTMLElement,
  ctx: ToolPropertyRendererContext,
): void {
  const meta = TOOL_REGISTRY[toolId];
  if (!meta?.panelControls) return;
  const preset = ctx.getCurrentPreset(toolId);

  // Seed the variant field if a Type chip row is the first control
  // and the preset doesn't carry one yet. Mirrors the imperative
  // renderer's `if (!preset.drawStyle) preset.drawStyle = "pen"` /
  // `if (!preset.shapeType) preset.shapeType = "rect"` etc. — without
  // this the chip row would render with NO active chip on first use.
  seedDefaultVariantIfNeeded(toolId, meta.variantField, meta.defaultVariant, preset);

  const sync = (): void => {
    ctx.saveCurrentPreset(toolId, preset);
    Object.assign(ctx.options, preset);
  };

  // Filter visible controls against the current preset (e.g. Redact
  // Fill row hides unless redactStyle === "solid").
  const visible = meta.panelControls.filter(
    (c) => !c.visibleWhen || c.visibleWhen(preset),
  );

  // Group by section, preserving array order. Consecutive entries
  // with the same section share one `pp-section`.
  const sections: Array<[ToolPanelSection, ToolPanelControlDef[]]> = [];
  const sectionIndex = new Map<ToolPanelSection, number>();
  for (const def of visible) {
    if (isMenuLevelToolId(def.id)) continue; // rendered after sections
    const existing = sectionIndex.get(def.section);
    if (existing == null) {
      sectionIndex.set(def.section, sections.length);
      sections.push([def.section, [def]]);
    } else {
      sections[existing]![1].push(def);
    }
  }

  // Render each section.
  for (const [name, controls] of sections) {
    const { section, body } = createPropertySection(name);
    renderControlsIntoBody(toolId, controls, preset, body, ctx, sync);
    menu.appendChild(section);
  }

  // Render menu-level extras (currently only `tool.freehandDone`)
  // AFTER sections, matching the imperative renderer's ordering.
  for (const def of visible) {
    if (!isMenuLevelToolId(def.id)) continue;
    const node = renderMenuLevelControl(toolId, def.id, ctx);
    if (node) menu.appendChild(node);
  }

  // Initial persist — matches the imperative tail's
  // `ctx.saveCurrentPreset + Object.assign`.
  sync();
}

// ─── Section body rendering ──────────────────────────────────────────

/** Ids that are rendered OUTSIDE any pp-section, directly on `menu`.
 *  Currently just the freehand "Done drawing" button. */
function isMenuLevelToolId(id: ToolPanelAdapterId): boolean {
  return id === "tool.freehandDone";
}

/** Set of arrow per-end pulldown ids. The imperative renderer batches
 *  all four into one `createArrowEndsRows` call (a single widget
 *  producing 4 rows of Begin Type / Begin Size / End Type / End
 *  Size). For byte-equivalent DOM, the schema renderer detects the
 *  full set in a section and dispatches to the SAME helper instead
 *  of rendering each id as its own row. */
const ARROW_PER_END_IDS: ReadonlySet<ToolPanelAdapterId> = new Set([
  PROPERTY_CONTROL_IDS.arrowStartShape,
  PROPERTY_CONTROL_IDS.arrowStartSize,
  PROPERTY_CONTROL_IDS.arrowEndShape,
  PROPERTY_CONTROL_IDS.arrowEndSize,
]);

function renderControlsIntoBody(
  toolId: string,
  controls: ToolPanelControlDef[],
  preset: ToolOptions,
  body: HTMLElement,
  ctx: ToolPropertyRendererContext,
  sync: () => void,
): void {
  // Detect a complete arrow-per-end group — render via
  // createArrowEndsRows, then drop the four ids from the per-id
  // dispatch loop below so they aren't double-rendered.
  const arrowGroupIds = new Set<ToolPanelAdapterId>();
  for (const def of controls) {
    if (ARROW_PER_END_IDS.has(def.id)) arrowGroupIds.add(def.id);
  }
  const hasFullArrowGroup = arrowGroupIds.size === ARROW_PER_END_IDS.size;

  for (const def of controls) {
    if (hasFullArrowGroup && ARROW_PER_END_IDS.has(def.id)) {
      // Render the whole group on the FIRST encounter; skip the
      // remaining three so we emit createArrowEndsRows exactly once.
      if (def.id !== PROPERTY_CONTROL_IDS.arrowStartShape) continue;
      renderArrowEndsRows(body, preset, sync);
      continue;
    }
    const node = renderPerIdControl(toolId, def.id, preset, ctx, sync);
    if (node) body.appendChild(node);
  }
}

// ─── Per-id rendering ────────────────────────────────────────────────

function renderPerIdControl(
  toolId: string,
  id: ToolPanelAdapterId,
  preset: ToolOptions,
  ctx: ToolPropertyRendererContext,
  sync: () => void,
): HTMLElement | null {
  switch (id) {
    case "tool.typeChips":
      return renderTypeChipsRow(toolId, preset, ctx);
    case "tool.transparencyPercent":
      return renderTransparencyPercent(preset, sync);
    case "tool.fillTransparencyPercent":
      return renderFillTransparencyPercent(preset, sync);
    case "tool.fillOpacityPercent":
      return renderFillOpacityPercent(preset, sync);
    case "tool.freehandDone":
      // Menu-level — handled separately, never reaches here.
      return null;
    case PROPERTY_CONTROL_IDS.strokeColor:
      return renderStrokeColorRow(toolId, preset, sync);
    case PROPERTY_CONTROL_IDS.strokeWidth:
      return renderStrokeWidthRow(toolId, preset, sync);
    case PROPERTY_CONTROL_IDS.strokeStyle:
      return renderDashTypeRow(preset, sync);
    case PROPERTY_CONTROL_IDS.strokeLinecap:
      return renderCapTypeRow(preset, sync);
    case PROPERTY_CONTROL_IDS.fillColor:
      return renderFillColorRow(toolId, preset, sync);
    case PROPERTY_CONTROL_IDS.fontSize:
      return renderFontSizeRow(toolId, preset, sync);
    case PROPERTY_CONTROL_IDS.fontFamily:
      return renderFontFamilyRow(preset, sync);
    default:
      // Per-end arrow ids reach here only when the section doesn't
      // have the full 4-id group — which the registry today never
      // produces, but render a defensive null so a malformed
      // registry edit surfaces in tests rather than throwing.
      return null;
  }
}

function renderMenuLevelControl(
  toolId: string,
  id: ToolPanelAdapterId,
  ctx: ToolPropertyRendererContext,
): HTMLElement | null {
  // Currently only freehandDone — kept as a switch so adding a new
  // menu-level id is a one-line edit here.
  if (id === "tool.freehandDone" && toolId === "freehand") {
    return renderFreehandDoneRow(ctx);
  }
  return null;
}

// ─── Type chip row ───────────────────────────────────────────────────

/** Per-tool tooltip overrides that preserve the imperative renderer's
 *  hardcoded labels. Two registry variants today carry more
 *  descriptive labels than the imperative tool panel uses — keeping
 *  the imperative wording is what the Phase 2 byte-equivalence
 *  contract requires.
 *
 *  Phase 5 cleanup will DROP this table and accept the registry's
 *  labels as the canonical source of truth (a deliberate UX
 *  improvement: "Rounded" → "Rounded rectangle", "Line" → "Line (no
 *  arrow)" — small wording fixes that bring the right-panel chip
 *  tooltips in line with the toolbar flyout, which already uses
 *  the registry labels). */
const TYPE_CHIP_TOOLTIP_OVERRIDES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  arrow: {
    none: "Line",
  },
  shape: {
    rounded: "Rounded",
  },
};

function renderTypeChipsRow(
  toolId: string,
  preset: ToolOptions,
  ctx: ToolPropertyRendererContext,
): HTMLElement | null {
  const meta = TOOL_REGISTRY[toolId];
  if (!meta?.variantField) return null;

  // Highlight uses color-swatch chips driven by HIGHLIGHT_COLORS
  // (the variants list maps from the same source but loses the
  // swatch info); every other tool uses regular icon/svg chips
  // driven by `meta.variants`.
  if (toolId === "highlight") return renderHighlightTypeChipsRow(preset, ctx);

  const current = preset[meta.variantField];
  const overrides = TYPE_CHIP_TOOLTIP_OVERRIDES[toolId] ?? {};
  const row = document.createElement("div");
  row.className = "pp-type-row";
  for (const opt of meta.variants ?? []) {
    const chip = document.createElement("div");
    const useSvg = !!opt.svg;
    const isActive = current === opt.value;
    chip.className =
      `prop-choice-chip${useSvg ? "" : " material-symbols-outlined"}${
        isActive ? " active" : ""
      }`;
    if (useSvg) {
      chip.innerHTML = opt.svg!;
    } else {
      chip.textContent = opt.icon;
    }
    setTooltip(chip, overrides[opt.value] ?? opt.label);
    chip.addEventListener("click", () => {
      row.querySelectorAll(".prop-choice-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      ctx.handlePanelVariantChange(toolId, opt.value, preset);
    });
    row.appendChild(chip);
  }
  // The chip row goes under the "Type" pp-section directly — return
  // the row, the caller appends it to the section body.
  return row;
}

function renderHighlightTypeChipsRow(
  preset: ToolOptions,
  ctx: ToolPropertyRendererContext,
): HTMLElement {
  const fallback = HIGHLIGHT_COLORS[0]!.value;
  const currentColor = (preset.highlightColor || fallback).toLowerCase();
  const row = document.createElement("div");
  row.className = "pp-type-row";
  for (const opt of HIGHLIGHT_COLORS) {
    const chip = document.createElement("div");
    chip.className = `prop-choice-chip pp-color-chip${
      currentColor === opt.value ? " active" : ""
    }`;
    chip.style.setProperty("--swatch-color", opt.value);
    setTooltip(chip, opt.label);
    chip.addEventListener("click", () => {
      row.querySelectorAll(".prop-choice-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      ctx.handlePanelVariantChange("highlight", opt.value, preset);
    });
    row.appendChild(chip);
  }
  return row;
}

// ─── Transparency / opacity number rows ──────────────────────────────

function renderTransparencyPercent(preset: ToolOptions, sync: () => void): HTMLElement {
  return createPropertyRow(
    "Transparency",
    createNumberInput({
      current: Math.round((1 - (preset.strokeOpacity ?? 1)) * 100),
      unit: "%",
      min: 0,
      max: 100,
      step: 1,
      onChange: (v) => {
        preset.strokeOpacity = 1 - v / 100;
        sync();
      },
    }),
  );
}

function renderFillTransparencyPercent(preset: ToolOptions, sync: () => void): HTMLElement {
  return createPropertyRow(
    "Transparency",
    createNumberInput({
      current: Math.round((1 - (preset.fillOpacity ?? 0.4)) * 100),
      unit: "%",
      min: 0,
      max: 100,
      step: 5,
      onChange: (v) => {
        preset.fillOpacity = 1 - v / 100;
        sync();
      },
    }),
  );
}

function renderFillOpacityPercent(preset: ToolOptions, sync: () => void): HTMLElement {
  return createPropertyRow(
    "Opacity",
    createNumberInput({
      current: Math.round((preset.fillOpacity ?? 1) * 100),
      unit: "%",
      min: 0,
      max: 100,
      step: 5,
      onChange: (v) => {
        preset.fillOpacity = v / 100;
        sync();
      },
    }),
  );
}

// ─── Freehand "Done drawing" button ──────────────────────────────────

function renderFreehandDoneRow(ctx: ToolPropertyRendererContext): HTMLElement {
  const doneRow = document.createElement("div");
  doneRow.className = "pp-done-row";
  const doneBtn = document.createElement("button");
  doneBtn.type = "button";
  doneBtn.className = "pp-done-btn";
  doneBtn.textContent = "Done drawing";
  setTooltip(doneBtn, "Finish the current drawing (Esc)");
  doneBtn.addEventListener("click", () => {
    const active = ctx.canvas.activeTool;
    if (active && active.name === "freehand") {
      (active as FreehandTool).endSession();
    }
  });
  doneRow.appendChild(doneBtn);
  return doneRow;
}

// ─── SELECTION-side ids ──────────────────────────────────────────────

function renderStrokeColorRow(
  toolId: string,
  preset: ToolOptions,
  sync: () => void,
): HTMLElement {
  // Marker's Line > Color falls back to white when strokeColor is
  // empty; every other tool uses the literal preset value. Matches
  // the imperative `preset.strokeColor || "#ffffff"` for marker,
  // `preset.strokeColor` everywhere else.
  const initial = toolId === "marker" ? preset.strokeColor || "#ffffff" : preset.strokeColor;
  const btn = createColorPullButton(initial, (color) => {
    preset.strokeColor = color;
    sync();
  });
  return createPropertyRow("Color", btn);
}

function renderStrokeWidthRow(
  toolId: string,
  preset: ToolOptions,
  sync: () => void,
): HTMLElement {
  // Marker's Line > Width allows 0 (matches the imperative's
  // `min: 0, max: 20`); every stroke-bearing tool else uses
  // `min: 0.25, max: 40`. Step = 0.25, unit = "pt" everywhere.
  const isMarker = toolId === "marker";
  const min = isMarker ? 0 : 0.25;
  const max = isMarker ? 20 : 40;
  const initial = isMarker ? preset.strokeWidth ?? 1.5 : preset.strokeWidth;
  return createPropertyRow(
    "Width",
    createNumberInput({
      current: initial,
      unit: "pt",
      min,
      max,
      step: 0.25,
      onChange: (v) => {
        preset.strokeWidth = v;
        sync();
      },
    }),
  );
}

function renderDashTypeRow(preset: ToolOptions, sync: () => void): HTMLElement {
  return createPropertyRow(
    "Dash type",
    createCustomSelect({
      options: [
        { value: "", label: "Solid", preview: dashPreview("") },
        { value: "dash", label: "Dashed", preview: dashPreview("dash") },
        { value: "dot", label: "Dotted", preview: dashPreview("dot") },
        { value: "dashDot", label: "Dash-Dot", preview: dashPreview("dashDot") },
        { value: "lgDash", label: "Long Dash", preview: dashPreview("lgDash") },
      ],
      current: preset.strokeDasharray ?? "",
      ariaLabel: "Dash type",
      onChange: (v) => {
        preset.strokeDasharray = v;
        sync();
      },
    }),
  );
}

function renderCapTypeRow(preset: ToolOptions, sync: () => void): HTMLElement {
  return createPropertyRow(
    "Cap type",
    createCustomSelect({
      options: [
        { value: "square", label: "Square", preview: capPreview("square") },
        { value: "round", label: "Round", preview: capPreview("round") },
        { value: "butt", label: "Flat", preview: capPreview("butt") },
      ],
      current: preset.strokeLinecap ?? "butt",
      ariaLabel: "Cap type",
      onChange: (v) => {
        preset.strokeLinecap = v as LineCap;
        sync();
      },
    }),
  );
}

function renderFillColorRow(
  toolId: string,
  preset: ToolOptions,
  sync: () => void,
): HTMLElement {
  // Per-tool fallbacks match the imperative renderer:
  //   marker:  preset.fillColor ?? "#ff0000"        (allowNone)
  //   shape:   "none" → "#ffffff", else preset      (allowNone)
  //   redact:  "none" → "#111111", else preset      (no allowNone)
  // Label varies too: marker / redact use "Color"; shape uses "Fill".
  let initial: string;
  let allowNone: boolean;
  let label: string;
  switch (toolId) {
    case "marker":
      initial = preset.fillColor ?? "#ff0000";
      allowNone = true;
      label = "Color";
      break;
    case "shape":
      initial = preset.fillColor === "none" ? "#ffffff" : preset.fillColor;
      allowNone = true;
      label = "Fill";
      break;
    case "redact":
      initial = preset.fillColor === "none" ? "#111111" : preset.fillColor;
      allowNone = false;
      label = "Color";
      break;
    default:
      initial = preset.fillColor;
      allowNone = false;
      label = "Color";
      break;
  }
  const btn = createColorPullButton(
    initial,
    (color) => {
      preset.fillColor = color;
      sync();
    },
    { allowNone },
  );
  return createPropertyRow(label, btn);
}

function renderFontSizeRow(
  toolId: string,
  preset: ToolOptions,
  sync: () => void,
): HTMLElement {
  // Text > Line > Size: 8..96. Marker > Label > Size: 8..48. Step 1.
  const max = toolId === "marker" ? 48 : 96;
  return createPropertyRow(
    "Size",
    createNumberInput({
      current: preset.fontSize,
      unit: "pt",
      min: 8,
      max,
      step: 1,
      onChange: (v) => {
        preset.fontSize = v;
        sync();
      },
    }),
  );
}

function renderFontFamilyRow(preset: ToolOptions, sync: () => void): HTMLElement {
  // Standard 4-option set. Phase 4 will read this from
  // PROPERTY_CONTROLS.fontFamily.options.
  if (!preset.fontFamily) preset.fontFamily = "sans-serif";
  return createPropertyRow(
    "Font",
    createCustomSelect({
      options: [
        { value: "sans-serif", label: "Sans-serif" },
        { value: "serif", label: "Serif" },
        { value: "monospace", label: "Monospace" },
        { value: "system-ui, -apple-system, sans-serif", label: "System UI" },
      ],
      current: preset.fontFamily,
      ariaLabel: "Font",
      onChange: (v) => {
        preset.fontFamily = v;
        sync();
      },
    }),
  );
}

// ─── Arrow per-end group ─────────────────────────────────────────────

function renderArrowEndsRows(body: HTMLElement, preset: ToolOptions, sync: () => void): void {
  // Same 4-row widget the imperative arrow renderer used. Per-end
  // shape / width / length are all preserved when the user picks a
  // different begin / end variant — `createArrowEndsRows` clamps
  // them internally based on the current line variant.
  createArrowEndsRows(
    body,
    {
      start: {
        shape: (preset.arrowHeadStart ?? "none") as ArrowShape,
        width: (preset.arrowWidthStart ?? "md") as ArrowDim,
        length: (preset.arrowLengthStart ?? "md") as ArrowDim,
      },
      end: {
        shape: (preset.arrowHeadEnd ?? "triangle") as ArrowShape,
        width: (preset.arrowWidthEnd ?? "md") as ArrowDim,
        length: (preset.arrowLengthEnd ?? "md") as ArrowDim,
      },
    },
    (next) => {
      preset.arrowHeadStart = next.start.shape;
      preset.arrowHeadEnd = next.end.shape;
      preset.arrowWidthStart = next.start.width;
      preset.arrowWidthEnd = next.end.width;
      preset.arrowLengthStart = next.start.length;
      preset.arrowLengthEnd = next.end.length;
      sync();
    },
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Ensure `preset[variantField]` is set before rendering the Type
 *  chip row — otherwise no chip would highlight on first launch. */
function seedDefaultVariantIfNeeded(
  toolId: string,
  variantField: keyof ToolOptions | undefined,
  defaultVariant: string | undefined,
  preset: ToolOptions,
): void {
  if (!variantField || !defaultVariant) return;
  const cur = preset[variantField];
  if (cur != null && cur !== "") return;
  // Same dynamic-dispatch trick the `tool.typeChips` adapter uses —
  // see the `tool-panel-adapter.ts` doc for why it's safe.
  void toolId;
  (preset as unknown as Record<string, unknown>)[variantField as string] = defaultVariant;
}

/** SVG preview for a dash-style dropdown row — same markup the
 *  imperative renderer + selection panel emit. */
function dashPreview(key: string): string {
  const da = computeDasharray(key, 1.5);
  const daAttr = da ? ` stroke-dasharray="${da}"` : "";
  return `<svg width="60" height="10" viewBox="0 0 60 10"><line x1="2" y1="5" x2="58" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"${daAttr}/></svg>`;
}

/** SVG preview for a stroke-linecap dropdown row. */
function capPreview(cap: LineCap): string {
  return `<svg width="32" height="12" viewBox="0 0 32 12"><line x1="4" y1="6" x2="28" y2="6" stroke="currentColor" stroke-width="4" stroke-linecap="${cap}"/></svg>`;
}
