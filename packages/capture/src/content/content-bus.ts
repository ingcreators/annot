/**
 * `ContentBus` — host-neutral back-channel from a content module to its
 * orchestrator host.
 *
 * The Chrome extension implements this with `chrome.runtime.sendMessage`
 * (content → service-worker). The future Electron Browse window will
 * implement it with an `ipcRenderer.send` bridge that forwards through
 * the main process to the chrome's renderer.
 *
 * Keep the surface minimal: every content module talks to the host
 * through this interface, never directly to `chrome.*` /
 * `window.electronAPI.*`. That's what lets the same content code run
 * unmodified in both hosts.
 */

import type { ContentToBackgroundMessage } from "../shared/messages.js";

export interface ContentBus {
  /**
   * Post a one-shot event to the orchestrator host. The host's
   * dispatcher decides which capture mode (if any) is currently
   * waiting for the event.
   *
   * Errors are swallowed by the bus implementation — a dead host
   * (extension service-worker reload, Browse window closed mid-
   * capture) leaves the content script orphaned, and there's nothing
   * the content side can do beyond logging.
   */
  send(msg: ContentToBackgroundMessage): void;
}
