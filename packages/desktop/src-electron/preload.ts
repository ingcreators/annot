/**
 * Electron preload — Phase 0 scaffold.
 *
 * Runs in an isolated Chromium context with access to a small slice
 * of the Node API (`ipcRenderer`, `contextBridge`). Exposes:
 *
 *   - `window.electronAPI.invoke(channel, args)` — a thin pass-through
 *     over `ipcRenderer.invoke`. The Phase 0 scaffold ships exactly
 *     one functional channel (`ping` → `"pong"`); every other channel
 *     surfaces the main process's "no handler registered" error
 *     verbatim until Phases 1–4 land their respective handlers.
 *   - `window.__ANNOT_DESKTOP__ = true` — the runtime detection flag
 *     the renderer's `desktop-bridge.ts` (Phase 1) will check. The
 *     legacy `tauri-bridge.ts` checks `__TAURI_INTERNALS__`, which
 *     is *not* set by this preload, so the existing Tauri bridge
 *     correctly reports "Not running in Tauri" when the renderer
 *     loads under Electron. This is the intended behaviour for
 *     Phase 0 — gallery / capture / Office paste don't work yet.
 */

import { contextBridge, ipcRenderer } from "electron";

const electronAPI = {
  invoke: (channel: string, args?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(channel, args),
} as const;

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
contextBridge.exposeInMainWorld("__ANNOT_DESKTOP__", true);

export type ElectronAPI = typeof electronAPI;
