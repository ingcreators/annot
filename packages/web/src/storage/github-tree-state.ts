/**
 * In-memory mirror of the GitHub tree state GitHubStore needs to
 * answer reads + plan writes without re-fetching the tree on every
 * operation. Owns three pieces of state:
 *
 *   - `shaByPath`: blob path → current SHA. Populated from the
 *     initial `GET /git/trees/{branch}?recursive=1`, kept in sync
 *     by every PUT / DELETE / atomic-tree commit.
 *   - `allFolderPaths`: every folder visible in the sidebar tree,
 *     populated from the `type === "tree"` entries in the same
 *     fetch and incrementally updated by createFolder /
 *     deleteFolder / renameFolder / moveFolder / saveImage.
 *   - Loading lifecycle: a one-shot "loaded" flag plus an
 *     in-flight promise so concurrent first-listImages calls share
 *     a single tree fetch.
 *
 * Lifted out of `github-store.ts` (Phase-2 of proposal 4) so the
 * tree-state mutations can be unit-tested independently of the
 * stateful HTTP layer + I/O pipeline. Same module file as the
 * pure path helpers in `github-paths.ts`, but state-bearing —
 * hence a class instead of free functions.
 *
 * Paths are basePath-relative, matching the rest of the store.
 */

import { getParentPath, rewritePathPrefix } from "@ingcreators/annot-core/storage";

export class GitHubTreeState {
  #shaByPath = new Map<string, string>();
  #allFolderPaths = new Set<string>();
  #loaded = false;
  #loadInFlight: Promise<void> | null = null;

  // ─── Blob access ────────────────────────────────────────────────

  /** True when a tracked blob exists at `path`. */
  hasBlob(path: string): boolean {
    return this.#shaByPath.has(path);
  }

  /** Current SHA for the blob at `path`, or `undefined` if not tracked. */
  getBlobSha(path: string): string | undefined {
    return this.#shaByPath.get(path);
  }

  /** Set the SHA for the blob at `path`. Used by PUT / atomic-tree
   *  responses that hand us a fresh SHA. */
  setBlobSha(path: string, sha: string): void {
    this.#shaByPath.set(path, sha);
  }

  /** Drop the blob at `path` from the tracked set. Returns whether
   *  the blob was present. */
  removeBlob(path: string): boolean {
    return this.#shaByPath.delete(path);
  }

  /** Iterator over every tracked blob path. Snapshot via
   *  `Array.from(...)` if you plan to mutate during iteration. */
  blobPaths(): IterableIterator<string> {
    return this.#shaByPath.keys();
  }

  // ─── Folder access ──────────────────────────────────────────────

  /** True when `path` is in the tracked folder set. */
  hasFolder(path: string): boolean {
    return this.#allFolderPaths.has(path);
  }

  /**
   * Materialise `path` and every ancestor in the folder set. Used
   * by `saveImage` so a capture into `a/b/c/foo.png` makes `a`,
   * `a/b`, and `a/b/c` appear in the sidebar without waiting for a
   * tree re-fetch. The historical helper inside the store was
   * called `#registerFolder`; the rename here makes the
   * "ancestors included" semantic explicit at the call site.
   */
  addFolderWithAncestors(path: string): void {
    let p = path;
    while (p) {
      this.#allFolderPaths.add(p);
      p = getParentPath(p);
    }
  }

  /**
   * Add a single folder path to the tracked set. Caller is
   * responsible for ancestor materialisation if needed (most call
   * sites should prefer {@link addFolderWithAncestors}). Used by
   * `#loadTree` where the tree-API entries already cover every
   * ancestor explicitly.
   */
  addFolderExact(path: string): void {
    this.#allFolderPaths.add(path);
  }

  /** Remove a single folder from the tracked set. Returns whether
   *  the folder was present. */
  removeFolderExact(path: string): boolean {
    return this.#allFolderPaths.delete(path);
  }

  /**
   * Remove `path` and every descendant from the folder set. Used by
   * `deleteFolder` so the entire subtree disappears from the
   * sidebar in one pass.
   */
  removeFolderTree(path: string): void {
    for (const f of Array.from(this.#allFolderPaths)) {
      if (f === path || f.startsWith(`${path}/`)) {
        this.#allFolderPaths.delete(f);
      }
    }
  }

  /**
   * Rewrite the folder set in place: every folder under (or equal
   * to) `oldPath` becomes a folder under `newPath`. Used by the
   * folder rename / move paths so the sidebar reflects the new
   * placement before the next tree fetch.
   */
  rewriteFolderPrefix(oldPath: string, newPath: string): void {
    for (const f of Array.from(this.#allFolderPaths)) {
      if (f === oldPath || f.startsWith(`${oldPath}/`)) {
        this.#allFolderPaths.delete(f);
        this.#allFolderPaths.add(rewritePathPrefix(f, oldPath, newPath));
      }
    }
  }

  /** Iterator over every tracked folder path. Snapshot via
   *  `Array.from(...)` if you plan to mutate during iteration. */
  folderPaths(): IterableIterator<string> {
    return this.#allFolderPaths.values();
  }

  // ─── Loading lifecycle ──────────────────────────────────────────

  /** True after the initial tree fetch completed (success or empty). */
  isLoaded(): boolean {
    return this.#loaded;
  }

  /** Mark the tree as loaded. Called at the end of a successful
   *  `#loadTree` so subsequent calls short-circuit. */
  markLoaded(): void {
    this.#loaded = true;
  }

  /** The in-flight promise for the active tree load, if any. Used
   *  by `#ensureTreeLoaded` to coalesce concurrent callers onto a
   *  single fetch. */
  getLoadInFlight(): Promise<void> | null {
    return this.#loadInFlight;
  }

  /** Store / clear the in-flight load promise. */
  setLoadInFlight(p: Promise<void> | null): void {
    this.#loadInFlight = p;
  }

  /** Drop every cached entry and clear the loaded flag. Used by
   *  `forceRefresh()` so the next read triggers a fresh tree fetch. */
  clear(): void {
    this.#shaByPath.clear();
    this.#allFolderPaths.clear();
    this.#loaded = false;
    this.#loadInFlight = null;
  }
}
