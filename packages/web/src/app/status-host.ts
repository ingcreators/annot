/**
 * Status host — orchestrates the editor statusbar (#statusbar):
 * zoom controls, image dimensions, current-tool indicator.
 *
 * Lit Phase 4 — the imperative DOM construction now lives in
 * `<annot-editor-statusbar>`. The host class stays as a thin
 * orchestrator so callers (`AnnotApp`, `EditorSession`) keep the
 * pre-Lit `new StatusHost().build(canvas, w, h)` shape +
 * `setActiveTool(name)` for tool-name updates.
 */

import type { CanvasManager } from "@ingcreators/annot-core";
import "../editor/editor-statusbar.js";
import type { AnnotEditorStatusbarElement } from "../editor/editor-statusbar.js";

export { ZOOM_OPTIONS } from "../editor/editor-statusbar.js";

export class StatusHost {
  #statusbarEl: AnnotEditorStatusbarElement | null = null;

  /** Build the editor statusbar:
   *   [zoom] [dimensions] ───── [current tool]
   */
  build(canvas: CanvasManager, width: number, height: number): void {
    const statusbar = document.getElementById("statusbar");
    if (!statusbar) return;
    statusbar.innerHTML = "";
    const el = document.createElement("annot-editor-statusbar");
    el.canvas = canvas;
    el.width = width;
    el.height = height;
    statusbar.appendChild(el);
    this.#statusbarEl = el;
  }

  /** Update the right-side current-tool indicator. Called from
   *  the editor session's toolbar callback whenever the active
   *  tool changes. */
  setActiveTool(name: string): void {
    if (this.#statusbarEl) this.#statusbarEl.setActiveTool(name);
  }
}
