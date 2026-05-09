/**
 * Electron preload — Phases 0–2 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * Runs in an isolated Chromium context with access to a small slice
 * of the Node API (`ipcRenderer`, `contextBridge`). Exposes:
 *
 *   - `window.electronAPI.invoke(channel, args)` — request/response
 *     IPC, a thin pass-through over `ipcRenderer.invoke`.
 *   - `window.electronAPI.on(channel, listener)` — main→renderer
 *     event subscription. Phase 2 introduces this for the
 *     `chrome-capture` event the http-server emits when the
 *     extension's "send to local desktop" button POSTs to
 *     `http://localhost:19530/capture`. Returns an
 *     unsubscribe callback so the renderer doesn't have to thread
 *     `removeListener` calls back through the bridge.
 *   - `window.__ANNOT_DESKTOP__ = true` — the runtime detection
 *     flag the renderer's `desktop-bridge.ts` checks.
 */

import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";

const electronAPI = {
  invoke: (channel: string, args?: unknown): Promise<unknown> => ipcRenderer.invoke(channel, args),

  /** Subscribe to a main→renderer event. Returns an unsubscribe
   *  fn; the renderer-side listener receives only the IPC
   *  `payload`, not the underlying Electron `IpcRendererEvent`
   *  (which carries `sender` references that contextBridge
   *  refuses to clone anyway). */
  on(channel: string, listener: (payload: unknown) => void): () => void {
    const wrapped = (_evt: IpcRendererEvent, payload: unknown): void => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
} as const;

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
contextBridge.exposeInMainWorld("__ANNOT_DESKTOP__", true);

export type ElectronAPI = typeof electronAPI;
