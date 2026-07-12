/**
 * Extension-handoff IPC — Phase 9 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * Two channels the renderer's incoming-sweep + legacy-data toast
 * call into now that the @tauri-apps/plugin-fs dynamic imports
 * are gone:
 *
 *   - `extension.drainIncoming()` → list `<userData>/data/incoming/`,
 *     read each `<filename>.json` sidecar + the matching capture
 *     image, return the captures with their bytes inlined as
 *     base64 data URLs, then unlink both files. The renderer
 *     persists the captures via `DesktopStore` and never has to
 *     touch the filesystem itself.
 *
 *
 * Pre-Phase 9 the renderer reached into the filesystem directly
 * via `@tauri-apps/plugin-fs`; that runtime dep is dropped, so
 * the read + delete + exists-check moves into the main process
 * where Node's `fs/promises` gives the same primitives without a
 * native dep.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

/** Mirrors `IncomingMeta` in
 *  `packages/desktop/src/app/app.ts`. The shape is the JSON
 *  sidecar `http-server.ts` writes alongside each incoming
 *  capture. */
export interface IncomingCaptureMeta {
  filename: string;
  path: string;
  source_url?: string;
  width?: number;
  height?: number;
}

/** One drained capture, ready for the renderer to persist. */
export interface DrainedCapture {
  /** The original filename on disk
   *  (`annot-YYYYMMDD-HHMMSS-mmm.jpg`). */
  filename: string;
  source_url: string;
  width: number;
  height: number;
  /** `data:image/jpeg;base64,...`. The Phase 2 http-server
   *  always writes JPEG bytes, so the MIME prefix is hard-coded
   *  here. */
  data_url: string;
}

export interface ExtensionHandlers {
  drainIncoming(): Promise<DrainedCapture[]>;
}

export interface ExtensionDeps {
  /** Resolves `<userData>/`. The handler joins `data/incoming/`
   *  and `data/annot.db` against this. */
  userDataDir: string;
}

export function createExtensionHandlers(deps: ExtensionDeps): ExtensionHandlers {
  const incomingDir = join(deps.userDataDir, "data", "incoming");

  return {
    async drainIncoming() {
      let entries: Array<{ name: string }>;
      try {
        const dirents = await fs.readdir(incomingDir, { withFileTypes: true });
        entries = dirents.filter((d) => d.isFile()).map((d) => ({ name: d.name }));
      } catch (err) {
        if (isEnoent(err)) return [];
        throw err;
      }

      const metaFiles = entries.filter((e) => e.name.toLowerCase().endsWith(".json"));
      const out: DrainedCapture[] = [];

      for (const meta of metaFiles) {
        const metaPath = join(incomingDir, meta.name);
        try {
          const text = await fs.readFile(metaPath, "utf-8");
          const parsed = JSON.parse(text) as Partial<IncomingCaptureMeta>;
          if (!parsed.path) {
            await safeUnlink(metaPath);
            continue;
          }
          let bytes: Buffer;
          try {
            bytes = await fs.readFile(parsed.path);
          } catch {
            // Orphan metadata — image already gone. Clean up
            // the sidecar so it doesn't keep getting re-read.
            await safeUnlink(metaPath);
            continue;
          }
          out.push({
            filename: parsed.filename ?? meta.name.replace(/\.json$/i, ""),
            source_url: parsed.source_url ?? "",
            width: parsed.width ?? 0,
            height: parsed.height ?? 0,
            data_url: `data:image/jpeg;base64,${bytes.toString("base64")}`,
          });
          // Best-effort cleanup. Failures don't block the drain;
          // the next sweep retries.
          await safeUnlink(parsed.path);
          await safeUnlink(metaPath);
        } catch (err) {
          console.error("[extension.drainIncoming] entry failed:", err);
        }
      }

      return out;
    },
  };
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch {
    /* ignore */
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}

export const EXTENSION_CHANNELS = {
  drainIncoming: "extension.drainIncoming",
} as const;

export type ExtensionChannel = (typeof EXTENSION_CHANNELS)[keyof typeof EXTENSION_CHANNELS];

export const EXTENSION_CHANNEL_TO_HANDLER: Record<ExtensionChannel, keyof ExtensionHandlers> = {
  [EXTENSION_CHANNELS.drainIncoming]: "drainIncoming",
};
