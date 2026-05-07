/**
 * Browse-window IPC.
 *
 * Phase 6 of `_done/desktop-electron-migration.md` shipped a
 * minimum-viable `browse.captureVisible` + `browse.persistVisible`
 * pair. Phase 3 of `desktop-browser-mode.md` (this PR) replaces
 * those with the host-primitive pair the orchestrators in
 * `@ingcreators/annot-capture` consume:
 *
 *   - `browse.open(url?)`                       — spawn (or focus)
 *     the Browse window. Optionally navigates to `url` once the
 *     chrome finishes loading.
 *   - `browse.host.captureViewport(webContentsId)` — call
 *     `webContents.fromId(id).capturePage()`. Returns a PNG data
 *     URL plus the host-authoritative DPR (Phase 2 of
 *     `desktop-browser-mode.md` — read via
 *     `executeJavaScript("window.devicePixelRatio")`).
 *   - `browse.host.executeMainWorld(webContentsId, expression)` —
 *     run a JavaScript expression in the target's MAIN world.
 *     The renderer-side host calls this with a stringified
 *     `walkPageMetadata` IIFE for `requestPageMetadata`, but the
 *     channel itself is generic so future orchestrator surfaces
 *     (e.g. element-picker pre-fetch, area-snap probes) can
 *     reuse it.
 *
 * Persistence routes through `DesktopStore.saveImage` rather than
 * a one-off filesystem write IPC, so the editor / gallery / sync
 * mechanism that already observes `<userData>/library/` picks the
 * new record up for free.
 *
 * Phase 3 minimum-viable scope: visible-mode capture only.
 * Multi-tab + the Area / Full-Page / Per-Page / Click / Hotkey
 * orchestrators land in Phase 4 along with the `<webview>`
 * preload that bridges the content-script bus.
 */

export interface CapturedViewportResult {
  /** PNG data URL of the captured viewport. */
  pngDataUrl: string;
  /** Authoritative DPR for this capture (read via
   *  `executeJavaScript("window.devicePixelRatio")`). */
  dpr: number;
}

export interface ExecuteMainWorldInput {
  webContentsId: number;
  /** A JavaScript expression to evaluate. The renderer-side host
   *  is responsible for assembling closure-free expressions; the
   *  main process is a thin pass-through. */
  expression: string;
}

export interface BrowseHandlers {
  open(input: { url?: string }): Promise<void>;
  captureViewport(input: { webContentsId: number }): Promise<CapturedViewportResult>;
  executeMainWorld(input: ExecuteMainWorldInput): Promise<unknown>;
}

// ---- Dependency injection seam ─────────────────────────────────

export interface CapturedImage {
  /** PNG bytes. */
  png: Uint8Array;
  width: number;
  height: number;
  /** DPR at capture time, read in the same event-loop turn as
   *  `capturePage()` so the value matches the captured pixels. */
  dpr: number;
}

export interface BrowseDeps {
  /** Open (or focus) the Browse window, optionally navigating to
   *  `url` once the chrome finishes loading. The production wiring
   *  in `main.ts` spawns a `BrowserWindow` loading `browse.html`. */
  openBrowseWindow(opts: { url?: string }): Promise<void>;
  /** Resolve the `webContents` for the given id and run
   *  `capturePage()` against it. Returns PNG bytes + size + DPR. */
  captureWebContents(webContentsId: number): Promise<CapturedImage>;
  /** Run a MAIN-world JavaScript expression against the target
   *  `webContents`. Production wiring uses
   *  `webContents.fromId(id).executeJavaScript(expression, true)`;
   *  tests inject a fake. */
  executeJavaScriptInTarget(webContentsId: number, expression: string): Promise<unknown>;
}

export function createBrowseHandlers(deps: BrowseDeps): BrowseHandlers {
  return {
    async open(input) {
      await deps.openBrowseWindow({ url: input.url });
    },

    async captureViewport(input): Promise<CapturedViewportResult> {
      const captured = await deps.captureWebContents(input.webContentsId);
      const b64 = Buffer.from(
        captured.png.buffer,
        captured.png.byteOffset,
        captured.png.byteLength,
      ).toString("base64");
      return {
        pngDataUrl: `data:image/png;base64,${b64}`,
        dpr: captured.dpr,
      };
    },

    async executeMainWorld(input): Promise<unknown> {
      return deps.executeJavaScriptInTarget(input.webContentsId, input.expression);
    },
  };
}

// ---- IPC channel inventory ──────────────────────────────────────

export const BROWSE_CHANNELS = {
  open: "browse.open",
  captureViewport: "browse.host.captureViewport",
  executeMainWorld: "browse.host.executeMainWorld",
} as const;

export type BrowseChannel = (typeof BROWSE_CHANNELS)[keyof typeof BROWSE_CHANNELS];

export const BROWSE_CHANNEL_TO_HANDLER: Record<BrowseChannel, keyof BrowseHandlers> = {
  [BROWSE_CHANNELS.open]: "open",
  [BROWSE_CHANNELS.captureViewport]: "captureViewport",
  [BROWSE_CHANNELS.executeMainWorld]: "executeMainWorld",
};
