/**
 * Orchestration surface of `@ingcreators/annot-capture`.
 *
 * Phase 1A exposed the pure-math helpers and shared constants. Phase
 * 1B grew this module with `runVisibleCapture` / `runAreaCapture` /
 * `runScrollCapture` / `runPerPageCapture` lifted from the
 * extension's `service-worker.ts`. Click / hotkey state machines
 * stay extension-side because they own session bookkeeping (badge,
 * sessionId, click tags) that's host-specific.
 */

export * from "./capture-prep.js";
export * from "./constants.js";
export * from "./emulation.js";
export * from "./frame.js";
export * from "./run-area.js";
export * from "./run-per-page.js";
export * from "./run-scroll.js";
export * from "./run-visible.js";
export * from "./strategy.js";
