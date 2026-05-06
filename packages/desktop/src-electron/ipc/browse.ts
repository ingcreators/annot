/**
 * Browse-window IPC — Phase 6 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * Three channels:
 *
 *   - `browse.open(url?)`           → spawn (or focus) the Browse
 *                                      window. Optionally
 *                                      navigates to `url` after
 *                                      load.
 *   - `browse.captureVisible(id)`   → call `webContents.capturePage()`
 *                                      on the webview identified
 *                                      by `webContentsId`. Returns
 *                                      a PNG data URL + size.
 *   - `browse.persistVisible(...)`  → write the captured PNG into
 *                                      `<userData>/library/Inbox/`
 *                                      with a deterministic
 *                                      `annot-<ts>.annot.png`
 *                                      filename. Returns the
 *                                      library-relative path.
 *
 * **Phase 6 minimum-viable scope.** Single tab, visible-only
 * capture. Multi-tab orchestration + the Area / Full-Page /
 * Per-Page / Click / Hotkey modes are deferred to a follow-up
 * that lands the `@ingcreators/annot-capture` package extraction
 * (`docs/plans/desktop-browser-mode.md` Phase 1). That extraction
 * powers the orchestrator-driven capture state machines, which
 * the Browse window will consume verbatim once available.
 *
 * The handler factory takes a `BrowseDeps` adapter so unit tests
 * exercise the IPC logic without booting Electron.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

export interface CaptureVisibleResult {
  data_url: string;
  width: number;
  height: number;
}

export interface PersistVisibleInput {
  /** PNG data URL produced by `browse.captureVisible`. */
  dataUrl: string;
  width: number;
  height: number;
  /** Source URL the capture came from (recorded in the XMP-like
   *  metadata sidecar). Empty string when unavailable. */
  sourceUrl?: string;
  /** Optional page title for the library entry. */
  title?: string;
}

export interface PersistVisibleResult {
  /** Library-relative forward-slash path of the saved file. */
  path: string;
  /** Absolute path on disk. */
  abs_path: string;
  /** Filename (no directory). */
  filename: string;
}

export interface BrowseHandlers {
  open(input: { url?: string }): Promise<void>;
  captureVisible(input: { webContentsId: number }): Promise<CaptureVisibleResult>;
  persistVisible(input: PersistVisibleInput): Promise<PersistVisibleResult>;
}

// ---- Dependency injection seam ─────────────────────────────────

export interface CapturedImage {
  /** PNG bytes. */
  png: Uint8Array;
  width: number;
  height: number;
}

export interface BrowseDeps {
  /** Open (or focus) the Browse window, optionally navigating to
   *  `url` once the chrome finishes loading. The production wiring
   *  in `main.ts` spawns a `BrowserWindow` loading `browse.html`. */
  openBrowseWindow(opts: { url?: string }): Promise<void>;
  /** Resolve the `webContents` for the given id and run
   *  `capturePage()` against it. Returns PNG bytes + size. */
  captureWebContents(webContentsId: number): Promise<CapturedImage>;
  /** Absolute path to `<userData>/library/`. The persist handler
   *  joins this with `Inbox/<filename>`. */
  libraryRoot: string;
  /** Override the timestamp source (tests inject a fixed clock so
   *  filename round-trips are deterministic). Production uses
   *  `Date.now()` via `() => new Date()`. */
  now?: () => Date;
}

/** Default Inbox folder under `<userData>/library/`. The renderer-
 *  side `bootstrap.ts` ensures this exists at first launch. */
const INBOX_FOLDER = "Inbox";

export function createBrowseHandlers(deps: BrowseDeps): BrowseHandlers {
  const now = deps.now ?? (() => new Date());

  return {
    async open(input) {
      await deps.openBrowseWindow({ url: input.url });
    },

    async captureVisible(input) {
      const captured = await deps.captureWebContents(input.webContentsId);
      const b64 = Buffer.from(
        captured.png.buffer,
        captured.png.byteOffset,
        captured.png.byteLength,
      ).toString("base64");
      return {
        data_url: `data:image/png;base64,${b64}`,
        width: captured.width,
        height: captured.height,
      };
    },

    async persistVisible(input) {
      const bytes = parseDataUrl(input.dataUrl);
      const stem = formatLocalTimestampStem(now());
      const filename = `${stem}.annot.png`;
      const inboxDir = join(deps.libraryRoot, INBOX_FOLDER);
      await fs.mkdir(inboxDir, { recursive: true });
      const absPath = join(inboxDir, filename);
      await fs.writeFile(absPath, bytes);
      // Sidecar metadata — best-effort. The renderer's gallery
      // doesn't yet read this; it's a forward-looking record so
      // future XMP-on-PNG porting can pick up the source URL.
      const meta = {
        source_url: input.sourceUrl ?? "",
        title: input.title ?? "",
        width: input.width,
        height: input.height,
      };
      try {
        await fs.writeFile(`${absPath}.json`, JSON.stringify(meta, null, 2), "utf-8");
      } catch {
        /* ignore — sidecar is decorative */
      }
      return {
        path: `${INBOX_FOLDER}/${filename}`,
        abs_path: absPath,
        filename,
      };
    },
  };
}

function parseDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("[browse] invalid data URL");
  const b64 = dataUrl.slice(comma + 1);
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** Mirrors `defaultAnnotFilenameStem` in
 *  `packages/core/src/utils/filename.ts`. Local time, not UTC —
 *  the capture stem is user-visible and stable across host
 *  languages. */
function formatLocalTimestampStem(now: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const y = now.getFullYear();
  const mo = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  const ms = pad(now.getMilliseconds(), 3);
  return `annot-${y}${mo}${d}-${h}${mi}${s}-${ms}`;
}

// ---- IPC channel inventory ──────────────────────────────────────

export const BROWSE_CHANNELS = {
  open: "browse.open",
  captureVisible: "browse.captureVisible",
  persistVisible: "browse.persistVisible",
} as const;

export type BrowseChannel = (typeof BROWSE_CHANNELS)[keyof typeof BROWSE_CHANNELS];

export const BROWSE_CHANNEL_TO_HANDLER: Record<BrowseChannel, keyof BrowseHandlers> = {
  [BROWSE_CHANNELS.open]: "open",
  [BROWSE_CHANNELS.captureVisible]: "captureVisible",
  [BROWSE_CHANNELS.persistVisible]: "persistVisible",
};
