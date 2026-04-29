import {
  CATEGORY_CONTROL_SHAPE,
  classifyPropertyElement,
  PROPERTY_CONTROL_IDS,
  PROPERTY_CONTROLS,
  type PropertyCategory,
  type PropertyControlId,
  type PropertyEffectId,
} from "@ingcreators/annot-core/editor/property-schema";
import { convertTextVariant, detectTextVariant } from "@ingcreators/annot-core/editor/text-utils";
import { createColorPullButton } from "@ingcreators/annot-editor/property-controls";
import { convertRedactStyle } from "@ingcreators/annot-editor/redact-utils";
import type { CanvasManager } from "./canvas-manager.js";
import type { History } from "./history.js";
import { ppNumberInput } from "./property-panel-helpers.js";
import {
  type CommitInfo,
  type ElementReplacement,
  type PropertyEffectHandler,
  type RenderControlDeps,
  renderControl,
} from "./property-panel-renderer.js";
import { applyArrowHead, detectArrowEnds } from "./tools/arrow-tool.js";
import { applyDrawStyle, isFreehandGroup } from "./tools/freehand-tool.js";
import { convertMarkerShape, resizeMarker } from "./tools/marker-tool.js";
import type {
  ArrowDim,
  ArrowHead,
  ArrowShape,
  DrawStyle,
  MarkerShape,
  RedactStyle,
} from "./tools/tool-base.js";

/** Per-end arrow effect handler — mutates a single shape field of
 *  an arrow's per-end spec and re-applies via `applyArrowHead`.
 *  Returns identity replacements; the outer `<g>` keeps DOM
 *  identity so `onTargetReplaced` is correctly skipped. Shared by
 *  the `applyArrowStartShape` / `applyArrowEndShape` effect
 *  handlers bound in the PropertyPanel constructor. */
function applyArrowEndField(
  els: readonly SVGElement[],
  end: "start" | "end",
  field: "shape",
  value: ArrowShape,
): ElementReplacement[] {
  const out: ElementReplacement[] = [];
  for (const el of els) {
    const spec = detectArrowEnds(el);
    const next = { start: { ...spec.start }, end: { ...spec.end } };
    next[end][field] = value;
    applyArrowHead(el, next);
    out.push({ oldEl: el, newEl: el });
  }
  return out;
}

/** Per-end arrow size handler — splits the `"w-l"` value back into
 *  per-axis dims, mutates both, re-applies. Same identity-
 *  replacement shape as the shape handler. */
function applyArrowEndSizeField(
  els: readonly SVGElement[],
  end: "start" | "end",
  value: string,
): ElementReplacement[] {
  const [w, l] = value.split("-") as [ArrowDim, ArrowDim];
  const out: ElementReplacement[] = [];
  for (const el of els) {
    const spec = detectArrowEnds(el);
    const next = { start: { ...spec.start }, end: { ...spec.end } };
    next[end].width = w;
    next[end].length = l;
    applyArrowHead(el, next);
    out.push({ oldEl: el, newEl: el });
  }
  return out;
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
      // Per-end arrow type / size effect handlers (Phase C). Each
      // reads the current per-end spec, mutates a single field, and
      // re-applies via `applyArrowHead` — same per-element mutation
      // shape the imperative `#addPPArrowRows` callbacks used.
      // Returned identity replacements skip `onTargetReplaced` (the
      // outer `<g data-type="arrow">` keeps DOM identity); the
      // commit routes through `onStyleChanged` because per-end Type
      // / Size edits are non-variant (changing one end's shape /
      // size doesn't trigger preset rubber-band, mirroring the
      // imperative `#commit()` behaviour).
      applyArrowStartShape: (els, value) =>
        applyArrowEndField(els, "start", "shape", value as ArrowShape),
      applyArrowStartSize: (els, value) => applyArrowEndSizeField(els, "start", value as string),
      applyArrowEndShape: (els, value) =>
        applyArrowEndField(els, "end", "shape", value as ArrowShape),
      applyArrowEndSize: (els, value) => applyArrowEndSizeField(els, "end", value as string),
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

  /** Render a control against an explicit target list rather than
   *  `this.#targets`. Used by the Pattern A "shape-with-text"
   *  surface to wire the existing fill / stroke / etc. controls
   *  to the inner geometry primitive (`<rect>` / `<ellipse>` …)
   *  while the wrapper `<g>` itself stays the host element for
   *  the text-side controls. */
  #renderRegistryControlAgainst(targets: SVGElement[], id: PropertyControlId): void {
    if (targets.length === 0) return;
    const deps: RenderControlDeps = {
      effects: this.#effects,
      onCommit: (info) => this.#handleRendererCommit(info),
    };
    const el = renderControl(PROPERTY_CONTROLS[id], targets, deps);
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

  #renderShapeControls(_el: SVGElement): void {
    // Type section — schema-driven variant pickers (Phase 3b).
    this.#inSection("Type", () => {
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.shapeTypePicker);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.arrowVariantPicker);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.drawStylePicker);
    });

    // Fill section — fillColor + fillOpacity. Hidden entirely for
    // stroke-only families (line / path / freehand group) via
    // `#inSection`'s "remove root if empty body" cleanup, since both
    // defs' `visibleWhen` excludes those families.
    this.#inSection("Fill", () => {
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.fillColor);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.fillOpacity);
    });

    // Line section — fully schema-driven now. Per-end arrow Type /
    // Size pulldowns landed in Phase C of
    // `property-panel-schema-extensions.md`; their `visibleWhen:
    // isLineLike` gate hides them for non-line targets, and the
    // shape pulldowns' dynamic `getOptions` filters the OOXML
    // preset list by the current variant ("Line" hides all non-
    // "none"; "Arrow" splits the rule per-end).
    this.#inSection("Line", () => {
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.strokeColor);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.strokeOpacity);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.strokeWidth);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.strokeStyle);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.strokeLinecap);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.arrowStartShape);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.arrowStartSize);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.arrowEndShape);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.arrowEndSize);
    });
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
  #renderTextboxControls(g: SVGElement): void {
    // Pattern A wrappers (data-shape-kind ∈ rect / rounded /
    // ellipse) carry a user-drawn geometry primitive whose
    // stroke / fill the user originally configured via the Shape
    // toolbar. After the dblclick promotion they expect those
    // controls to remain accessible alongside the new text
    // controls — otherwise the impression is that "the Shape's
    // colors got replaced by Text's". Surface the geometry's
    // fill / stroke controls scoped to the inner primitive.
    const shapeKind = g.getAttribute("data-shape-kind");
    const isPatternA = shapeKind === "rect" || shapeKind === "rounded" || shapeKind === "ellipse";
    const innerGeometry = isPatternA
      ? (g.querySelector(":scope > rect, :scope > ellipse") as SVGElement | null)
      : null;

    this.#inSection("Type", () => {
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.textVariantPicker);
    });

    if (innerGeometry) {
      // Fill section — colour + opacity of the underlying shape.
      this.#inSection("Fill", () => {
        this.#renderRegistryControlAgainst([innerGeometry], PROPERTY_CONTROL_IDS.fillColor);
        this.#renderRegistryControlAgainst([innerGeometry], PROPERTY_CONTROL_IDS.fillOpacity);
      });
      // Line section — stroke colour / width / dash style.
      this.#inSection("Line", () => {
        this.#renderRegistryControlAgainst([innerGeometry], PROPERTY_CONTROL_IDS.strokeColor);
        this.#renderRegistryControlAgainst([innerGeometry], PROPERTY_CONTROL_IDS.strokeWidth);
        this.#renderRegistryControlAgainst([innerGeometry], PROPERTY_CONTROL_IDS.strokeStyle);
      });
    }

    // Text section — applies to the wrapper itself (text colour,
    // font, per-character toggles, alignment).
    this.#inSection("Text", () => {
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.textColor);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.fontFamily);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.fontSize);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.textBold);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.textItalic);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.textUnderline);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.textAnchor);
      this.#renderRegistryControl(PROPERTY_CONTROL_IDS.textVerticalAnchor);
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
  // `#addPPLineSection` and `#addPPFillSection` removed in
  // Extensions Phase B — both sections are now schema-driven via
  // `#renderShapeControls` calling `#renderRegistryControl` per id.
  // The registry's strokeColor / strokeWidth setValues internally
  // expand to freehand <path> children + handle composed-arrow
  // augmentations (head-filled fill propagation, refreshArrowPath
  // regen). Fill / Line / per-end-arrow gating uses each def's
  // `visibleWhen` predicate plus `#inSection`'s "remove root if
  // empty" cleanup. Per-end arrow type+size grids stay imperative
  // (`#addPPArrowRows`); Phase C will model them.

  // `#addPPArrowRows` removed in Extensions Phase C — the 4
  // per-end pulldowns (Begin / End × Type / Size) are now schema-
  // driven via the `arrowStartShape` / `arrowStartSize` /
  // `arrowEndShape` / `arrowEndSize` registry defs. The variant-
  // filter logic (Type options change based on the OTHER end's
  // shape) lives in each shape def's `getOptions(el)` callback;
  // the size 3×3 width × length grid is a static `options` field.
  // Effect handlers bound in the constructor call
  // `applyArrowHead` per target with the modified spec.
}

// `openAnchoredPopoverForColor` now lives in property-controls.ts so
// both the selection and tool property editors share a single
// implementation (including the "No fill" affordance via allowNone).
