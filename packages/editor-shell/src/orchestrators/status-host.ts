/**
 * Status host — orchestrates the editor statusbar
 * (`<annot-editor-statusbar>`): zoom controls, image dimensions,
 * current-tool indicator.
 *
 * Lit Phase 4 — the imperative DOM construction lives inside the
 * `<annot-editor-statusbar>` Lit element. This host class stays as a
 * thin orchestrator so callers don't have to know which Lit element
 * to mount or how to mutate its props between mounts.
 *
 * Phase 3 of `docs/plans/host-convergence.md` lifted this class out
 * of `packages/web/src/app/status-host.ts` so PWA + Desktop + VSCode
 * all share one orchestrator implementation. The earlier PWA-only
 * version queried `document.getElementById("statusbar")` itself,
 * which violates editor-shell's host-boundary invariant
 * (`packages/editor-shell/src/host-boundary.test.ts`); the host
 * element is now injected via the constructor instead. Hosts:
 *
 *   - **PWA**: `new StatusHost(document.getElementById("statusbar")!)`
 *     once per App init.
 *   - **Desktop**: same pattern, against the index.html-shipped
 *     `<div id="statusbar">`.
 *   - **VSCode webview**: against the parallel `<div id="statusbar">`
 *     in the webview HTML scaffold.
 */

import type { CanvasManager } from "@ingcreators/annot-editor";
import "../editor-statusbar.js";
import type { AnnotEditorStatusbarElement } from "../editor-statusbar.js";

export { ZOOM_OPTIONS } from "../editor-statusbar.js";

export class StatusHost {
  readonly #host: HTMLElement;
  #statusbarEl: AnnotEditorStatusbarElement | null = null;

  constructor(host: HTMLElement) {
    this.#host = host;
  }

  /** Build the editor statusbar inside the host element supplied at
   *  construction:
   *
   *   [zoom] [dimensions] ───── [current tool]
   *
   *  Idempotent — calling again clears the previous element and
   *  mounts a fresh one bound to the new canvas / dimensions. */
  build(canvas: CanvasManager, width: number, height: number): void {
    this.#host.innerHTML = "";
    const el = document.createElement("annot-editor-statusbar");
    el.canvas = canvas;
    el.width = width;
    el.height = height;
    this.#host.appendChild(el);
    this.#statusbarEl = el;
  }

  /** Update the right-side current-tool indicator. Called from
   *  the editor session's toolbar callback whenever the active
   *  tool changes. */
  setActiveTool(name: string): void {
    if (this.#statusbarEl) this.#statusbarEl.setActiveTool(name);
  }
}
