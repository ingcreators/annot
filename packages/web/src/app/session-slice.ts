/**
 * Capture-session helpers for grouping records by `tags.session`.
 *
 * Extracted from `app.ts` as part of the Phase 0 decomposition
 * (see `docs/plans/_done/app-decomposition.md`). Pure logic — the only
 * external contact is the caller-supplied `StorageProvider`.
 */

import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";

/**
 * Locate all images in the given folder that carry `tags.session === sessionId`.
 * Returns them sorted by sessionIndex (numeric, asc) so the filmstrip
 * presents frames in capture order.
 */
export async function findSessionRecords(
  storage: StorageProvider,
  folderPath: string,
  sessionId: string,
): Promise<ImageRecord[]> {
  const all = await storage.listImages(folderPath);
  const matched = all.filter((r) => r.tags?.session === sessionId);
  matched.sort((a, b) => {
    const ai = Number(a.tags?.sessionIndex ?? 0);
    const bi = Number(b.tags?.sessionIndex ?? 0);
    if (ai !== bi) return ai - bi;
    // Fallback: compare path for stable ordering
    return a.path.localeCompare(b.path);
  });
  return matched;
}
