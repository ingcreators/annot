/**
 * EditorRightPanel — unified context-aware properties panel.
 *
 * Phase 3 of `docs/plans/plugin-ui-slots.md` reshaped this class
 * into a section host. The three previous hardcoded blocks
 * (tool-properties, selection-properties, page-elements) are now
 * `UISection` modules under `./right-panel-sections/`. Plugin-
 * registered right-panel sections (Phase 1's
 * `addRightPanelSection`) render alongside, sorted by `priority`.
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

import type { PageMetadata, SelectionManager, Toolbar } from "@ingcreators/annot-core";
import {
  type CanvasManager,
  type History,
  highlightColorLabel,
  PropertyPanel,
  setTooltip,
} from "@ingcreators/annot-core";
import {
  readTransformState,
  setRotation,
  toggleFlip,
} from "@ingcreators/annot-core/editor/transform-utils";
import type { UISection, UISectionContext, UISectionLifecycle } from "../app/plugin-host.js";
import { createPageElementsSection } from "./right-panel-sections/page-elements-section.js";
import { createSelectionPropertiesSection } from "./right-panel-sections/selection-properties-section.js";
import { createToolPropertiesSection } from "./right-panel-sections/tool-properties-section.js";

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
  <rect x="9" y="9" width="11" height="11" fill="var(--bg-panel, #fff)" stroke-opacity="0.9"/>
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
 *  `docs/plans/plugin-ui-slots.md`. */
export const BUILTIN_RIGHT_PANEL_SECTION_IDS = [
  "right-panel.tool-properties",
  "right-panel.selection-properties",
  "right-panel.page-elements",
] as const;

export interface EditorRightPanelDeps {
  /** Plugin-registered right-panel sections. Combined with built-
   *  ins before sort + filter. Optional. */
  getPluginSections?(): UISection[];
  /** Built-in section ids the deployment opted out of via
   *  `App.init({ disableBuiltinUISections })`. Optional. */
  isBuiltinSectionDisabled?(id: string): boolean;
}

interface MountedSection {
  section: UISection;
  sectionEl: HTMLElement;
  bodyEl: HTMLElement;
  lifecycle: UISectionLifecycle;
  reactive: boolean;
}

export class EditorRightPanel {
  #container: HTMLElement;
  #toolbar: Toolbar;
  #history: History;
  #selection: SelectionManager;
  #canvas: CanvasManager;
  #deps: EditorRightPanelDeps;

  /** Inline, "docked" PropertyPanel — owned at the panel level so
   *  its internal observers / event listeners survive mode
   *  switches. The selection-properties section attaches /
   *  detaches `#propPanelHost` to / from its mount container. */
  #propPanel: PropertyPanel;
  #propPanelHost: HTMLElement;

  /** Action buttons (rotate / flip / arrange / align / group) shown
   *  only when there's a selection. Panel-level chrome — not a
   *  `UISection` — so it stays anchored above the section list
   *  regardless of which sections happen to be visible. */
  #actionsSection: HTMLElement;

  /** Wraps the priority-sorted plugin + built-in sections. Inserted
   *  between Actions and the empty state so the layout stays
   *  consistent across re-renders. */
  #sectionsHost: HTMLElement;

  /** Shown when no section visible — keeps the always-visible
   *  panel feeling intentional. */
  #emptyState: HTMLElement;

  /** Active tool id mirror — set via `showToolProperties`. */
  #activeToolId: string | null = null;
  /** Current selection mirror — set via `showSelectionProperties`. */
  #currentSelection: SVGElement[] = [];
  /** Current page metadata — set via `setPageMetadata`. */
  #pageMetadata: PageMetadata | null = null;

  /** Built-in sections constructed once at panel boot. */
  #builtinSections: UISection[];
  /** Currently-mounted section state. */
  #mounted: MountedSection[] = [];

  constructor(
    container: HTMLElement,
    toolbar: Toolbar,
    canvas: CanvasManager,
    history: History,
    selection: SelectionManager,
    deps: EditorRightPanelDeps = {},
  ) {
    this.#container = container;
    this.#toolbar = toolbar;
    this.#history = history;
    this.#selection = selection;
    this.#canvas = canvas;
    this.#deps = deps;
    this.#container.innerHTML = "";

    // --- Actions section (transform / arrange / align / group buttons) ---
    this.#actionsSection = document.createElement("section");
    this.#actionsSection.className = "editor-right-panel-actions";
    this.#actionsSection.style.display = "none";
    this.#buildActionButtons(this.#actionsSection);
    this.#container.appendChild(this.#actionsSection);

    // --- Sections host (priority-sorted built-ins + plugins) ---
    this.#sectionsHost = document.createElement("div");
    this.#sectionsHost.className = "editor-right-panel-sections-host";
    this.#container.appendChild(this.#sectionsHost);

    // --- PropertyPanel singleton ---
    // Built once into a stable host element so its event listeners
    // / observers survive mode switches. The selection-properties
    // section attaches / detaches this host as it mounts /
    // unmounts.
    this.#propPanelHost = document.createElement("div");
    this.#propPanel = new PropertyPanel(this.#propPanelHost, canvas, history, "docked");
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
      for (const t of targets) toolbar.syncPresetFromElement(t);
    };
    // Variant change (e.g. Selected Arrow → Selected Double arrow
    // via the Type picker). Load the new variant's preset and apply
    // its style attrs so the element visually reflects the variant's
    // saved defaults, then re-render this panel so the TITLE refreshes
    // and variant-dependent controls (like the per-end shape picker's
    // filter) rebuild against the new state.
    this.#propPanel.onVariantChanged = (targets) => {
      for (const t of targets) toolbar.applyElementVariantPreset(t);
      selection.refreshHandles();
      this.showSelectionProperties(targets);
    };

    // --- Empty state ---
    this.#emptyState = document.createElement("div");
    this.#emptyState.className = "editor-right-panel-empty";
    this.#emptyState.innerHTML = `
      <span class="editor-right-panel-empty-icon material-symbols-outlined">tune</span>
      <p class="editor-right-panel-empty-title">Properties</p>
      <p class="editor-right-panel-empty-hint">
        Pick a tool or select a shape to see its properties here.
      </p>
    `;
    this.#container.appendChild(this.#emptyState);

    // --- Built-in sections ---
    this.#builtinSections = [
      createToolPropertiesSection({
        getActiveToolId: () => this.#activeToolId,
        getToolbar: () => this.#toolbar,
      }),
      createSelectionPropertiesSection({
        getSelection: () => this.#currentSelection,
        getPropPanelHost: () => this.#propPanelHost,
        showPropPanel: (els) => this.#propPanel.show(els),
        hidePropPanel: () => this.#propPanel.hide(),
        computeTitle: (els) => this.#computeSelectionTitle(els),
      }),
      createPageElementsSection({
        getPageMetadata: () => this.#pageMetadata,
        getCanvas: () => this.#canvas,
        getHistory: () => this.#history,
        getSelection: () => this.#selection,
      }),
    ];

    document.body.classList.add("has-right-panel");
    this.#render();
  }

  /** Called when the active tool changes. `toolId === null` →
   *  Select mode (no tool). */
  showToolProperties(toolId: string | null): void {
    this.#activeToolId = toolId;
    // The tool-properties section's `visible(ctx)` filters out
    // null / "crop" tools, so a null toolId naturally hides the
    // section on the next render.
    this.#setDrawingBanner(toolId === "freehand");
    this.#render();
  }

  /** Called on selection change. Empty selection → hide section. */
  showSelectionProperties(elements: SVGElement[]): void {
    this.#currentSelection = elements;
    this.#render();
  }

  /** Update / clear the DOM-element metadata for the current image.
   *  Pass `null` (or omit) when loading an image without metadata
   *  (paste, desktop capture, legacy) — the Elements section then
   *  hides itself. Called by EditorSession on each new editor
   *  session. */
  setPageMetadata(meta: PageMetadata | null | undefined): void {
    this.#pageMetadata = meta ?? null;
    console.log(
      "[annot/editor] setPageMetadata:",
      meta ? `${meta.elements.length} elements` : "null/undefined",
      meta?.captureRect,
    );
    this.#render();
  }

  destroy(): void {
    this.#disposeSections();
    this.#setDrawingBanner(false);
    this.#container.innerHTML = "";
    document.body.classList.remove("has-right-panel");
  }

  /**
   * Lightweight refresh: dispatch `update(ctx)` to every reactive
   * section without re-rendering DOM. Use when only data inside an
   * existing section changed and visibility didn't flip.
   */
  notifyUpdate(): void {
    const ctx = this.#ctx();
    for (const state of this.#mounted) {
      if (state.reactive) {
        const lifecycle = state.lifecycle as { update?(c: UISectionContext): void };
        if (lifecycle.update) {
          try {
            lifecycle.update(ctx);
          } catch (e) {
            console.error(
              `[right-panel] section "${state.section.id}" update threw:`,
              e,
            );
          }
        }
      }
    }
  }

  /** Section context handed to every `mount` / `update` call. The
   *  `path` / `mode` / `tags` fields are placeholders for now —
   *  the right-panel doesn't directly receive them; a future
   *  follow-up can plumb them via deps if a plugin section needs
   *  them. */
  #ctx(): UISectionContext {
    return {
      path: "",
      mode: "",
      tags: {},
      setTitle: (newTitle) => {
        // Find the most-recently-mounted section that asked to
        // override its title — plugins typically call this from
        // inside `mount` (as the host-supplied DOM is being set
        // up), so the freshest entry in `#mounted` is theirs.
        const last = this.#mounted[this.#mounted.length - 1];
        if (!last) return;
        const heading = last.sectionEl.querySelector(
          ".editor-right-panel-section-title",
        );
        if (heading) heading.textContent = newTitle;
      },
    };
  }

  #composeSections(): UISection[] {
    const isDisabled = this.#deps.isBuiltinSectionDisabled ?? (() => false);
    const builtins = this.#builtinSections.filter((s) => !isDisabled(s.id));
    const plugins = this.#deps.getPluginSections?.() ?? [];
    const all = [...builtins, ...plugins];
    return all.sort((a, b) => {
      const ap = Number.isFinite(a.priority) ? a.priority : Number.POSITIVE_INFINITY;
      const bp = Number.isFinite(b.priority) ? b.priority : Number.POSITIVE_INFINITY;
      return ap - bp;
    });
  }

  #render(): void {
    this.#disposeSections();
    this.#sectionsHost.innerHTML = "";

    // Toggle Actions panel chrome based on selection state. Stays
    // above the section list (panel-level chrome).
    this.#actionsSection.style.display =
      this.#currentSelection.length > 0 ? "" : "none";

    const ctx = this.#ctx();
    let mountedCount = 0;
    for (const section of this.#composeSections()) {
      if (section.visible && !section.visible(ctx)) continue;
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
      this.#sectionsHost.appendChild(sectionEl);
      try {
        const lifecycle = section.mount(body, ctx);
        this.#mounted.push({
          section,
          sectionEl,
          bodyEl: body,
          lifecycle,
          reactive: typeof lifecycle === "object",
        });
        mountedCount++;
      } catch (e) {
        console.error(`[right-panel] section "${section.id}" mount threw:`, e);
        sectionEl.remove();
      }
    }

    this.#emptyState.style.display = mountedCount > 0 ? "none" : "";
  }

  #disposeSections(): void {
    for (const state of this.#mounted) {
      try {
        if (typeof state.lifecycle === "function") state.lifecycle();
        else state.lifecycle.unmount();
      } catch (e) {
        console.error(
          `[right-panel] section "${state.section.id}" unmount threw:`,
          e,
        );
      }
    }
    this.#mounted = [];
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
        <span class="material-symbols-outlined">edit</span>
        <span>Drawing — press <kbd>Esc</kbd> or <b>Done</b> to finish</span>
      `;
      document.body.appendChild(banner);
    } else if (!visible && banner) {
      banner.remove();
    }
  }

  /** Build the rotate / flip / arrange / align / group buttons. Each
   *  button applies its operation to every currently-selected
   *  element and saves a history entry. */
  #buildActionButtons(container: HTMLElement): void {
    const mkBtn = (
      icon: string | { svg: string },
      tooltip: string,
      onClick: () => void,
    ): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.type = "button";
      if (typeof icon === "string") {
        btn.className = "toolbar-btn material-symbols-outlined";
        btn.textContent = icon;
      } else {
        btn.className = "toolbar-btn action-btn-svg";
        btn.innerHTML = icon.svg;
      }
      setTooltip(btn, tooltip);
      btn.addEventListener("click", onClick);
      return btn;
    };

    const mkGroupHeader = (text: string): HTMLElement => {
      const h = document.createElement("div");
      h.className = "editor-right-panel-actions-group-label";
      h.textContent = text;
      return h;
    };

    container.appendChild(mkGroupHeader("Transform"));
    const transformRow = document.createElement("div");
    transformRow.className = "editor-right-panel-actions-row";
    transformRow.appendChild(
      mkBtn("rotate_left", "Rotate 90° counter-clockwise", () => this.#rotate(-90)),
    );
    transformRow.appendChild(mkBtn("rotate_right", "Rotate 90° clockwise", () => this.#rotate(90)));
    transformRow.appendChild(
      mkBtn({ svg: FLIP_H_SVG }, "Flip Horizontal (Shift+H)", () => this.#flip("h")),
    );
    transformRow.appendChild(
      mkBtn({ svg: FLIP_V_SVG }, "Flip Vertical (Shift+V)", () => this.#flip("v")),
    );
    container.appendChild(transformRow);

    container.appendChild(mkGroupHeader("Arrange"));
    const zorderRow = document.createElement("div");
    zorderRow.className = "editor-right-panel-actions-row";
    zorderRow.appendChild(
      mkBtn({ svg: BRING_TO_FRONT_SVG }, "Bring to Front (Ctrl+Shift+])", () =>
        this.#selection.bringToFront(),
      ),
    );
    zorderRow.appendChild(
      mkBtn({ svg: BRING_FORWARD_SVG }, "Bring Forward (Ctrl+])", () =>
        this.#selection.bringForward(),
      ),
    );
    zorderRow.appendChild(
      mkBtn({ svg: SEND_BACKWARD_SVG }, "Send Backward (Ctrl+[)", () =>
        this.#selection.sendBackward(),
      ),
    );
    zorderRow.appendChild(
      mkBtn({ svg: SEND_TO_BACK_SVG }, "Send to Back (Ctrl+Shift+[)", () =>
        this.#selection.sendToBack(),
      ),
    );
    container.appendChild(zorderRow);

    container.appendChild(mkGroupHeader("Align"));
    const alignRow = document.createElement("div");
    alignRow.className = "editor-right-panel-actions-row";
    alignRow.appendChild(
      mkBtn("align_horizontal_left", "Align left", () => this.#selection.alignSelected("left")),
    );
    alignRow.appendChild(
      mkBtn("align_horizontal_center", "Align center", () =>
        this.#selection.alignSelected("center-h"),
      ),
    );
    alignRow.appendChild(
      mkBtn("align_horizontal_right", "Align right", () => this.#selection.alignSelected("right")),
    );
    alignRow.appendChild(
      mkBtn("horizontal_distribute", "Distribute horizontally (needs 3+)", () =>
        this.#selection.distributeSelected("horizontal"),
      ),
    );
    container.appendChild(alignRow);
    const align2Row = document.createElement("div");
    align2Row.className = "editor-right-panel-actions-row";
    align2Row.appendChild(
      mkBtn("align_vertical_top", "Align top", () => this.#selection.alignSelected("top")),
    );
    align2Row.appendChild(
      mkBtn("align_vertical_center", "Align middle", () =>
        this.#selection.alignSelected("middle-v"),
      ),
    );
    align2Row.appendChild(
      mkBtn("align_vertical_bottom", "Align bottom", () => this.#selection.alignSelected("bottom")),
    );
    align2Row.appendChild(
      mkBtn("vertical_distribute", "Distribute vertically (needs 3+)", () =>
        this.#selection.distributeSelected("vertical"),
      ),
    );
    container.appendChild(align2Row);

    container.appendChild(mkGroupHeader("Group"));
    const groupRow = document.createElement("div");
    groupRow.className = "editor-right-panel-actions-row";
    groupRow.appendChild(
      mkBtn("join_inner", "Group (Ctrl+G)", () => this.#selection.groupSelected()),
    );
    groupRow.appendChild(
      mkBtn("join_left", "Ungroup (Ctrl+Shift+G)", () => this.#selection.ungroupSelected()),
    );
    container.appendChild(groupRow);
  }

  #rotate(delta: number): void {
    if (this.#currentSelection.length === 0) return;
    for (const t of this.#currentSelection) {
      const cur = readTransformState(t).rotation;
      setRotation(t, cur + delta);
    }
    this.#history.save();
    this.#selection.refreshHandles();
  }

  #flip(axis: "h" | "v"): void {
    if (this.#currentSelection.length === 0) return;
    for (const t of this.#currentSelection) toggleFlip(t, axis);
    this.#history.save();
    this.#selection.refreshHandles();
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
    return `${elements.length} selected — ${breakdown}`;
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
      if (type === "textbox") {
        const variant = el.getAttribute("data-text-variant");
        if (variant === "callout") return "Callout";
        if (variant === "sticky") return "Sticky note";
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
