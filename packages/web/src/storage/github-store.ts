/**
 * GitHub storage provider — commits images to a user-picked repo.
 *
 * Phase 2 of `docs/plans/github-integration.md`. Implements
 * `StorageProvider` against the GitHub Contents API (single-file
 * reads/writes) and the Git Data API (batch / large-file paths
 * reserved for Phase 4 — for now big files error out with a clear
 * message instead of silently corrupting state).
 *
 * Paths exposed to the rest of Annot are relative to the repo's
 * `basePath`, so a user with `basePath = "screenshots"` who saves
 * `mobile/foo.annot.png` ends up with
 * `screenshots/mobile/foo.annot.png` in the repo. Internally we
 * convert between the two via `#fullPath` / `#relPath`.
 *
 * Commit strategy: one commit per mutation. Message format is
 * `annot: <verb> <filename>` so `git log --oneline` stays readable
 * after heavy editing sessions.
 *
 * SHA cache: GitHub's Contents API requires the current blob SHA
 * on update/delete for optimistic concurrency. We populate the
 * cache from the initial tree fetch and keep it in sync with every
 * response that carries a new SHA. Without this cache each edit
 * would need to re-list the tree first, which would burn rate
 * limit and block the save behind a network round-trip.
 */
import type {
  DocumentRecord,
  DocumentRecordUpdate,
  FolderRecord,
  ImageRecord,
  ImageRecordUpdate,
  MetadataCache,
  StorageProvider,
  StorageWithDocuments,
  StorageWithForceRefresh,
  StorageWithInit,
  StorageWithMetadataCache,
  StorageWithRateLimit,
  StorageWithResync,
  StorageWithThumbnailCache,
  StorageWithTokenRefresher,
} from "@ingcreators/annot-core/storage";
import {
  ancestorPaths,
  annotationsYamlPathFor,
  getFilename,
  getParentPath,
  joinPath,
  rewritePathPrefix,
  StorageConflictError,
  StorageNotFoundError,
  uniquifyFilename,
  validateName,
} from "@ingcreators/annot-core/storage";
import {
  defaultAnnotImageFilename,
  normalizeAnnotImageFilename,
} from "@ingcreators/annot-core/utils";
import {
  createGitHubApiClient,
  type GitHubApiClient,
  type RateLimitListener,
} from "./github-api-client.js";
import type { GitHubCommitSummary, GitHubRepoRef } from "./github-auth.js";
import { getLastCommitForPath } from "./github-auth.js";
import {
  base64ToBytes,
  blobToBase64,
  GITHUB_API,
  GITKEEP,
  type GitHubError,
  githubError,
  inferMimeFromPath,
  isDocumentFilename,
  isImageFilename,
  MAX_CONTENTS_BYTES,
} from "./github-helpers.js";
import { decodeImageRecord } from "./github-image-codec.js";
import {
  commitMessage as buildCommitMessage,
  contentsUrl as buildContentsUrl,
  encodePath,
  fullPath as toFullPath,
  relPath as toRelPath,
} from "./github-paths.js";
import { GitHubTreeState } from "./github-tree-state.js";
import { buildEditableImageBlob } from "./image-encode.js";

interface TreeEntry {
  path: string; // repo-relative
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

/**
 * One file change in a Git Data API batch commit
 * (`GitHubStore#commitTreeOps`). Exactly one of `blob`,
 * `existingBlobSha`, or `deleteOnly` must be set:
 *
 *   - `blob`            — upload fresh content, reference it in the tree.
 *   - `existingBlobSha` — rename / move: reference an already-known blob
 *                         at the new path (git’s implicit rename).
 *   - `deleteOnly`      — drop the entry from the tree.
 *
 * `relPath` is the basePath-relative path the rest of the store uses;
 * the commit helper applies `#fullPath()` before handing entries to
 * GitHub.
 */
interface TreeOp {
  relPath: string;
  mode?: string;
  blob?: Blob;
  existingBlobSha?: string;
  deleteOnly?: boolean;
}

export class GitHubStore
  implements
    StorageProvider,
    StorageWithInit,
    StorageWithResync,
    StorageWithForceRefresh,
    StorageWithTokenRefresher,
    StorageWithRateLimit,
    StorageWithThumbnailCache,
    StorageWithDocuments,
    StorageWithMetadataCache
{
  /** HTTP layer — owns token, token-refresh, rate-limit state, and
   *  the GitHub-specific error mapping. Synthesised in the public
   *  constructor; tests can inject a mock via the alternate
   *  `(token, ref, apiClient)` signature. */
  #api: GitHubApiClient;
  #owner: string;
  #repo: string;
  #branch: string;
  /** "" for repo root; otherwise a repo-relative prefix without
   *  leading/trailing slash (normalized via `normalizeBasePath`). */
  #basePath: string;

  // ---- Tree state (keys are relative paths, i.e. basePath-relative) ----

  /**
   * In-memory mirror of the GitHub tree the store maintains — blob
   * SHAs by basePath-relative path + every visible folder path +
   * the loading lifecycle. Populated by the initial
   * `GET /git/trees/{branch}?recursive=1` and kept in sync by every
   * mutation, so reads + write planning don't trigger fresh tree
   * fetches. Implementation lives in `./github-tree-state.ts` so
   * the mutation surface is unit-testable independently of the
   * stateful HTTP layer.
   */
  #tree = new GitHubTreeState();

  // Token refresh + rate-limit telemetry now live inside `#api`.

  // ── MetadataCache integration ────────────────────────────────
  /**
   * Host-supplied shared metadata cache. Replaces the bespoke
   * in-memory `GitHubBlobCache` + `#docMeta` Map: per-path
   * `ImageRecord` / `DocumentRecord` rows live in IDB under
   * `MetadataCache`, version-gated by blob SHA so peer-tab edits
   * automatically invalidate. The remaining bespoke state in this
   * store is `GitHubTreeState` (path → SHA + folder set), tracked
   * as a follow-up phase (P9 of the shared-metadata-cache plan).
   *
   * Cache-meta integration also wires:
   *
   *   - `branchHead` namespace meta persists the last-known HEAD
   *     commit SHA across sessions. `init()` compares it against
   *     the current live HEAD via 1 cheap `GET /git/refs/...`;
   *     mismatch triggers a forced cache reset before the first
   *     listing so peers' commits get picked up automatically.
   *   - Cross-tab `annot-metadata-ns-changed` listener: when a
   *     peer tab commits, our local `#tree` gets invalidated so
   *     the next read fetches fresh.
   */
  #cache?: MetadataCache;
  /** Memory shortcut for `branchHead` so we don't re-read IDB on
   *  every operation. Cleared by the cross-tab listener so peer
   *  commits force a re-check. */
  #headShaMemo: string | null = null;
  /** Per-instance handler bound to `window` for cross-tab updates.
   *  Stored so we can remove it on teardown — not strictly needed
   *  today (stores live for the page's lifetime) but harmless. */
  #onNsChangedBound?: (e: Event) => void;

  constructor(token: string, ref: GitHubRepoRef, apiClient?: GitHubApiClient) {
    this.#api = apiClient ?? createGitHubApiClient(token);
    this.#owner = ref.owner;
    this.#repo = ref.repo;
    this.#branch = ref.branch;
    this.#basePath = ref.basePath || "";
  }

  // ── StorageWithMetadataCache ─────────────────────────────────

  metadataNamespace(): string {
    return `github:${this.#owner}/${this.#repo}:${this.#branch}`;
  }

  attachMetadataCache(cache: MetadataCache): void {
    this.#cache = cache;
    if (typeof window !== "undefined") {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent<{ ns: string; key: string }>).detail;
        if (!detail) return;
        if (detail.ns !== this.metadataNamespace()) return;
        if (detail.key !== "branchHead") return;
        // Peer tab committed something. Drop our memory shortcuts
        // so the next operation re-validates against the live
        // HEAD and refetches the tree. Record-cache invalidation
        // happens automatically via SHA-versioned reads.
        this.#headShaMemo = null;
        this.#tree.clear();
      };
      this.#onNsChangedBound = handler;
      window.addEventListener("annot-metadata-ns-changed", handler);
    }
  }

  /** Throw when no cache has been attached (test helper / safety
   *  net — the production path always attaches via `bridge.ts`
   *  before any operation). */
  #c(): MetadataCache {
    const cache = this.#cache;
    if (!cache) {
      throw new Error(
        "GitHubStore: MetadataCache not attached. Call attachMetadataCache() before any operation.",
      );
    }
    return cache;
  }

  #ns(): string {
    return this.metadataNamespace();
  }

  // ── Local helpers around the shared MetadataCache ────────────
  //
  // The bespoke `GitHubBlobCache` + `#docMeta` were path-keyed in-
  // memory Maps without a version concept. These helpers reproduce
  // the same surface but back it with the shared `MetadataCache`
  // SHA-gated by blob SHA (read from `GitHubTreeState` for now —
  // P9 of the shared-metadata-cache plan migrates the tree state
  // itself onto the listing layer). Callers continue to look like
  // method calls on a per-instance object; the only difference
  // visible at the call site is the `await`.

  /**
   * Read a cached `ImageRecord` by path. Returns `undefined` when:
   *   - no SHA is known for the path (tree state hasn't been
   *     loaded yet, or the path doesn't exist in the repo),
   *   - the cached version doesn't match the current SHA (peer-
   *     tab edit invalidated us; we fall back to a fresh fetch).
   */
  async #cacheGetRecord(path: string): Promise<ImageRecord | undefined> {
    const sha = this.#tree.getBlobSha(path);
    if (!sha) return undefined;
    return await this.#c().getImage(this.#ns(), path, sha);
  }

  /** Write an `ImageRecord` at the current SHA version. No-op when
   *  the SHA isn't known yet (the next save / commit response will
   *  populate it and a subsequent put will succeed). */
  async #cachePutRecord(path: string, record: ImageRecord): Promise<void> {
    const sha = this.#tree.getBlobSha(path);
    if (!sha) return;
    await this.#c().putImage(this.#ns(), path, sha, record);
  }

  /** Read a cached `DocumentRecord` shape (lightweight subset) by
   *  path. Returns `undefined` on miss; mirrors `#cacheGetRecord`. */
  async #cacheGetDocument(path: string): Promise<DocumentRecord | undefined> {
    const sha = this.#tree.getBlobSha(path);
    if (!sha) return undefined;
    return await this.#c().getDocument(this.#ns(), path, sha);
  }

  /** Write a `DocumentRecord` (lightweight subset) at the current
   *  SHA version. Bytes are NOT persisted — the cache only carries
   *  the lightweight metadata; callers fetch bytes from the
   *  Contents API as before. */
  async #cachePutDocument(path: string, record: DocumentRecord): Promise<void> {
    const sha = this.#tree.getBlobSha(path);
    if (!sha) return;
    await this.#c().putDocument(this.#ns(), path, sha, record);
  }

  /** Drop any cached image OR document row at `path`. Used on
   *  delete / commit-removes-path. */
  async #cachePurge(path: string): Promise<void> {
    await this.#c().invalidatePath(this.#ns(), path);
  }

  /** Move a cached image entry under a path rename. Reads the old
   *  record, applies `transformRecord` (typically setting
   *  `.path` / `.folderPath`), writes it at the new path's
   *  version, and drops the old key. Used by `moveImage` /
   *  `renameImage`. The new path's SHA is read from the tree
   *  state — both the atomic rename (existing blob SHA preserved)
   *  and the fallback path (fresh blob SHA from a re-upload)
   *  have populated the tree by the time this helper runs. */
  async #cacheMigrate(
    oldPath: string,
    newPath: string,
    transformRecord?: (rec: ImageRecord) => ImageRecord,
  ): Promise<void> {
    const cache = this.#c();
    // The old path's SHA may already be gone from the tree (the
    // mutation that triggered the rename clears it). Try a fixed
    // probe via `migrateEntry` so the IDB layer transfers the row
    // regardless of which version it was stored under, then apply
    // the transform on top by reading + putting.
    await cache.migrateEntry(this.#ns(), oldPath, newPath);
    if (!transformRecord) return;
    const sha = this.#tree.getBlobSha(newPath);
    if (!sha) return;
    const moved = await cache.getImage(this.#ns(), newPath, sha);
    if (moved) {
      await cache.putImage(this.#ns(), newPath, sha, transformRecord(moved));
    }
  }

  /** Bulk-rewrite cached entries under `oldPrefix` to live under
   *  `newPrefix` (folder rename / move). After the migrate, walk
   *  back and apply `transformRecord` to each moved record so its
   *  `path` / `folderPath` fields stay consistent with the new
   *  key. */
  async #cacheRewritePrefix(
    oldPrefix: string,
    newPrefix: string,
    transformRecord?: (rec: ImageRecord, newPath: string) => ImageRecord,
  ): Promise<void> {
    const cache = this.#c();
    await cache.rewriteEntriesForPrefix(this.#ns(), oldPrefix, newPrefix);
    if (!transformRecord) return;
    // Rewrite the in-record path / folderPath fields by reading +
    // putting at every blob under the new prefix that we know
    // about via the tree state.
    for (const newPath of Array.from(this.#tree.blobPaths())) {
      if (newPath !== newPrefix && !newPath.startsWith(`${newPrefix}/`)) continue;
      const sha = this.#tree.getBlobSha(newPath);
      if (!sha) continue;
      const rec = await cache.getImage(this.#ns(), newPath, sha);
      if (rec) {
        await cache.putImage(this.#ns(), newPath, sha, transformRecord(rec, newPath));
      }
    }
  }

  /** Drop every cached row in this store's namespace. Used by
   *  `forceRefresh()`. */
  async #cacheClear(): Promise<void> {
    await this.#c().invalidatePrefix(`${this.#ns()}:`);
  }

  /**
   * One-shot startup hook — reconciles the local cache against the
   * live branch HEAD. If our last-known `branchHead` matches what
   * the API reports, nothing has changed since last session and
   * existing in-session caches (when they're populated) stay
   * valid. If it differs, we clear caches so the first
   * `listImages` fetches a fresh tree.
   *
   * Cheap: 1 API call to `GET /git/refs/heads/{branch}`
   * (significantly smaller than the recursive tree fetch).
   * Silently best-effort: a network failure here leaves caches
   * intact and the user can still operate offline against memory
   * data.
   */
  async init(): Promise<void> {
    if (!this.#cache) return;
    try {
      const ns = this.metadataNamespace();
      const knownHead = await this.#cache.getNamespaceMeta(ns, "branchHead");
      const liveHead = await this.#fetchBranchHead();
      this.#headShaMemo = liveHead;
      if (knownHead && liveHead && knownHead !== liveHead) {
        // Stale cache from a prior session — drop everything in
        // this namespace so the next `listImages` refetches a
        // fresh tree + records.
        this.#tree.clear();
        await this.#cacheClear();
      } else if (knownHead && liveHead && knownHead === liveHead) {
        // Warm start — branch HEAD hasn't moved since we cached.
        // Try to hydrate the in-memory tree state from the
        // namespace-meta snapshot so the next `listImages` skips
        // the recursive tree fetch entirely. Best-effort: a
        // corrupt / missing snapshot just falls through to the
        // normal `#loadTree()` path.
        await this.#hydrateTreeFromCache();
      }
      if (liveHead && liveHead !== knownHead) {
        await this.#cache.putNamespaceMeta(ns, "branchHead", liveHead);
      }
    } catch {
      /* offline / 401 / 404 — leave caches intact */
    }
  }

  /**
   * Restore the in-memory `GitHubTreeState` from a previously-saved
   * `treeState` namespace-meta blob. Called from `init()` on a
   * `branchHead` match so the next read can skip the recursive
   * tree fetch.
   *
   * Returns `true` when the in-memory tree was repopulated and
   * marked loaded; `false` when there's no usable snapshot (first
   * connect, deserialisation failure, …).
   */
  async #hydrateTreeFromCache(): Promise<boolean> {
    if (!this.#cache) return false;
    try {
      const raw = await this.#cache.getNamespaceMeta(this.#ns(), "treeState");
      if (!raw) return false;
      const parsed = JSON.parse(raw) as {
        shaByPath?: ReadonlyArray<readonly [string, string]>;
        folderPaths?: ReadonlyArray<string>;
      };
      // Defensive: a future schema bump may invalidate the shape;
      // bail rather than half-populate.
      if (!Array.isArray(parsed.shaByPath) || !Array.isArray(parsed.folderPaths)) {
        return false;
      }
      for (const [path, sha] of parsed.shaByPath) {
        if (typeof path === "string" && typeof sha === "string") {
          this.#tree.setBlobSha(path, sha);
        }
      }
      for (const folder of parsed.folderPaths) {
        if (typeof folder === "string") {
          this.#tree.addFolderExact(folder);
        }
      }
      this.#tree.markLoaded();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Snapshot the current in-memory tree state into the namespace-
   * meta `treeState` value so the next session can warm-start via
   * `#hydrateTreeFromCache`. Called from:
   *   - `#loadTree()` on successful cold fetch,
   *   - every mutation that updates the in-memory tree (the
   *     wrapper `#persistTreeAfter` collapses the repeated
   *     `await` into a single helper at each public-method exit).
   *
   * Best-effort: an IDB write failure here doesn't break the
   * current session, just means the next session falls back to
   * the recursive tree fetch.
   */
  async #persistTreeState(): Promise<void> {
    if (!this.#cache) return;
    try {
      const shaByPath: Array<[string, string]> = [];
      for (const path of this.#tree.blobPaths()) {
        const sha = this.#tree.getBlobSha(path);
        if (sha) shaByPath.push([path, sha]);
      }
      const folderPaths = Array.from(this.#tree.folderPaths());
      const blob = JSON.stringify({ shaByPath, folderPaths });
      await this.#cache.putNamespaceMeta(this.#ns(), "treeState", blob);
    } catch {
      /* best-effort */
    }
  }

  /**
   * Read the current branch HEAD commit SHA. Best-effort: 404 on
   * empty repos returns `null` so callers can treat "no commits
   * yet" the same as "matches our zero-state".
   */
  async #fetchBranchHead(): Promise<string | null> {
    const owner = encodeURIComponent(this.#owner);
    const repo = encodeURIComponent(this.#repo);
    const branch = encodeURIComponent(this.#branch);
    try {
      const resp = await this.#fetch(
        `${GITHUB_API}/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      );
      const body = (await resp.json()) as { object?: { sha?: string } };
      return body?.object?.sha ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Push a freshly-known HEAD commit SHA into namespace meta.
   * Called after every commit response so peer tabs find a
   * matching `branchHead` instead of triggering a spurious reset
   * on their next `init()`.
   */
  async #recordBranchHead(commitSha: string): Promise<void> {
    this.#headShaMemo = commitSha;
    if (!this.#cache) return;
    try {
      await this.#cache.putNamespaceMeta(this.metadataNamespace(), "branchHead", commitSha);
      // After every commit we refresh the persisted tree snapshot
      // alongside the HEAD pointer — both move together, so peers
      // that warm-start in the next session see a consistent
      // pair (new HEAD, new tree).
      await this.#persistTreeState();
    } catch {
      /* best-effort */
    }
  }

  setToken(token: string): void {
    this.#api.setToken(token);
  }

  setTokenRefresher(refresher: () => Promise<string | null>): void {
    this.#api.setTokenRefresher(refresher);
  }

  getRateLimit(): { remaining: number | null; resetAt: number | null } {
    return this.#api.getRateLimit();
  }

  /** Register a listener for rate-limit-low events. Delegates to
   *  the API client, which fires the listener at most once per
   *  reset window. */
  setRateLimitListener(listener: RateLimitListener): void {
    this.#api.setRateLimitListener(listener);
  }

  /**
   * Public URL to the file's blob on github.com. Used by the file-
   * details drawer's "View on GitHub" link. Returns `null` if the
   * path is outside basePath (shouldn't happen but guard anyway).
   */
  getViewUrl(relPath: string): string | null {
    const fullPath = this.#fullPath(relPath);
    if (!fullPath) return null;
    const owner = encodeURIComponent(this.#owner);
    const repo = encodeURIComponent(this.#repo);
    const branch = encodeURIComponent(this.#branch);
    return `https://github.com/${owner}/${repo}/blob/${branch}/${this.#encodePath(fullPath)}`;
  }

  /** Convenience wrapper so the host doesn't have to thread `owner`,
   *  `repo`, `branch` through the call site. */
  async getLastCommit(relPath: string): Promise<GitHubCommitSummary | null> {
    return getLastCommitForPath(this.#owner, this.#repo, this.#branch, this.#fullPath(relPath));
  }

  /**
   * No-op. `StorageProvider.resync` is called automatically by the
   * gallery after every navigation / mutation; for GitHub a blanket
   * cache reset at those moments is both wasteful (tree fetch is a
   * whole-repo request) and incorrect (GitHub's tree endpoint can
   * briefly lag behind a just-made commit, so the reset+refetch
   * right after `createFolder` / `deleteFolder` can drop the folder
   * the user just created). The in-memory tree is maintained
   * incrementally by every mutation, so no reset is needed.
   *
   * Users can still force a re-scan for external commits via the
   * Refresh button in the gallery header, which routes through
   * `forceRefresh()` below.
   */
  async resync(): Promise<void> {
    // intentionally empty
  }

  /**
   * User-initiated full reload. Discards every cached entry and
   * re-fetches `GET /git/trees/{branch}?recursive=1` on the next
   * list call. Called by the gallery's Refresh button via
   * `file-manager.refreshFromDisk()` (which probes for
   * `forceRefresh` before falling back to `resync`).
   */
  async forceRefresh(): Promise<void> {
    this.#tree.clear();
    await this.#cacheClear();
  }

  // ===========================================================================
  // Path helpers — thin wrappers around the pure functions in
  // `./github-paths.ts` so call sites read naturally (`this.#fullPath(rel)`)
  // without spreading `this.#basePath` / `this.#owner` / `this.#repo` to
  // every location.
  // ===========================================================================

  #fullPath(relPath: string): string {
    return toFullPath(this.#basePath, relPath);
  }

  #relPath(fullPath: string): string | null {
    return toRelPath(this.#basePath, fullPath);
  }

  #encodePath(path: string): string {
    return encodePath(path);
  }

  #contentsUrl(fullPath: string): string {
    return buildContentsUrl(this.#owner, this.#repo, fullPath);
  }

  #commitMessage(verb: "add" | "update" | "delete", relPath: string): string {
    return buildCommitMessage(verb, relPath);
  }

  // ===========================================================================
  // Low-level HTTP delegation. The actual fetch / 401-retry / rate-
  // limit / error-mapping logic lives in `GitHubApiClient` (see
  // `./github-api-client.ts`); these thin adapters keep the existing
  // call sites readable without re-typing `this.#api.request(...)`
  // everywhere.
  // ===========================================================================

  #fetch(url: string, init?: RequestInit): Promise<Response> {
    return this.#api.request(url, init);
  }

  // ===========================================================================
  // Tree loading (once per session unless `resync()` is called).
  // ===========================================================================

  #ensureTreeLoaded(): Promise<void> {
    if (this.#tree.isLoaded()) return Promise.resolve();
    let inFlight = this.#tree.getLoadInFlight();
    if (!inFlight) {
      inFlight = this.#loadTree().finally(() => {
        this.#tree.setLoadInFlight(null);
      });
      this.#tree.setLoadInFlight(inFlight);
    }
    return inFlight;
  }

  async #loadTree(): Promise<void> {
    const owner = encodeURIComponent(this.#owner);
    const repo = encodeURIComponent(this.#repo);
    const branch = encodeURIComponent(this.#branch);
    let tree: TreeEntry[] = [];

    try {
      const resp = await this.#fetch(
        `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      );
      const body = await resp.json();
      tree = (body?.tree as TreeEntry[] | undefined) ?? [];
      // When a repo is gigantic the API may truncate. We accept that
      // for v1 — `getImage` still works via the Contents API for
      // paths the user types in manually. The plan's "fall back to
      // text-input branch picker" note covers this edge case.
      if (body?.truncated) {
        console.warn("[github-store] tree truncated; large repos may need per-folder fetches");
      }
    } catch (e) {
      // Empty repo (no commits yet) returns 404 for the default
      // branch. Treat as an empty tree so the first save is free to
      // create the initial commit.
      const err = e as GitHubError;
      if (err.status !== 404) throw e;
    }

    for (const entry of tree) {
      const rel = this.#relPath(entry.path);
      if (rel == null) continue;
      if (entry.type === "tree") {
        // Every directory the repo actually contains becomes a
        // sidebar folder entry, just like DeviceStore / Drive /
        // Browser — no need for image contents or a `.gitkeep`
        // marker to materialise it.
        if (rel) this.#tree.addFolderExact(rel);
        continue;
      }
      if (entry.type !== "blob") continue;
      const name = getFilename(rel);
      if (name === GITKEEP) {
        // Track the gitkeep SHA so `deleteFolder` can remove it.
        // No special "empty folder" flag needed — the folder itself
        // shows up via its `type === "tree"` entry above.
        this.#tree.setBlobSha(rel, entry.sha);
        continue;
      }
      // Non-image blobs (READMEs, source code, configs) are visible
      // in the folder tree via their containing folder's tree entry,
      // but never listed in the gallery — Annot can't render them.
      if (!isImageFilename(name)) continue;
      this.#tree.setBlobSha(rel, entry.sha);
    }

    this.#tree.markLoaded();
    // Persist the freshly-fetched tree state so the next session
    // (with a matching `branchHead`) can warm-start without
    // re-running this recursive fetch.
    await this.#persistTreeState();
  }

  // ===========================================================================
  // Contents API primitives
  // ===========================================================================

  /** Create or update a file. Returns the new blob SHA. */
  async #putContents(
    relPath: string,
    blob: Blob,
    message: string,
    existingSha?: string,
  ): Promise<string> {
    if (blob.size > MAX_CONTENTS_BYTES) {
      throw githubError(
        `File is too large for the GitHub Contents API (${(blob.size / 1024 / 1024).toFixed(1)} MB > 40 MB). Large-file support via the Git Data API is planned for a later phase.`,
      );
    }
    const full = this.#fullPath(relPath);
    const base64 = await blobToBase64(blob);
    const body: Record<string, string> = {
      message,
      content: base64,
      branch: this.#branch,
    };
    if (existingSha) body.sha = existingSha;
    const resp = await this.#fetch(this.#contentsUrl(full), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    const newSha: string | undefined = data?.content?.sha;
    if (!newSha) throw githubError("GitHub PUT returned no content SHA.");
    this.#tree.setBlobSha(relPath, newSha);
    // Materialise the containing folder (and ancestors) in the
    // sidebar tree without waiting for a tree re-fetch.
    this.#tree.addFolderWithAncestors(getParentPath(relPath));
    // Persist the new HEAD commit SHA for peer-tab freshness.
    const newCommitSha: string | undefined = data?.commit?.sha;
    if (newCommitSha) {
      await this.#recordBranchHead(newCommitSha);
    }
    return newSha;
  }

  // ===========================================================================
  // Amend path — the preferred write strategy for annotation updates.
  //
  // A naïve commit-per-save produces one git commit per debounce tick, so a
  // single editing session ends up with dozens of identical "annot: update
  // foo.png" commits filling the log. Instead we check whether the branch's
  // HEAD is already an Annot update commit for THIS file; if so, we replace
  // it with a new commit that has the SAME parent, and force-update the ref.
  // The intermediate commit is still reachable via reflog for a while but
  // drops out of `git log` — matching what `git commit --amend` does locally.
  //
  // Falls back to a regular `#putContents` whenever amend can't apply:
  //   - No previous commit (empty branch / first save of this file)
  //   - HEAD is a different file's commit, or not from Annot
  //   - Branch protection refuses force-update (422)
  //   - Any API error along the way
  //
  // Only used from `updateImage`'s annotation path; `saveImage` (new file)
  // and the Contents-API deletes keep their existing behaviour because
  // there's nothing to amend for those.
  // ===========================================================================

  async #commitFileAmendable(
    relPath: string,
    blob: Blob,
    message: string,
    expectedBlobSha?: string,
  ): Promise<string> {
    // Best-effort amend first. Any failure falls through to Contents PUT,
    // which preserves the historical behaviour unchanged.
    try {
      const amended = await this.#tryAmendCommit(relPath, blob, message, expectedBlobSha);
      if (amended) return amended;
    } catch (e) {
      // Swallow amend failures — they're non-fatal; we'll create a
      // fresh commit via Contents PUT below.
      console.warn("[github-store] amend failed, falling back to Contents PUT:", e);
    }
    return this.#putContents(relPath, blob, message, expectedBlobSha);
  }

  /**
   * Try to amend the HEAD commit on the configured branch. Returns the
   * new blob SHA on success, or `null` if the HEAD isn't amendable for
   * this file (caller should fall through to Contents PUT).
   */
  async #tryAmendCommit(
    relPath: string,
    blob: Blob,
    message: string,
    expectedBlobSha?: string,
  ): Promise<string | null> {
    const owner = encodeURIComponent(this.#owner);
    const repo = encodeURIComponent(this.#repo);
    const branchEnc = encodeURIComponent(this.#branch);
    const repoBase = `${GITHUB_API}/repos/${owner}/${repo}`;
    const fullPath = this.#fullPath(relPath);

    // 1) Current ref → HEAD commit sha.
    const refResp = await this.#fetchOrNull(`${repoBase}/git/refs/heads/${branchEnc}`);
    if (!refResp) return null;
    const refBody = await refResp.json();
    const headSha: string | undefined = refBody?.object?.sha;
    if (!headSha) return null;

    // 2) HEAD commit → parent sha + tree sha + committer info + message.
    const commitResp = await this.#fetchOrNull(`${repoBase}/git/commits/${headSha}`);
    if (!commitResp) return null;
    const commitBody = await commitResp.json();
    const headMessage = (commitBody?.message as string | undefined) ?? "";
    const parentSha: string | undefined = commitBody?.parents?.[0]?.sha;
    if (!parentSha) return null; // initial commit — amending would delete history

    // 3) Amendable iff HEAD is an Annot update commit for THIS file.
    // Matches the message produced by `#commitMessage("update", ...)`:
    // `annot: update <filename>`.
    const filename = getFilename(relPath) || relPath;
    if (headMessage !== `annot: update ${filename}`) return null;

    // Optimistic-concurrency check: the expected blob SHA the caller
    // has is still the HEAD tree's entry for this file. If somebody
    // else committed in between (GitHub UI, another tab), expectedBlobSha
    // won't match → bail so the caller's Contents PUT raises a proper
    // 409 for the user to resolve.
    if (expectedBlobSha) {
      const headTreeSha: string | undefined = commitBody?.tree?.sha;
      if (!headTreeSha) return null;
      const treeResp = await this.#fetchOrNull(`${repoBase}/git/trees/${headTreeSha}?recursive=1`);
      if (!treeResp) return null;
      const treeBody = await treeResp.json();
      const entry = (treeBody?.tree as Array<{ path: string; sha: string }> | undefined)?.find(
        (e) => e.path === fullPath,
      );
      if (!entry || entry.sha !== expectedBlobSha) return null;
    }

    // 4) New blob for the file we're writing.
    const base64 = await blobToBase64(blob);
    const blobResp = await this.#fetch(`${repoBase}/git/blobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: base64, encoding: "base64" }),
    });
    const blobBody = await blobResp.json();
    const newBlobSha: string | undefined = blobBody?.sha;
    if (!newBlobSha) throw githubError("git/blobs returned no SHA");

    // 5) New tree: inherit the HEAD tree and overlay our file.
    const headTreeSha: string | undefined = commitBody?.tree?.sha;
    if (!headTreeSha) return null;
    const treePostResp = await this.#fetch(`${repoBase}/git/trees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_tree: headTreeSha,
        tree: [
          {
            path: fullPath,
            mode: "100644",
            type: "blob",
            sha: newBlobSha,
          },
        ],
      }),
    });
    const treePostBody = await treePostResp.json();
    const newTreeSha: string | undefined = treePostBody?.sha;
    if (!newTreeSha) throw githubError("git/trees returned no SHA");

    // 6) New commit with the SAME parent as the HEAD we're replacing.
    const newCommitResp = await this.#fetch(`${repoBase}/git/commits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        tree: newTreeSha,
        parents: [parentSha],
      }),
    });
    const newCommitBody = await newCommitResp.json();
    const newCommitSha: string | undefined = newCommitBody?.sha;
    if (!newCommitSha) throw githubError("git/commits returned no SHA");

    // 7) Force-update the branch ref to the replacement commit. If
    // branch protection refuses (422), treat it as a non-amendable
    // branch and let the caller fall back to Contents PUT — the user
    // will still get their save, just as an additional commit.
    const patchResp = await this.#fetchOrNull(`${repoBase}/git/refs/heads/${branchEnc}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newCommitSha, force: true }),
    });
    if (!patchResp) return null;

    // Refresh local state to reflect the new blob.
    this.#tree.setBlobSha(relPath, newBlobSha);
    this.#tree.addFolderWithAncestors(getParentPath(relPath));
    // Persist the new HEAD commit SHA so peer tabs don't think
    // we're stale after we just authored a commit.
    await this.#recordBranchHead(newCommitSha);
    return newBlobSha;
  }

  /**
   * `#fetch` variant that swallows non-OK responses and returns `null`
   * instead of throwing. Used inside the amend path where any failure
   * (missing ref, unreadable tree, branch-protection force-rejection)
   * should gracefully fall through to the Contents PUT path. Delegates
   * to the API client, which handles the same 401-retry semantics
   * as `#fetch`.
   */
  #fetchOrNull(url: string, init?: RequestInit): Promise<Response | null> {
    return this.#api.requestOrNull(url, init);
  }

  // ===========================================================================
  // Atomic multi-file commit via Git Data API.
  //
  // The Contents API works a file at a time: every PUT / DELETE is a
  // separate commit. That's fine for the single-file edit loop, but
  // operations that touch several paths — folder rename, folder move,
  // `deleteFolder` on a tree of captures, image rename (= delete-at-old
  // + add-at-new) — explode into N commits each. Users reported the
  // resulting git log as spammy, and each commit carries a
  // round-trip so the wall-clock cost grows linearly.
  //
  // `#commitTreeOps` collapses any batch of upserts / deletes into a
  // single commit on the branch:
  //
  //   1. GET /git/refs/heads/{branch}        HEAD commit sha
  //   2. GET /git/commits/{HEAD}             HEAD tree sha
  //   3. POST /git/blobs  (for each upsert with fresh content)
  //   4. POST /git/trees  base_tree = HEAD tree, overlay entries
  //   5. POST /git/commits  parent = HEAD (fast-forward)
  //   6. PATCH /git/refs/heads/{branch}  force=false (safe advance)
  //
  // Pure renames / moves (path change, content unchanged) skip the
  // blob upload in step 3 and reference the file's existing blob sha
  // — git handles the rename implicitly at the tree level.
  //
  // Returns `null` on any failure, including:
  //   - Branch protection rejects the fast-forward (422).
  //   - Ref moved between steps 1 and 6 (concurrent commit).
  //   - Network / API error at any step.
  //
  // Callers fall back to the per-file Contents API loop on null,
  // so the batch failing gracefully degrades instead of losing the
  // user's work.
  // ===========================================================================

  async #commitTreeOps(ops: TreeOp[], message: string): Promise<string | null> {
    if (ops.length === 0) return null;

    const owner = encodeURIComponent(this.#owner);
    const repo = encodeURIComponent(this.#repo);
    const branchEnc = encodeURIComponent(this.#branch);
    const repoBase = `${GITHUB_API}/repos/${owner}/${repo}`;

    try {
      // HEAD ref → commit sha.
      const refResp = await this.#fetchOrNull(`${repoBase}/git/refs/heads/${branchEnc}`);
      if (!refResp) return null;
      const headSha: string | undefined = (await refResp.json())?.object?.sha;
      if (!headSha) return null;

      // HEAD commit → tree sha.
      const commitResp = await this.#fetchOrNull(`${repoBase}/git/commits/${headSha}`);
      if (!commitResp) return null;
      const headTreeSha: string | undefined = (await commitResp.json())?.tree?.sha;
      if (!headTreeSha) return null;

      // Upload blobs in parallel for every upsert carrying fresh
      // content. Renames reuse the old blob's sha and skip this.
      const blobShaByRelPath = new Map<string, string>();
      const uploads = ops.filter((op) => op.blob != null);
      if (uploads.length > 0) {
        await Promise.all(
          uploads.map(async (op) => {
            const base64 = await blobToBase64(op.blob!);
            const blobResp = await this.#fetch(`${repoBase}/git/blobs`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: base64, encoding: "base64" }),
            });
            const body = await blobResp.json();
            if (!body?.sha) throw githubError("git/blobs returned no SHA");
            blobShaByRelPath.set(op.relPath, body.sha);
          }),
        );
      }

      // Build tree entries. Per GitHub docs, `sha: null` removes the
      // entry from base_tree; omitting it for upserts would append,
      // but we always set sha explicitly so the diff is unambiguous.
      const treeEntries = ops.map((op) => {
        const entry: {
          path: string;
          mode: string;
          type: "blob";
          sha: string | null;
        } = {
          path: this.#fullPath(op.relPath),
          mode: op.mode ?? "100644",
          type: "blob",
          sha: null,
        };
        if (op.deleteOnly) {
          entry.sha = null;
        } else if (op.existingBlobSha) {
          entry.sha = op.existingBlobSha;
        } else {
          const uploadedSha = blobShaByRelPath.get(op.relPath);
          if (!uploadedSha) throw githubError("tree op missing blob content");
          entry.sha = uploadedSha;
        }
        return entry;
      });

      const treeResp = await this.#fetch(`${repoBase}/git/trees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_tree: headTreeSha, tree: treeEntries }),
      });
      const newTreeSha: string | undefined = (await treeResp.json())?.sha;
      if (!newTreeSha) throw githubError("git/trees returned no SHA");

      const commitPostResp = await this.#fetch(`${repoBase}/git/commits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          tree: newTreeSha,
          parents: [headSha],
        }),
      });
      const newCommitSha: string | undefined = (await commitPostResp.json())?.sha;
      if (!newCommitSha) throw githubError("git/commits returned no SHA");

      // Fast-forward update. `force: false` protects against
      // concurrent commits on the branch — if someone else pushed
      // between our ref read (step 1) and this PATCH, GitHub
      // refuses with 422 and we fall back.
      const patchResp = await this.#fetchOrNull(`${repoBase}/git/refs/heads/${branchEnc}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: newCommitSha, force: false }),
      });
      if (!patchResp) return null;

      // Reconcile local state against the new commit's effective
      // contents. Upserts learn their new blob sha; deletes drop out
      // of every cache for this path.
      for (const op of ops) {
        if (op.deleteOnly) {
          this.#tree.removeBlob(op.relPath);
          await this.#cachePurge(op.relPath);
          continue;
        }
        const newBlobSha = op.existingBlobSha ?? blobShaByRelPath.get(op.relPath);
        if (newBlobSha) this.#tree.setBlobSha(op.relPath, newBlobSha);
        this.#tree.addFolderWithAncestors(getParentPath(op.relPath));
      }
      // Persist the new HEAD commit SHA so peer tabs don't think
      // we're stale after we just authored a multi-file commit.
      await this.#recordBranchHead(newCommitSha);
      return newCommitSha;
    } catch (e) {
      console.warn("[github-store] tree commit failed, caller will fall back:", e);
      return null;
    }
  }

  /** Delete a file. Requires the current SHA. */
  async #deleteContents(relPath: string, sha: string, message: string): Promise<void> {
    const full = this.#fullPath(relPath);
    const resp = await this.#fetch(this.#contentsUrl(full), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        sha,
        branch: this.#branch,
      }),
    });
    this.#tree.removeBlob(relPath);
    // We intentionally don't prune ancestor folders here — other
    // stores (Drive, Device, Browser) leave the folder visible after
    // its last child is deleted, and we mirror that behaviour.
    try {
      const data = await resp.json();
      const newCommitSha: string | undefined = data?.commit?.sha;
      if (newCommitSha) await this.#recordBranchHead(newCommitSha);
    } catch {
      /* response not JSON / no commit info — best-effort */
    }
  }

  /**
   * Fetch a blob by path. Pure read — does NOT mutate `tree-state SHA cache`.
   *
   * Writing to `tree-state SHA cache` from here was the source of a 409
   * conflict bug: a background thumbnail prefetch (launched by a
   * prior `listImages`) would eventually return with a now-stale
   * SHA and overwrite the freshly-saved one in the cache, so the
   * next save PUT would send a stale SHA and GitHub would 409.
   *
   * Callers who *want* to promote the fetched SHA into the cache
   * (e.g. `getImage`, which is on the foreground edit path) do so
   * explicitly after the await. Background callers (the thumbnail
   * prefetch) leave the cache alone.
   */
  async #getContents(relPath: string): Promise<{ bytes: Uint8Array; sha: string } | undefined> {
    const full = this.#fullPath(relPath);
    const branch = encodeURIComponent(this.#branch);
    try {
      const resp = await this.#fetch(`${this.#contentsUrl(full)}?ref=${branch}`);
      const data = await resp.json();
      if (typeof data?.content !== "string" || typeof data?.sha !== "string") {
        return undefined;
      }
      const bytes = base64ToBytes(data.content);
      return { bytes, sha: data.sha };
    } catch (e) {
      const err = e as GitHubError;
      if (err.status === 404) return undefined;
      throw e;
    }
  }

  // ===========================================================================
  // StorageProvider — Images
  // ===========================================================================

  async saveImage(data: Omit<ImageRecord, "path">, opts?: { filename?: string }): Promise<string> {
    await this.#ensureTreeLoaded();
    const folderPath = data.folderPath || "";

    const isJpeg = data.originalDataUrl.startsWith("data:image/jpeg");
    const desired = opts?.filename
      ? normalizeAnnotImageFilename(opts.filename)
      : defaultAnnotImageFilename(data.originalDataUrl);
    validateName(desired);

    const filename = uniquifyFilename(desired, (candidate) => {
      return this.#tree.hasBlob(joinPath(folderPath, candidate));
    });
    const relPath = joinPath(folderPath, filename);

    const blob = await this.#buildXmpBlob(
      {
        originalDataUrl: data.originalDataUrl,
        annotationsSvg: data.annotationsSvg,
        width: data.width,
        height: data.height,
        tags: data.tags,
      },
      isJpeg ? "jpg" : "png",
    );
    await this.#putContents(relPath, blob, this.#commitMessage("add", relPath));

    // If this save lands in a folder that previously existed only by
    // virtue of a `.gitkeep`, we leave the gitkeep in place rather
    // than chase a second commit to remove it. It's ignored by
    // listImages (extension filter) and costs 0 bytes in the repo.

    const now = new Date().toISOString();
    const record: ImageRecord = {
      path: relPath,
      folderPath,
      originalDataUrl: data.originalDataUrl,
      thumbnailDataUrl: data.thumbnailDataUrl || "",
      annotationsSvg: data.annotationsSvg || "",
      width: data.width,
      height: data.height,
      sourceUrl: data.sourceUrl || "",
      tags: data.tags || {},
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now,
      elementTree: data.elementTree,
    };
    await this.#cachePutRecord(relPath, record);
    // Thumbnail bytes are owned by the unified `ThumbnailManager`:
    // capture-host calls `tm.write(provider, path, dataUrl, dims)`
    // after `saveImage` resolves, so the gallery card has its
    // thumbnail before the next listing.
    return relPath;
  }

  async getImage(path: string): Promise<ImageRecord | undefined> {
    await this.#ensureTreeLoaded();
    // Try the shared cache before any network. SHA-versioned reads
    // mean a peer-tab commit that bumped the blob SHA on disk
    // automatically misses (our local `#tree` still has the old
    // SHA until the next forceRefresh / branchHead-mismatch
    // detection clears it; eventually the listing-cache work in
    // P9 + Phase 5's `branchHead` listener take care of this).
    const cached = await this.#cacheGetRecord(path);
    if (cached) return cached;

    // Snapshot the cached SHA before fetching so we can apply a
    // compare-and-set on the way out. Without this a concurrent
    // mutation that advances `tree-state SHA cache` while our GET is in flight
    // would be clobbered on our return path.
    const before = this.#tree.getBlobSha(path);
    const result = await this.#getContents(path);
    if (!result) return undefined;
    if (this.#tree.getBlobSha(path) === before) {
      this.#tree.setBlobSha(path, result.sha);
    }
    return await this.#decodeRecord(path, result.bytes);
  }

  async #decodeRecord(relPath: string, bytes: Uint8Array): Promise<ImageRecord> {
    // Pure decode lives in `./github-image-codec.ts`; the cache
    // write stays here because it's tied to this store instance's
    // cache, not the codec.
    //
    // Pass the previously-cached record's commit timestamps to the
    // decoder so the freshly-decoded record carries the same
    // createdAt / updatedAt the gallery has shown so far (the XMP
    // payload itself doesn't always include them).
    const previous = await this.#cacheGetRecord(relPath);
    const fallbackMeta = previous
      ? { createdAt: previous.createdAt, updatedAt: previous.updatedAt }
      : undefined;
    const record = decodeImageRecord(relPath, bytes, fallbackMeta);
    await this.#cachePutRecord(relPath, record);
    return record;
  }

  async listImages(folderPath: string): Promise<ImageRecord[]> {
    await this.#ensureTreeLoaded();
    const results: ImageRecord[] = [];
    for (const path of this.#tree.blobPaths()) {
      const name = getFilename(path);
      if (name === GITKEEP) continue;
      if (!isImageFilename(name)) continue;
      if (getParentPath(path) !== folderPath) continue;
      const cachedRecord = await this.#cacheGetRecord(path);
      // Thumbnail bytes are owned by the unified `ThumbnailManager`.
      // The gallery calls `tm.attach(provider, records)` after
      // this returns and fills `thumbnailDataUrl` from the cache
      // (or schedules a prefetch via `fetchThumbnailSource` on
      // miss). Dimensions land via the cached record (when
      // `getImage` has decoded XMP) or via the manager's own
      // dimension extraction during prefetch.
      results.push({
        path,
        folderPath,
        originalDataUrl: "",
        thumbnailDataUrl: "",
        annotationsSvg: "",
        width: cachedRecord?.width || 0,
        height: cachedRecord?.height || 0,
        sourceUrl: "",
        tags: {},
        createdAt: cachedRecord?.createdAt || "",
        updatedAt: cachedRecord?.updatedAt || "",
      });
    }
    results.sort((a, b) => a.path.localeCompare(b.path));
    return results;
  }

  // ── StorageWithThumbnailCache ────────────────────────────────

  /**
   * Stable per-image identifier for the unified thumbnail cache.
   * Repo + branch + relative path uniquely identify a blob within
   * GitHub's namespace; the basePath is folded in so two repos
   * (or two basePaths inside one repo) can't collide.
   */
  thumbnailKey(path: string): string | undefined {
    if (!this.#tree.hasBlob(path)) return undefined;
    return `github:${this.#owner}/${this.#repo}/${this.#branch}:${this.#basePath}:${path}`;
  }

  /**
   * Blob SHA — advances on every commit. Cache hits require a
   * matching SHA; mismatches evict and re-prefetch. `""` when the
   * tree hasn't been loaded yet (manager treats as constant; the
   * first listing's prefetch lands the canonical SHA, so cross-
   * session continuity works as long as the tree state is fresh).
   */
  thumbnailVersion(path: string): string {
    return this.#tree.getBlobSha(path) || "";
  }

  /**
   * Fetch the blob's bytes. Returns the raw bytes wrapped in a
   * `Blob` with the inferred mime so the manager's
   * `createImageBitmap` decode succeeds for both annot-native
   * `.annot.png|jpg` files and plain images dropped into the repo.
   */
  async fetchThumbnailSource(path: string): Promise<Blob | undefined> {
    await this.#ensureTreeLoaded();
    const fetched = await this.#getContents(path);
    if (!fetched) return undefined;
    const mime = inferMimeFromPath(path);
    return new Blob([fetched.bytes as BlobPart], { type: mime });
  }

  async updateImage(path: string, updates: ImageRecordUpdate): Promise<void> {
    await this.#ensureTreeLoaded();

    // `updates.thumbnailDataUrl` is intentionally NOT handled here.
    // Thumbnails are owned by the unified `ThumbnailManager` —
    // callers seed it via `tm.write(provider, path, dataUrl, dims)`,
    // which dispatches the `annot-thumbnail-ready` event the
    // gallery listens for. Phase 5 of the unified-thumbnail-cache
    // plan removes the field from `ImageRecordUpdate` entirely.

    // -- Annotation / tag / underlying-bitmap update: re-render + PUT
    //    in place. `originalDataUrl` carries the new bitmap when the
    //    redact-burn path explicitly mutates the base image (see
    //    `_done/redact-burn-into-image.md`); without it in the gate
    //    condition, a bitmap-only update would skip the commit and
    //    the new bytes never reach GitHub.
    if (
      updates.annotationsSvg !== undefined ||
      updates.tags !== undefined ||
      updates.originalDataUrl !== undefined ||
      updates.width !== undefined ||
      updates.height !== undefined
    ) {
      const record = await this.getImage(path);
      if (!record?.originalDataUrl) return;

      const annotationsSvg = updates.annotationsSvg ?? record.annotationsSvg;
      const tags = updates.tags ?? record.tags;
      const originalDataUrl = updates.originalDataUrl ?? record.originalDataUrl;
      const width = updates.width ?? record.width;
      const height = updates.height ?? record.height;
      const isJpeg = originalDataUrl.startsWith("data:image/jpeg");
      const blob = await this.#buildXmpBlob(
        { ...record, annotationsSvg, tags, originalDataUrl, width, height },
        isJpeg ? "jpg" : "png",
      );

      const existingSha = this.#tree.getBlobSha(path);
      try {
        // Use the amend-aware commit path so a sequence of debounced
        // updates collapses into a single commit on the branch's
        // `git log` instead of piling up identical
        // "annot: update foo.png" entries.
        await this.#commitFileAmendable(
          path,
          blob,
          this.#commitMessage("update", path),
          existingSha,
        );
      } catch (e) {
        // Auto-recover from a stale-SHA 409. This can happen when a
        // background task (e.g. thumbnail prefetch) leaves a cached
        // SHA out of date, or when a user's other tab committed to
        // the same file. Refetch the current SHA and retry once.
        // v1 is last-write-wins (see plan §5); a real merge flow is
        // a future plan.
        const err = e as GitHubError;
        if (!err.conflict) throw e;
        const fresh = await this.#getContents(path);
        if (!fresh) throw e;
        this.#tree.setBlobSha(path, fresh.sha);
        await this.#commitFileAmendable(path, blob, this.#commitMessage("update", path), fresh.sha);
      }

      await this.#cachePutRecord(path, {
        ...record,
        annotationsSvg,
        tags,
        originalDataUrl,
        width,
        height,
        updatedAt: new Date().toISOString(),
      });
      // Thumbnail cache invalidation / re-prefetch is the
      // `ThumbnailManager`'s concern: the next `attach` cycle
      // checks the new blob SHA (returned by `thumbnailVersion`)
      // against the cached entry and evicts on mismatch. The
      // editor's `writeThumbnailToStorage` runs before this PUT
      // and routes through `tm.write`, so the freshly-rendered
      // thumbnail already lands under the new SHA before the
      // gallery re-lists.
    }
  }

  /**
   * Move an image to a different folder. Implemented as a single
   * atomic Git Data API commit that re-targets the existing blob at
   * the new path and drops the old entry — so the blob is reused
   * and there's no XMP rebuild in the happy path. Falls back to
   * the two-commit Contents-API path (PUT new, DELETE old) when
   * the atomic commit fails (e.g. branch protection rejecting the
   * fast-forward).
   */
  async moveImage(path: string, newFolderPath: string): Promise<string> {
    await this.#ensureTreeLoaded();
    if (!this.#tree.hasBlob(path)) {
      throw new StorageNotFoundError(path, `Image not found: ${path}`);
    }
    if (newFolderPath === getParentPath(path)) return path;
    const newPath = joinPath(newFolderPath, getFilename(path));
    if (newPath === path) return path;
    if (this.#tree.hasBlob(newPath)) {
      throw new StorageConflictError(newPath, `Destination already exists: ${newPath}`);
    }

    const oldSha = this.#tree.getBlobSha(path);
    let moved = false;
    if (oldSha) {
      const atomicSha = await this.#commitTreeOps(
        [
          { relPath: newPath, existingBlobSha: oldSha },
          { relPath: path, deleteOnly: true },
        ],
        `annot: move ${getFilename(path)} → ${newFolderPath || "/"}`,
      );
      if (atomicSha) moved = true;
    }

    if (!moved) {
      // Fallback to the two-commit Contents-API path.
      const record = await this.getImage(path);
      if (!record?.originalDataUrl) {
        throw new StorageNotFoundError(path, `Cannot move missing image: ${path}`);
      }
      const isJpeg = record.originalDataUrl.startsWith("data:image/jpeg");
      const blob = await this.#buildXmpBlob(record, isJpeg ? "jpg" : "png");
      await this.#putContents(newPath, blob, this.#commitMessage("add", newPath));
      if (oldSha) {
        await this.#deleteContents(path, oldSha, this.#commitMessage("delete", path));
      }
    }

    await this.#cacheMigrate(path, newPath, (rec) => ({
      ...rec,
      path: newPath,
      folderPath: newFolderPath,
    }));
    return newPath;
  }

  async renameImage(path: string, newName: string): Promise<string> {
    validateName(newName);
    await this.#ensureTreeLoaded();
    if (!this.#tree.hasBlob(path)) {
      throw new StorageNotFoundError(path, `Image not found: ${path}`);
    }

    const folderPath = getParentPath(path);
    const newPath = joinPath(folderPath, newName);
    if (newPath === path) return path;
    if (this.#tree.hasBlob(newPath)) {
      throw new StorageConflictError(newPath, `Image already exists: ${newPath}`);
    }

    const oldSha = this.#tree.getBlobSha(path);

    // Atomic path: one commit that references the existing blob at
    // the new path and removes the old entry. No blob upload, no
    // content re-render — a pure git rename.
    if (oldSha) {
      const atomicSha = await this.#commitTreeOps(
        [
          { relPath: newPath, existingBlobSha: oldSha },
          { relPath: path, deleteOnly: true },
        ],
        `annot: rename ${getFilename(path)} → ${newName}`,
      );
      if (atomicSha) {
        await this.#migrateLocalCachesAfterRename(path, newPath);
        return newPath;
      }
    }

    // Fallback (branch protection, concurrent commit, API error):
    // rebuild the blob via XMP and fall back to the Contents-API
    // two-commit path. Preserves the historical semantics.
    const record = await this.getImage(path);
    if (!record?.originalDataUrl) {
      throw new StorageNotFoundError(path, `Cannot rename missing image: ${path}`);
    }
    const isJpeg = record.originalDataUrl.startsWith("data:image/jpeg");
    const blob = await this.#buildXmpBlob(record, isJpeg ? "jpg" : "png");

    await this.#putContents(newPath, blob, this.#commitMessage("add", newPath));
    if (oldSha) {
      await this.#deleteContents(path, oldSha, this.#commitMessage("delete", path));
    }

    await this.#migrateLocalCachesAfterRename(path, newPath);
    return newPath;
  }

  /** Move `path`'s cached record + document metadata to `newPath`.
   *  Shared between the atomic and fallback rename paths so both
   *  end up with the same local state. */
  async #migrateLocalCachesAfterRename(oldPath: string, newPath: string): Promise<void> {
    await this.#cacheMigrate(oldPath, newPath, (rec) => ({ ...rec, path: newPath }));
  }

  async deleteImage(path: string): Promise<void> {
    await this.#ensureTreeLoaded();
    const sha = this.#tree.getBlobSha(path);
    if (!sha) return;
    await this.#deleteContents(path, sha, this.#commitMessage("delete", path));
    await this.#cachePurge(path);
    // Phase 7d — `deleteImage` is the path-keyed delete primitive
    // per the `StorageWithDocuments` contract. The tree-state +
    // commit dance above doesn't care whether the file was an
    // image or a document; `cachePurge` already wipes any
    // document-shaped record at the same path.
  }

  // ---- Documents (Phase 7d) ─────────────────────────────────
  // `.annot.html` files are committed verbatim as `text/html` via
  // the existing `#putContents` helper. Each save = one commit;
  // matches the image-save commit cadence the rest of the store
  // uses. Metadata (title / blockCount / imageCount) is cached in
  // memory keyed by path; first listing returns filename-derived
  // defaults until the user opens the doc (which triggers a
  // getDocument + updateDocument cycle that populates the cache).

  async saveDocument(
    data: Omit<DocumentRecord, "path">,
    opts?: { filename?: string },
  ): Promise<string> {
    await this.#ensureTreeLoaded();
    const folderPath = data.folderPath || "";
    const desired = opts?.filename || `document-${Date.now()}.annot.html`;
    validateName(desired);

    const filename = uniquifyFilename(desired, (candidate) =>
      this.#tree.hasBlob(joinPath(folderPath, candidate)),
    );
    const relPath = joinPath(folderPath, filename);

    const blob = new Blob([data.bytes], { type: "text/html" });
    await this.#putContents(relPath, blob, this.#commitMessage("add", relPath));

    const now = new Date().toISOString();
    await this.#cachePutDocument(relPath, {
      path: relPath,
      folderPath,
      bytes: "",
      thumbnailDataUrl: "",
      title: data.title,
      blockCount: data.blockCount,
      imageCount: data.imageCount,
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now,
    });
    return relPath;
  }

  async getDocument(path: string): Promise<DocumentRecord | undefined> {
    await this.#ensureTreeLoaded();
    if (!this.#tree.hasBlob(path)) return undefined;
    if (!isDocumentFilename(getFilename(path))) return undefined;
    const result = await this.#getContents(path);
    if (!result) return undefined;
    const bytes = new TextDecoder().decode(result.bytes);
    const cached = await this.#cacheGetDocument(path);
    return {
      path,
      folderPath: getParentPath(path),
      bytes,
      thumbnailDataUrl: "",
      title: cached?.title ?? stripDocExtension(getFilename(path)),
      blockCount: cached?.blockCount ?? 0,
      imageCount: cached?.imageCount ?? 0,
      createdAt: cached?.createdAt ?? "",
      updatedAt: cached?.updatedAt ?? "",
    };
  }

  async listDocuments(folderPath: string): Promise<DocumentRecord[]> {
    await this.#ensureTreeLoaded();
    const out: DocumentRecord[] = [];
    for (const path of this.#tree.blobPaths()) {
      const name = getFilename(path);
      if (!isDocumentFilename(name)) continue;
      if (getParentPath(path) !== folderPath) continue;
      const cached = await this.#cacheGetDocument(path);
      out.push({
        path,
        folderPath,
        bytes: "",
        thumbnailDataUrl: "",
        title: cached?.title ?? stripDocExtension(name),
        blockCount: cached?.blockCount ?? 0,
        imageCount: cached?.imageCount ?? 0,
        createdAt: cached?.createdAt ?? "",
        updatedAt: cached?.updatedAt ?? "",
      });
    }
    out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return out;
  }

  async updateDocument(path: string, updates: DocumentRecordUpdate): Promise<void> {
    await this.#ensureTreeLoaded();
    if (!this.#tree.hasBlob(path)) return;
    if (!isDocumentFilename(getFilename(path))) return;
    if (updates.bytes !== undefined) {
      const blob = new Blob([updates.bytes], { type: "text/html" });
      await this.#putContents(path, blob, this.#commitMessage("update", path));
    }
    const existing = (await this.#cacheGetDocument(path)) ?? {
      path,
      folderPath: getParentPath(path),
      bytes: "",
      thumbnailDataUrl: "",
      title: stripDocExtension(getFilename(path)),
      blockCount: 0,
      imageCount: 0,
      createdAt: "",
      updatedAt: "",
    };
    if (updates.title !== undefined) existing.title = updates.title;
    if (updates.blockCount !== undefined) existing.blockCount = updates.blockCount;
    if (updates.imageCount !== undefined) existing.imageCount = updates.imageCount;
    if (updates.updatedAt !== undefined) existing.updatedAt = updates.updatedAt;
    await this.#cachePutDocument(path, existing);
  }

  // ===========================================================================
  // Annotations YAML sidecar (Phase 4a)
  // ===========================================================================

  async getAnnotationsYaml(pngPath: string): Promise<string | undefined> {
    const sidecarPath = annotationsYamlPathFor(pngPath);
    const result = await this.#getContents(sidecarPath);
    if (!result) return undefined;
    return new TextDecoder().decode(result.bytes);
  }

  async setAnnotationsYaml(pngPath: string, content: string): Promise<void> {
    await this.#ensureTreeLoaded();
    const sidecarPath = annotationsYamlPathFor(pngPath);
    const existingSha = this.#tree.getBlobSha(sidecarPath);
    const blob = new Blob([content], { type: "text/yaml" });
    const verb: "add" | "update" = existingSha ? "update" : "add";
    await this.#putContents(sidecarPath, blob, this.#commitMessage(verb, sidecarPath), existingSha);
  }

  // ===========================================================================
  // StorageProvider — Folders
  // ===========================================================================

  async createFolder(parentPath: string, name: string): Promise<string> {
    validateName(name);
    await this.#ensureTreeLoaded();
    const fullPath = joinPath(parentPath, name);
    if (this.#folderExists(fullPath)) {
      throw new StorageConflictError(fullPath, `Folder already exists: ${fullPath}`);
    }
    // Git has no "empty directory" concept, so we commit a zero-byte
    // `.gitkeep` to materialise the folder in the tree. The folder
    // path itself is registered in the tree state so the sidebar
    // sees it immediately without waiting for a tree re-fetch (which
    // can briefly lag behind the just-made commit anyway).
    const gitkeepRel = joinPath(fullPath, GITKEEP);
    const blob = new Blob([""], { type: "application/octet-stream" });
    await this.#putContents(gitkeepRel, blob, `annot: create folder ${fullPath}`);
    this.#tree.addFolderWithAncestors(fullPath);
    return fullPath;
  }

  async listFolders(parentPath: string): Promise<FolderRecord[]> {
    await this.#ensureTreeLoaded();
    const results: FolderRecord[] = [];
    for (const folder of this.#tree.folderPaths()) {
      if (!folder) continue;
      if (getParentPath(folder) !== parentPath) continue;
      results.push({
        path: folder,
        parentPath,
        name: getFilename(folder),
        createdAt: "",
      });
    }
    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
  }

  async getFolder(path: string): Promise<FolderRecord | undefined> {
    if (!path) return undefined;
    await this.#ensureTreeLoaded();
    if (!this.#folderExists(path)) return undefined;
    return {
      path,
      parentPath: getParentPath(path),
      name: getFilename(path),
      createdAt: "",
    };
  }

  async renameFolder(path: string, newName: string): Promise<string> {
    validateName(newName);
    const newPath = joinPath(getParentPath(path), newName);
    if (newPath === path) return path;
    await this.#moveFolderContents(path, newPath);
    return newPath;
  }

  async moveFolder(path: string, newParentPath: string): Promise<string> {
    const newPath = joinPath(newParentPath, getFilename(path));
    if (newPath === path) return path;
    await this.#moveFolderContents(path, newPath);
    return newPath;
  }

  async #moveFolderContents(oldPath: string, newPath: string): Promise<void> {
    await this.#ensureTreeLoaded();
    if (!this.#folderExists(oldPath)) {
      throw new StorageNotFoundError(oldPath, `Folder not found: ${oldPath}`);
    }
    if (this.#folderExists(newPath)) {
      throw new StorageConflictError(newPath, `Folder already exists: ${newPath}`);
    }

    // Collect every blob we track under the old path — images and
    // any `.gitkeep` markers that materialised empty subfolders.
    // Iterate a snapshot so the in-flight PUT / DELETE mutations of
    // `tree-state SHA cache` don't invalidate iteration.
    const entries = Array.from(this.#tree.blobPaths()).filter(
      (p) => p === oldPath || p.startsWith(`${oldPath}/`),
    );

    // Empty folder (just a `.gitkeep` at oldPath) — convert to a
    // one-entry batch so the atomic path still runs.
    if (entries.length === 0) {
      entries.push(joinPath(oldPath, GITKEEP));
    }

    // Atomic path: one commit that renames every descendant blob.
    // Pure rename via existingBlobSha — no byte-rebuild, no upload,
    // just a tree + commit + ref update. For a 50-file folder this
    // cuts N=100 round-trips (add + delete per file) down to 4.
    const treeOps: TreeOp[] = [];
    for (const oldFile of entries) {
      const newFile = rewritePathPrefix(oldFile, oldPath, newPath);
      const sha = this.#tree.getBlobSha(oldFile);
      if (!sha) continue;
      treeOps.push({ relPath: newFile, existingBlobSha: sha });
      treeOps.push({ relPath: oldFile, deleteOnly: true });
    }
    const atomicSha =
      treeOps.length > 0
        ? await this.#commitTreeOps(treeOps, `annot: move ${oldPath} → ${newPath}`)
        : null;

    if (!atomicSha) {
      // Fallback: per-file migrate via the Contents API. Produces
      // 2 × N commits but preserves the operation if the branch
      // refuses the atomic path (protection, concurrent commit).
      if (entries.length === 1 && getFilename(entries[0]!) === GITKEEP) {
        await this.#migrateBlob(entries[0]!, joinPath(newPath, GITKEEP), "move folder");
      } else {
        for (const oldFile of entries) {
          const newFile = rewritePathPrefix(oldFile, oldPath, newPath);
          await this.#migrateBlob(oldFile, newFile, this.#commitMessage("update", newFile));
        }
      }
    }

    await this.#rewriteDescendantCaches(oldPath, newPath);
  }

  async #migrateBlob(oldRelPath: string, newRelPath: string, message: string): Promise<void> {
    // Fast path for `.gitkeep` — no XMP, just read raw bytes, re-put, delete.
    const isKeep = getFilename(oldRelPath) === GITKEEP;
    if (isKeep) {
      const fetched = await this.#getContents(oldRelPath);
      if (!fetched) return;
      const blob = new Blob([fetched.bytes as BlobPart], { type: "application/octet-stream" });
      await this.#putContents(newRelPath, blob, message);
      await this.#deleteContents(oldRelPath, fetched.sha, `annot: cleanup ${oldRelPath}`);
      return;
    }

    const record = await this.getImage(oldRelPath);
    if (!record?.originalDataUrl) return;
    const isJpeg = record.originalDataUrl.startsWith("data:image/jpeg");
    const blob = await this.#buildXmpBlob(record, isJpeg ? "jpg" : "png");
    await this.#putContents(newRelPath, blob, message);
    const oldSha = this.#tree.getBlobSha(oldRelPath);
    if (oldSha) {
      await this.#deleteContents(oldRelPath, oldSha, this.#commitMessage("delete", oldRelPath));
    }
  }

  async #rewriteDescendantCaches(oldPath: string, newPath: string): Promise<void> {
    // Record / document-metadata entries are migrated atomically
    // by the cache's prefix-rewrite helper; the record's `path`
    // and `folderPath` fields stay consistent with the new key
    // via the transform callback.
    await this.#cacheRewritePrefix(oldPath, newPath, (rec, np) => ({
      ...rec,
      path: np,
      folderPath: getParentPath(np),
    }));
    // folder set
    this.#tree.rewriteFolderPrefix(oldPath, newPath);
    // Ensure every ancestor of the new path is present too (in case
    // the parent itself wasn't in the set yet).
    this.#tree.addFolderWithAncestors(newPath);
  }

  async deleteFolder(path: string): Promise<void> {
    if (!path) return;
    await this.#ensureTreeLoaded();
    if (!this.#folderExists(path)) return;

    // Collect every tracked blob under the folder — images plus
    // any `.gitkeep` markers for empty subfolders.
    const entries = Array.from(this.#tree.blobPaths()).filter(
      (p) => p === path || p.startsWith(`${path}/`),
    );

    // Atomic bulk delete via Git Data API: one commit drops every
    // descendant blob instead of `N` per-file Contents API deletes.
    // `#commitTreeOps` handles cache cleanup for each op on
    // success; we just need to clean the folder set separately.
    if (entries.length > 0) {
      const atomicSha = await this.#commitTreeOps(
        entries.map((rel) => ({ relPath: rel, deleteOnly: true })),
        `annot: delete folder ${path}`,
      );
      if (!atomicSha) {
        // Fallback: per-file Contents API deletes. Produces N
        // commits but guarantees the folder is gone even when
        // the atomic path is refused (branch protection etc.).
        for (const rel of entries) {
          const sha = this.#tree.getBlobSha(rel);
          if (!sha) continue;
          await this.#deleteContents(rel, sha, this.#commitMessage("delete", rel));
          await this.#cachePurge(rel);
        }
      }
    }

    // Remove the folder itself and every subfolder from the visible
    // tree. (Ancestor folders stay — they may still contain siblings.)
    this.#tree.removeFolderTree(path);
  }

  async getBreadcrumb(path: string): Promise<FolderRecord[]> {
    if (!path) return [];
    const paths = [...ancestorPaths(path), path];
    const out: FolderRecord[] = [];
    for (const p of paths) {
      const f = await this.getFolder(p);
      if (f) out.push(f);
    }
    return out;
  }

  // ===========================================================================
  // Folder-existence logic — driven directly by the tree state,
  // which is populated from the git tree's `type === "tree"` entries
  // plus any createFolder calls made locally.
  // ===========================================================================

  #folderExists(path: string): boolean {
    if (!path) return true; // root always exists
    return this.#tree.hasFolder(path);
  }

  // ===========================================================================
  // XMP build helper — delegates to the shared `image-encode.ts`
  // pipeline (Browser / Device / Drive / GitHub all use it).
  // ===========================================================================

  async #buildXmpBlob(record: Partial<ImageRecord>, format: "jpg" | "png"): Promise<Blob> {
    return buildEditableImageBlob(record, format);
  }
}

/** Phase 7d of `docs/plans/_done/annot-html-document.md` — strip the
 *  `.annot.html` extension from a filename when no cached title
 *  is available. Mirrors the per-store fallback the other
 *  backends use (DeviceStore, DesktopStore, GoogleDriveStore)
 *  so the gallery's filename column shows the same default
 *  string everywhere. */
function stripDocExtension(name: string): string {
  if (name.toLowerCase().endsWith(".annot.html")) {
    return name.slice(0, -".annot.html".length);
  }
  return name;
}
