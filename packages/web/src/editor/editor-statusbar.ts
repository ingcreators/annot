import { builtinIcon } from "@ingcreators/annot-core";
import "../ui/annot-icon.js";
/**
 * `<annot-editor-statusbar>` — editor footer bar:
 *
 *   [zoom] [dimensions] ───── [current tool]
 *
 * Lit Phase 4 — replaces the imperative `StatusHost.build()`
 * DOM construction. The controls drive the canvas directly via
 * the `canvas` property; the host class still owns the
 * orchestration (`new StatusHost().build(canvas, w, h)`) but
 * renders through this element.
 */

import type { CanvasManager } from "@ingcreators/annot-editor";
import { html, LitElement, nothing } from "../lit.js";

export const ZOOM_OPTIONS: { label: string; value: number | "fit" }[] = [
  { label: "Fit to window", value: "fit" },
  { label: "25%", value: 0.25 },
  { label: "50%", value: 0.5 },
  { label: "75%", value: 0.75 },
  { label: "100%", value: 1 },
  { label: "150%", value: 1.5 },
  { label: "200%", value: 2 },
  { label: "300%", value: 3 },
];

export class AnnotEditorStatusbarElement extends LitElement {
  static override properties = {
    canvas: { attribute: false },
    width: { type: Number },
    height: { type: Number },
    currentToolName: { type: String },
    zoomMenuOpen: { state: true },
    zoomLabel: { state: true },
    isFitMode: { state: true },
    zoomValue: { state: true },
  };

  declare canvas: CanvasManager | null;
  declare width: number;
  declare height: number;
  declare currentToolName: string;
  declare zoomMenuOpen: boolean;
  declare zoomLabel: string;
  declare isFitMode: boolean;
  declare zoomValue: number;

  #closeMenu: ((e: MouseEvent) => void) | null = null;

  constructor() {
    super();
    this.canvas = null;
    this.width = 0;
    this.height = 0;
    this.currentToolName = "Select";
    this.zoomMenuOpen = false;
    this.zoomLabel = "100%";
    this.isFitMode = false;
    this.zoomValue = 1;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Pre-Lit method preserved so editor-session callers don't
   *  move. Updates the active-tool indicator on the right side
   *  of the statusbar. */
  setActiveTool(name: string): void {
    this.currentToolName = name;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("click", this.#onDocClick);
    // The host `#statusbar` is `display: flex` and lays out
    // [zoom controls] [dimensions] [.toolbar-spacer] [tool name]
    // as direct flex children. With this Lit wrapper sitting in
    // between, the flex container only sees one block-level item
    // (`<annot-editor-statusbar>`) and the inner `.toolbar-spacer`
    // (which relies on `flex: 1` to push the tool name to the
    // right) collapses to 0 width. `display: contents` makes the
    // wrapper transparent to layout so the spacer works again.
    this.style.display = "contents";
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("click", this.#onDocClick);
    if (this.#closeMenu) document.removeEventListener("click", this.#closeMenu);
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has("canvas") && this.canvas) {
      // Track zoom changes — the canvas is the source of truth.
      // Snapshot initial state so the label matches before any
      // user gesture lands.
      this.#syncFromCanvas();
      const canvas = this.canvas;
      canvas.onZoomChange = () => this.#syncFromCanvas();
    }
  }

  #syncFromCanvas(): void {
    if (!this.canvas) return;
    this.isFitMode = this.canvas.isFitMode;
    this.zoomValue = this.canvas.zoom;
    this.zoomLabel = this.canvas.isFitMode ? "Fit" : `${Math.round(this.canvas.zoom * 100)}%`;
  }

  #onDocClick = (): void => {
    // Any click anywhere closes the menu. The menu's own click
    // handlers stop propagation so they don't trigger this.
    if (this.zoomMenuOpen) this.zoomMenuOpen = false;
  };

  override render() {
    return html`
      <div id="status-zoom">${this.#renderZoomControls()}</div>
      <span data-tooltip="Image dimensions (width × height in pixels)"
        aria-label="Image dimensions"
        >${this.width} \u00d7 ${this.height}</span
      >
      <span class="toolbar-spacer"></span>
      <span
        id="status-tool"
        data-tooltip="Current tool — press V or Esc to return to Select"
        aria-label="Current tool"
        >${this.currentToolName}</span
      >
    `;
  }

  #renderZoomControls() {
    return html`
      <div id="zoom-controls">
        <button type="button"
          class="zoom-btn"
          data-tooltip="Zoom out (\u221210%)"
          aria-label="Zoom out"
          @click=${() => this.canvas?.setZoom(this.zoomValue - 0.1)}>
            <annot-icon .spec=${builtinIcon("remove")}></annot-icon>
          </button>
        <div class="zoom-select-wrap">
          <button type="button"
            class="zoom-label"
            data-tooltip="Zoom level — click to choose a preset"
            aria-label="Zoom level — click to choose a preset"
            @click=${this.#toggleMenu}
          >
            ${this.zoomLabel}
          </button>
          ${this.zoomMenuOpen ? this.#renderZoomMenu() : nothing}
        </div>
        <button type="button"
          class="zoom-btn"
          data-tooltip="Zoom in (+10%)"
          aria-label="Zoom in"
          @click=${() => this.canvas?.setZoom(this.zoomValue + 0.1)}>
            <annot-icon .spec=${builtinIcon("add")}></annot-icon>
          </button>
      </div>
    `;
  }

  #renderZoomMenu() {
    return html`
      <div class="zoom-menu" style="display: block">
        ${ZOOM_OPTIONS.map((opt) => {
          if (opt.value === "fit") {
            return html`
              <button
                type="button"
                class=${this.isFitMode ? "zoom-menu-item active" : "zoom-menu-item"}
                @click=${(e: MouseEvent) => {
                  e.stopPropagation();
                  this.canvas?.fitToView();
                  this.zoomMenuOpen = false;
                }}
              >
                Fit to window
              </button>
              <div class="zoom-menu-sep"></div>
            `;
          }
          const numeric = opt.value;
          const isActive =
            !this.isFitMode &&
            Math.round(this.zoomValue * 100) === Math.round(numeric * 100);
          return html`
            <button
              type="button"
              class=${isActive ? "zoom-menu-item active" : "zoom-menu-item"}
              @click=${(e: MouseEvent) => {
                e.stopPropagation();
                this.canvas?.setZoom(numeric);
                this.zoomMenuOpen = false;
              }}
            >
              ${opt.label}
            </button>
          `;
        })}
      </div>
    `;
  }

  #toggleMenu = (e: MouseEvent): void => {
    e.stopPropagation();
    this.zoomMenuOpen = !this.zoomMenuOpen;
  };
}

if (!customElements.get("annot-editor-statusbar")) {
  customElements.define("annot-editor-statusbar", AnnotEditorStatusbarElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-editor-statusbar": AnnotEditorStatusbarElement;
  }
}
