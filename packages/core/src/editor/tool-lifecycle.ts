// Tier B — DOM-side abstraction the editor's tools depend on, in
// place of poking `CanvasManager.annotations` and `History.save()`
// directly. Two reasons:
//
//   1. Tools become testable with a `createMockToolSurface()` and a
//      jsdom-friendly Element instead of a live `<svg>` plus a
//      `CanvasManager` plus a `History`.
//   2. The published Tool API now describes "what the tool needs
//      from the host" in terms of three callbacks rather than an
//      entire CanvasManager — easier for plugin authors to build
//      against.
//
// Element-taking helpers (jsdom-friendly): every method receives an
// SVGElement the tool already constructed. The surface decides where
// to mount it. Live-canvas adapters live in
// `@ingcreators/annot-editor/tools/canvas-tool-surface`; this file
// stays free of `CanvasManager` / `History` references.

/**
 * Minimal contract a host must satisfy for a `ToolBase` subclass to
 * draw onto its canvas.
 *
 * Three operations cover every tool in the editor:
 *
 *   - {@link attachDraft} — mount an in-flight element onto the
 *     canvas without saving history. Used while the user is still
 *     dragging; the tool keeps a ref so it can mutate attributes
 *     each pointer-move and either {@link saveHistory} (commit) or
 *     `el.remove()` (discard) at pointer-up.
 *
 *   - {@link addAnnotation} — atomic "append + save" used by
 *     click-to-create tools (counter, single-click placements) where
 *     the element is fully formed at attach time.
 *
 *   - {@link saveHistory} — push a history snapshot without changing
 *     children. Used when the tool committed an in-flight element
 *     via {@link attachDraft} earlier and the gesture is now
 *     finished, or when an existing element was mutated in place.
 */
export interface ToolDOMSurface {
  attachDraft(el: SVGElement): void;
  addAnnotation(el: SVGElement): void;
  saveHistory(): void;
}

/**
 * Test-only surface that records every call so tests can drive a
 * tool against an inert sink and assert the resulting sequence of
 * DOM mutations + history saves.
 *
 * `attachDraft` and `addAnnotation` BOTH append the element to the
 * supplied `host` parent so the tool's subsequent attribute
 * mutations on the element survive across pointer-move callbacks.
 * `addAnnotation` additionally bumps `saveCount`. The mock therefore
 * lets a tool's full pointer-event lifecycle execute without ever
 * touching a real `CanvasManager`.
 */
export interface MockToolSurface extends ToolDOMSurface {
  /** All elements ever attached as drafts (not yet committed). */
  readonly drafts: readonly SVGElement[];
  /** All elements ever passed through `addAnnotation` — the
   *  click-to-create / atomic case. */
  readonly committed: readonly SVGElement[];
  /** Total count of `saveHistory` invocations, including those
   *  implicit in `addAnnotation`. Tests typically assert this hits
   *  exactly 1 after a successful single-shape gesture. */
  saveCount: number;
}

/**
 * Build a {@link MockToolSurface} that mounts attached / added
 * elements into `host`. The host can be any `Element` that accepts
 * `appendChild` — typically a freshly-created `<g>` SVG group from
 * `document.createElementNS` under happy-dom.
 */
export function createMockToolSurface(host: Element): MockToolSurface {
  const drafts: SVGElement[] = [];
  const committed: SVGElement[] = [];
  const surface: MockToolSurface = {
    drafts,
    committed,
    saveCount: 0,
    attachDraft(el) {
      drafts.push(el);
      host.appendChild(el);
    },
    addAnnotation(el) {
      committed.push(el);
      host.appendChild(el);
      surface.saveCount += 1;
    },
    saveHistory() {
      surface.saveCount += 1;
    },
  };
  return surface;
}
