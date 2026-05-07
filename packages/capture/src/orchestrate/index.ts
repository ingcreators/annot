/**
 * Orchestration surface of `@ingcreators/annot-capture`.
 *
 * Phase 1A exposes the pure-math helpers and shared constants. Phase
 * 1B will grow this module with `runVisibleCapture` /
 * `runAreaCapture` / `runScrollCapture` / `runPerPageCapture` /
 * `runClickCapture` / `runHotkeyCapture` lifted from the extension's
 * `service-worker.ts`.
 */

export * from "./constants.js";
export * from "./strategy.js";
