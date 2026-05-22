/**
 * Content-side surface of `@ingcreators/annot-capture`.
 *
 * The host (extension's `content/index.ts`, future Electron Browse
 * window's webview preload) wires its own message-bus to these
 * helpers — the capture package itself never imports `chrome.*` or
 * `window.electronAPI`.
 */

export * from "./area-selector.js";
export * from "./content-bus.js";
export * from "./element-tree-walker.js";
export * from "./page-metadata-walker.js";
export * from "./progress-overlay.js";
export * from "./scroll-controller.js";
export * from "./sticky-handler.js";
