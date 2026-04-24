/**
 * EditorRightPanel — unified context-aware properties panel.
 *
 * Layout (top to bottom):
 *   ┌─ Actions ──────────────────────┐    ← only with selection
 *   │ ↺  ↻  ↔  ↕                     │       (rotate/flip)
 *   └─────────────────────────────────┘
 *   ┌─ [Dynamic Title] ──────────────┐    ← tool OR selection props
 *   │ Color ▌                         │
 *   │ Width  3 pt                     │
 *   │ ...                             │
 *   └─────────────────────────────────┘
 *
 * Design decisions (consolidated from the earlier two-section layout):
 *
 *   1. SINGLE properties section with a DYNAMIC title — e.g.
 *      "Rectangle" when the Shape tool is active with the rect
 *      variant, "Arrow" when an arrow is selected. The generic
 *      "Tool" / "Selection" section labels were removed because they
 *      describe the MECHANISM (which data source) rather than the
 *      CONTENT (what the user is editing). Concrete names match the
 *      Figma / Miro / Excalidraw convention.
 *
 *   2. Tool and Selection modes are MUTUALLY EXCLUSIVE. Only one
 *      content block is visible at a time (the host's `app.ts`
 *      already enforces this: it calls `showSelectionProperties([])`
 *      whenever a drawing tool is active, and vice versa). So the
 *      panel keeps ONE content container and swaps its contents.
 *
 *   3. Transform (rotate/flip) moved OUT of the properties panel
 *      into an "Actions" button row above it. Rationale: rotate/flip
 *      are operations the user performs ON a shape, not properties
 *      they edit. Exposing them as quick-tap buttons matches the
 *      Figma / Miro / PowerPoint convention and removes the
 *      temptation to treat rotation as a cumulative numeric input.
 *
 *   4. The panel is ALWAYS VISIBLE (240 px reserved). Hiding/showing
 *      on selection changes would cause canvas-size jitter and
 *      fit-to-window recomputes.
 */
import type { PageElement, PageMetadata, SelectionManager, Toolbar } from "@ingcreators/annot-core";
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

const SVG_NS = "http://www.w3.org/2000/svg";

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

/** Bring to Front — two overlapping rectangles, the front one solid
 *  (closer to viewer), the back one outlined. Matches PowerPoint's
 *  "bring to front" glyph where the foreground shape is emphasized. */
const BRING_TO_FRONT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
  <rect x="4" y="4" width="11" height="11" stroke-opacity="0.45"/>
  <rect x="9" y="9" width="11" height="11" fill="currentColor"/>
</svg>`;

/** Send to Back — inverse of BringToFront: the BACK shape is the
 *  solid one, the front is merely outlined. */
const SEND_TO_BACK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
  <rect x="4" y="4" width="11" height="11" fill="currentColor"/>
  <rect x="9" y="9" width="11" height="11" fill="var(--bg-panel, #fff)" stroke-opacity="0.9"/>
</svg>`;

/** Bring Forward — single rectangle with an up-pointing arrow on
 *  the right, echoing PowerPoint's "step up one layer" glyph. */
const BRING_FORWARD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="4" y="8" width="12" height="12" fill="currentColor" fill-opacity="0.15"/>
  <path d="M20 16 V6 M16 10 L20 6 L24 10" transform="translate(-2 0)"/>
</svg>`;

/** Send Backward — mirror of BringForward: same rect + down arrow. */
const SEND_BACKWARD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="4" y="4" width="12" height="12" fill="currentColor" fill-opacity="0.15"/>
  <path d="M20 8 V18 M16 14 L20 18 L24 14" transform="translate(-2 0)"/>
</svg>`;

export class EditorRightPanel {
  #container: HTMLElement;
  #toolbar: Toolbar;
  #history: History;
  #selection: SelectionManager;

  /** Inline, "docked" PropertyPanel — no floating chrome. */
  #propPanel: PropertyPanel;

  /** Action buttons (rotate/flip) shown only with selection. */
  #actionsSection: HTMLElement;

  /** Single properties section with dynamic title. */
  #propertiesSection: HTMLElement;
  #titleEl: HTMLElement;
  /** Container for tool-side rendered controls. */
  #toolContent: HTMLElement;
  /** Container for PropertyPanel's content (Selection mode). */
  #selectionContent: HTMLElement;

  /** Shown when neither tool nor selection has something to edit. */
  #emptyState: HTMLElement;

  /** Track mode so swapping the visible content is idempotent. */
  #mode: "none" | "tool" | "selection" = "none";
  /** Selected targets remembered so the action buttons can reach them. */
  #currentTargets: SVGElement[] = [];

  // ---- Elements (DOM metadata) section ----

  /** Lazy: only created when an image with pageMetadata is loaded. */
  #elementsSection: HTMLElement | null = null;
  #elementsBody: HTMLElement | null = null;
  /** Live metadata for the current image. Null when the image has
   *  no DOM snapshot (paste, desktop capture, legacy). */
  #pageMetadata: PageMetadata | null = null;
  /** Filtered list of elements currently displayed (matches search
   *  + falls within screenshot bounds). */
  #visibleElements: PageElement[] = [];
  /** Hover-highlight overlay drawn in the canvas SVG when a sidebar
   *  row is hovered. Lazy-created on first hover. */
  #hoverHighlight: SVGRectElement | null = null;
  /** CanvasManager — needed to insert annotations + draw the hover
   *  overlay on the canvas SVG. Stashed at construction time. */
  #canvas: CanvasManager;

  constructor(
    container: HTMLElement,
    toolbar: Toolbar,
    canvas: CanvasManager,
    history: History,
    selection: SelectionManager,
  ) {
    this.#container = container;
    this.#toolbar = toolbar;
    this.#history = history;
    this.#selection = selection;
    this.#canvas = canvas;
    this.#container.innerHTML = "";

    // --- Actions section (transform buttons) ---
    this.#actionsSection = document.createElement("section");
    this.#actionsSection.className = "editor-right-panel-actions";
    this.#actionsSection.style.display = "none";
    this.#buildActionButtons(this.#actionsSection);
    this.#container.appendChild(this.#actionsSection);

    // --- Properties section (dynamic title + swappable content) ---
    this.#propertiesSection = document.createElement("section");
    this.#propertiesSection.className = "editor-right-panel-section";
    this.#propertiesSection.style.display = "none";

    this.#titleEl = document.createElement("h3");
    this.#titleEl.className = "editor-right-panel-section-title";
    this.#propertiesSection.appendChild(this.#titleEl);

    // Two inner containers; exactly one is visible at a time. We keep
    // them as siblings (rather than swapping `innerHTML`) so the embedded
    // PropertyPanel instance survives across mode switches and retains
    // its state (event handlers, observers, etc.).
    this.#toolContent = document.createElement("div");
    this.#toolContent.style.display = "none";
    this.#propertiesSection.appendChild(this.#toolContent);

    this.#selectionContent = document.createElement("div");
    this.#selectionContent.style.display = "none";
    this.#propertiesSection.appendChild(this.#selectionContent);

    this.#container.appendChild(this.#propertiesSection);

    // Embedded PropertyPanel — renders into its own root inside
    // selectionContent, which we toggle visibility on.
    this.#propPanel = new PropertyPanel(this.#selectionContent, canvas, history, "docked");
    this.#propPanel.onTargetReplaced = (replacements) => {
      const newEls = replacements.map((r) => r.newEl);
      if (newEls.length === 1) selection.select(newEls[0]);
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
    // ("Selected Arrow" → "Selected Double arrow") and variant-
    // dependent controls (like the per-end shape picker's filter)
    // rebuild against the new state.
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

    document.body.classList.add("has-right-panel");
    this.#syncEmptyState();
  }

  /** Called when the active tool changes. `toolId === null` → Select
   *  mode (no tool → hide tool content). */
  showToolProperties(toolId: string | null): void {
    if (!toolId || toolId === "crop") {
      // Select mode, or tool has no adjustable properties.
      if (this.#mode === "tool") {
        this.#mode = "none";
        this.#propertiesSection.style.display = "none";
        this.#toolContent.style.display = "none";
        this.#toolContent.innerHTML = "";
      }
      this.#setDrawingBanner(false);
      this.#syncEmptyState();
      return;
    }
    this.#mode = "tool";
    this.#toolContent.innerHTML = "";
    this.#toolbar.renderToolProperties(toolId, this.#toolContent);
    this.#toolContent.style.display = "";
    this.#selectionContent.style.display = "none";
    this.#propPanel.hide();
    this.#titleEl.textContent = this.#toolbar.getToolDisplayTitle(toolId);
    this.#propertiesSection.style.display = "";
    // Tool mode implies no selection — hide Actions (transform buttons
    // have nothing to act on).
    this.#actionsSection.style.display = "none";
    this.#currentTargets = [];
    // Show the floating "Drawing mode" indicator when the freehand
    // tool is active (multi-stroke session continues until Esc/Done —
    // users need a visual cue that the tool is "holding" their work).
    this.#setDrawingBanner(toolId === "freehand");
    this.#syncEmptyState();
  }

  /** Toggle the floating "Drawing mode" banner shown at the top of
   *  the canvas while the Draw tool is active. Communicates that
   *  strokes are accumulating into a session that needs to be
   *  committed (Esc / Done) — surfaces the non-standard draw.io-
   *  style behavior so users don't get confused. Lazily-created. */
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

  /** Called on selection change. Empty selection → hide section. */
  showSelectionProperties(elements: SVGElement[]): void {
    this.#currentTargets = elements;
    if (elements.length === 0) {
      if (this.#mode === "selection") {
        this.#mode = "none";
        this.#propertiesSection.style.display = "none";
        this.#selectionContent.style.display = "none";
        this.#propPanel.hide();
      }
      this.#actionsSection.style.display = "none";
      this.#syncEmptyState();
      return;
    }
    this.#mode = "selection";
    this.#toolContent.style.display = "none";
    this.#toolContent.innerHTML = "";
    this.#selectionContent.style.display = "";
    this.#propPanel.show(elements);
    this.#titleEl.textContent = this.#computeSelectionTitle(elements);
    this.#propertiesSection.style.display = "";
    // Actions only make sense on at least one real element. Markers
    // (numbered badges) have rotation suppressed elsewhere but we
    // still show the flip buttons for consistency.
    this.#actionsSection.style.display = "";
    this.#syncEmptyState();
  }

  destroy(): void {
    this.#container.innerHTML = "";
    document.body.classList.remove("has-right-panel");
    this.#hoverHighlight?.remove();
    this.#hoverHighlight = null;
  }

  /** Update / clear the DOM-element metadata for the current image.
   *  Pass `null` (or omit) when loading an image without metadata
   *  (paste, desktop capture, legacy) — the Elements section then
   *  hides itself. Called by app.ts on each new editor session. */
  setPageMetadata(meta: PageMetadata | null | undefined): void {
    this.#pageMetadata = meta ?? null;
    console.log(
      "[annot/editor] setPageMetadata:",
      meta ? `${meta.elements.length} elements` : "null/undefined",
      meta?.captureRect,
    );
    if (!this.#pageMetadata || this.#pageMetadata.elements.length === 0) {
      // Hide section if visible
      if (this.#elementsSection) this.#elementsSection.style.display = "none";
      return;
    }
    if (!this.#elementsSection) this.#buildElementsSection();
    this.#elementsSection!.style.display = "";
    this.#refreshElementsList("");
  }

  /** Lazy-build the Elements panel: section header + search box +
   *  scrollable list. Mounted at the bottom of the right panel so it
   *  doesn't shift the focus area (Properties / Actions) above. */
  #buildElementsSection(): void {
    const section = document.createElement("section");
    section.className = "editor-right-panel-section editor-right-panel-elements";

    const title = document.createElement("h3");
    title.className = "editor-right-panel-section-title";
    title.textContent = "Elements";
    section.appendChild(title);

    const hint = document.createElement("p");
    hint.className = "editor-right-panel-elements-hint";
    hint.textContent = "Click to draw a box around it.";
    section.appendChild(hint);

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search by text…";
    search.className = "editor-right-panel-elements-search";
    search.addEventListener("input", () => this.#refreshElementsList(search.value));
    section.appendChild(search);

    const body = document.createElement("div");
    body.className = "editor-right-panel-elements-list";
    section.appendChild(body);
    this.#elementsBody = body;

    // Insert BEFORE the empty-state element. The empty state has
    // `flex: 1` to fill remaining space and is appended last in the
    // constructor — appending the Elements section after it would
    // push the section below the visible area, hidden by the
    // panel's flex layout. Inserting before the empty state lands
    // the section in the visible flow above it.
    this.#container.insertBefore(section, this.#emptyState);
    this.#elementsSection = section;
  }

  /** Re-render the elements list, optionally filtered by query (case-
   *  insensitive substring match against text + ariaLabel + role +
   *  placeholder). Off-frame elements (bbox outside captureRect /
   *  screenshot) are skipped — they wouldn't render usefully and
   *  produce nonsense coordinates. */
  #refreshElementsList(query: string): void {
    if (!this.#elementsBody || !this.#pageMetadata) return;
    const meta = this.#pageMetadata;

    // Filter against the metadata's `captureRect` (the doc-coord
    // rectangle the screenshot covers). For area captures this is
    // a small sub-region — without this filter we'd surface every
    // element on the page with screenshot-coord garbage. Element
    // is "in bounds" if its bbox INTERSECTS captureRect at all.
    // Defensive: older metadata records may not have captureRect
    // (the field was added later). Fall back to scrollOffset +
    // viewport so existing screenshots still surface elements.
    const cr = meta.captureRect ?? {
      x: meta.scrollOffset.x,
      y: meta.scrollOffset.y,
      width: meta.viewport.width,
      height: meta.viewport.height,
    };
    const inBounds = (el: PageElement): boolean => {
      const [x, y, w, h] = el.bbox;
      return x + w > cr.x && y + h > cr.y && x < cr.x + cr.width && y < cr.y + cr.height;
    };
    const matchesQuery = (el: PageElement): boolean => {
      if (!query) return true;
      const q = query.toLowerCase();
      return [el.text, el.ariaLabel, el.role, el.placeholder, el.tag, el.href].some((s) =>
        s?.toLowerCase().includes(q),
      );
    };

    const filtered = meta.elements.filter((e) => inBounds(e) && matchesQuery(e));
    console.log(
      "[annot/editor] filtered elements:",
      filtered.length,
      "/",
      meta.elements.length,
      "captureRect:",
      cr,
    );
    this.#visibleElements = filtered;
    this.#elementsBody.innerHTML = "";
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "editor-right-panel-elements-empty";
      empty.textContent = query ? "No matches." : "No interactive elements detected.";
      this.#elementsBody.appendChild(empty);
      return;
    }
    for (const el of filtered) {
      this.#elementsBody.appendChild(this.#buildElementRow(el));
    }
  }

  /** One row in the elements list — icon + label + (optional) sub-text. */
  #buildElementRow(el: PageElement): HTMLElement {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "editor-right-panel-element-row";

    const icon = document.createElement("span");
    icon.className = "editor-right-panel-element-icon material-symbols-outlined";
    icon.textContent = iconForElement(el);
    row.appendChild(icon);

    const text = document.createElement("span");
    text.className = "editor-right-panel-element-label";
    text.textContent = primaryLabelFor(el);
    row.appendChild(text);

    const sub = document.createElement("span");
    sub.className = "editor-right-panel-element-sub";
    sub.textContent = subLabelFor(el);
    row.appendChild(sub);

    setTooltip(row, fullDescriptionFor(el));

    // Hover → outline on canvas. Pointer-leave clears.
    row.addEventListener("mouseenter", () => this.#showHoverHighlight(el));
    row.addEventListener("mouseleave", () => this.#clearHoverHighlight());
    // Click → insert annotation rectangle around the element.
    row.addEventListener("click", () => {
      this.#clearHoverHighlight();
      this.#annotateElement(el);
    });
    return row;
  }

  /** Convert an element's document-coords bbox (from metadata) to
   *  the canvas SVG's viewBox coords (which equal the screenshot's
   *  device-pixel dimensions). Origin is the metadata's `captureRect`
   *  — the doc-coord rect the screenshot covers — so visible / area
   *  / scroll captures all map to the right spot. CSS px → device
   *  px via DPR. */
  #bboxOnScreenshot(el: PageElement): [number, number, number, number] {
    const meta = this.#pageMetadata!;
    const dpr = meta.devicePixelRatio || 1;
    const ox = meta.captureRect.x;
    const oy = meta.captureRect.y;
    const [x, y, w, h] = el.bbox;
    return [(x - ox) * dpr, (y - oy) * dpr, w * dpr, h * dpr];
  }

  /** Draw a translucent outline rect on the canvas SVG at the given
   *  element's bbox. Reuses one rect across hovers (cheap). Cleared
   *  by `#clearHoverHighlight` when the row's hover ends. */
  #showHoverHighlight(el: PageElement): void {
    const [x, y, w, h] = this.#bboxOnScreenshot(el);
    if (!this.#hoverHighlight) {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("fill", "none");
      rect.setAttribute("stroke", "#ff00a8");
      rect.setAttribute("stroke-width", "2");
      rect.setAttribute("vector-effect", "non-scaling-stroke");
      rect.setAttribute("pointer-events", "none");
      rect.setAttribute("data-role", "elements-hover");
      this.#canvas.svg.appendChild(rect);
      this.#hoverHighlight = rect;
    }
    this.#hoverHighlight.setAttribute("x", String(x));
    this.#hoverHighlight.setAttribute("y", String(y));
    this.#hoverHighlight.setAttribute("width", String(w));
    this.#hoverHighlight.setAttribute("height", String(h));
    this.#hoverHighlight.setAttribute("opacity", "1");
  }

  #clearHoverHighlight(): void {
    if (this.#hoverHighlight) this.#hoverHighlight.setAttribute("opacity", "0");
  }

  /** Insert a red rectangle annotation around the element's bbox.
   *  The new rect lands in `#annotations` (so it exports / saves
   *  like any user-drawn rect) and becomes the selection so the
   *  user can immediately tweak it via the Property panel. */
  #annotateElement(el: PageElement): void {
    const [x, y, w, h] = this.#bboxOnScreenshot(el);
    if (w < 1 || h < 1) return;
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(w));
    rect.setAttribute("height", String(h));
    rect.setAttribute("fill", "none");
    rect.setAttribute("stroke", "#ff0000");
    rect.setAttribute("stroke-width", "3");
    this.#canvas.annotations.appendChild(rect);
    this.#history.save();
    // Select the newly-created rect so the user can immediately
    // drag / resize / restyle without an extra click.
    this.#selection.select(rect);
  }

  // ---- Private helpers ----

  /** Build the rotate-CCW / rotate-CW / flip-H / flip-V buttons. Each
   *  button applies its operation to every currently-selected element
   *  and saves a history entry. Rotation is incremental (90° per
   *  click), matching the user's mental model of "do it, see it,
   *  maybe do it again". */
  #buildActionButtons(container: HTMLElement): void {
    /** Icon-only button matching the rest of the editor UI. Tooltip
     *  (positioned above the button via editor.css so it stays
     *  inside the narrow 240 px panel) carries the full PowerPoint
     *  terminology + keyboard shortcut, so users who recognize the
     *  icon click directly and everyone else hovers. */
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

    /** Build a category header matching the property-panel's
     *  pp-section pattern so Actions reads with the same visual
     *  vocabulary as Properties — TRANSFORM / ARRANGE appear the
     *  same way as TYPE / FILL / LINE above. */
    const mkGroupHeader = (text: string): HTMLElement => {
      const h = document.createElement("div");
      h.className = "editor-right-panel-actions-group-label";
      h.textContent = text;
      return h;
    };

    // Group 1: Transform (rotate / flip) — operations that change
    // the element's orientation.
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

    // Group 2: Arrange (z-order) — operations that change the
    // element's stacking position. "Arrange" is PowerPoint's ribbon
    // tab name for this group; matches users' existing vocabulary.
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

    // Group 3: Align — six edge/center options + two distribute.
    // Material Symbols ships dedicated glyphs for horizontal /
    // vertical alignment (align_horizontal_* / align_vertical_*)
    // that read instantly. Distribute shares the horizontal /
    // vertical_distribute pair.
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

    // Group 4: Group / Ungroup.
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
    if (this.#currentTargets.length === 0) return;
    for (const t of this.#currentTargets) {
      const cur = readTransformState(t).rotation;
      setRotation(t, cur + delta);
    }
    this.#history.save();
    this.#selection.refreshHandles();
  }

  #flip(axis: "h" | "v"): void {
    if (this.#currentTargets.length === 0) return;
    for (const t of this.#currentTargets) toggleFlip(t, axis);
    this.#history.save();
    this.#selection.refreshHandles();
  }

  /** Friendly, user-facing title for the selection.
   *
   *  Format:
   *    - Single selection: `"Selected [element name]"` (e.g. "Selected
   *      Rectangle", "Selected Arrow"). The "Selected" prefix makes it
   *      read as a past-tense status ("this is what you've selected")
   *      and disambiguates from Tool-mode titles that use the same
   *      element names but describe "what the tool will create next".
   *    - Multi selection: `"N selected"`.
   *
   *  Element names deliberately MIRROR `Toolbar.getToolDisplayTitle`
   *  output — selecting a rounded rectangle and activating the Shape
   *  tool with the rounded variant both show "Rounded rectangle" (the
   *  former prefixed with "Selected "). This reinforces the mental
   *  model that the properties panel labels the SHAPE, not the
   *  mechanism by which the user got to it. */
  #computeSelectionTitle(elements: SVGElement[]): string {
    if (elements.length === 1) {
      return `Selected ${this.#elementTypeName(elements[0])}`;
    }
    // Multi selection: show the breakdown by element type so users
    // can confirm "what they grabbed" at a glance ("2 rectangles +
    // 1 arrow" beats a generic "3 selected"). Grouping uses the
    // base type name (stripping variant parens) so homogeneous
    // selections collapse cleanly — e.g. 3 rectangles of different
    // sizes all read as "3 rectangles", not "3 different things".
    const counts = new Map<string, number>();
    for (const el of elements) {
      // Use the base element family (before the " (variant)" suffix)
      // so "Counter (Circle)" + "Counter (Square)" collapse to
      // "2 counters" rather than listing variants separately.
      const full = this.#elementTypeName(el);
      const base = full.replace(/\s*\(.*\)$/, "");
      counts.set(base, (counts.get(base) ?? 0) + 1);
    }
    // Pluralize the common cases by appending "s". Types that
    // pluralize irregularly (none in the current set) would need
    // an explicit map; we keep the naive rule for now.
    const pluralize = (name: string, n: number): string => {
      if (n === 1) return name.toLowerCase();
      // "Arrow" → "arrows", "Highlight" → "highlights", etc.
      // "Counter (Circle)" already stripped to "Counter".
      return `${name.toLowerCase()}s`;
    };
    const parts = Array.from(counts.entries()).map(([name, n]) => `${n} ${pluralize(name, n)}`);
    // Cap at 3 segments to keep the title readable in the narrow
    // panel; overflow becomes "…". Users can still see the full
    // count from the leading "N selected" prefix.
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
        // Mirror the Counter (Circle) / Counter (Square) convention:
        // append the color label in parens so "Selected Highlight
        // (Yellow)" makes the current swatch obvious from the panel
        // title alone.
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
      // Mosaic / blur redactions bake a modified PNG into an <image>.
      const rs = el.getAttribute("data-redact-style");
      if (rs === "mosaic") return "Mosaic";
      if (rs === "blur") return "Blur";
      return "Redaction";
    }
    if (tag === "path") {
      // Freehand tool tags its output with data-draw-style so pen vs
      // highlighter strokes surface as distinct element names —
      // matches Toolbar.getToolDisplayTitle's output for the same
      // variants.
      const style = el.getAttribute("data-draw-style");
      // "<Tool> (<variant>)" convention — matches Counter / Highlight
      // naming so "Selected Draw (Pen)" identifies both the family
      // and the variant at a glance.
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
        // Freehand session group — multiple <path> children bundled
        // as one drawing. Read style from the group's data-draw-style
        // (updated on every stroke, so it reflects the latest style).
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
        // Counter variants share the base noun "Counter" and append
        // the shape in parens. The shape names ("Circle", "Square",
        // "Rounded square") are ambiguous without the "Counter"
        // qualifier — e.g. "Selected Circle" could mean a circle
        // shape or a circle marker, so the parens format keeps the
        // identity clear.
        const shape = el.getAttribute("data-shape");
        if (shape === "rect") return "Counter (Square)";
        if (shape === "rounded") return "Counter (Rounded square)";
        return "Counter (Circle)";
      }
    }
    return "Element";
  }

  /** Show the empty-state hint when nothing is visible in the main
   *  sections — keeps the always-visible panel feeling intentional. */
  #syncEmptyState(): void {
    const hasContent = this.#propertiesSection.style.display !== "none";
    this.#emptyState.style.display = hasContent ? "none" : "";
  }
}

// =============================================================================
// Element-row formatting helpers — pure functions of a PageElement.
// Kept at module level so the row builder stays readable.
// =============================================================================

/** Material Symbols glyph name appropriate to the element's role. */
function iconForElement(el: PageElement): string {
  const tag = el.tag;
  if (tag === "button" || el.role === "button") return "smart_button";
  if (tag === "a" || el.role === "link") return "link";
  if (tag === "input") {
    const t = el.inputType || "text";
    if (t === "checkbox") return "check_box";
    if (t === "radio") return "radio_button_checked";
    if (t === "submit" || t === "button") return "smart_button";
    if (t === "email") return "alternate_email";
    if (t === "search") return "search";
    if (t === "password") return "key";
    return "edit";
  }
  if (tag === "textarea") return "edit_note";
  if (tag === "select" || el.role === "combobox") return "list";
  if (tag === "label") return "label";
  if (/^h[1-6]$/.test(tag)) return "title";
  if (el.role === "tab") return "tab";
  if (el.role === "menuitem") return "more_vert";
  if (el.role === "checkbox") return "check_box";
  if (el.role === "radio") return "radio_button_checked";
  if (el.role === "slider") return "tune";
  return "widgets";
}

/** Primary text shown on a row — first available of: ariaLabel,
 *  text, placeholder, role, tag. Trimmed for compactness. */
function primaryLabelFor(el: PageElement): string {
  const candidate = el.ariaLabel || el.text || el.placeholder || el.role || el.tag;
  if (!candidate) return el.tag;
  // Sidebar rows are ~220 px after icon + sub. Keep label snug.
  return candidate.length > 36 ? `${candidate.slice(0, 33)}…` : candidate;
}

/** Sub-label (small grey text on the right) — type / role hint. */
function subLabelFor(el: PageElement): string {
  if (el.tag === "input" && el.inputType) return el.inputType;
  if (el.tag === "a") return "link";
  if (/^h[1-6]$/.test(el.tag)) return el.tag;
  if (el.role && el.role !== el.tag) return el.role;
  return el.tag;
}

/** Tooltip — the full label without truncation, plus role and href. */
function fullDescriptionFor(el: PageElement): string {
  const parts: string[] = [];
  const label = el.ariaLabel || el.text || el.placeholder;
  if (label) parts.push(label);
  parts.push(`<${el.tag}${el.role ? ` role="${el.role}"` : ""}>`);
  if (el.href) parts.push(`→ ${el.href}`);
  return parts.join("\n");
}
