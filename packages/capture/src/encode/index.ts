/**
 * Encode-pipeline surface of `@ingcreators/annot-capture`.
 *
 * The host's offscreen document (extension) or main renderer (Electron
 * Browse window) wires its `chrome.runtime.onMessage` /
 * `ipcMain.handle` listener to dispatch into the pure functions
 * exposed here.
 */

export * from "./image-ops.js";
export * from "./worker-pool.js";
