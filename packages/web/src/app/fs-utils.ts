/**
 * Filesystem and filename helpers shared across the app shell.
 *
 * Extracted from `app.ts` as part of the Phase 0 decomposition
 * (see `docs/plans/app-decomposition.md`). Pure functions only — no
 * DOM, no app state.
 */

/**
 * Append " (n)" before the file extension to uniquify a colliding filename.
 * Mirrors the convention used by the storage layer's own `uniquifyFilename`.
 *   "image-X-p5.png", 2  → "image-X-p5 (2).png"
 *   "image-X-p5.png", 3  → "image-X-p5 (3).png"
 */
export function bumpFilenameSuffix(filename: string, n: number): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return `${filename} (${n})`;
  return `${filename.slice(0, dot)} (${n})${filename.slice(dot)}`;
}

/**
 * Retry a File System Access API call when Chrome reports
 * `InvalidStateError` ("state cached in interface object… changed since
 * read from disk") or `InvalidModificationError`. Both fire when a
 * directory handle's internal entry cache goes stale after rapid
 * delete + create cycles, and a small backoff usually clears them.
 */
export async function retryFsOp<T>(op: () => Promise<T>, maxRetries = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await op();
    } catch (e: unknown) {
      lastErr = e;
      const err = e as { name?: string; message?: string } | null;
      const name = err?.name || "";
      const msg = String(err?.message || "");
      const isStaleHandle =
        name === "InvalidStateError" ||
        name === "InvalidModificationError" ||
        msg.includes("state had changed since it was read from disk");
      if (!isStaleHandle || attempt === maxRetries) throw e;
      // Backoff: 50ms, 120ms, 220ms, 350ms — gives Chrome time to refresh
      // its cached directory entries.
      await new Promise((r) => setTimeout(r, 50 + attempt * 70));
    }
  }
  throw lastErr;
}
