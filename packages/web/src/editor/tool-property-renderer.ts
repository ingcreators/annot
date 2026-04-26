/**
 * Tool-properties side-panel renderer for the editor toolbar. This
 * module owns the layout / DOM construction of the per-tool panel
 * (Type / Fill / Line / Label sections, color pull-buttons, number
 * inputs, dash-style selects, etc.) but does NOT own preset state —
 * the calling toolbar passes in the small set of state operations
 * the renderer needs as a `ToolPropertyRendererContext`.
 *
 * Extracted from `toolbar.ts` as Stage 3a-2 of
 * `docs/plans/pre-release-cleanup.md` to start whittling that file
 * down from its god-module shape. The context-object pattern keeps
 * preset state private to the toolbar while letting the renderer
 * stay a self-contained pure-ish function (all DOM access, no
 * cross-method `this.#` coupling).
 */

import {
  ARROW_ICON_SVG,
  COUNTER_ICON_SVG,
  HIGHLIGHT_COLORS,
  SHAPE_ICON_SVG,
} from "@ingcreators/annot-core/editor";
import type { CanvasManager } from "@ingcreators/annot-editor";
import type {
  ArrowDim,
  ArrowShape,
  LineCap,
  MarkerShape,
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

/**
 * Hooks the renderer needs from the owning toolbar. Kept narrow so
 * the renderer stays decoupled from `Toolbar`'s private state shape;
 * a future refactor can swap the toolbar for any host that supplies
 * this same handful of primitives.
 */
export interface ToolPropertyRendererContext {
  /** Active editor canvas. Used by the "Done drawing" button to
   *  commit the freehand session. */
  canvas: CanvasManager;
  /** Live `ToolOptions` reference owned by the toolbar. The renderer
   *  `Object.assign`s mutated preset values into this so the active
   *  tool picks them up on the next pointer event (without it, an
   *  in-flight FreehandTool keeps drawing with the OLD color even
   *  after the user picks a new one in the panel). */
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
 * Render the per-tool properties panel into `menu`. Caller is
 * responsible for clearing `menu` between invocations.
 *
 * Changes persist to the in-memory preset map immediately; disk
 * flush happens either via the popover close handler (horizontal
 * mode) or when the host decides (e.g. when switching tools).
 */
export function populateToolPropertyPanel(
  toolId: string,
  menu: HTMLElement,
  ctx: ToolPropertyRendererContext,
): void {
  const preset = ctx.getCurrentPreset(toolId);
  const isText = toolId === "text";
  const isMarker = toolId === "marker";
  const isShape = toolId === "shape";
  const isArrow = toolId === "arrow";
  const isFreehand = toolId === "freehand";
  const isRedact = toolId === "redact";
  const isHighlight = toolId === "highlight";

  // --- Local helpers (close over preset + toolId) ------------------

  /** Chip-row variant picker wrapped in a "Type" pp-section. Each
   *  chip's click routes through ctx.handlePanelVariantChange so the
   *  switch/save/seed logic matches the toolbar flyout's behavior. */
  const addTypeRow = (
    options: Array<{ value: string; icon?: string; svg?: string; label: string }>,
    current: string,
  ): void => {
    const { section, body } = createPropertySection("Type");
    const row = document.createElement("div");
    row.className = "pp-type-row";
    for (const opt of options) {
      const chip = document.createElement("div");
      chip.className = `prop-choice-chip${opt.svg ? "" : " material-symbols-outlined"}${current === opt.value ? " active" : ""}`;
      if (opt.svg) {
        chip.innerHTML = opt.svg;
      } else if (opt.icon) {
        chip.textContent = opt.icon;
        // Size + font-variation come from .prop-choice-chip /
        // .material-symbols-outlined in CSS so the Tool panel
        // ligature chips match Selection panel + toolbar flyout
        // dimensions (22px glyph in a 32×32 box).
      }
      setTooltip(chip, opt.label);
      chip.addEventListener("click", () => {
        row.querySelectorAll(".prop-choice-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        ctx.handlePanelVariantChange(toolId, opt.value, preset);
      });
      row.appendChild(chip);
    }
    body.appendChild(row);
    menu.appendChild(section);
  };

  /** Lazily-created Fill / Line section bodies. Category order in
   *  the DOM is Type → Fill → Line. We enforce the order at
   *  insertion time: when Fill is created, insert it BEFORE any
   *  already-created Line section; Line always appends to the end.
   *  Sections stay out of the DOM entirely if no row is added — no
   *  empty cards for tools that don't need Fill. */
  let fillBody: HTMLElement | null = null;
  let lineSection: HTMLElement | null = null;
  let lineBody: HTMLElement | null = null;
  const getFillBody = (): HTMLElement => {
    if (!fillBody) {
      const s = createPropertySection("Fill");
      if (lineSection) {
        // Line already in DOM — slot Fill in ahead of it.
        menu.insertBefore(s.section, lineSection);
      } else {
        menu.appendChild(s.section);
      }
      fillBody = s.body;
    }
    return fillBody;
  };
  const getLineBody = (): HTMLElement => {
    if (!lineBody) {
      const s = createPropertySection("Line");
      lineSection = s.section;
      menu.appendChild(s.section);
      lineBody = s.body;
    }
    return lineBody;
  };

  /** Sync-helper: after a property row mutates `preset`, push the
   *  change into BOTH the presets map (so it persists) AND the
   *  live `ctx.options` reference (so the ACTIVE tool sees it on
   *  the next pointerdown — tools read options at creation-time
   *  values otherwise).
   *
   *  Without this sync, e.g. picking a new pen color while Draw is
   *  active would save the color to the preset but leave the in-
   *  flight FreehandTool drawing with the OLD color, because its
   *  `this.options` is a reference to `ctx.options` which was only
   *  populated on tool activation. */
  const syncPreset = (): void => {
    ctx.saveCurrentPreset(toolId, preset);
    Object.assign(ctx.options, preset);
  };

  /** Color pull-button row (PowerPoint-style). The callback receives
   *  the picked color; persistence happens automatically. */
  const addColorRow = (
    container: HTMLElement,
    label: string,
    current: string,
    onChange: (v: string) => void,
    opts?: { allowNone?: boolean },
  ): void => {
    const btn = createColorPullButton(
      current,
      (color) => {
        onChange(color);
        syncPreset();
      },
      { allowNone: opts?.allowNone },
    );
    container.appendChild(createPropertyRow(label, btn));
  };

  /** Number input row (PowerPoint-style with up/down spinner). */
  const addNumberRow = (
    container: HTMLElement,
    label: string,
    current: number,
    unit: string,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
  ): void => {
    const input = createNumberInput({
      current,
      unit,
      min,
      max,
      step,
      onChange: (v) => {
        onChange(v);
        syncPreset();
      },
    });
    container.appendChild(createPropertyRow(label, input));
  };

  /** Pulldown row (createCustomSelect), for Dash / Cap / Join /
   *  Font-family selections with SVG previews. */
  const addSelectRow = (
    container: HTMLElement,
    label: string,
    options: Array<{ value: string; label: string; preview?: string }>,
    current: string,
    onChange: (v: string) => void,
  ): void => {
    container.appendChild(
      createPropertyRow(
        label,
        createCustomSelect({
          options,
          current,
          ariaLabel: label,
          onChange: (v) => {
            onChange(v);
            syncPreset();
          },
        }),
      ),
    );
  };

  /** Preview SVG helpers — match the selection panel's visuals for
   *  drop-in consistency between the two surfaces. */
  const dashPreview = (key: string): string => {
    const da = computeDasharray(key, 1.5);
    const daAttr = da ? ` stroke-dasharray="${da}"` : "";
    return `<svg width="60" height="10" viewBox="0 0 60 10"><line x1="2" y1="5" x2="58" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"${daAttr}/></svg>`;
  };
  const capPreview = (cap: LineCap): string =>
    `<svg width="32" height="12" viewBox="0 0 32 12"><line x1="4" y1="6" x2="28" y2="6" stroke="currentColor" stroke-width="4" stroke-linecap="${cap}"/></svg>`;

  // =================================================================
  // 1. Type picker (for tools with variants)
  // =================================================================
  if (isRedact) {
    if (!preset.redactStyle) preset.redactStyle = "mosaic";
    addTypeRow(
      [
        { value: "mosaic", icon: "grid_view", label: "Mosaic (pixelate)" },
        { value: "solid", icon: "check_box", label: "Solid bar" },
        { value: "blur", icon: "blur_on", label: "Blur" },
      ],
      preset.redactStyle,
    );
  } else if (isFreehand) {
    if (!preset.drawStyle) preset.drawStyle = "pen";
    addTypeRow(
      [
        { value: "pen", icon: "edit", label: "Pen" },
        { value: "highlighter", icon: "ink_highlighter", label: "Highlighter" },
      ],
      preset.drawStyle,
    );
  } else if (isArrow) {
    if (!preset.arrowHead) preset.arrowHead = "end";
    // Share ARROW_ICON_SVG with the toolbar flyout so the Tool panel
    // Type row and the toolbar's variant badge show identical glyphs.
    addTypeRow(
      [
        { value: "none", label: "Line", svg: ARROW_ICON_SVG.none },
        { value: "end", label: "Arrow", svg: ARROW_ICON_SVG.end },
        { value: "both", label: "Double arrow", svg: ARROW_ICON_SVG.both },
      ],
      preset.arrowHead,
    );
  } else if (isShape) {
    if (!preset.shapeType) preset.shapeType = "rect";
    // Use the same SHAPE_ICON_SVG set as the toolbar badge so the
    // "next draw" chip and the "currently selected" badge carry
    // identical glyphs across the three surfaces (toolbar badge /
    // Tool panel Type row / Selection panel Type row).
    addTypeRow(
      [
        { value: "rect", svg: SHAPE_ICON_SVG.rect, label: "Rectangle" },
        { value: "rounded", svg: SHAPE_ICON_SVG.rounded, label: "Rounded" },
        { value: "ellipse", svg: SHAPE_ICON_SVG.ellipse, label: "Ellipse" },
      ],
      preset.shapeType,
    );
  } else if (isMarker) {
    const currentMarker: MarkerShape =
      preset.markerShape ?? (preset.fillColor === "rect" ? "rect" : "circle");
    if (preset.fillColor === "rect" || preset.fillColor === "none") {
      delete (preset as Partial<ToolOptions>).fillColor;
    }
    addTypeRow(
      [
        { value: "circle", svg: COUNTER_ICON_SVG.circle, label: "Circle" },
        { value: "rect", svg: COUNTER_ICON_SVG.rect, label: "Square" },
        { value: "rounded", svg: COUNTER_ICON_SVG.rounded, label: "Rounded square" },
      ],
      currentMarker,
    );
  } else if (isText) {
    if (!preset.textVariant) preset.textVariant = "sticky";
    addTypeRow(
      [
        { value: "plain", icon: "text_fields", label: "Plain text" },
        { value: "sticky", icon: "sticky_note_2", label: "Sticky note" },
        { value: "callout", icon: "chat_bubble", label: "Callout" },
      ],
      preset.textVariant,
    );
  }

  // =================================================================
  // 2. Appearance controls
  // =================================================================

  // --- Redact: only color for solid variant (goes under Fill) ----
  if (isRedact) {
    if (preset.redactStyle === "solid") {
      addColorRow(
        getFillBody(),
        "Color",
        preset.fillColor === "none" ? "#111111" : preset.fillColor,
        (v) => {
          preset.fillColor = v;
        },
      );
    }
    ctx.saveCurrentPreset(toolId, preset);
    Object.assign(ctx.options, preset);
    return;
  }

  // --- Marker / Counter: Fill (Color) + Line (border) + Label ----
  // Fill = bg fill (tool convention: stored in preset.strokeColor).
  // Line = OPTIONAL bg border — stored in the markerBorder* fields
  //   so it doesn't collide with the strokeColor-as-fill convention.
  // Label = number-rendering controls (Size; Value is per-element).
  if (isMarker) {
    // Fill — `allowNone` so the user can pick "No fill" to create
    // an outline-only counter (ring + number, no interior paint).
    // P3-8: standard color semantics — Fill = bg interior
    // (`fillColor`), Line = bg border (`strokeColor`). Back-compat:
    // migrate legacy presets on first render by copying the old
    // `strokeColor = bg fill` value into `fillColor` if unset.
    if (preset.fillColor === undefined && preset.strokeColor) {
      preset.fillColor = preset.strokeColor;
      // Clear old `strokeColor` — it'll be re-seeded below with the
      // proper border default if needed.
      preset.strokeColor = preset.markerBorderColor ?? "#ffffff";
    }
    const fb = getFillBody();
    addColorRow(
      fb,
      "Color",
      preset.fillColor ?? "#ff0000",
      (v) => {
        preset.fillColor = v;
      },
      { allowNone: true },
    );

    // Line — default border is white 1.5pt solid (matches
    // MarkerTool.onPointerDown). Uses the standard stroke* preset
    // fields now that marker follows the same color convention as
    // every other tool.
    const lb = getLineBody();
    addColorRow(lb, "Color", preset.strokeColor || "#ffffff", (v) => {
      preset.strokeColor = v;
    });
    addNumberRow(lb, "Width", preset.strokeWidth ?? 1.5, "pt", 0, 20, 0.25, (v) => {
      preset.strokeWidth = v;
    });
    addSelectRow(
      lb,
      "Dash type",
      [
        { value: "", label: "Solid", preview: dashPreview("") },
        { value: "dash", label: "Dashed", preview: dashPreview("dash") },
        { value: "dot", label: "Dotted", preview: dashPreview("dot") },
        { value: "dashDot", label: "Dash-Dot", preview: dashPreview("dashDot") },
        { value: "lgDash", label: "Long Dash", preview: dashPreview("lgDash") },
      ],
      preset.strokeDasharray ?? "",
      (v) => {
        preset.strokeDasharray = v;
      },
    );

    // Label — appended at `menu` tail, which (after Fill + Line
    // insertion) lands last. Order: Type → Fill → Line → Label.
    const { section: labelSection, body: labelBody } = createPropertySection("Label");
    menu.appendChild(labelSection);
    addNumberRow(labelBody, "Size", preset.fontSize, "pt", 8, 48, 1, (v) => {
      preset.fontSize = v;
    });

    ctx.saveCurrentPreset(toolId, preset);
    Object.assign(ctx.options, preset);
    return;
  }

  // --- Text: Color + Font + Size (Line section) ------------------
  if (isText) {
    const lb = getLineBody();
    addColorRow(lb, "Color", preset.strokeColor, (v) => {
      preset.strokeColor = v;
    });
    if (!preset.fontFamily) preset.fontFamily = "sans-serif";
    addSelectRow(
      lb,
      "Font",
      [
        { value: "sans-serif", label: "Sans-serif" },
        { value: "serif", label: "Serif" },
        { value: "monospace", label: "Monospace" },
        { value: "system-ui, -apple-system, sans-serif", label: "System UI" },
      ],
      preset.fontFamily,
      (v) => {
        preset.fontFamily = v;
      },
    );
    addNumberRow(lb, "Size", preset.fontSize, "pt", 8, 96, 1, (v) => {
      preset.fontSize = v;
    });
    ctx.saveCurrentPreset(toolId, preset);
    Object.assign(ctx.options, preset);
    return;
  }

  // --- Highlight: Type = color swatch chips, Fill = Transparency -
  // The Highlight "variant" concept IS the color itself (see
  // `TOOL_REGISTRY.highlight` — `variantField: "highlightColor"`,
  // `variants` mapped from `HIGHLIGHT_COLORS`). Each swatch routes
  // through the standard ctx.handlePanelVariantChange path so the
  // preset system keeps a separate Transparency value per color —
  // yellow at 60% and red at 40% can coexist.
  if (isHighlight) {
    const currentColor = (preset.highlightColor || HIGHLIGHT_COLORS[0]!.value).toLowerCase();
    const { section: typeSection, body: typeBody } = createPropertySection("Type");
    const row = document.createElement("div");
    row.className = "pp-type-row";
    for (const opt of HIGHLIGHT_COLORS) {
      const chip = document.createElement("div");
      chip.className = `prop-choice-chip pp-color-chip${currentColor === opt.value ? " active" : ""}`;
      // Color lives on an inner swatch (rendered via .pp-color-chip
      // ::before in CSS) driven by this custom property. The chip's
      // outer frame stays transparent so hover / active states read
      // the same way as every other Type chip (accent border + bg
      // tint) — unifies the Highlight picker with the rest of the
      // Type row vocabulary.
      chip.style.setProperty("--swatch-color", opt.value);
      setTooltip(chip, opt.label);
      chip.addEventListener("click", () => {
        row.querySelectorAll(".prop-choice-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        ctx.handlePanelVariantChange(toolId, opt.value, preset);
      });
      row.appendChild(chip);
    }
    typeBody.appendChild(row);
    menu.appendChild(typeSection);

    // Fill section — Transparency only. Stored as `1 - fillOpacity`
    // to match the unified Transparency vocabulary used elsewhere
    // (Shape, Arrow, Freehand strokes). Default fillOpacity 0.4 →
    // displayed transparency 60%.
    const fb = getFillBody();
    addNumberRow(
      fb,
      "Transparency",
      Math.round((1 - (preset.fillOpacity ?? 0.4)) * 100),
      "%",
      0,
      100,
      5,
      (v) => {
        preset.fillOpacity = 1 - v / 100;
      },
    );
    ctx.saveCurrentPreset(toolId, preset);
    Object.assign(ctx.options, preset);
    return;
  }

  // --- Shape / Arrow / Freehand: stroke-based controls (Line) ----
  const lb = getLineBody();
  addColorRow(lb, "Color", preset.strokeColor, (v) => {
    preset.strokeColor = v;
  });

  // Transparency (stroke-based). Stored as 1 - opacity to match the
  // selection panel's Transparency slider semantics.
  addNumberRow(
    lb,
    "Transparency",
    Math.round((1 - (preset.strokeOpacity ?? 1)) * 100),
    "%",
    0,
    100,
    1,
    (v) => {
      preset.strokeOpacity = 1 - v / 100;
    },
  );

  // Width
  addNumberRow(lb, "Width", preset.strokeWidth, "pt", 0.25, 40, 0.25, (v) => {
    preset.strokeWidth = v;
  });

  // Dash type
  addSelectRow(
    lb,
    "Dash type",
    [
      { value: "", label: "Solid", preview: dashPreview("") },
      { value: "dash", label: "Dashed", preview: dashPreview("dash") },
      { value: "dot", label: "Dotted", preview: dashPreview("dot") },
      { value: "dashDot", label: "Dash-Dot", preview: dashPreview("dashDot") },
      { value: "lgDash", label: "Long Dash", preview: dashPreview("lgDash") },
    ],
    preset.strokeDasharray ?? "",
    (v) => {
      preset.strokeDasharray = v;
    },
  );

  // Cap type — line ends on stroke primitives. Ordering mirrors
  // selection panel (square / round / flat).
  if (isShape || isArrow || isFreehand) {
    addSelectRow(
      lb,
      "Cap type",
      [
        { value: "square", label: "Square", preview: capPreview("square") },
        { value: "round", label: "Round", preview: capPreview("round") },
        { value: "butt", label: "Flat", preview: capPreview("butt") },
      ],
      preset.strokeLinecap ?? "butt",
      (v) => {
        preset.strokeLinecap = v as LineCap;
      },
    );
  }

  // Join type (stroke-linejoin) intentionally omitted — see
  // property-panel.ts #addPPLineSection for the rationale (invisible
  // at typical widths, conceptually confusing).

  // Arrow only: per-end type + size pulldowns (Begin / End). Lives
  // inside the Line category — they're line-end decorations, not a
  // separate concern. The picker auto-filters by the `arrowHead`
  // variant (Line hides all non-"None" shapes).
  if (isArrow) {
    createArrowEndsRows(
      lb,
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
        syncPreset();
      },
    );
  }

  // Shape only: Fill section (Fill color + Opacity)
  if (isShape) {
    const fb = getFillBody();
    addColorRow(
      fb,
      "Fill",
      preset.fillColor === "none" ? "#ffffff" : preset.fillColor,
      (v) => {
        preset.fillColor = v;
      },
      { allowNone: true },
    );
    addNumberRow(
      fb,
      "Opacity",
      Math.round((preset.fillOpacity ?? 1) * 100),
      "%",
      0,
      100,
      5,
      (v) => {
        preset.fillOpacity = v / 100;
      },
    );
  }

  // Freehand-only: "Done" button that commits the active drawing
  // session (matches draw.io's continuous-draw workflow). Strokes
  // across multiple pen-down cycles accumulate into one <path>
  // until the user explicitly ends the session via this button
  // or the Esc key. Without the button, the Esc-key shortcut is
  // the only visible way to stop, which is easy to miss.
  if (isFreehand) {
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
    menu.appendChild(doneRow);
  }

  ctx.saveCurrentPreset(toolId, preset);
  Object.assign(ctx.options, preset);
}
