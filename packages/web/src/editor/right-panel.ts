import { builtinIcon } from "@ingcreators/annot-core";
import "../ui/annot-icon.js";

/**
 * `<annot-editor-right-panel>` — unified context-aware properties
 * panel.
 *
 * The three built-in blocks (tool-properties, selection-properties,
 * page-elements) are `UISection` modules under
 * `./right-panel-sections/`. Plugin-registered right-panel
 * sections render alongside, sorted by `priority`.
 *
 * Layout (top to bottom):
 *   ┌─ Actions ──────────────────────┐    ← only with selection
 *   │ ↺  ↻  ↔  ↕   ⇧  ⇩  ⤴ ⤵ etc.    │       (rotate/flip/arrange/align/group)
 *   └─────────────────────────────────┘
 *   ┌─ Sections (sorted by priority) ┐
 *   │ • right-panel.tool-properties   │  ← when active tool
 *   │ • right-panel.selection-properties│ ← when selection
 *   │ • right-panel.page-elements     │  ← when pageMetadata
 *   │ • plugin sections by priority   │
 *   └─────────────────────────────────┘
 *   ┌─ Empty state ──────────────────┐    ← when no section visible
 *   └─────────────────────────────────┘
 *
 * Lit Phase 2 — the class facade became this Lit element. The
 * `setPageMetadata` / `showToolProperties` / `showSelectionProperties`
 * / `destroy` / `notifyUpdate` method surface is preserved so
 * pre-Lit callers don't move.
 *
 * Design decisions preserved from the previous implementation:
 *
 *   1. Tool and Selection modes are MUTUALLY EXCLUSIVE. Their
 *      sections each have a `visible(ctx)` predicate; the host
 *      already enforces "either active tool or selection, not
 *      both" by calling `showSelectionProperties([])` whenever a
 *      drawing tool is active and `showToolProperties(null)` on
 *      selection. The visible() guards then ensure exactly one
 *      section mounts.
 *
 *   2. Transform / Arrange / Align / Group buttons live in an
 *      "Actions" panel chrome rendered above the section list.
 *      Operations the user performs ON a shape, not properties
 *      they edit. Stays as panel-level chrome (not a UISection)
 *      to preserve the visual hierarchy.
 *
 *   3. The panel is ALWAYS VISIBLE (240 px reserved). Hiding /
 *      showing on selection changes would cause canvas-size
 *      jitter and fit-to-window recomputes.
 *
 *   4. `PropertyPanel` is a panel-level singleton. The
 *      selection-properties section borrows its host element on
 *      mount and detaches on unmount, so the embedded
 *      PropertyPanel's internal observers / event listeners
 *      survive mode switches.
 */

import { highlightColorLabel } from "@ingcreators/annot-core/editor";
import {
  readTransformState,
  setRotation,
  toggleFlip,
} from "@ingcreators/annot-core/editor/transform-utils";
import type { PageMetadata } from "@ingcreators/annot-core/storage";
import type { SelectionManager } from "@ingcreators/annot-editor";
import { type CanvasManager, type History, PropertyPanel } from "@ingcreators/annot-editor";
import type { UISection, UISectionContext, UISectionLifecycle } from "../app/plugin-host.js";
import { html, LitElement, unsafeHTML } from "../lit.js";
import { logger } from "../logger.js";
import { createPageElementsSection } from "./right-panel-sections/annot-page-elements-section.js";
import { createSelectionPropertiesSection } from "./right-panel-sections/annot-selection-properties-section.js";
import { createToolPropertiesSection } from "./right-panel-sections/annot-tool-properties-section.js";
import type { Toolbar } from "@ingcreators/annot-editor-shell/toolbar";

// =============================================================================
// Action-button SVGs — custom glyphs modeled on PowerPoint's ribbon
// icons so the visual language feels familiar to Office users. All
// drawn on a 24×24 viewBox with stroke-width 1.6 (matching Material
// Symbols' "Outlined" weight) and `currentColor` so they pick up the
// panel's text / accent colors through .toolbar-btn styling.
// =============================================================================

/** Flip Horizontal — two triangles meeting at a vertical axis, mirrored. */
const FLIP_H_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 4 V20" stroke-dasharray="1 2"/>
  <path d="M4 7 L10 7 L10 17 L4 17 Z" fill="currentColor" fill-opacity="0.2"/>
  <path d="M20 7 L14 7 L14 17 L20 17 Z"/>
</svg>`;

/** Flip Vertical — same motif, rotated 90°. */
const FLIP_V_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 12 H20" stroke-dasharray="1 2"/>
  <path d="M7 4 L7 10 L17 10 L17 4 Z" fill="currentColor" fill-opacity="0.2"/>
  <path d="M7 20 L7 14 L17 14 L17 20 Z"/>
</svg>`;

const BRING_TO_FRONT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
  <rect x="4" y="4" width="11" height="11" stroke-opacity="0.45"/>
  <rect x="9" y="9" width="11" height="11" fill="currentColor"/>
</svg>`;

const SEND_TO_BACK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
  <rect x="4" y="4" width="11" height="11" fill="currentColor"/>
  <rect x="9" y="9" width="11" height="11" fill="var(--annot-bg-panel, #fff)" stroke-opacity="0.9"/>
</svg>`;

const BRING_FORWARD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="4" y="8" width="12" height="12" fill="currentColor" fill-opacity="0.15"/>
  <path d="M20 16 V6 M16 10 L20 6 L24 10" transform="translate(-2 0)"/>
</svg>`;

const SEND_BACKWARD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="4" y="4" width="12" height="12" fill="currentColor" fill-opacity="0.15"/>
  <path d="M20 8 V18 M16 14 L20 18 L24 14" transform="translate(-2 0)"/>
</svg>`;

/** Built-in section ids exposed by the right-panel. Used by
 *  `App.init({ disableBuiltinUISections })` to opt out of any
 *  given section without touching plugin code. Documented in
 *  `docs/plans/_done/plugin-ui-slots.md`. */
export const BUILTIN_RIGHT_PANEL_SECTION_IDS = [
  "right-panel.tool-properties",
  "right-panel.selection-properties",
  "right-panel.page-elements",
] as const;

interface MountedSection {
  section: UISection;
  sectionEl: HTMLElement;
  bodyEl: HTMLElement;
  lifecycle: UISectionLifecycle;
  reactive: boolean;
}

export class AnnotEditorRightPanelElement extends LitElement {
  static override properties = {
    toolbar: { attribute: false },
    canvas: { attribute: false },
    history: { attribute: false },
    selection: { attribute: false },
    getPluginSections: { attribute: false },
    isBuiltinSectionDisabled: { attribute: false },
    activeToolId: { state: true },
    currentSelection: { state: true },
    pageMetadata: { state: true },
  };

  declare toolbar: Toolbar | null;
  declare canvas: CanvasManager | null;
  declare history: History | null;
  declare selection: SelectionManager | null;
  declare getPluginSections: (() => UISection[]) | null;
  declare isBuiltinSectionDisabled: ((id: string) => boolean) | null;
  declare activeToolId: string | null;
  declare currentSelection: SVGElement[];
  declare pageMetadata: PageMetadata | null;

  /** Inline, "docked" PropertyPanel — owned at the panel level so
   *  its internal observers / event listeners survive mode
   *  switches. The selection-properties section attaches /
   *  detaches `#propPanelHost` to / from its mount container. */
  #propPanel: PropertyPanel | null = null;
  #propPanelHost: HTMLElement;

  /** Built-in sections constructed once on first mount (when the
   *  Toolbar / Canvas / History / Selection deps are all known). */
  #builtinSections: UISection[] | null = null;
  #mounted: MountedSection[] = [];

  constructor() {
    super();
    this.toolbar = null;
    this.canvas = null;
    this.history = null;
    this.selection = null;
    this.getPluginSections = null;
    this.isBuiltinSectionDisabled = null;
    this.activeToolId = null;
    this.currentSelection = [];
    this.pageMetadata = null;
    // Stable PropertyPanel host built once; the selection section
    // attaches / detaches it across mode switches.
    this.#propPanelHost = document.createElement("div");
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.body.classList.add("has-right-panel");
    // The host `#editor-right-panel` is `display: flex` (column).
    // With this Lit element wrapping the actions / sections-host
    // / empty-state divs, the flex column would only see ONE
    // item (this element) and any inner `flex: 1` rules on the
    // sections-host wouldn't grow against the empty-state row.
    // `display: contents` makes the wrapper transparent so the
    // three children become direct flex items of the column.
    this.style.display = "contents";
  }

  override disconnectedCallback(): void {
    this.#disposeSections();
    this.#setDrawingBanner(false);
    document.body.classList.remove("has-right-panel");
    super.disconnectedCallback();
  }

  override render() {
    const hasSelection = this.currentSelection.length > 0;
    return html`
      <section
        class="editor-right-panel-section editor-right-panel-actions"
        data-section-id="right-panel.actions"
        style=${hasSelection ? "" : "display: none"}
      >
        <h3 class="editor-right-panel-section-title">Actions</h3>
        <!--
          Body wrapper mirrors the Selected card's .prop-panel-docked
          inner column so level-2 sub-section headers (Transform /
          Arrange / Align / Group) line up horizontally with the
          Selected side's TYPE / FILL / LINE — same nesting, same
          CSS, no Actions-specific override. Each sub-group is a
          regular .pp-section with a .pp-section-header for the
          label; only the button row stays
          .editor-right-panel-actions-row because its tighter 2 px
          button gap (vs .pp-section-body's 6 px) is intentional for
          icon-button rows.
        -->
        <div class="prop-panel prop-panel-docked">
          <div class="pp-section">
            <div class="pp-section-header">Transform</div>
            <div class="editor-right-panel-actions-row">
              <button type="button"
                class="toolbar-btn"
                data-tooltip="Rotate 90° counter-clockwise"
                aria-label="Rotate 90° counter-clockwise"
                @click=${() => this.#rotate(-90)}>
                <annot-icon .spec=${builtinIcon("rotate_left")}></annot-icon>
              </button>
              <button type="button"
                class="toolbar-btn"
                data-tooltip="Rotate 90° clockwise"
                aria-label="Rotate 90° clockwise"
                @click=${() => this.#rotate(90)}>
                <annot-icon .spec=${builtinIcon("rotate_right")}></annot-icon>
              </button>
              ${this.#svgActionBtn(FLIP_H_SVG, "Flip Horizontal (Shift+H)", () => this.#flip("h"))}
              ${this.#svgActionBtn(FLIP_V_SVG, "Flip Vertical (Shift+V)", () => this.#flip("v"))}
            </div>
          </div>

          <div class="pp-section">
            <div class="pp-section-header">Arrange</div>
            <div class="editor-right-panel-actions-row">
              ${this.#svgActionBtn(BRING_TO_FRONT_SVG, "Bring to Front (Ctrl+Shift+])", () =>
                this.selection?.bringToFront(),
              )}
              ${this.#svgActionBtn(BRING_FORWARD_SVG, "Bring Forward (Ctrl+])", () =>
                this.selection?.bringForward(),
              )}
              ${this.#svgActionBtn(SEND_BACKWARD_SVG, "Send Backward (Ctrl+[)", () =>
                this.selection?.sendBackward(),
              )}
              ${this.#svgActionBtn(SEND_TO_BACK_SVG, "Send to Back (Ctrl+Shift+[)", () =>
                this.selection?.sendToBack(),
              )}
            </div>
          </div>

          <div class="pp-section">
            <div class="pp-section-header">Align</div>
            <div class="editor-right-panel-actions-row">
              <button type="button"
                class="toolbar-btn"
                data-tooltip="Align left"
                aria-label="Align left"
                @click=${() => this.selection?.alignSelected("left")}>
                <annot-icon .spec=${builtinIcon("align_horizontal_left")}></annot-icon>
              </button>
              <button type="button"
                class="toolbar-btn"
                data-tooltip="Align center"
                aria-label="Align center"
                @click=${() => this.selection?.alignSelected("center-h")}>
                <annot-icon .spec=${builtinIcon("align_horizontal_center")}></annot-icon>
              </button>
              <button type="button"
                class="toolbar-btn"
                data-tooltip="Align right"
                aria-label="Align right"
                @click=${() => this.selection?.alignSelected("right")}>
                <annot-icon .spec=${builtinIcon("align_horizontal_right")}></annot-icon>
              </button>
              <button type="button"
                class="toolbar-btn"
                data-tooltip="Distribute horizontally (needs 3+)"
                aria-label="Distribute horizontally (needs 3+)"
                @click=${() => this.selection?.distributeSelected("horizontal")}>
                <annot-icon .spec=${builtinIcon("horizontal_distribute")}></annot-icon>
              </button>
            </div>
            <div class="editor-right-panel-actions-row">
              <button type="button"
                class="toolbar-btn"
                data-tooltip="Align top"
                aria-label="Align top"
                @click=${() => this.selection?.alignSelected("top")}>
                <annot-icon .spec=${builtinIcon("align_vertical_top")}></annot-icon>
              </button>
              <button type="button"
                class="toolbar-btn"
                data-tooltip="Align middle"
                aria-label="Align middle"
                @click=${() => this.selection?.alignSelected("middle-v")}>
                <annot-icon .spec=${builtinIcon("align_vertical_center")}></annot-icon>
              </button>
              <button type="button"
                class="toolbar-btn"
                data-tooltip="Align bottom"
                aria-label="Align bottom"
                @click=${() => this.selection?.alignSelected("bottom")}>
                <annot-icon .spec=${builtinIcon("align_vertical_bottom")}></annot-icon>
              </button>
              <button type="button"
                class="toolbar-btn"
                data-tooltip="Distribute vertically (needs 3+)"
                aria-label="Distribute vertically (needs 3+)"
                @click=${() => this.selection?.distributeSelected("vertical")}>
                <annot-icon .spec=${builtinIcon("vertical_distribute")}></annot-icon>
              </button>
            </div>
          </div>

          <div class="pp-section">
            <div class="pp-section-header">Group</div>
            <div class="editor-right-panel-actions-row">
              <button type="button"
                class="toolbar-btn"
                data-tooltip="Group (Ctrl+G)"
                aria-label="Group"
                @click=${() => this.selection?.groupSelected()}>
                <annot-icon .spec=${builtinIcon("join_inner")}></annot-icon>
              </button>
              <button type="button"
                class="toolbar-btn"
                data-tooltip="Ungroup (Ctrl+Shift+G)"
                aria-label="Ungroup"
                @click=${() => this.selection?.ungroupSelected()}>
                <annot-icon .spec=${builtinIcon("join_left")}></annot-icon>
              </button>
            </div>
          </div>
        </div>
      </section>

      <div class="editor-right-panel-sections-host"></div>

      <div class="editor-right-panel-empty">
        <annot-icon class="editor-right-panel-empty-icon" .spec=${builtinIcon("tune")}></annot-icon>
        <p class="editor-right-panel-empty-title">Properties</p>
        <p class="editor-right-panel-empty-hint">
          Pick a tool or select a shape to see its properties here.
        </p>
      </div>
    `;
  }

  #svgActionBtn(svg: string, tooltip: string, onClick: () => void) {
    return html`
      <button
        type="button"
        class="toolbar-btn action-btn-svg"
        data-tooltip=${tooltip}
        aria-label=${tooltip}
        @click=${onClick}
      >
        ${unsafeHTML(svg)}
      </button>
    `;
  }

  protected override updated(): void {
    // Lazy-initialise the PropertyPanel + built-in sections once
    // the editor-host deps are known. Re-running cheaply after
    // that since `#buildBuiltinSections` returns the cached list.
    this.#ensurePropPanel();
    this.#renderSections();
    this.#setDrawingBanner(this.activeToolId === "freehand");
    // Empty-state visibility follows whether any section actually
    // mounted. Hidden by style() rather than re-rendered so Lit
    // doesn't churn the template on every section change.
    const empty = this.querySelector(".editor-right-panel-empty") as HTMLElement | null;
    if (empty) empty.style.display = this.#mounted.length > 0 ? "none" : "";
  }

  #ensurePropPanel(): void {
    if (this.#propPanel || !this.canvas || !this.history || !this.selection) return;
    const selection = this.selection;
    const toolbar = this.toolbar;
    this.#propPanel = new PropertyPanel(this.#propPanelHost, this.canvas, this.history, "docked");
    this.#propPanel.onTargetReplaced = (replacements) => {
      const newEls = replacements.map((r) => r.newEl);
      if (newEls.length === 1) selection.select(newEls[0]!);
      else selection.selectMultiple(newEls);
    };
    this.#propPanel.onTargetMutated = () => selection.refreshHandles();
    // Rubber-band: editing a shape's color/width via the Selection
    // panel updates the matching tool's preset so the next shape
    // drawn with that tool inherits the value.
    this.#propPanel.onStyleChanged = (targets) => {
      if (!toolbar) return;
      for (const t of targets) toolbar.syncPresetFromElement(t);
    };
    // Variant change (e.g. Selected Arrow → Selected Double arrow
    // via the Type picker). Load the new variant's preset and apply
    // its style attrs so the element visually reflects the variant's
    // saved defaults, then re-render this panel so the TITLE
    // refreshes and variant-dependent controls (like the per-end
    // shape picker's filter) rebuild against the new state.
    this.#propPanel.onVariantChanged = (targets) => {
      if (toolbar) for (const t of targets) toolbar.applyElementVariantPreset(t);
      selection.refreshHandles();
      this.showSelectionProperties(targets);
    };
  }

  #builtinSectionList(): UISection[] {
    if (this.#builtinSections) return this.#builtinSections;
    if (!this.toolbar || !this.canvas || !this.history || !this.selection) return [];
    const panel = this.#propPanel;
    if (!panel) return [];
    this.#builtinSections = [
      createToolPropertiesSection({
        getActiveToolId: () => this.activeToolId,
        getToolbar: () => this.toolbar!,
      }),
      createSelectionPropertiesSection({
        getSelection: () => this.currentSelection,
        getPropPanelHost: () => this.#propPanelHost,
        showPropPanel: (els) => panel.show(els),
        hidePropPanel: () => panel.hide(),
        computeTitle: (els) => this.#computeSelectionTitle(els),
      }),
      createPageElementsSection({
        getPageMetadata: () => this.pageMetadata,
        getCanvas: () => this.canvas!,
        getHistory: () => this.history!,
        getSelection: () => this.selection!,
      }),
    ];
    return this.#builtinSections;
  }

  /** Section context handed to every `mount` / `update` call. The
   *  `path` / `mode` / `tags` fields are placeholders for now —
   *  the right-panel doesn't directly receive them; a future
   *  follow-up can plumb them via properties if a plugin section
   *  needs them. */
  /** Build a context object scoped to a specific section's heading
   *  element. Each `mount(container, ctx)` call gets its OWN ctx
   *  whose `setTitle` writes to that section's `<h3>` and no other.
   *
   *  The previous shared-ctx implementation looked up "the last
   *  mounted section" inside `setTitle` — a race that, after the
   *  Actions section landed, started writing the Selection
   *  section's dynamic title ("Selected Ellipse") onto the
   *  page-elements section's heading. The user-visible symptom
   *  was a "Selection" / "Tool" header pair appearing empty while
   *  "Selected Ellipse" leaked onto the page-elements card. */
  #ctxFor(headingEl: HTMLElement): UISectionContext {
    return {
      path: "",
      mode: "",
      tags: {},
      setTitle: (newTitle) => {
        headingEl.textContent = newTitle;
      },
    };
  }

  #composeSections(): UISection[] {
    const isDisabled = this.isBuiltinSectionDisabled ?? (() => false);
    const builtins = this.#builtinSectionList().filter((s) => !isDisabled(s.id));
    const plugins = this.getPluginSections?.() ?? [];
    const all = [...builtins, ...plugins];
    return all.sort((a, b) => {
      const ap = Number.isFinite(a.priority) ? a.priority : Number.POSITIVE_INFINITY;
      const bp = Number.isFinite(b.priority) ? b.priority : Number.POSITIVE_INFINITY;
      return ap - bp;
    });
  }

  #renderSections(): void {
    const host = this.querySelector(".editor-right-panel-sections-host") as HTMLElement | null;
    if (!host) return;
    this.#disposeSections();
    host.innerHTML = "";

    for (const section of this.#composeSections()) {
      const sectionEl = document.createElement("section");
      sectionEl.className = "editor-right-panel-section";
      sectionEl.dataset["sectionId"] = section.id;
      const heading = document.createElement("h3");
      heading.className = "editor-right-panel-section-title";
      heading.textContent = section.title;
      sectionEl.appendChild(heading);
      const body = document.createElement("div");
      body.className = "editor-right-panel-section-body";
      sectionEl.appendChild(body);
      // Per-section ctx so `setTitle(...)` writes to THIS section's
      // own heading instead of leaking onto a sibling. The
      // visibility predicate also runs against the per-section ctx
      // so it matches the value `mount` will see — no shared-ctx
      // surprise.
      const ctx = this.#ctxFor(heading);
      if (section.visible && !section.visible(ctx)) continue;
      host.appendChild(sectionEl);
      try {
        const lifecycle = section.mount(body, ctx);
        this.#mounted.push({
          section,
          sectionEl,
          bodyEl: body,
          lifecycle,
          reactive: typeof lifecycle === "object",
        });
      } catch (e) {
        console.error(`[right-panel] section "${section.id}" mount threw:`, e);
        sectionEl.remove();
      }
    }
  }

  #disposeSections(): void {
    for (const state of this.#mounted) {
      try {
        if (typeof state.lifecycle === "function") state.lifecycle();
        else state.lifecycle.unmount();
      } catch (e) {
        console.error(`[right-panel] section "${state.section.id}" unmount threw:`, e);
      }
    }
    this.#mounted = [];
  }

  /** Called when the active tool changes. `toolId === null` →
   *  Select mode (no tool). */
  showToolProperties(toolId: string | null): void {
    this.activeToolId = toolId;
  }

  /** Called on selection change. Empty selection → hide section. */
  showSelectionProperties(elements: SVGElement[]): void {
    this.currentSelection = elements;
  }

  /** Update / clear the DOM-element metadata for the current image.
   *  Pass `null` (or omit) when loading an image without metadata
   *  (paste, desktop capture, legacy) — the Elements section then
   *  hides itself. Called by EditorSession on each new editor
   *  session. */
  setPageMetadata(meta: PageMetadata | null | undefined): void {
    this.pageMetadata = meta ?? null;
    logger.debug(
      "[annot/editor] setPageMetadata:",
      meta ? `${meta.elements.length} elements` : "null/undefined",
      meta?.captureRect,
    );
  }

  /** Pre-Lit API parity — `.destroy()` is an alias for `.remove()`.
   *  `disconnectedCallback` handles section teardown + chrome
   *  cleanup. */
  destroy(): void {
    this.remove();
  }

  /**
   * Lightweight refresh: dispatch `update(ctx)` to every reactive
   * section without re-rendering DOM. Use when only data inside an
   * existing section changed and visibility didn't flip.
   */
  notifyUpdate(): void {
    for (const state of this.#mounted) {
      if (state.reactive) {
        const lifecycle = state.lifecycle as { update?(c: UISectionContext): void };
        if (lifecycle.update) {
          // Each section gets a ctx scoped to its own heading so
          // a late `setTitle(...)` doesn't leak onto a sibling.
          const heading = state.sectionEl.querySelector<HTMLElement>(
            ".editor-right-panel-section-title",
          );
          if (!heading) continue;
          try {
            lifecycle.update(this.#ctxFor(heading));
          } catch (e) {
            console.error(`[right-panel] section "${state.section.id}" update threw:`, e);
          }
        }
      }
    }
  }

  /** Toggle the floating "Drawing mode" banner shown at the top of
   *  the canvas while the Draw tool is active. Communicates that
   *  strokes are accumulating into a session that needs to be
   *  committed (Esc / Done). Lazily-created. */
  #setDrawingBanner(visible: boolean): void {
    const id = "draw-session-indicator";
    let banner = document.getElementById(id);
    if (visible && !banner) {
      banner = document.createElement("div");
      banner.id = id;
      banner.innerHTML = `
        <annot-icon .spec=${builtinIcon("edit")}></annot-icon>
        <span>Drawing — press <kbd>Esc</kbd> or <b>Done</b> to finish</span>
      `;
      document.body.appendChild(banner);
    } else if (!visible && banner) {
      banner.remove();
    }
  }

  #rotate(delta: number): void {
    if (!this.history || !this.selection || this.currentSelection.length === 0) return;
    for (const t of this.currentSelection) {
      const cur = readTransformState(t).rotation;
      setRotation(t, cur + delta);
    }
    this.history.save();
    this.selection.refreshHandles();
  }

  #flip(axis: "h" | "v"): void {
    if (!this.history || !this.selection || this.currentSelection.length === 0) return;
    for (const t of this.currentSelection) toggleFlip(t, axis);
    this.history.save();
    this.selection.refreshHandles();
  }

  /** Friendly, user-facing title for the selection. Plumbed into
   *  the selection-properties section's `computeTitle` dep so the
   *  panel-level naming logic stays co-located with the rest of
   *  the right-panel state. */
  #computeSelectionTitle(elements: SVGElement[]): string {
    if (elements.length === 1) {
      return `Selected ${this.#elementTypeName(elements[0]!)}`;
    }
    const counts = new Map<string, number>();
    for (const el of elements) {
      const full = this.#elementTypeName(el);
      const base = full.replace(/\s*\(.*\)$/, "");
      counts.set(base, (counts.get(base) ?? 0) + 1);
    }
    const pluralize = (name: string, n: number): string => {
      if (n === 1) return name.toLowerCase();
      return `${name.toLowerCase()}s`;
    };
    const parts = Array.from(counts.entries()).map(([name, n]) => `${n} ${pluralize(name, n)}`);
    let breakdown: string;
    if (parts.length <= 3) {
      breakdown = parts.join(" + ");
    } else {
      breakdown = `${parts.slice(0, 2).join(" + ")} + ${parts.length - 2} more`;
    }
    return `${elements.length} selected \u2014 ${breakdown}`;
  }

  #elementTypeName(el: SVGElement): string {
    const tag = el.tagName;
    if (tag === "rect") {
      if (el.getAttribute("data-highlight") === "1") {
        const label = highlightColorLabel(el.getAttribute("fill"));
        return label ? `Highlight (${label})` : "Highlight";
      }
      if (el.getAttribute("data-redact-style") === "solid") return "Solid redaction";
      if (el.hasAttribute("data-rounded")) return "Rounded rectangle";
      return "Rectangle";
    }
    if (tag === "ellipse") return "Ellipse";
    if (tag === "line") return "Line";
    if (tag === "text") return "Text";
    if (tag === "image") {
      const rs = el.getAttribute("data-redact-style");
      if (rs === "mosaic") return "Mosaic";
      if (rs === "blur") return "Blur";
      return "Redaction";
    }
    if (tag === "path") {
      const style = el.getAttribute("data-draw-style");
      if (style === "highlighter") return "Draw (Highlighter)";
      if (style === "pen") return "Draw (Pen)";
      return "Drawing";
    }
    if (tag === "g") {
      const type = el.getAttribute("data-type");
      if (type === "group") {
        const n = el.children.length;
        return `Group (${n} item${n === 1 ? "" : "s"})`;
      }
      if (type === "freehand") {
        const style = el.getAttribute("data-draw-style");
        if (style === "highlighter") return "Draw (Highlighter)";
        return "Draw (Pen)";
      }
      if (type === "arrow") {
        const headS = el.getAttribute("data-arrow-start-shape");
        const headE = el.getAttribute("data-arrow-end-shape");
        const hasStart = headS && headS !== "none";
        const hasEnd = headE && headE !== "none";
        if (hasStart && hasEnd) return "Double arrow";
        if (hasEnd || hasStart) return "Arrow";
        return "Line";
      }
      if (type === "shape") {
        const kind = el.getAttribute("data-shape-kind");
        // Text-on-shape wrappers carry the original geometry's
        // identity: rect / rounded / ellipse stay labelled by
        // their shape kind ("Selected Rectangle"), not the text
        // content they may also contain. Single-click selects
        // the SHAPE; double-click enters text edit mode and the
        // panel re-renders text-side controls.
        if (kind === "rect") return "Rectangle";
        if (kind === "rounded") return "Rounded rectangle";
        if (kind === "ellipse") return "Ellipse";
        if (kind === "callout") return "Callout";
        if (kind === "sticky") return "Sticky note";
        return "Text";
      }
      if (el.hasAttribute("data-marker")) {
        const shape = el.getAttribute("data-shape");
        if (shape === "rect") return "Counter (Square)";
        if (shape === "rounded") return "Counter (Rounded square)";
        return "Counter (Circle)";
      }
    }
    return "Element";
  }
}

if (!customElements.get("annot-editor-right-panel")) {
  customElements.define("annot-editor-right-panel", AnnotEditorRightPanelElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-editor-right-panel": AnnotEditorRightPanelElement;
  }
}
