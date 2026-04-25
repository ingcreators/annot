import { classifyPropertyElement } from "@ingcreators/annot-core/editor/property-schema";
import { computeDasharray, detectDashKey } from "@ingcreators/annot-core/utils";
import { setTooltip } from "./tooltip.js";
import { refreshArrowPath } from "@ingcreators/annot-core/editor/arrow-markers";
import type { CanvasManager } from "./canvas-manager.js";
import { createCustomSelect } from "./custom-select.js";
import {
  arrowPreview,
  arrowSizePreview,
  dashPreview,
  ppNumberInput,
} from "./property-panel-helpers.js";
import type { History } from "./history.js";
import { createColorPullButton, openAnchoredPopoverForColor } from "@ingcreators/annot-editor/property-controls";
import { convertRedactStyle, detectRedactStyle } from "@ingcreators/annot-editor/redact-utils";
import { convertShape, detectShapeType } from "@ingcreators/annot-core/editor/shape-utils";
import { convertTextVariant, detectTextVariant } from "@ingcreators/annot-core/editor/text-utils";
import {
  ARROW_ICON_SVG,
  COUNTER_ICON_SVG,
  HIGHLIGHT_COLORS,
  SHAPE_ICON_SVG,
} from "@ingcreators/annot-core/editor/toolbar-icons";
import { applyArrowHead, detectArrowEnds } from "./tools/arrow-tool.js";
import { applyDrawStyle, detectDrawStyle, isFreehandGroup } from "./tools/freehand-tool.js";
import { convertMarkerShape, detectMarkerShape, resizeMarker } from "./tools/marker-tool.js";
import type {
  ArrowDim,
  ArrowHead,
  ArrowShape,
  DrawStyle,
  LineCap,
  MarkerShape,
  RedactStyle,
  ShapeType,
  TextVariant,
} from "./tools/tool-base.js";
import { readTransformState, setRotation, toggleFlip } from "@ingcreators/annot-core/editor/transform-utils";

/** True for any element that represents a line-with-optional-arrowheads:
 *  a classic `<line>` OR the new composed `<g data-type="arrow">`
 *  wrapper produced by ArrowTool (stem + head paths inside). */
function isLineLike(el: Element): boolean {
  if (el.tagName === "line") return true;
  return el.tagName === "g" && el.getAttribute("data-type") === "arrow";
}

const WIDTH_OPTIONS = [
  { label: "0.5pt", value: 0.5 },
  { label: "1pt", value: 1 },
  { label: "1.5pt", value: 1.5 },
  { label: "2pt", value: 2 },
  { label: "3pt", value: 3 },
  { label: "4.5pt", value: 4.5 },
  { label: "6pt", value: 6 },
];

const STYLE_PRESETS = [
  { label: "Solid", value: "" },
  { label: "Dashed", value: "dash" },
  { label: "Dotted", value: "dot" },
  { label: "Dash-Dot", value: "dashDot" },
  { label: "Long Dash", value: "lgDash" },
];

/**
 * Placement mode for the PropertyPanel.
 *   "floating" — default, original behavior. The panel absolutely
 *                positions itself on top of the canvas via its
 *                `.prop-panel` CSS.
 *   "docked"   — added to the `.prop-panel-docked` variant that strips
 *                the absolute-positioning/border/shadow styling so the
 *                panel flows inline inside the host container (e.g. a
 *                right-side sidebar managed by the host).
 */
export type PropertyPanelMode = "floating" | "docked";

export class PropertyPanel {
  #el: HTMLDivElement;
  #canvas: CanvasManager;
  #history: History;
  #targets: SVGElement[] = [];
  /** Current append destination for row-level helpers (pickers, color
   *  pickers, number inputs, etc). Defaults to `#el` (top-level flow).
   *  Render methods temporarily swap this to a section's body via
   *  `#inSection(title, fn)` so helpers populate the correct Type /
   *  Line / Fill category card. */
  #appendTarget: HTMLElement | null = null;

  /** Called after a property edit REPLACES one or more target elements
   *  (e.g. converting a rectangle to an ellipse). The host should use
   *  this to update its SelectionManager so the new element is still
   *  the current selection, keeping handles and further edits alive. */
  onTargetReplaced?: (replacements: { oldEl: SVGElement; newEl: SVGElement }[]) => void;

  /** Called after a property edit MUTATES targets in place (e.g.
   *  rotation, flip) without swapping any DOM nodes. The host should
   *  refresh selection handles so they track the new visual frame. */
  onTargetMutated?: () => void;

  /** Called after the user changes a style attribute on selected
   *  targets (color, width, dash, variant, font size, etc). The host
   *  uses this for rubber-band behavior: "the color I just picked for
   *  this shape is also the color for the next one I draw". Payload
   *  includes all current targets so the host can propagate each
   *  element's new style back into the matching tool's preset. */
  onStyleChanged?: (targets: SVGElement[]) => void;

  /** Fired when the selection's VARIANT was switched via an in-panel
   *  type picker (e.g. "Line" → "Arrow" via the Type row). Unlike
   *  `onStyleChanged`, this signals the FUNDAMENTAL TYPE changed,
   *  not just a style tweak. Hosts typically:
   *    1. Load the new variant's preset (saved per-variant defaults)
   *       and apply its style attrs to the targets — "converting to
   *       Double arrow uses the Double arrow preset's color/width"
   *    2. Re-invoke their selection-property render so the panel
   *       title (e.g. "Selected Arrow" → "Selected Double arrow")
   *       and variant-dependent controls refresh. */
  onVariantChanged?: (targets: SVGElement[]) => void;

  constructor(
    container: HTMLElement,
    canvas: CanvasManager,
    history: History,
    mode: PropertyPanelMode = "floating",
  ) {
    this.#canvas = canvas;
    this.#history = history;

    this.#el = document.createElement("div");
    this.#el.className = `prop-panel${mode === "docked" ? " prop-panel-docked" : ""}`;
    this.#el.style.display = "none";
    container.appendChild(this.#el);

    this.#el.addEventListener("pointerdown", (e) => e.stopPropagation());
  }

  show(elements: SVGElement[]): void {
    this.#targets = elements;
    if (elements.length === 0) {
      this.hide();
      return;
    }

    this.#el.innerHTML = "";
    this.#el.style.display = "flex";

    // `elements.length === 0` was guarded above, so `elements[0]`
    // is always defined here.
    const sample = elements[0]!;
    // Coarse category dispatch lives in `@ingcreators/annot-core/editor/property-schema`
    // (Tier B, jsdom-testable). The category enum collapses the
    // three redact variants into a single dispatch arm here — the
    // sub-variant (mosaic / solid / blur) is re-detected inside
    // `#renderRedactControls` because the picker UI needs the
    // current style.
    const category = classifyPropertyElement(sample);
    switch (category) {
      case "group":
        // Manually-grouped <g data-type="group"> — no per-element
        // properties to edit (children have wildly different shapes
        // in the general case). Only the Actions section (rotate /
        // flip / z-order / ungroup) applies. Render nothing here.
        return;
      case "textbox":
        this.#renderTextboxControls(sample);
        break;
      case "marker":
        this.#renderMarkerControls(sample);
        break;
      case "redact-mosaic":
      case "redact-solid":
      case "redact-blur":
        this.#renderRedactControls(sample);
        break;
      case "highlight":
        this.#renderHighlightControls(sample);
        break;
      case "shape":
        this.#renderShapeControls(sample);
        break;
    }

    // Transform (rotate / flip) used to be rendered here as a section,
    // but was moved OUT of the Properties panel and into a dedicated
    // "Actions" button row on the right panel (EditorRightPanel). The
    // rationale: rotate/flip are OPERATIONS on an element, not state
    // properties a user "edits". Exposing them as quick-tap buttons
    // (with each press applying immediately) matches how Figma / Miro
    // / PowerPoint surface them and removes the temptation to treat
    // rotation as a mutable numeric field with undo weirdness. The
    // old `#addTransformControls` method is preserved below solely
    // for backwards compatibility of external callers; no longer
    // invoked from `show()`.
  }

  hide(): void {
    this.#el.style.display = "none";
    this.#targets = [];
  }

  #renderShapeControls(el: SVGElement): void {
    // Type section: variant picker appropriate to the selected element
    // family (shape / arrow-like / freehand path). Wrapped in a Type
    // pp-section for visual parity with Tool mode.
    this.#inSection("Type", () => {
      const currentType = detectShapeType(el);
      if (currentType && this.#targets.every((t) => detectShapeType(t) !== null)) {
        this.#addShapeTypePicker(currentType);
      }
      if (isLineLike(el) && this.#targets.every((t) => isLineLike(t))) {
        const ends = detectArrowEnds(el);
        const hStart = ends.start.shape !== "none";
        const hEnd = ends.end.shape !== "none";
        const current: ArrowHead = !hStart && !hEnd ? "none" : hStart && hEnd ? "both" : "end";
        this.#addArrowVariantPicker(current);
      }
      // Draw style picker: shown for both bare <path> elements (legacy
      // / single-stroke) and freehand <g> groups (new multi-stroke
      // session wrapper). Detection is uniform because detectDrawStyle
      // handles both shapes.
      const isFreehandEl = (t: SVGElement) => t.tagName === "path" || isFreehandGroup(t);
      if (isFreehandEl(el) && this.#targets.every(isFreehandEl)) {
        this.#addDrawStylePicker(detectDrawStyle(el));
      }
    });

    // Fill paint — rendered ABOVE the Line section, matching the tool
    // panel's category order (Type → Fill → Line). Hidden for strokes-
    // only elements (line / path / freehand group) so we don't show a
    // useless "No fill" button for them.
    if (!isLineLike(el) && el.tagName !== "path" && !isFreehandGroup(el)) {
      this.#addPPFillSection(el);
    }

    // Stroke paint (Line section). #addPPLineSection already builds
    // its own `pp-section` card via `#ppSection("Line")`.
    this.#addPPLineSection(el);
  }

  #renderTextboxControls(g: SVGElement): void {
    const textEl = g.querySelector("text");
    const color = textEl?.getAttribute("fill") || "#ff0000";
    const fontSize = textEl?.getAttribute("font-size") || "16";
    const fontFamily =
      textEl?.getAttribute("font-family") || g.getAttribute("data-font-family") || "sans-serif";

    // Type section: variant picker (plain / sticky / callout).
    this.#inSection("Type", () => {
      this.#addTextVariantPicker(detectTextVariant(g));
    });

    // Line section: textbox "line" means all text-appearance rows
    // (Color / Font / Size). We reuse the "Line" label for every tool
    // to keep the category vocabulary consistent.
    this.#inSection("Line", () => {
      this.#addColorPicker("Color", color, (v) => {
        for (const t of this.#targets) {
          t.querySelector("text")?.setAttribute("fill", v);
          t.setAttribute("data-color", v);
          if (detectTextVariant(t) !== "plain") {
            this.#recreateTextbox(t);
          }
        }
        this.#commit();
      });
      this.#addFontFamilyPicker(fontFamily);
      this.#addFontSizePicker(Number.parseFloat(fontSize));
    });
  }

  /**
   * Regenerate a textbox element in place so its bg / tail cosmetics
   * catch up with the latest data-* metadata. Used when changing the
   * color of a sticky (whose pale bg is derived from the text color).
   */
  #recreateTextbox(g: SVGElement): SVGElement | null {
    // Import lazily to avoid a top-level cycle with text-utils.
    // (text-utils has no reverse dependency, so this is safe either
    // way — inline for readability.)
    const parent = g.parentNode;
    if (!parent) return null;
    const newEl = convertTextVariant(g, detectTextVariant(g));
    // Update the target list if the target we just replaced was tracked.
    const idx = this.#targets.indexOf(g);
    if (idx >= 0) this.#targets[idx] = newEl;
    this.onTargetReplaced?.([{ oldEl: g, newEl }]);
    return newEl;
  }

  #addTextVariantPicker(current: TextVariant): void {
    // Emits just the chip row — the outer "Type" category card is
    // created by `#inSection("Type", ...)` in the render method.
    const row = document.createElement("div");
    row.className = "pp-type-row";
    const options: Array<{ value: TextVariant; icon: string; label: string }> = [
      { value: "plain", icon: "text_fields", label: "Plain text" },
      { value: "sticky", icon: "sticky_note_2", label: "Sticky note" },
      { value: "callout", icon: "chat_bubble", label: "Callout" },
    ];
    for (const opt of options) {
      const chip = document.createElement("div");
      chip.className = `prop-choice-chip material-symbols-outlined${current === opt.value ? " active" : ""}`;
      chip.textContent = opt.icon;
      setTooltip(chip, opt.label);
      chip.addEventListener("click", () => {
        if (opt.value === current) return;
        const replacements: { oldEl: SVGElement; newEl: SVGElement }[] = [];
        const nextTargets: SVGElement[] = [];
        for (const t of this.#targets) {
          const newEl = convertTextVariant(t, opt.value);
          replacements.push({ oldEl: t, newEl });
          nextTargets.push(newEl);
        }
        this.#targets = nextTargets;
        // Skip the style rubber-band (#commit would push the converted
        // element's OLD style into the NEW variant's preset). The
        // host's onVariantChanged will load the new variant's saved
        // style and apply it instead.
        this.#history.save();
        this.onTargetReplaced?.(replacements);
        if (this.onVariantChanged) {
          this.onVariantChanged(nextTargets);
        } else {
          this.show(nextTargets);
        }
      });
      row.appendChild(chip);
    }
    this.#target().appendChild(row);
  }

  #addFontFamilyPicker(current: string): void {
    const select = document.createElement("select");
    select.className = "toolbar-input prop-font-select";
    const FONT_OPTIONS: Array<{ label: string; value: string }> = [
      { label: "Sans-serif", value: "sans-serif" },
      { label: "Serif", value: "serif" },
      { label: "Monospace", value: "monospace" },
      { label: "System UI", value: "system-ui, -apple-system, sans-serif" },
    ];
    // Preserve any non-preset value so it round-trips.
    if (!FONT_OPTIONS.some((o) => o.value === current)) {
      FONT_OPTIONS.push({ label: current, value: current });
    }
    for (const opt of FONT_OPTIONS) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === current) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener("change", () => {
      const next = select.value;
      for (const t of this.#targets) {
        t.setAttribute("data-font-family", next);
        t.querySelector("text")?.setAttribute("font-family", next);
      }
      this.#commit();
    });
    this.#target().appendChild(this.#ppRow("Font", select));
  }

  /**
   * Redact properties — style picker + solid color picker (only
   * relevant for the solid variant). Converting between styles
   * generates new <image> content when switching to/from mosaic or
   * blur, which is async because it samples the underlying base image.
   */
  #renderRedactControls(el: SVGElement): void {
    const current = detectRedactStyle(el) || "mosaic";
    // Type section
    this.#inSection("Type", () => {
      this.#addRedactStylePicker(current);
    });
    // Fill section — only the solid variant has an editable paint
    // (mosaic / blur bake pixels into an <image>, so there's no color
    // attribute to drive). Placed under "Fill" because it sets the
    // `fill` attribute of the solid rect.
    if (current === "solid") {
      this.#inSection("Fill", () => {
        const fill = el.getAttribute("fill") || "#111111";
        this.#addColorPicker("Color", fill, (v) => {
          for (const t of this.#targets) {
            if (detectRedactStyle(t) === "solid") {
              t.setAttribute("fill", v);
            }
          }
          this.#commit();
        });
      });
    }
  }

  /** Highlight properties — mirrors the Tool mode Highlight layout.
   *  Type section exposes the color-swatch chips (the Highlight
   *  "variant" IS the color); Fill section carries only Transparency.
   *  No Line section — highlight rects are strokeless paints. */
  #renderHighlightControls(el: SVGElement): void {
    // `HIGHLIGHT_COLORS` is a non-empty constant; `[0]` is always defined.
    const currentFill = (el.getAttribute("fill") || HIGHLIGHT_COLORS[0]!.value).toLowerCase();

    // Type section — swatch chips routed through onVariantChanged so
    // the new color's preset (including its saved Transparency) gets
    // applied via applyElementVariantPreset.
    this.#inSection("Type", () => {
      const row = document.createElement("div");
      row.className = "pp-type-row";
      for (const opt of HIGHLIGHT_COLORS) {
        const chip = document.createElement("div");
        chip.className = `prop-choice-chip pp-color-chip${currentFill === opt.value ? " active" : ""}`;
        // Color goes on the inner swatch (.pp-color-chip::before); the
        // chip frame stays transparent so active state matches other
        // Type chips (accent border + bg tint).
        chip.style.setProperty("--swatch-color", opt.value);
        setTooltip(chip, opt.label);
        chip.addEventListener("click", () => {
          if (opt.value === currentFill) return;
          for (const t of this.#targets) {
            t.setAttribute("fill", opt.value);
          }
          // Skip #commit rubber-band (would push the OLD preset's
          // transparency onto the NEW color's preset). applyElement-
          // VariantPreset on the onVariantChanged path will load the
          // new color's saved Transparency instead.
          this.#history.save();
          if (this.onVariantChanged) {
            this.onVariantChanged(this.#targets);
          } else {
            this.show(this.#targets);
          }
        });
        row.appendChild(chip);
      }
      this.#target().appendChild(row);
    });

    // Fill section — Transparency only. 1 - fill-opacity, so 60% means
    // the rect is 40% opaque (the classic highlighter feel).
    this.#inSection("Fill", () => {
      const fo = Number.parseFloat(el.getAttribute("fill-opacity") || "0.4");
      const transparency = Math.round((1 - (Number.isFinite(fo) ? fo : 0.4)) * 100);
      const input = ppNumberInput(transparency, "%", 0, 100, 5, (v) => {
        const nextOpacity = 1 - v / 100;
        for (const t of this.#targets) {
          t.setAttribute("fill-opacity", String(nextOpacity));
        }
        this.#commit();
      });
      this.#target().appendChild(this.#ppRow("Transparency", input));
    });
  }

  #addRedactStylePicker(current: RedactStyle): void {
    // Just the chip row — category header is handled by `#inSection("Type",…)`.
    const row = document.createElement("div");
    row.className = "pp-type-row";
    const options: Array<{ value: RedactStyle; icon: string; label: string }> = [
      { value: "mosaic", icon: "grid_view", label: "Mosaic (pixelate)" },
      { value: "solid", icon: "check_box", label: "Solid bar" },
      { value: "blur", icon: "blur_on", label: "Blur" },
    ];
    for (const opt of options) {
      const chip = document.createElement("div");
      chip.className = `prop-choice-chip material-symbols-outlined${current === opt.value ? " active" : ""}`;
      chip.textContent = opt.icon;
      setTooltip(chip, opt.label);
      chip.addEventListener("click", async () => {
        if (opt.value === current) return;
        row.querySelectorAll(".prop-choice-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        // Convert is async (mosaic / blur need to resample pixels).
        // Process targets sequentially to avoid N concurrent image
        // decodes on low-end machines.
        const replacements: { oldEl: SVGElement; newEl: SVGElement }[] = [];
        const nextTargets: SVGElement[] = [];
        for (const t of this.#targets) {
          try {
            const newEl = await convertRedactStyle(t, opt.value, this.#canvas);
            replacements.push({ oldEl: t, newEl });
            nextTargets.push(newEl);
          } catch (err) {
            console.error("[redact] style convert failed", err);
          }
        }
        this.#targets = nextTargets;
        // Skip style rubber-band (mosaic / blur elements are <image>s
        // with baked pixels — their "style" isn't a user-editable set
        // of attrs anyway). Just save history and fire the variant-
        // changed path for title / panel refresh.
        this.#history.save();
        this.onTargetReplaced?.(replacements);
        if (this.onVariantChanged) {
          this.onVariantChanged(nextTargets);
        } else {
          this.show(nextTargets);
        }
      });
      row.appendChild(chip);
    }
    this.#target().appendChild(row);
  }

  #renderMarkerControls(g: SVGElement): void {
    const bgEl = g.querySelector("circle") || g.querySelector("rect");
    const fill = bgEl?.getAttribute("fill") || "#ff0000";
    const bgStroke = bgEl?.getAttribute("stroke") || "#ffffff";
    const bgStrokeWidth = Number.parseFloat(bgEl?.getAttribute("stroke-width") || "1.5");
    const bgDashKey =
      bgEl?.getAttribute("data-dash-key") ??
      detectDashKey(bgEl?.getAttribute("stroke-dasharray") || "", bgStrokeWidth) ??
      "";
    const textEl = g.querySelector("text");
    const fontSize = Number.parseFloat(textEl?.getAttribute("font-size") || "13");
    const currentVal = Number.parseInt(g.getAttribute("data-marker") || "1", 10);

    // Type section: Circle / Square / Rounded square.
    this.#inSection("Type", () => {
      this.#addMarkerShapePicker(detectMarkerShape(g));
    });

    // Fill section: the bg primitive's color. The Counter's interior
    // paint lives here, mirroring Shape / Highlight. `allowNone`
    // exposes "No fill" so users can make an outline-only counter
    // (just the ring + number, no interior paint).
    this.#inSection("Fill", () => {
      this.#addColorPicker(
        "Color",
        fill,
        (v) => {
          for (const t of this.#targets) {
            const bg = t.querySelector("circle") || t.querySelector("rect");
            bg?.setAttribute("fill", v);
          }
          this.#commit();
        },
        { allowNone: true },
      );
    });

    // Line section: the bg primitive's OPTIONAL border. Unlike most
    // tools the Counter's stroke isn't required, but users occasionally
    // want a thicker outline or a dashed ring — expose the standard
    // Color / Width / Dash rows here. Attrs go on the <circle>/<rect>
    // child (not the outer <g>), matching where MarkerTool writes them
    // at creation time.
    this.#inSection("Line", () => {
      // Border color
      this.#addColorPicker("Color", bgStroke, (v) => {
        for (const t of this.#targets) {
          const bg = t.querySelector("circle") || t.querySelector("rect");
          bg?.setAttribute("stroke", v);
        }
        this.#commit();
      });
      // Border width
      this.#target().appendChild(
        this.#ppRow(
          "Width",
          ppNumberInput(bgStrokeWidth, "pt", 0, 20, 0.25, (v) => {
            for (const t of this.#targets) {
              const bg = t.querySelector("circle") || t.querySelector("rect");
              if (!bg) continue;
              bg.setAttribute("stroke-width", String(v));
              // Re-express the dasharray (if any) against the new width
              // so dots/dashes stay proportional, matching how the Line
              // section does it for stroke primitives.
              const dashKey = bg.getAttribute("data-dash-key");
              if (dashKey) {
                bg.setAttribute("stroke-dasharray", computeDasharray(dashKey, v));
              }
            }
            this.#commit();
          }),
        ),
      );
      // Border dash type
      this.#target().appendChild(
        this.#ppRow(
          "Dash type",
          createCustomSelect({
            options: [
              { value: "", label: "Solid", preview: dashPreview("") },
              { value: "dash", label: "Dashed", preview: dashPreview("dash") },
              { value: "dot", label: "Dotted", preview: dashPreview("dot") },
              { value: "dashDot", label: "Dash-Dot", preview: dashPreview("dashDot") },
              { value: "lgDash", label: "Long Dash", preview: dashPreview("lgDash") },
            ],
            current: bgDashKey,
            ariaLabel: "Dash type",
            onChange: (v) => {
              for (const t of this.#targets) {
                const bg = t.querySelector("circle") || t.querySelector("rect");
                if (!bg) continue;
                const w = Number.parseFloat(bg.getAttribute("stroke-width") || "1.5");
                if (v) {
                  bg.setAttribute("stroke-dasharray", computeDasharray(v, w));
                  bg.setAttribute("data-dash-key", v);
                } else {
                  bg.removeAttribute("stroke-dasharray");
                  bg.removeAttribute("data-dash-key");
                }
              }
              this.#commit();
            },
          }),
        ),
      );
    });

    // Label section: the displayed number + its rendered size. "Label"
    // covers both the textual content (Value) and the font size that
    // drives the counter's overall visual size.
    this.#inSection("Label", () => {
      this.#addNumberInput("Value", currentVal, 1, 999, (v) => {
        for (const t of this.#targets) {
          t.setAttribute("data-marker", String(v));
          const te = t.querySelector("text");
          if (te) te.textContent = String(v);
        }
        this.#commit();
      });
      // Counter-specific Size row: `resizeMarker` rescales the entire
      // counter (bg primitive + text) so changing Size grows/shrinks
      // the whole element proportionally, not just the digit. Using
      // the shared `#addFontSizePicker` would only touch font-size,
      // leaving the ring unchanged — visually awkward (tiny label in
      // big bubble).
      const sizeInput = ppNumberInput(fontSize, "pt", 8, 96, 1, (v) => {
        for (const t of this.#targets) resizeMarker(t, v);
        // #commit rubber-bands the style to the tool preset so a
        // subsequent Counter draw uses the new size.
        this.#commit();
        // Selection handles were computed against the OLD bbox —
        // refresh them so drag-resize grabs the new bounds.
        this.onTargetMutated?.();
      });
      this.#target().appendChild(this.#ppRow("Size", sizeInput));
    });
  }

  /**
   * Counter (marker) shape picker — Circle / Square / Rounded chips
   * at the top of a marker's selection properties. Unlike the Shape
   * or Text pickers, converting a marker does NOT replace the outer
   * `<g>` — only the inner `<circle>` / `<rect>` bg is swapped, so
   * no onTargetReplaced signal is needed.
   */
  #addMarkerShapePicker(current: MarkerShape): void {
    // Chip row only — category header comes from `#inSection("Type",…)`.
    const row = document.createElement("div");
    row.className = "pp-type-row";
    const options: Array<{ value: MarkerShape; label: string; svg: string }> = [
      { value: "circle", label: "Circle", svg: COUNTER_ICON_SVG.circle },
      { value: "rect", label: "Square", svg: COUNTER_ICON_SVG.rect },
      { value: "rounded", label: "Rounded square", svg: COUNTER_ICON_SVG.rounded },
    ];
    for (const opt of options) {
      const chip = document.createElement("div");
      chip.className = `prop-choice-chip${current === opt.value ? " active" : ""}`;
      chip.innerHTML = opt.svg;
      setTooltip(chip, opt.label);
      chip.addEventListener("click", () => {
        if (opt.value === current) return;
        for (const t of this.#targets) {
          convertMarkerShape(t, opt.value);
        }
        // Skip rubber-band (#commit) — the marker's style attrs
        // (fill / font-size) haven't changed, and we want the NEW
        // variant's preset to drive any color/size updates via
        // onVariantChanged. See the arrow variant picker for the
        // same rationale.
        this.#history.save();
        if (this.onVariantChanged) {
          this.onVariantChanged(this.#targets);
        } else {
          this.show(this.#targets);
        }
      });
      row.appendChild(chip);
    }
    this.#target().appendChild(row);
  }

  /**
   * Shape type picker — rect / rounded / ellipse chips at the top of
   * the selection properties. Clicking a chip calls convertShape() on
   * every selected target (all of which are Shape elements at this
   * point), replaces them in the DOM, updates #targets so subsequent
   * property edits go to the new elements, and notifies the host via
   * onTargetReplaced so SelectionManager can update its selectedSet.
   */
  #addShapeTypePicker(current: ShapeType): void {
    // Chip row only — category header comes from `#inSection("Type",…)`.
    const row = document.createElement("div");
    row.className = "pp-type-row";
    // SVG glyphs (not Material Symbols ligatures) so the chip set
    // matches the toolbar badge + Tool panel Type row exactly. The
    // three shared glyphs (rect / rounded / ellipse) all use
    // stroke-width 2 in SHAPE_ICON_SVG so they read as a coherent
    // icon family, fixing the previous inconsistency where the
    // "circle" ligature rendered visibly thinner than the hand-
    // rolled rect / rounded outlines.
    const options: Array<{ value: ShapeType; svg: string; label: string }> = [
      { value: "rect", svg: SHAPE_ICON_SVG.rect, label: "Rectangle" },
      { value: "rounded", svg: SHAPE_ICON_SVG.rounded, label: "Rounded" },
      { value: "ellipse", svg: SHAPE_ICON_SVG.ellipse, label: "Ellipse" },
    ];
    for (const opt of options) {
      const chip = document.createElement("div");
      chip.className = `prop-choice-chip${current === opt.value ? " active" : ""}`;
      chip.innerHTML = opt.svg;
      setTooltip(chip, opt.label);
      chip.addEventListener("click", () => {
        if (opt.value === current) return;
        const replacements: { oldEl: SVGElement; newEl: SVGElement }[] = [];
        const nextTargets: SVGElement[] = [];
        for (const t of this.#targets) {
          const newEl = convertShape(t, opt.value);
          replacements.push({ oldEl: t, newEl });
          nextTargets.push(newEl);
        }
        this.#targets = nextTargets;
        // Skip #commit (rubber-band) — it would overwrite the new
        // variant's preset with the converted element's carried-over
        // old style. applyElementVariantPreset will load the NEW
        // variant's saved style on the onVariantChanged path below.
        this.#history.save();
        this.onTargetReplaced?.(replacements);
        // Apply the new variant's preset style (color / width / dash
        // / …) so the converted element reflects how that variant
        // was last drawn. Parallels the arrow variant picker and
        // keeps "change type → get that type's saved defaults"
        // consistent across tools.
        if (this.onVariantChanged) {
          this.onVariantChanged(nextTargets);
        } else {
          this.show(nextTargets);
        }
      });
      row.appendChild(chip);
    }
    this.#target().appendChild(row);
  }

  /** Inline SVG preview for an arrow-shape dropdown row. Matches
   *  PowerPoint's visual scheme: right-pointing for End arrow
   *  (outward from line's end), left-pointing for Begin arrow
   *  (outward from line's start). The two variants share the same
   *  geometry, just mirrored horizontally via a wrapper transform. */
  // `#arrowPreview` and `#arrowPreviewContent` extracted to
  // `./property-panel-helpers.ts` (Stage 3b-1). Call sites use the
  // imported `arrowPreview` / `arrowPreviewContent` directly.

  /** Stroke-opacity slider (0..100%). Kept distinct from
   *  `#addOpacityPicker` which targets fill-opacity, because the two
   *  control different visual properties and users often want one
   *  faded and the other solid. */
  #addStrokeOpacityPicker(current: number): void {
    const wrap = document.createElement("div");
    wrap.className = "prop-row";
    const lbl = document.createElement("span");
    lbl.className = "prop-label";
    // "Stroke opacity" — the old "Stroke α" label was too cryptic
    // (users don't know "α" = alpha = opacity at a glance).
    lbl.textContent = "Stroke opacity";
    wrap.appendChild(lbl);

    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.value = String(Math.round(current * 100));
    input.className = "prop-slider";
    input.addEventListener("input", () => {
      const v = Number.parseFloat(input.value) / 100;
      // Cheap per-frame update — avoid history save until release.
      for (const t of this.#targets) {
        // Lines use `opacity` so markers fade with the stroke
        // (context-stroke propagates color but not stroke-opacity).
        // Also drop the legacy stroke-opacity so the two paint
        // channels don't compound into an overly faded line.
        if (isLineLike(t)) {
          t.setAttribute("opacity", String(v));
          t.removeAttribute("stroke-opacity");
        } else {
          t.setAttribute("stroke-opacity", String(v));
        }
      }
      valLbl.textContent = `${input.value}%`;
    });
    input.addEventListener("change", () => {
      const v = Number.parseFloat(input.value) / 100;
      for (const t of this.#targets) {
        if (isLineLike(t)) {
          t.setAttribute("opacity", String(v));
          t.removeAttribute("stroke-opacity");
        } else {
          t.setAttribute("stroke-opacity", String(v));
        }
      }
      this.#commit();
    });
    wrap.appendChild(input);

    const valLbl = document.createElement("span");
    valLbl.className = "prop-value";
    valLbl.textContent = `${Math.round(current * 100)}%`;
    wrap.appendChild(valLbl);
    this.#el.appendChild(wrap);
  }

  /**
   * Arrow variant picker — "Type" row at the top of the properties
   * panel when an arrow-ish element is selected. Lets the user
   * convert between the 3 canonical variants without losing detailed
   * per-end customizations beyond what the new variant requires:
   *
   *   Line         → begin + end forced to "none"
   *   Arrow        → begin forced to "none"; if end was "none", seed
   *                  "triangle", else keep (preserves e.g. diamond)
   *   Double arrow → any "none" ends get seeded "triangle"; non-none
   *                  ends (triangle / diamond / oval / …) are kept
   *
   * Mirrors the toolbar flyout's 3-state picker so the user can reach
   * the same operation from either entry point — critical for the
   * "selected X → change X's type" use case.
   */
  #addArrowVariantPicker(current: ArrowHead): void {
    // Chip row only — category header comes from `#inSection("Type",…)`.
    const row = document.createElement("div");
    row.className = "pp-type-row";
    // Use ARROW_ICON_SVG (same constants the toolbar uses) so the
    // variant glyph is bit-for-bit identical across toolbar badge /
    // flyout / Selection panel Type row.
    const options: Array<{ value: ArrowHead; label: string; svg: string }> = [
      { value: "none", label: "Line", svg: ARROW_ICON_SVG.none },
      { value: "end", label: "Arrow", svg: ARROW_ICON_SVG.end },
      { value: "both", label: "Double arrow", svg: ARROW_ICON_SVG.both },
    ];
    for (const opt of options) {
      const chip = document.createElement("div");
      chip.className = `prop-choice-chip${current === opt.value ? " active" : ""}`;
      chip.innerHTML = opt.svg;
      setTooltip(chip, opt.label);
      chip.addEventListener("click", () => {
        if (opt.value === current) return;
        // Step 1: clamp per-end shapes into the new variant's valid
        // range (preserves already-valid customizations).
        for (const t of this.#targets) {
          const ends = detectArrowEnds(t);
          const clamped = this.#clampArrowEndsToVariant(ends, opt.value);
          applyArrowHead(t, clamped);
        }
        // Step 2: save history, but INTENTIONALLY SKIP the style
        // rubber-band (#commit would fire onStyleChanged which in
        // turn calls syncPresetFromElement — that reads the element's
        // OLD stroke / fill values and writes them into the NEW
        // variant's preset, overwriting any saved color for the new
        // variant. Here we want the opposite: load the NEW variant's
        // preset and apply it, NOT push stale style into it).
        this.#history.save();
        // Step 3: notify the host. The host loads the new variant's
        // preset (so the element's style reflects the variant's
        // saved defaults) and triggers a full panel re-render — the
        // title updates to "Selected Double arrow" (etc.) and the
        // per-end shape pickers rebuild with the new filter.
        // If the host doesn't wire onVariantChanged, we still refresh
        // our own internals so the filtered pickers stay consistent.
        if (this.onVariantChanged) {
          this.onVariantChanged(this.#targets);
        } else {
          this.show(this.#targets);
        }
      });
      row.appendChild(chip);
    }
    this.#target().appendChild(row);
  }

  /** Adjust per-end shapes to fit a variant's constraint, preserving
   *  already-valid values. See the `#addArrowVariantPicker` comment
   *  for the clamp rules per variant. Width / length are always
   *  carried over unchanged — only shape values get adjusted. */
  #clampArrowEndsToVariant(
    spec: ReturnType<typeof detectArrowEnds>,
    variant: ArrowHead,
  ): ReturnType<typeof detectArrowEnds> {
    const next = {
      start: { ...spec.start },
      end: { ...spec.end },
    };
    switch (variant) {
      case "none":
        next.start.shape = "none";
        next.end.shape = "none";
        break;
      case "end":
        next.start.shape = "none";
        if (next.end.shape === "none") next.end.shape = "triangle";
        break;
      case "both":
        if (next.start.shape === "none") next.start.shape = "triangle";
        if (next.end.shape === "none") next.end.shape = "triangle";
        break;
    }
    return next;
  }

  /**
   * Draw-style picker for freehand <path> selections. Toggles between
   * pen and highlighter via applyDrawStyle(), which is the same
   * helper FreehandTool uses at creation time so both paths (no pun
   * intended) produce consistent attribute sets.
   */
  #addDrawStylePicker(current: DrawStyle): void {
    // Chip row only — category header comes from `#inSection("Type",…)`.
    // Note: label unified from "Style" to "Type" across all variant
    // pickers; the picker itself just emits chips now, no label.
    const row = document.createElement("div");
    row.className = "pp-type-row";
    const options: Array<{ value: DrawStyle; icon: string; label: string }> = [
      { value: "pen", icon: "edit", label: "Pen" },
      { value: "highlighter", icon: "ink_highlighter", label: "Highlighter" },
    ];
    for (const opt of options) {
      const chip = document.createElement("div");
      chip.className = `prop-choice-chip material-symbols-outlined${current === opt.value ? " active" : ""}`;
      chip.textContent = opt.icon;
      setTooltip(chip, opt.label);
      chip.addEventListener("click", () => {
        if (opt.value === current) return;
        row.querySelectorAll(".prop-choice-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        for (const t of this.#targets) applyDrawStyle(t, opt.value);
        // Skip #commit (rubber-band) — it would overwrite the new
        // variant's preset with the element's current (pre-switch)
        // style, defeating the "apply new variant's preset" intent.
        this.#history.save();
        // Load the new variant's preset (Pen / Highlighter have their
        // own saved style — e.g. Highlighter's wider default width +
        // lower opacity — and should re-apply on variant switch so
        // the conversion isn't just a data-attr toggle).
        this.onVariantChanged?.(this.#targets);
      });
      row.appendChild(chip);
    }
    this.#target().appendChild(row);
  }

  #addOpacityPicker(current: number): void {
    const wrap = document.createElement("div");
    wrap.className = "prop-row";
    const lbl = document.createElement("span");
    lbl.className = "prop-label";
    lbl.textContent = "Opacity";
    wrap.appendChild(lbl);

    const minusBtn = document.createElement("button");
    minusBtn.className = "zoom-btn material-symbols-outlined";
    minusBtn.textContent = "remove";

    const input = document.createElement("input");
    input.type = "number";
    input.className = "prop-number-input";
    input.min = "0";
    input.max = "100";
    input.step = "5";
    input.value = String(Math.round(current * 100));

    const pctLabel = document.createElement("span");
    pctLabel.className = "prop-value";
    pctLabel.textContent = "%";

    const plusBtn = document.createElement("button");
    plusBtn.className = "zoom-btn material-symbols-outlined";
    plusBtn.textContent = "add";

    const apply = () => {
      let v = Number.parseInt(input.value, 10) || 0;
      v = Math.max(0, Math.min(100, v));
      input.value = String(v);
      this.#setAll("fill-opacity", String(v / 100));
    };

    input.addEventListener("change", apply);
    minusBtn.addEventListener("click", () => {
      const v = (Number.parseInt(input.value, 10) || 0) - 5;
      input.value = String(Math.max(0, v));
      apply();
    });
    plusBtn.addEventListener("click", () => {
      const v = (Number.parseInt(input.value, 10) || 0) + 5;
      input.value = String(Math.min(100, v));
      apply();
    });

    wrap.appendChild(minusBtn);
    wrap.appendChild(input);
    wrap.appendChild(pctLabel);
    wrap.appendChild(plusBtn);
    this.#el.appendChild(wrap);
  }

  #addNumberInput(
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (v: number) => void,
  ): void {
    // Unified: render as a pp-row with a pp-number input + stepper,
    // matching the Line / Fill rows. Previous implementation used a
    // bare `<input>` — looked visually out-of-place inside a pp card.
    const input = ppNumberInput(value, "", min, max, 1, (v) => onChange(Math.round(v)));
    this.#target().appendChild(this.#ppRow(label, input));
  }

  // --- Width picker: visual line samples ---

  #addWidthPicker(current: number, _color: string, onWidthChange?: (w: number) => void): void {
    const wrap = document.createElement("div");
    wrap.className = "prop-section";

    const label = document.createElement("div");
    label.className = "prop-section-label";
    label.textContent = "Width";
    wrap.appendChild(label);

    const list = document.createElement("div");
    list.className = "prop-choice-list";

    for (const opt of WIDTH_OPTIONS) {
      const item = document.createElement("div");
      item.className = `prop-choice-item${Math.abs(opt.value - current) < 0.3 ? " active" : ""}`;
      setTooltip(item, opt.label);

      // SVG preview of line thickness
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "80");
      svg.setAttribute("height", "16");
      svg.setAttribute("viewBox", "0 0 80 16");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", "4");
      line.setAttribute("y1", "8");
      line.setAttribute("x2", "76");
      line.setAttribute("y2", "8");
      line.setAttribute("class", "preview-line");
      line.setAttribute("stroke-width", String(opt.value));
      line.setAttribute("stroke-linecap", "round");
      svg.appendChild(line);
      item.appendChild(svg);

      const lbl = document.createElement("span");
      lbl.className = "prop-choice-label";
      lbl.textContent = opt.label;
      item.appendChild(lbl);

      item.addEventListener("click", () => {
        list.querySelectorAll(".prop-choice-item").forEach((i) => i.classList.remove("active"));
        item.classList.add("active");
        this.#setAll("stroke-width", String(opt.value));
        onWidthChange?.(opt.value);
      });
      list.appendChild(item);
    }

    wrap.appendChild(list);
    this.#el.appendChild(wrap);
  }

  // --- Dash picker: visual dash pattern samples ---

  #addStylePicker(currentKey: string, sw: number): void {
    const wrap = document.createElement("div");
    wrap.className = "prop-section";

    const label = document.createElement("div");
    label.className = "prop-section-label";
    // "Dash" (not "Style") — the tool-side panel uses "Style" for
    // variant pickers (pen/highlighter, mosaic/solid/blur, etc.).
    // Calling dash-pattern "Style" here clashed; "Dash" names the
    // CSS property explicitly and avoids the confusion.
    label.textContent = "Dash";
    wrap.appendChild(label);

    const list = document.createElement("div");
    list.className = "prop-choice-list";

    // Fixed preview stroke width for consistency
    const previewSw = 1.5;

    for (const opt of STYLE_PRESETS) {
      const item = document.createElement("div");
      item.className = `prop-choice-item${opt.value === currentKey ? " active" : ""}`;
      setTooltip(item, opt.label);

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "80");
      svg.setAttribute("height", "16");
      svg.setAttribute("viewBox", "0 0 80 16");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", "4");
      line.setAttribute("y1", "8");
      line.setAttribute("x2", "76");
      line.setAttribute("y2", "8");
      line.setAttribute("class", "preview-line");
      line.setAttribute("stroke-width", String(previewSw));
      line.setAttribute("stroke-linecap", "round");
      const previewDash = computeDasharray(opt.value, previewSw);
      if (previewDash) line.setAttribute("stroke-dasharray", previewDash);
      svg.appendChild(line);
      item.appendChild(svg);

      const lbl = document.createElement("span");
      lbl.className = "prop-choice-label";
      lbl.textContent = opt.label;
      item.appendChild(lbl);

      item.addEventListener("click", () => {
        list.querySelectorAll(".prop-choice-item").forEach((i) => i.classList.remove("active"));
        item.classList.add("active");
        // Set both the key and computed SVG dasharray
        for (const t of this.#targets) {
          t.setAttribute("data-dash-key", opt.value);
          const elSw = Number.parseFloat(t.getAttribute("stroke-width") || String(sw));
          t.setAttribute("stroke-dasharray", computeDasharray(opt.value, elSw));
        }
        this.#commit();
      });
      list.appendChild(item);
    }

    wrap.appendChild(list);
    this.#el.appendChild(wrap);
  }

  // --- Font size picker ---

  #addFontSizePicker(current: number): void {
    // Unified: switched from a chip grid (9 fixed sizes) to the
    // pp-number input used by Tool mode, so both panels expose the
    // same spinner + keyboard-entry control. Accepts any pt value in
    // a reasonable range rather than the preset list.
    const input = ppNumberInput(current, "pt", 8, 96, 1, (v) => {
      for (const t of this.#targets) {
        const te = t.querySelector("text");
        if (te) te.setAttribute("font-size", String(v));
        t.setAttribute("data-font-size", String(v));
      }
      this.#commit();
    });
    this.#target().appendChild(this.#ppRow("Size", input));
  }

  // --- Common helpers ---

  #addColorPicker(
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts: { allowNone?: boolean } = {},
  ): void {
    // Unified: render as a pp-row with a color pull-button (swatch +
    // caret). `allowNone` surfaces a "No fill" sentinel in the
    // popover — used by Shape fill, Counter fill, etc. where the
    // element can meaningfully be unpainted.
    const btn = createColorPullButton(value, onChange, { allowNone: opts.allowNone });
    this.#target().appendChild(this.#ppRow(label, btn));
  }

  #addButton(icon: string, title: string, onClick: () => void): void {
    const btn = document.createElement("button");
    btn.className = "prop-btn";
    btn.textContent = icon;
    setTooltip(btn, title);
    btn.addEventListener("click", onClick);
    this.#el.appendChild(btn);
  }

  #setAll(attr: string, value: string): void {
    // Use the stroke-target expansion so freehand groups also route
    // writes into their <path> children — caller is typically the
    // Line section setting stroke-linecap / stroke-linejoin / etc.
    for (const el of this.#strokeTargets()) {
      el.setAttribute(attr, value);
    }
    this.#commit();
  }

  /** Save to history AND notify the host that the selection's style
   *  changed. Single entry point for every mutation site so we never
   *  forget to fire `onStyleChanged` — the rubber-band propagation
   *  depends on being called from ALL style edits. */
  #commit(): void {
    this.#history.save();
    this.onStyleChanged?.(this.#targets);
  }

  #getAttr(el: SVGElement, attr: string): string | null {
    if (el.tagName === "g") {
      // Walk into the group's first styled child — for shape-ish
      // groups (arrows, markers) that's one of rect/line/circle;
      // for freehand groups it's the first <path>. Falls back to
      // the group's own attr for compound props like `opacity`.
      const inner = el.querySelector("path, rect, line, circle");
      return inner?.getAttribute(attr) || el.getAttribute(attr);
    }
    return el.getAttribute(attr);
  }

  /** Expand `this.#targets` for stroke-attr writes: freehand groups
   *  surface their child <path> elements so each stroke's individual
   *  stroke attrs get updated. Non-group targets pass through. Used
   *  by the Line section — editing Color/Width/Dash/etc. on a
   *  selected freehand session propagates to every stroke in the
   *  session, unifying the look of the drawing. */
  #strokeTargets(): SVGElement[] {
    const out: SVGElement[] = [];
    for (const t of this.#targets) {
      if (isFreehandGroup(t)) {
        for (const child of Array.from(t.children)) {
          if (child.tagName.toLowerCase() === "path") out.push(child as SVGElement);
        }
      } else {
        out.push(t);
      }
    }
    return out;
  }

  /**
   * Universal Transform section — rotate (numeric input + quick-set
   * buttons) and flip (horizontal / vertical toggles). Operates on
   * every selected target so multi-select rotates / flips as a batch.
   */
  #addTransformControls(sample: SVGElement): void {
    const state = readTransformState(sample);

    const section = document.createElement("div");
    section.className = "prop-section";
    const lbl = document.createElement("div");
    lbl.className = "prop-section-label";
    lbl.textContent = "Transform";
    section.appendChild(lbl);

    // Rotation row: numeric input + ±90° quick-set chips.
    const rotRow = document.createElement("div");
    rotRow.className = "prop-row";

    const rotInput = document.createElement("input");
    rotInput.type = "number";
    rotInput.className = "toolbar-input";
    rotInput.style.width = "64px";
    rotInput.value = String(Math.round(state.rotation));
    setTooltip(rotInput, "Rotation (degrees)");
    rotInput.addEventListener("change", () => {
      const v = Number.parseFloat(rotInput.value);
      if (!Number.isFinite(v)) return;
      for (const t of this.#targets) setRotation(t, v);
      // Rotation is instance-specific — don't rubber-band it to the
      // tool's preset, just save history and refresh handles.
      this.#history.save();
      this.onTargetMutated?.();
    });
    rotRow.appendChild(rotInput);

    const degLabel = document.createElement("span");
    degLabel.textContent = "°";
    degLabel.style.opacity = "0.7";
    degLabel.style.marginRight = "6px";
    rotRow.appendChild(degLabel);

    const quickRotate = (delta: number, title: string) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn material-symbols-outlined";
      setTooltip(btn, title);
      btn.textContent = delta < 0 ? "rotate_left" : "rotate_right";
      btn.style.fontSize = "18px";
      btn.addEventListener("click", () => {
        for (const t of this.#targets) {
          const cur = readTransformState(t).rotation;
          setRotation(t, cur + delta);
        }
        this.#history.save();
        this.show(this.#targets); // reflect new value in the input
        this.onTargetMutated?.();
      });
      rotRow.appendChild(btn);
    };
    quickRotate(-90, "Rotate 90° counter-clockwise");
    quickRotate(90, "Rotate 90° clockwise");

    section.appendChild(rotRow);

    // Flip row: two icon chips. "active" mirrors the current flip
    // state so the user sees at a glance which axes are mirrored.
    const flipRow = document.createElement("div");
    flipRow.className = "prop-choice-list prop-choice-horizontal";

    const flipChip = (axis: "h" | "v", icon: string, label: string) => {
      const chip = document.createElement("div");
      const active = axis === "h" ? state.flipH : state.flipV;
      chip.className = `prop-choice-chip material-symbols-outlined${active ? " active" : ""}`;
      chip.textContent = icon;
      setTooltip(chip, label);
      chip.addEventListener("click", () => {
        for (const t of this.#targets) toggleFlip(t, axis);
        // Flip is instance-specific — don't rubber-band.
        this.#history.save();
        this.show(this.#targets); // refresh active state
        this.onTargetMutated?.();
      });
      flipRow.appendChild(chip);
    };
    flipChip("h", "swap_horiz", "Flip horizontal (Shift+H)");
    flipChip("v", "swap_vert", "Flip vertical (Shift+V)");

    section.appendChild(flipRow);
    this.#el.appendChild(section);
  }

  // ==================================================================
  // PowerPoint-style "Line" property section.
  // Reproduces the structure of PowerPoint's line panel:
  //   - collapsible section header
  //   - paint-type radios (none / solid / gradient)
  //   - color pulldown, transparency slider+input, width number input
  //   - sketch style (placeholder), compound type (placeholder)
  //   - dash type / cap / join pulldowns
  //   - per-end arrow type + size pulldowns
  // ==================================================================

  /** Build a collapsible PP-style section, attach it to the panel,
   *  and return its body element so callers can append rows. The
   *  section root is appended EAGERLY so a later throw while building
   *  rows still leaves the header visible (the user can at least see
   *  that "Line" exists, which matches PowerPoint's behavior when a
   *  section's inner controls haven't loaded yet). */
  /** Where the next row should be inserted. Falls back to `#el` when
   *  no section has been opened (picker-only flow). */
  #target(): HTMLElement {
    return this.#appendTarget ?? this.#el;
  }

  /** Create a pp-section and run `fn` with the section body as the
   *  current append target. Any helper called inside `fn` (pickers,
   *  color pickers, number inputs, ...) appends to the section body.
   *  Skips section creation entirely if `fn` populates nothing —
   *  keeps the panel tidy when, e.g., a Line section has no rows for
   *  the selected variant. */
  #inSection(title: string, fn: () => void): void {
    const { body, root } = this.#ppSection(title);
    const prev = this.#appendTarget;
    this.#appendTarget = body;
    try {
      fn();
    } finally {
      this.#appendTarget = prev;
    }
    if (!body.firstChild) root.remove();
  }

  /** Build a non-collapsible pp-section card and append it to `#el`.
   *  Used for the top-level Type / Line / Fill categories. The
   *  collapsible tree affordance was removed: in the screenshot-
   *  annotation flow users never want to hide properties — every
   *  collapse was an accidental click. Category headers now behave
   *  as static labels, mirroring `createPropertySection` in
   *  property-controls.ts (used by the toolbar flyout) so both panels
   *  share pixel-identical category cards. */
  #ppSection(title: string): { body: HTMLElement; root: HTMLElement } {
    const root = document.createElement("div");
    root.className = "pp-section";
    const header = document.createElement("div");
    header.className = "pp-section-header";
    header.textContent = title;
    root.appendChild(header);
    const body = document.createElement("div");
    body.className = "pp-section-body";
    root.appendChild(body);
    this.#el.appendChild(root);
    return { body, root };
  }

  /** Helper — build a 2-column label/control row. */
  #ppRow(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement("div");
    row.className = "pp-row";
    const lbl = document.createElement("div");
    lbl.className = "pp-row-label";
    lbl.textContent = label;
    row.appendChild(lbl);
    row.appendChild(control);
    return row;
  }

  /** Render the PowerPoint-style Line section (stroke paint, width,
   *  cap/join, dash type, arrow heads). Drives all selected targets
   *  uniformly so multi-select edits remain consistent.
   *
   *  Solid stroke is the only supported paint mode — "No line" and
   *  "Gradient line" were dropped as screenshot-annotation rarely
   *  needs either, and keeping a single-option radio would just add
   *  visual noise. If either mode is ever needed back, restore the
   *  paint-type radio and the gradient editor branch below. */
  #addPPLineSection(el: SVGElement): void {
    const { body } = this.#ppSection("Line");
    // For freehand sessions, edits target the individual <path>
    // strokes inside the <g> wrapper (they're where stroke attrs
    // actually live). `targets()` returns that expanded list so each
    // callback below can iterate the right elements.
    const targets = () => this.#strokeTargets();
    const isLineEl = isLineLike(el) && this.#targets.every((t) => isLineLike(t));

    // Normalize any stray non-solid stroke to a solid color so the
    // rest of the section has a real paint to bind to. "none" and
    // legacy url(...) gradient references (no longer authored — the
    // gradient editor was dropped) flip to a visible default red.
    let strokeAttr = this.#getAttr(el, "stroke") || "#ff0000";
    if (strokeAttr === "none" || /^url\(/.test(strokeAttr)) {
      const fallback = "#ff0000";
      for (const t of targets()) {
        t.setAttribute("stroke", fallback);
      }
      strokeAttr = fallback;
    }

    // --- Color pulldown --------------------------------------------
    const colorBtn = document.createElement("button");
    colorBtn.type = "button";
    colorBtn.className = "pp-color-btn";
    const swatch = document.createElement("span");
    swatch.className = "pp-color-swatch";
    swatch.style.background = strokeAttr;
    colorBtn.appendChild(swatch);
    const caret = document.createElement("span");
    caret.className = "material-symbols-outlined";
    caret.textContent = "expand_more";
    colorBtn.appendChild(caret);
    colorBtn.addEventListener("click", () => {
      openAnchoredPopoverForColor(colorBtn, strokeAttr, (color) => {
        for (const t of targets()) {
          t.setAttribute("stroke", color);
          // Arrow groups: the head <path> holds its own `fill` (the
          // filled triangle / diamond / oval interior). Keep it
          // locked to the stroke color so heads track the stem.
          if (t.tagName === "g" && t.getAttribute("data-type") === "arrow") {
            // Only the filled head carries a colored fill; the open
            // head path keeps fill="none" and should stay untouched.
            const headFilled = t.querySelector<SVGPathElement>(
              ':scope > [data-role="head-filled"]',
            );
            if (headFilled) headFilled.setAttribute("fill", color);
          }
        }
        swatch.style.background = color;
        this.#commit();
      });
    });
    body.appendChild(this.#ppRow("Color", colorBtn));

    // --- Transparency slider + number -------------------------------
    // For <line> we set `opacity` on the element itself rather than
    // `stroke-opacity`. SVG markers referenced via `url(#...)` pick up
    // the stroke COLOR via `context-stroke`, but NOT the stroke
    // opacity, so setting stroke-opacity alone leaves arrow heads /
    // diamonds fully opaque while the line fades. Applying `opacity`
    // cascades through to the markers (lines have no fill, so the
    // dual-property trade-off doesn't matter here).
    //
    // One-shot migration: if a line carries a legacy `stroke-opacity`
    // (written by an older build that didn't know about the marker
    // propagation issue), move the value to `opacity` on first edit
    // so any subsequent slider change doesn't compound the two.
    if (isLineLike(el) && el.hasAttribute("stroke-opacity") && !el.hasAttribute("opacity")) {
      for (const t of targets()) {
        if (isLineLike(t)) {
          const legacy = t.getAttribute("stroke-opacity");
          if (legacy != null) {
            t.setAttribute("opacity", legacy);
            t.removeAttribute("stroke-opacity");
          }
        }
      }
    }
    const readOp = (e: SVGElement) => {
      const direct = e.getAttribute("opacity");
      if (direct != null) return Number.parseFloat(direct);
      return Number.parseFloat(this.#getAttr(e, "stroke-opacity") || "1");
    };
    const strokeOp = readOp(el);
    body.appendChild(
      this.#ppRow(
        "Transparency",
        ppNumberInput(Math.round((1 - strokeOp) * 100), "%", 0, 100, 1, (transparencyPct) => {
          const op = 1 - transparencyPct / 100;
          for (const t of targets()) {
            if (t.tagName === "line") {
              t.setAttribute("opacity", String(op));
              // Drop any lingering stroke-opacity so the two don't
              // multiply into an unexpectedly faint line.
              t.removeAttribute("stroke-opacity");
            } else {
              t.setAttribute("stroke-opacity", String(op));
            }
          }
          this.#commit();
        }),
      ),
    );

    // --- Width number input (pt) -----------------------------------
    const sw = Number.parseFloat(this.#getAttr(el, "stroke-width") || "3");
    body.appendChild(
      this.#ppRow(
        "Width",
        ppNumberInput(sw, "pt", 0.25, 200, 0.25, (v) => {
          for (const t of targets()) {
            t.setAttribute("stroke-width", String(v));
            // Dashes are derived from the width — recompute so the pattern
            // stays visually consistent across width changes.
            const key = t.getAttribute("data-dash-key") || "";
            if (key) t.setAttribute("stroke-dasharray", computeDasharray(key, v));
            // Arrow groups compute their shortening offsets from the
            // stroke width (the trig constants multiply `sw`). Regenerate
            // stem + head `d` so the alignment stays flush after a width
            // change.
            if (t.tagName === "g" && t.getAttribute("data-type") === "arrow") {
              refreshArrowPath(t);
            }
          }
          this.#commit();
        }),
      ),
    );

    // --- Dash type pulldown ----------------------------------------
    const dashRaw = this.#getAttr(el, "stroke-dasharray") || "";
    const dashKey = this.#getAttr(el, "data-dash-key") || detectDashKey(dashRaw, sw);
    const DASH_OPTIONS: Array<{ value: string; label: string; preview: string }> = [
      { value: "", label: "Solid", preview: dashPreview("") },
      { value: "dash", label: "Dashed", preview: dashPreview("dash") },
      { value: "dot", label: "Dotted", preview: dashPreview("dot") },
      { value: "dashDot", label: "Dash-Dot", preview: dashPreview("dashDot") },
      { value: "lgDash", label: "Long Dash", preview: dashPreview("lgDash") },
    ];
    body.appendChild(
      this.#ppRow(
        "Dash type",
        createCustomSelect({
          options: DASH_OPTIONS,
          current: dashKey,
          ariaLabel: "Dash type",
          onChange: (v) => {
            for (const t of targets()) {
              t.setAttribute("data-dash-key", v);
              const elSw = Number.parseFloat(t.getAttribute("stroke-width") || String(sw));
              t.setAttribute("stroke-dasharray", computeDasharray(v, elSw));
            }
            this.#commit();
          },
        }),
      ),
    );

    // --- Cap type pulldown -----------------------------------------
    // Fallback is "butt" to match SVG's actual rendering when no
    // stroke-linecap attribute is present. The old "round" fallback
    // made the picker show Round-active for freshly-drawn lines that
    // were actually rendering flat. Order mirrors PowerPoint's
    // Square → Round → Flat ordering.
    const currentCap = (this.#getAttr(el, "stroke-linecap") as LineCap | null) || "butt";
    body.appendChild(
      this.#ppRow(
        "Cap type",
        createCustomSelect({
          options: [
            {
              value: "square",
              label: "Square",
              preview: `<svg width="32" height="12" viewBox="0 0 32 12"><line x1="4" y1="6" x2="28" y2="6" stroke="currentColor" stroke-width="4" stroke-linecap="square"/></svg>`,
            },
            {
              value: "round",
              label: "Round",
              preview: `<svg width="32" height="12" viewBox="0 0 32 12"><line x1="4" y1="6" x2="28" y2="6" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`,
            },
            {
              value: "butt",
              label: "Flat",
              preview: `<svg width="32" height="12" viewBox="0 0 32 12"><line x1="4" y1="6" x2="28" y2="6" stroke="currentColor" stroke-width="4" stroke-linecap="butt"/></svg>`,
            },
          ],
          current: currentCap,
          ariaLabel: "Line cap",
          onChange: (v) => this.#setAll("stroke-linecap", v),
        }),
      ),
    );

    // Join type (stroke-linejoin) intentionally omitted from the UI.
    // At casual annotation widths (~3 pt default) the visible effect
    // is only 1-2 px at each corner — below the noise floor for most
    // users — and the concept ("how two stroke segments meet") is
    // more confusing than useful. SVG's default is `miter`, which we
    // leave untouched so rectangles keep sharp stroke corners. Users
    // wanting genuinely rounded corners should pick the Rounded
    // variant (modifies rect geometry) rather than tweaking linejoin.

    // --- Arrow type & size pulldowns (lines only) ------------------
    if (isLineEl) {
      const spec = detectArrowEnds(el);
      this.#addPPArrowRows(body, spec);
    }
  }

  /** Fill section (PowerPoint-style). Solid-only + "No fill" via the
   *  color pulldown's built-in `allowNone` affordance — gradient fill
   *  was dropped (rarely useful for screenshot annotation, adds a
   *  notable amount of complex UI: paint-type radios, angle slider,
   *  stop editor). Users who need multi-color fills can overlay
   *  multiple shapes. */
  #addPPFillSection(el: SVGElement): void {
    const { body } = this.#ppSection("Fill");
    const fill = this.#getAttr(el, "fill") || "none";

    // Fill color (supports "No fill" as a sentinel via allowNone)
    const colorBtn = document.createElement("button");
    colorBtn.type = "button";
    colorBtn.className = "pp-color-btn";
    const swatch = document.createElement("span");
    swatch.className = "pp-color-swatch";
    const applySwatch = (c: string) => {
      if (c === "none") {
        swatch.classList.add("pp-color-swatch-none");
        swatch.style.background = "transparent";
      } else {
        swatch.classList.remove("pp-color-swatch-none");
        swatch.style.background = c;
      }
    };
    applySwatch(fill);
    colorBtn.appendChild(swatch);
    const caret = document.createElement("span");
    caret.className = "material-symbols-outlined";
    caret.textContent = "expand_more";
    colorBtn.appendChild(caret);
    colorBtn.addEventListener("click", () => {
      openAnchoredPopoverForColor(
        colorBtn,
        fill,
        (color) => {
          for (const t of this.#targets) t.setAttribute("fill", color);
          applySwatch(color);
          this.#commit();
        },
        { allowNone: true },
      );
    });
    body.appendChild(this.#ppRow("Color", colorBtn));

    // Fill transparency (0 = fully opaque, 100 = fully transparent)
    const fillOp = Number.parseFloat(this.#getAttr(el, "fill-opacity") || "1");
    body.appendChild(
      this.#ppRow(
        "Transparency",
        ppNumberInput(Math.round((1 - fillOp) * 100), "%", 0, 100, 1, (transparencyPct) => {
          const op = 1 - transparencyPct / 100;
          for (const t of this.#targets) t.setAttribute("fill-opacity", String(op));
          this.#commit();
        }),
      ),
    );
  }

  /** Two rows of pulldowns per endpoint (type + size).
   *
   *  PowerPoint parity:
   *    Type  — 6 options (none / arrow / triangle / stealth / diamond
   *            / oval), matching the 6 OOXML preset shapes.
   *    Size  — 9 options arranged as a 3×3 grid (width × length).
   *            Width = perpendicular thickness (OOXML `w`),
   *            length = along-stem extent (OOXML `len`). Values are
   *            encoded as `"w-l"` strings (e.g. "md-lg"). */
  #addPPArrowRows(body: HTMLElement, current: ReturnType<typeof detectArrowEnds>): void {
    const DIMS: ArrowDim[] = ["sm", "md", "lg"];

    // Classify the current per-end state into a variant:
    //   Line         = both ends "none"
    //   Arrow        = begin "none", end non-"none"
    //   Double arrow = both ends non-"none"
    // (The "reverse arrow" case of begin non-"none", end "none" is
    //  not one of the 3 variants; classifier treats it as Arrow to
    //  surface the "this end has a marker" shortcut.)
    const hStart = current.start.shape !== "none";
    const hEnd = current.end.shape !== "none";
    const lineVariant: "none" | "end" | "both" =
      !hStart && !hEnd ? "none" : hStart && hEnd ? "both" : "end";

    // Rebuild the shape list for a specific endpoint, FILTERED by
    // the variant's rule:
    //   Line:         both ends "none" only
    //   Arrow:        begin "none" only, end non-"none" only
    //   Double arrow: both ends non-"none" only
    // Previews face the correct direction:
    //   Begin arrow (start of line) → arrows point LEFT
    //   End arrow   (end of line)   → arrows point RIGHT
    const shapesFor = (end: "start" | "end") => {
      const dir: "left" | "right" = end === "start" ? "left" : "right";
      const allShapes = [
        { value: "none", label: "None", preview: arrowPreview("none", dir) },
        { value: "triangle", label: "Triangle", preview: arrowPreview("triangle", dir) },
        { value: "arrow", label: "Arrow", preview: arrowPreview("arrow", dir) },
        { value: "stealth", label: "Stealth", preview: arrowPreview("stealth", dir) },
        { value: "diamond", label: "Diamond", preview: arrowPreview("diamond", dir) },
        { value: "oval", label: "Oval", preview: arrowPreview("oval", dir) },
      ] as Array<{ value: ArrowShape; label: string; preview: string }>;
      // Filter rule: "none" is a MARKER ABSENCE, every other shape
      // is a MARKER PRESENCE. Each end must match what the variant
      // requires.
      return allShapes.filter((s) => {
        const isNone = s.value === "none";
        if (lineVariant === "none") return isNone;
        if (lineVariant === "both") return !isNone;
        // Arrow (lineVariant === "end"): begin is none-only, end is non-none
        return end === "start" ? isNone : !isNone;
      });
    };

    const sizesFor = (end: "start" | "end") => {
      const dir: "left" | "right" = end === "start" ? "left" : "right";
      const out: Array<{ value: string; label: string; preview: string }> = [];
      for (const w of DIMS) {
        for (const l of DIMS) {
          out.push({
            value: `${w}-${l}`,
            label: `W:${w.toUpperCase()}  L:${l.toUpperCase()}`,
            preview: arrowSizePreview(w, l, dir),
          });
        }
      }
      return out;
    };

    const push = (end: "start" | "end", typeLabel: string, sizeLabel: string) => {
      body.appendChild(
        this.#ppRow(
          typeLabel,
          createCustomSelect({
            options: shapesFor(end),
            current: current[end].shape,
            ariaLabel: typeLabel,
            // PowerPoint arranges the 6 preset shapes as a 3-wide × 2-tall
            // grid of icon buttons, not a vertical list. Pass columns: 3
            // so the custom-select popup matches the layout exactly.
            columns: 3,
            popupWidth: 170,
            onChange: (v) => {
              const next = { start: { ...current.start }, end: { ...current.end } };
              next[end].shape = v as ArrowShape;
              for (const t of this.#targets) applyArrowHead(t, next);
              current[end].shape = v as ArrowShape;
              this.#commit();
            },
          }),
        ),
      );
      body.appendChild(
        this.#ppRow(
          sizeLabel,
          createCustomSelect({
            options: sizesFor(end),
            current: `${current[end].width}-${current[end].length}`,
            ariaLabel: sizeLabel,
            columns: 3, // 3×3 grid
            popupWidth: 180,
            onChange: (v) => {
              const [w, l] = v.split("-") as [ArrowDim, ArrowDim];
              const next = { start: { ...current.start }, end: { ...current.end } };
              next[end].width = w;
              next[end].length = l;
              for (const t of this.#targets) applyArrowHead(t, next);
              current[end].width = w;
              current[end].length = l;
              this.#commit();
            },
          }),
        ),
      );
    };
    push("start", "Begin arrow type", "Begin arrow size");
    push("end", "End arrow type", "End arrow size");
  }

  /** Small SVG preview for the 3×3 arrow size grid. PowerPoint's
   *  grid shows short stems and big, readable arrow heads so the
   *  w × l proportions are immediately distinguishable; our earlier
   *  version had too much stem and too-small heads, making the cells
   *  look nearly identical. This rewrite:
   *    - expands the dimensional scale range (sm=0.4, lg=1.7) so
   *      `sm-sm` vs `lg-lg` differ by over 4×
   *    - bumps the base head geometry (W=7, L=14) so even the
   *      smallest cell has a legible arrow head
   *    - keeps the stem short (fixed ~10px) so the head dominates
   *      each cell, matching PowerPoint's visual priority
   *  The preview is horizontally mirrored for the Begin-arrow picker
   *  so the arrow faces the same way it will render on the line. */
  // `#arrowSizePreview`, `#ppNumberInput`, `#ppSliderRow`, `#dashPreview`
  // extracted to `./property-panel-helpers.ts` (Stage 3b-1).
}

// `openAnchoredPopoverForColor` now lives in property-controls.ts so
// both the selection and tool property editors share a single
// implementation (including the "No fill" affordance via allowNone).
