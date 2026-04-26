import {
  CATEGORY_CONTROL_SHAPE,
  classifyPropertyElement,
  type PropertyCategory,
  PROPERTY_CONTROL_IDS,
  PROPERTY_CONTROLS,
  type PropertyControlId,
  type PropertyEffectId,
} from "@ingcreators/annot-core/editor/property-schema";
import { computeDasharray, detectDashKey } from "@ingcreators/annot-core/utils";
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
import { convertRedactStyle } from "@ingcreators/annot-editor/redact-utils";
import { convertTextVariant, detectTextVariant } from "@ingcreators/annot-core/editor/text-utils";
import {
  type CommitInfo,
  type ElementReplacement,
  type PropertyEffectHandler,
  renderControl,
  type RenderControlDeps,
} from "./property-panel-renderer.js";
import { applyArrowHead, detectArrowEnds } from "./tools/arrow-tool.js";
import { applyDrawStyle, isFreehandGroup } from "./tools/freehand-tool.js";
import { convertMarkerShape, resizeMarker } from "./tools/marker-tool.js";
import type {
  ArrowDim,
  ArrowHead,
  ArrowShape,
  DrawStyle,
  LineCap,
  MarkerShape,
  RedactStyle,
} from "./tools/tool-base.js";

/** True for any element that represents a line-with-optional-arrowheads:
 *  a classic `<line>` OR the new composed `<g data-type="arrow">`
 *  wrapper produced by ArrowTool (stem + head paths inside). */
function isLineLike(el: Element): boolean {
  if (el.tagName === "line") return true;
  return el.tagName === "g" && el.getAttribute("data-type") === "arrow";
}

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

  /** Effect-handler table consumed by the schema-driven renderer
   *  (see `property-panel-renderer.ts`). Built once in the constructor
   *  so each `#renderViaRegistry` call reuses the same bound handlers
   *  — the deps' identity is stable across re-renders, which lets a
   *  future Storybook / golden test pin behaviour without re-wiring.
   *
   *  Each handler bridges a Tier B `PropertyControlDef.effect` id to
   *  the Tier C operation it represents (arrow head regeneration,
   *  freehand pen↔highlighter, marker geometry rescale, redact
   *  pixel-baked converter). All handlers return per-element
   *  replacement records so the renderer can update its target list
   *  AND the panel can fire `onTargetReplaced` for nodes that swapped
   *  identity. The redact handler is async (canvas pixel sampling); the
   *  others mutate in place + return identity replacements. */
  #effects: Record<PropertyEffectId, PropertyEffectHandler>;

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

    // Bind once — the renderer re-uses the same handlers across every
    // `show()` call. `convertRedactStyle` closes over `this.#canvas`,
    // so the deps object is panel-specific (each PropertyPanel
    // instance has its own canvas reference).
    this.#effects = {
      applyArrowVariant: (els, value) => {
        // The variant value is a 3-state `ArrowHead` ("none"/"end"/
        // "both"); per-end shapes are clamped to that variant via
        // the same `#clampArrowEndsToVariant` rule the imperative
        // chip handler uses, then `applyArrowHead` regenerates the
        // path's `d`. Replacement records carry identity (in-place
        // mutation; the outer element keeps its node).
        const v = value as ArrowHead;
        const out: ElementReplacement[] = [];
        for (const el of els) {
          const ends = detectArrowEnds(el);
          const clamped = this.#clampArrowEndsToVariant(ends, v);
          applyArrowHead(el, clamped);
          out.push({ oldEl: el, newEl: el });
        }
        return out;
      },
      applyDrawStyle: (els, value) => {
        const v = value as DrawStyle;
        const out: ElementReplacement[] = [];
        for (const el of els) {
          applyDrawStyle(el, v);
          out.push({ oldEl: el, newEl: el });
        }
        return out;
      },
      applyMarkerShape: (els, value) => {
        // `convertMarkerShape` swaps the inner bg primitive but the
        // outer <g> keeps identity — no real replacement.
        const v = value as MarkerShape;
        const out: ElementReplacement[] = [];
        for (const el of els) {
          convertMarkerShape(el, v);
          out.push({ oldEl: el, newEl: el });
        }
        return out;
      },
      resizeMarker: (els, value) => {
        const v = Number(value);
        const out: ElementReplacement[] = [];
        for (const el of els) {
          resizeMarker(el, v);
          out.push({ oldEl: el, newEl: el });
        }
        // The marker's bbox changed — the host needs to refresh
        // selection handles. `onTargetMutated` fires from the
        // commit path on a non-empty replacement set; see
        // `#handleRendererCommit`.
        return out;
      },
      applyRedactStyle: async (els, value) => {
        // Mosaic / blur converters resample the underlying base
        // image — async, sequential to avoid N concurrent decodes.
        // Failures per-element are logged but don't abort the
        // batch; the still-converting elements still succeed.
        const v = value as RedactStyle;
        const out: ElementReplacement[] = [];
        for (const el of els) {
          try {
            const newEl = await convertRedactStyle(el, v, this.#canvas);
            out.push({ oldEl: el, newEl });
          } catch (err) {
            console.error("[redact] style convert failed", err);
            out.push({ oldEl: el, newEl: el });
          }
        }
        return out;
      },
      applyTextColor: (els, value) => {
        // Set the text fill + data-color attr first; then for sticky
        // / callout textboxes regenerate the bg primitive (its tint
        // is derived from data-color, so re-running convertTextVariant
        // produces a fresh element with the matching new bg). Plain
        // textboxes return identity replacements — only the inner
        // <text> fill changed, no element swap needed.
        const v = String(value);
        const out: ElementReplacement[] = [];
        for (const el of els) {
          el.querySelector("text")?.setAttribute("fill", v);
          el.setAttribute("data-color", v);
          const variant = detectTextVariant(el);
          if (variant === "plain") {
            out.push({ oldEl: el, newEl: el });
          } else {
            const newEl = convertTextVariant(el, variant);
            out.push({ oldEl: el, newEl });
          }
        }
        return out;
      },
    };
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
        // flip / z-order / ungroup) applies. `CATEGORY_CONTROL_SHAPE
        // .group` is `[]`, so the registry-driven render is a no-op
        // here — equivalent to the previous early return — but it
        // exercises the renderer wiring end-to-end so the Phase 3b–
        // 3f migrations can swap one switch arm at a time without
        // re-plumbing.
        this.#renderViaRegistry(category);
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

  /**
   * Schema-driven render path — looks each id in
   * `CATEGORY_CONTROL_SHAPE[category]` up in `PROPERTY_CONTROLS`
   * (Tier B registry), passes the def + current targets + the
   * panel's own deps to `renderControl`, and appends the produced
   * element under the current `#appendTarget` (so callers wrapping
   * this in `#inSection(...)` get the controls placed inside the
   * right pp-section card).
   *
   * Phase 3a only invokes this for `category === "group"` — an
   * empty registry slice — so the visible behaviour stays
   * "render nothing." Phase 3b–3f will progressively swap the
   * remaining `#renderXxxControls` calls in `show()` for matching
   * `#renderViaRegistry(...)` invocations, deleting the now-unused
   * imperative methods as they go.
   */
  #renderViaRegistry(category: PropertyCategory): void {
    if (this.#targets.length === 0) return;
    for (const id of CATEGORY_CONTROL_SHAPE[category]) {
      this.#renderRegistryControl(id);
    }
  }

  /**
   * Render a single registry control under the current
   * `#appendTarget`. Used by category renderers that mix schema-
   * driven rows (chip pickers, color pulldowns, number inputs) with
   * imperative rows the registry doesn't yet model (transparency
   * sliders, cap type, per-end arrow grids). Phase 3 migrations
   * pull each `#addXxx` chip / color / number row into the
   * corresponding registry id and call this helper in its place,
   * letting `visibleWhen` handle multi-target gating uniformly.
   */
  #renderRegistryControl(id: PropertyControlId): void {
    if (this.#targets.length === 0) return;
    const deps: RenderControlDeps = {
      effects: this.#effects,
      onCommit: (info) => this.#handleRendererCommit(info),
    };
    const el = renderControl(PROPERTY_CONTROLS[id], this.#targets, deps);
    if (el) this.#target().appendChild(el);
  }

  /**
   * Bridge from the renderer's `onCommit(info)` callback to the
   * panel's existing host-callback contract:
   *   - apply replacements to `#targets` so subsequent edits route
   *     to the post-swap elements
   *   - fire `onTargetReplaced` for entries whose identity actually
   *     changed (`oldEl !== newEl`); pure in-place mutations
   *     (`setValue` / most `effect`s) skip this signal because the
   *     selection still holds the same DOM nodes
   *   - save history once per commit
   *   - dispatch the rubber-band callbacks: `onVariantChanged` for
   *     variant pickers (so the host loads the new variant's saved
   *     preset instead of overwriting it), `onStyleChanged` for
   *     everything else
   *
   * The branching mirrors the per-control imperative paths in
   * `#renderShapeControls` etc. — variant pickers historically called
   * `this.#history.save()` + `this.onVariantChanged?.(...)` while
   * non-variant edits called `this.#commit()` (which fires
   * `onStyleChanged`). Centralising that branching here is the whole
   * point of the schema-driven migration.
   */
  #handleRendererCommit(info: CommitInfo): void {
    if (info.replacements.length > 0) {
      const map = new Map<SVGElement, SVGElement>(
        info.replacements.map((r) => [r.oldEl, r.newEl] as const),
      );
      this.#targets = this.#targets.map((t) => map.get(t) ?? t);
      const real = info.replacements.filter((r) => r.oldEl !== r.newEl);
      if (real.length > 0) this.onTargetReplaced?.(real);
    }
    this.#history.save();
    if (info.variantChange) {
      if (this.onVariantChanged) {
        this.onVariantChanged(this.#targets);
      } else {
        // No host hook — re-render so dependent controls (e.g. the
        // arrow per-end shape pickers' variant filter) refresh.
        this.show(this.#targets);
      }
    } else {
      this.onStyleChanged?.(this.#targets);
      // For in-place mutations that change visual geometry (resize-
      // Marker), `onTargetMutated` is the host's selection-handle
      // refresh hook. Conservatively fire it on every non-variant
      // commit — selection handles re-laying out is cheap, and the
      // alternative (per-effect-id branching here) duplicates the
      // registry's classification.
      this.onTargetMutated?.();
    }
  }

  #renderShapeControls(el: SVGElement): void {
    // Type section: variant picker appropriate to the selected element
    // family (shape / arrow-like / freehand path). Each picker is now
    // schema-driven — the registry's `visibleWhen` predicates encode
    // the same gating the imperative chain used (`detectShapeType !==
    // null`, `isLineLike`, `path || freehand-group`), and the
    // renderer's all-targets check covers the multi-select rule.
    // The pp-section wrapper is preserved here at the panel layer
    // because the registry doesn't model section grouping.
    this.#inSection("Type", () => {
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.shapeTypePicker);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.arrowVariantPicker);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.drawStylePicker);
    });

    // Fill paint — rendered ABOVE the Line section, matching the tool
    // panel's category order (Type → Fill → Line). Hidden for strokes-
    // only elements (line / path / freehand group) so we don't show a
    // useless "No fill" button for them.
    //
    // Fill / Line sections still go through `#addPPFillSection` /
    // `#addPPLineSection` because they include rows the registry
    // doesn't yet model (fill transparency, stroke transparency,
    // cap type, per-end arrow type+size grids). A future Phase 3b-N
    // can extend the registry to cover those and migrate these
    // sections too.
    if (!isLineLike(el) && el.tagName !== "path" && !isFreehandGroup(el)) {
      this.#addPPFillSection(el);
    }

    // Stroke paint (Line section). #addPPLineSection already builds
    // its own `pp-section` card via `#ppSection("Line")`.
    this.#addPPLineSection(el);
  }

  /**
   * Textbox properties — schema-driven via Phase 3f of
   * `docs/plans/property-panel-schema.md`. All four controls live
   * in the registry:
   *
   *   - `textVariantPicker` (variantPicker → replace via
   *     `convertTextVariant`) — plain / sticky / callout chips. The
   *     replace path produces a fresh element per target; the
   *     renderer threads the swap through `onTargetReplaced` and
   *     fires `onVariantChanged` so the new variant's preset
   *     overrides the carried-over style.
   *
   *   - `textColor` (color → `effect: applyTextColor`) — text fill
   *     write + sticky / callout bg recreation. The effect handler
   *     bound in the constructor sets the attrs in place AND
   *     regenerates the bg primitive for non-plain variants
   *     (returns the post-recreation element so the renderer can
   *     fire `onTargetReplaced`). Plain textboxes return identity.
   *
   *   - `fontFamily` (select) — same 4 presets the imperative
   *     picker offered, plus the renderer's "preserve current value
   *     if non-preset" fallback so externally-supplied custom fonts
   *     round-trip. Renders via `createCustomSelect` (matching the
   *     panel's other dropdowns) instead of the imperative version's
   *     native `<select>` — a visual consistency improvement.
   *
   *   - `fontSize` (number) — 8..96 pt, step 1, unit "pt". The
   *     registry's setValue writes both the `<text>`'s `font-size`
   *     and the outer `data-font-size` marker.
   */
  #renderTextboxControls(_g: SVGElement): void {
    this.#inSection("Type", () => {
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.textVariantPicker);
    });
    this.#inSection("Line", () => {
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.textColor);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.fontFamily);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.fontSize);
    });
  }

  // `#recreateTextbox`, `#addTextVariantPicker`, `#addFontFamilyPicker`,
  // `#addFontSizePicker` removed in Phase 3f — all four textbox
  // controls are now schema-driven. Sticky / callout bg recreation
  // moved into the `applyTextColor` effect handler bound in the
  // constructor; variant conversion is handled by the registry's
  // `textVariantPicker.replace = convertTextVariant`. The font
  // family dropdown switched from a native `<select>` to
  // `createCustomSelect` (renderer's "select" type) for visual
  // consistency with the panel's other dropdowns.

  /**
   * Redact properties — style picker + solid color picker (only
   * relevant for the solid variant). Schema-driven via Phase 3c of
   * `docs/plans/property-panel-schema.md`:
   *
   *   - `redactStylePicker` uses `effect: applyRedactStyle`, the
   *     async handler bound in the constructor that calls
   *     `convertRedactStyle(t, v, this.#canvas)` per target. Mosaic
   *     and blur variants regenerate `<image>` content from
   *     resampled canvas pixels, so the handler is genuinely async;
   *     the renderer awaits before firing onCommit.
   *
   *   - `redactSolidColor` uses `setValue` (sync `fill` attribute
   *     write) and gates itself via `visibleWhen: (el) =>
   *     redactStyleOf(el) === "solid"`. With the renderer's all-
   *     targets gate that means the Fill section materialises only
   *     when EVERY selected target is a solid redact — matching the
   *     legacy `if (detectRedactStyle(t) === "solid")` per-target
   *     filter inside the imperative color callback (which silently
   *     skipped mixed-variant targets).
   *
   * The Fill `pp-section` wrapper is left unconditional here:
   * `#inSection`'s "remove root if body has no children" cleanup
   * makes the empty section disappear when `redactSolidColor`'s
   * `visibleWhen` returns `null` for mosaic / blur selections.
   */
  #renderRedactControls(_el: SVGElement): void {
    this.#inSection("Type", () => {
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.redactStylePicker);
    });
    this.#inSection("Fill", () => {
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.redactSolidColor);
    });
  }

  /** Highlight properties — mirrors the Tool mode Highlight layout.
   *  Schema-driven via Phase 3d of
   *  `docs/plans/property-panel-schema.md`:
   *
   *    - `highlightColorPicker` (variantPicker) — swatch chips. The
   *      registry's `setValue` writes the new `fill` color in place;
   *      because the def's `type === "variantPicker"`, the renderer
   *      flags the commit as `variantChange: true`, which routes
   *      through `#handleRendererCommit`'s onVariantChanged branch
   *      so the host loads the new color's saved Transparency
   *      preset instead of rubber-banding the previous one. Matches
   *      the imperative chain's `#history.save() + onVariantChanged`
   *      sequence one-for-one.
   *
   *    - `highlightTransparency` (number) — `fill-opacity` slider
   *      with the 0..100 percentage / inverse-opacity conversion
   *      baked into the registry's getValue / setValue. Routes
   *      through the standard onCommit (variantChange: false) path
   *      so the rubber-band carries Transparency into the next
   *      Highlight tool draw — same as the imperative `#commit()`.
   *
   *  No Line section — highlight rects are strokeless paints. */
  #renderHighlightControls(_el: SVGElement): void {
    this.#inSection("Type", () => {
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.highlightColorPicker);
    });
    this.#inSection("Fill", () => {
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.highlightTransparency);
    });
  }

  // `#addRedactStylePicker` removed in Phase 3c — the chip row is
  // now produced by the schema-driven renderer
  // (`PROPERTY_CONTROLS.redactStylePicker.effect = "applyRedactStyle"`)
  // and the async effect handler bound in the constructor calls
  // `convertRedactStyle(t, v, this.#canvas)` per target with the
  // same sequential-await pattern the imperative click handler used.

  /**
   * Marker (counter) properties — fully schema-driven via Phase A
   * of `docs/plans/property-panel-schema-extensions.md`.
   *
   *  - Type (markerShapePicker, effect: applyMarkerShape) — landed
   *    in Phase 3e.
   *  - Fill > Color (markerBgFillColor, allowNone) — bg primitive's
   *    interior paint.
   *  - Line > Color / Width / Dash type (markerBgStroke{Color,
   *    Width,Style}) — bg primitive's optional border. Width's
   *    setValue recomputes dasharray against the new width to
   *    match the imperative Line section's proportional behaviour.
   *  - Label > Value (markerLabelValue) — outer `<g>`'s
   *    `data-marker` attr + the inner `<text>`'s textContent kept
   *    in sync via the registry's setValue.
   *  - Label > Size (markerSize, effect: resizeMarker) — landed in
   *    Phase 3e; rescales bg + text geometry proportionally.
   *
   *  All five new defs traverse the inner bg primitive via
   *  `g.querySelector("circle, rect")` — Tier B-friendly element
   *  manipulation, no `effect` needed.
   */
  #renderMarkerControls(_g: SVGElement): void {
    this.#inSection("Type", () => {
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.markerShapePicker);
    });
    this.#inSection("Fill", () => {
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.markerBgFillColor);
    });
    this.#inSection("Line", () => {
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.markerBgStrokeColor);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.markerBgStrokeWidth);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.markerBgStrokeStyle);
    });
    this.#inSection("Label", () => {
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.markerLabelValue);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.markerSize);
    });
  }

  // `#addMarkerShapePicker` removed in Phase 3e — the chip row is now
  // produced by the schema-driven renderer
  // (`PROPERTY_CONTROLS.markerShapePicker.effect = "applyMarkerShape"`)
  // and the effect handler bound in the constructor calls
  // `convertMarkerShape(t, v)` per target. The outer `<g>` keeps
  // identity, so the returned identity replacements skip
  // `onTargetReplaced` while the variantPicker dispatch fires
  // `onVariantChanged` for preset rubber-band — same rationale as
  // the deleted imperative click handler.

  // `#addShapeTypePicker` removed in Phase 3b of
  // `docs/plans/property-panel-schema.md` — the chip row is now
  // produced by the schema-driven renderer
  // (`PROPERTY_CONTROLS.shapeTypePicker.replace = convertShape`)
  // wired through `#renderRegistryControl` from
  // `#renderShapeControls`'s Type section.

  /** Inline SVG preview for an arrow-shape dropdown row. Matches
   *  PowerPoint's visual scheme: right-pointing for End arrow
   *  (outward from line's end), left-pointing for Begin arrow
   *  (outward from line's start). The two variants share the same
   *  geometry, just mirrored horizontally via a wrapper transform. */
  // `#arrowPreview` and `#arrowPreviewContent` extracted to
  // `./property-panel-helpers.ts` (Stage 3b-1). Call sites use the
  // imported `arrowPreview` / `arrowPreviewContent` directly.

  // `#addStrokeOpacityPicker` removed in Phase 4 — never called from
  // anywhere in the panel. Stroke transparency is handled inline by
  // `#addPPLineSection` which writes its own ppNumberInput row.

  // `#addArrowVariantPicker` removed in Phase 3b — the chip row is
  // now produced by the schema-driven renderer
  // (`PROPERTY_CONTROLS.arrowVariantPicker.effect = "applyArrowVariant"`)
  // and the effect handler bound in the constructor calls
  // `#clampArrowEndsToVariant` + `applyArrowHead` per target. The
  // clamp helper below stays — it's still used by that handler.

  /** Adjust per-end shapes to fit a variant's constraint, preserving
   *  already-valid values. The clamp rules per variant:
   *    Line         → begin + end forced to "none"
   *    Arrow        → begin forced to "none"; if end was "none", seed
   *                   "triangle", else keep (preserves e.g. diamond)
   *    Double arrow → any "none" ends get seeded "triangle"; non-
   *                   none ends (triangle / diamond / oval / …) kept
   *  Width / length are always carried over unchanged — only shape
   *  values get adjusted. Called from the `applyArrowVariant` effect
   *  handler bound in the constructor. */
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

  // `#addDrawStylePicker` removed in Phase 3b — the chip row is now
  // produced by the schema-driven renderer
  // (`PROPERTY_CONTROLS.drawStylePicker.effect = "applyDrawStyle"`)
  // and the effect handler bound in the constructor calls
  // `applyDrawStyle` per target.

  // `#addOpacityPicker` removed in Phase 4 — never called from
  // anywhere in the panel. Fill transparency is handled inline by
  // `#addPPFillSection` (shape) and `#renderHighlightControls`
  // (highlight, schema-driven via `highlightTransparency`).

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

  // `#addWidthPicker` and `#addStylePicker` removed in Phase 4 —
  // visual chip-grid pickers for stroke width / dash pattern that
  // were never wired up from any category render method (the live
  // panel uses ppNumberInput / createCustomSelect rows in
  // `#addPPLineSection` instead). Their `WIDTH_OPTIONS` and
  // `STYLE_PRESETS` constants went with them.

  // `#addFontSizePicker` removed in Phase 3f — schema-driven via
  // `PROPERTY_CONTROLS.fontSize` (8..96 pt, step 1, unit "pt"). The
  // registry's setValue does the same `<text>` font-size +
  // `data-font-size` outer-attr write the imperative version did.

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

  // `#addButton` removed in Phase 4 — never called.

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

  // `#addTransformControls` removed in Phase 4 — never invoked from
  // anywhere in the panel. Rotate / flip live on the right-panel
  // Actions row (EditorRightPanel) per the rationale documented in
  // `show()`'s trailing comment.

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
