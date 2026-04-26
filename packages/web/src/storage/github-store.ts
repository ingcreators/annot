import { renderImageRecord } from "@ingcreators/annot-render";
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
  FolderRecord,
  ImageRecord,
  ImageRecordUpdate,
  StorageProvider,
  StorageWithForceRefresh,
  StorageWithResync,
  StorageWithTokenRefresher,
} from "@ingcreators/annot-core/storage";
import {
  ancestorPaths,
  drawToThumbCanvas,
  getFilename,
  getParentPath,
  joinPath,
  rewritePathPrefix,
  uniquifyFilename,
  validateName,
} from "@ingcreators/annot-core/storage";
import { createEditableImage, readEditableImage } from "@ingcreators/annot-core/xmp";
import { loadEncodeOptions } from "../encode-options.js";
import { encodeCaptureInWorker } from "../workers/encode-client.js";
import type { GitHubCommitSummary, GitHubRepoRef } from "./github-auth.js";
import { getLastCommitForPath } from "./github-auth.js";

import {
  blobToBase64,
  blobToDataUrl,
  base64ToBytes,
  bytesToDataUrl,
  inferMimeFromPath,
  type GitHubError,
  GITHUB_API,
  GITKEEP,
  githubError,
  isImageFilename,
  MAX_CONTENTS_BYTES,
} from "./github-helpers.js";
import {
  createGitHubApiClient,
  type GitHubApiClient,
  type RateLimitListener,
} from "./github-api-client.js";
import { GitHubBlobCache } from "./github-blob-cache.js";
import {
  commitMessage as buildCommitMessage,
  contentsUrl as buildContentsUrl,
  encodePath,
  fullPath as toFullPath,
  relPath as toRelPath,
} from "./github-paths.js";
import { GitHubTreeState } from "./github-tree-state.js";

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
    StorageWithResync,
    StorageWithForceRefresh,
    StorageWithTokenRefresher
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

  /**
   * In-memory caches keyed by basePath-relative path:
   *
   *   - `record`            — last full `ImageRecord` per path.
   *     Lets `updateImage` re-render without re-fetching the source
   *     bytes.
   *   - `meta`              — last-known commit info per file
   *     (`createdAt` / `updatedAt`), surfaced to the editor header.
   *   - `thumbnail`         — gallery thumbnail data URL. GitHub
   *     has no thumbnail facility of its own, so we generate and
   *     remember our own.
   *   - `thumbnailInFlight` — dedup map for in-flight thumbnail
   *     fetches launched by `listImages` so the gallery can patch
   *     cards in place without blocking its initial render.
   *
   * Implementation lives in `./github-blob-cache.ts` so the cache
   * invariants (purge-all-on-delete, move-on-rename,
   * rewrite-on-folder-rename) are unit-testable independently of
   * the HTTP layer + I/O pipeline.
   */
  #cache = new GitHubBlobCache();

  // Token refresh + rate-limit telemetry now live inside `#api`.

  constructor(token: string, ref: GitHubRepoRef, apiClient?: GitHubApiClient) {
    this.#api = apiClient ?? createGitHubApiClient(token);
    this.#owner = ref.owner;
    this.#repo = ref.repo;
    this.#branch = ref.branch;
    this.#basePath = ref.basePath || "";
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
    this.#cache.clear();
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
          this.#cache.purge(op.relPath);
          continue;
        }
        const newBlobSha = op.existingBlobSha ?? blobShaByRelPath.get(op.relPath);
        if (newBlobSha) this.#tree.setBlobSha(op.relPath, newBlobSha);
        this.#tree.addFolderWithAncestors(getParentPath(op.relPath));
      }
      return newCommitSha;
    } catch (e) {
      console.warn("[github-store] tree commit failed, caller will fall back:", e);
      return null;
    }
  }

  /** Delete a file. Requires the current SHA. */
  async #deleteContents(relPath: string, sha: string, message: string): Promise<void> {
    const full = this.#fullPath(relPath);
    await this.#fetch(this.#contentsUrl(full), {
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

  async saveImage(data: Omit<ImageRecord, "path"> & { filename?: string }): Promise<string> {
    await this.#ensureTreeLoaded();
    const folderPath = data.folderPath || "";

    const isJpeg = data.originalDataUrl.startsWith("data:image/jpeg");
    const ext = isJpeg ? "annot.jpg" : "annot.png";
    const desired = data.filename || `annot-${Date.now()}.${ext}`;
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
      pageMetadata: data.pageMetadata,
    };
    this.#cache.setRecord(relPath, record);
    this.#cache.setMeta(relPath, { createdAt: record.createdAt, updatedAt: record.updatedAt });
    // Pre-seed the thumbnail cache from the caller-provided one so
    // the new entry shows up in the gallery immediately. `listImages`
    // will still fetch-and-cache for entries we never saved locally.
    if (data.thumbnailDataUrl) {
      this.#cache.setThumbnail(relPath, data.thumbnailDataUrl);
    }
    return relPath;
  }

  async getImage(path: string): Promise<ImageRecord | undefined> {
    const cached = this.#cache.getRecord(path);
    if (cached) return cached;

    await this.#ensureTreeLoaded();
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
    return this.#decodeRecord(path, result.bytes);
  }

  #decodeRecord(relPath: string, bytes: Uint8Array): ImageRecord {
    const folderPath = getParentPath(relPath);
    const xmp = readEditableImage(bytes);
    const meta = this.#cache.getMeta(relPath);
    const originalDataUrl =
      xmp?.originalImageDataUrl || bytesToDataUrl(bytes, inferMimeFromPath(relPath));
    const record: ImageRecord = {
      path: relPath,
      folderPath,
      originalDataUrl,
      thumbnailDataUrl: "",
      annotationsSvg: xmp?.annotationsSvg || "",
      width: xmp?.width || 0,
      height: xmp?.height || 0,
      sourceUrl: "",
      tags: xmp?.tags || {},
      createdAt: meta?.createdAt || "",
      updatedAt: meta?.updatedAt || "",
    };
    this.#cache.setRecord(relPath, record);
    return record;
  }

  async listImages(folderPath: string): Promise<ImageRecord[]> {
    await this.#ensureTreeLoaded();
    const results: ImageRecord[] = [];
    const uncachedPaths: string[] = [];
    for (const path of this.#tree.blobPaths()) {
      const name = getFilename(path);
      if (name === GITKEEP) continue;
      if (!isImageFilename(name)) continue;
      if (getParentPath(path) !== folderPath) continue;
      const meta = this.#cache.getMeta(path);
      const cachedThumb = this.#cache.getThumbnail(path);
      if (!cachedThumb) uncachedPaths.push(path);
      results.push({
        path,
        folderPath,
        originalDataUrl: "",
        thumbnailDataUrl: cachedThumb || "",
        annotationsSvg: "",
        width: 0,
        height: 0,
        sourceUrl: "",
        tags: {},
        createdAt: meta?.createdAt || "",
        updatedAt: meta?.updatedAt || "",
      });
    }
    results.sort((a, b) => a.path.localeCompare(b.path));
    // Fire-and-forget thumbnail prefetch. Each one emits a DOM event
    // on completion (see `#ensureThumbnail`) so the gallery can patch
    // the card's `<img src>` in place without awaiting here.
    for (const p of uncachedPaths) {
      void this.#ensureThumbnail(p);
    }
    return results;
  }

  /**
   * Fetch `path`'s blob, generate a 480px JPEG thumbnail, cache the
   * resulting data URL, and emit an `annot-thumbnail-ready` window
   * event so any rendered gallery card for this path can swap in the
   * real thumbnail. Idempotent: duplicate calls share the in-flight
   * promise and cache hits return immediately.
   */
  async #ensureThumbnail(relPath: string): Promise<void> {
    if (this.#cache.hasThumbnail(relPath)) return;
    const existing = this.#cache.getThumbnailInFlight(relPath);
    if (existing) return existing;
    // `inFlight` is captured so the `finally` block can confirm
    // ownership of the in-flight slot before clearing it. Without
    // this check, an orphaned pre-save prefetch would clobber the
    // newer prefetch's entry when its `finally` ran.
    let inFlight: Promise<void> | undefined;
    inFlight = (async () => {
      try {
        // Snapshot the SHA so we can detect a concurrent mutation
        // during the fetch. If the file was re-committed locally
        // (e.g. via `updateImage` → `#putContents`) while our GET
        // was in flight, our bytes are already stale — skip caching
        // the thumbnail so the next `listImages` / post-save trigger
        // schedules a fresh fetch against the up-to-date blob.
        const before = this.#tree.getBlobSha(relPath);
        const fetched = await this.#getContents(relPath);
        if (!fetched) return;
        if (this.#tree.getBlobSha(relPath) !== before) return;

        const mime = inferMimeFromPath(relPath);
        const blob = new Blob([fetched.bytes as BlobPart], { type: mime });
        const bmp = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(1, 1);
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        drawToThumbCanvas(ctx, canvas, bmp, bmp.width, bmp.height, 480);
        bmp.close();
        const outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
        const dataUrl = await blobToDataUrl(outBlob);
        // Re-check after the (synchronous-ish but yielding) encode —
        // a save could have finished between our SHA snapshot and
        // the canvas work.
        if (this.#tree.getBlobSha(relPath) !== before) return;
        // Don't clobber a freshly-seeded thumbnail from the editor
        // (`updateImage({ thumbnailDataUrl })` → seed → clear
        // in-flight). Its render reflects the current canvas state,
        // which may include edits newer than what our GET saw.
        if (this.#cache.hasThumbnail(relPath)) return;
        this.#cache.setThumbnail(relPath, dataUrl);
        // CustomEvent is typed loosely here because we don't augment
        // the WindowEventMap globally for a storage-specific event.
        window.dispatchEvent(
          new CustomEvent("annot-thumbnail-ready", {
            detail: { path: relPath, dataUrl },
          }),
        );
      } catch {
        // Swallow — the gallery just keeps showing the placeholder.
        // A subsequent forceRefresh / navigation retries.
      } finally {
        // Only clear the in-flight slot if it's still ours. A save
        // that raced in may have already removed this entry and
        // launched a replacement prefetch.
        if (this.#cache.getThumbnailInFlight(relPath) === inFlight) {
          this.#cache.deleteThumbnailInFlight(relPath);
        }
      }
    })();
    this.#cache.setThumbnailInFlight(relPath, inFlight);
    return inFlight;
  }

  async updateImage(path: string, updates: ImageRecordUpdate): Promise<string> {
    await this.#ensureTreeLoaded();
    let currentPath = path;

    // -- Thumbnail-only update from the editor (every 2s during
    // editing, also flushed on navigation boundaries). Thumbnails
    // aren't persisted in the repo — we just seed the in-memory
    // cache so the gallery sees the caller-provided render directly
    // without waiting on the background prefetch's round-trip.
    if (updates.thumbnailDataUrl !== undefined) {
      if (updates.thumbnailDataUrl) {
        this.#cache.setThumbnail(currentPath, updates.thumbnailDataUrl);
        // Stop any still-in-flight prefetch from clobbering this
        // freshly-rendered thumbnail — the editor canvas is the
        // source of truth at this moment.
        this.#cache.deleteThumbnailInFlight(currentPath);
        window.dispatchEvent(
          new CustomEvent("annot-thumbnail-ready", {
            detail: { path: currentPath, dataUrl: updates.thumbnailDataUrl },
          }),
        );
      } else {
        // Caller passed empty (generator failed) — don't leave a
        // stale entry hanging around. Wipe so the next listImages
        // schedules a fresh prefetch from the just-committed blob.
        this.#cache.deleteThumbnail(currentPath);
        this.#cache.deleteThumbnailInFlight(currentPath);
        void this.#ensureThumbnail(currentPath);
      }
      const existingRecord = this.#cache.getRecord(currentPath);
      if (existingRecord) {
        this.#cache.setRecord(currentPath, {
          ...existingRecord,
          thumbnailDataUrl: updates.thumbnailDataUrl,
        });
      }
    }

    // -- Annotation / tag update: re-render + PUT in place.
    if (updates.annotationsSvg !== undefined || updates.tags !== undefined) {
      const record = await this.getImage(currentPath);
      if (!record?.originalDataUrl) return currentPath;

      const annotationsSvg = updates.annotationsSvg ?? record.annotationsSvg;
      const tags = updates.tags ?? record.tags;
      const isJpeg = record.originalDataUrl.startsWith("data:image/jpeg");
      const blob = await this.#buildXmpBlob(
        { ...record, annotationsSvg, tags },
        isJpeg ? "jpg" : "png",
      );

      const existingSha = this.#tree.getBlobSha(currentPath);
      try {
        // Use the amend-aware commit path so a sequence of debounced
        // updates collapses into a single commit on the branch's
        // `git log` instead of piling up identical
        // "annot: update foo.png" entries.
        await this.#commitFileAmendable(
          currentPath,
          blob,
          this.#commitMessage("update", currentPath),
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
        const fresh = await this.#getContents(currentPath);
        if (!fresh) throw e;
        this.#tree.setBlobSha(currentPath, fresh.sha);
        await this.#commitFileAmendable(
          currentPath,
          blob,
          this.#commitMessage("update", currentPath),
          fresh.sha,
        );
      }

      this.#cache.setRecord(currentPath, {
        ...record,
        annotationsSvg,
        tags,
        updatedAt: new Date().toISOString(),
      });
      // Don't invalidate the thumbnail cache here. The editor runs
      // its own `writeThumbnailToStorage` (2 s debounce) which fires
      // before this annotation save (10 s debounce) and seeds the
      // cache with a render of the exact same canvas state we're
      // committing now — so the cache already matches the just-
      // committed blob. A blanket `delete` + re-prefetch would leave
      // the cache empty for the network round-trip it takes the
      // prefetch to complete, producing a black-tile flash if the
      // user navigates into that window.
      //
      // Still kick off `#ensureThumbnail` as a *fallback*: the
      // `cache.has` guard inside makes it a no-op when the editor
      // thumbnail is present, and it populates the cache when
      // `writeThumbnailToStorage` didn't run (e.g. the generator
      // errored or the editor was torn down before the 2 s timer).
      void this.#ensureThumbnail(currentPath);
    }

    // -- Move: implemented as delete-at-old + create-at-new. Two
    // commits per move; `oss-cloud-split.md`-aligned Phase 4 polish
    // switches to a single Git Data API commit.
    if (updates.folderPath !== undefined && updates.folderPath !== getParentPath(currentPath)) {
      const newFolderPath = updates.folderPath;
      const newPath = joinPath(newFolderPath, getFilename(currentPath));
      if (newPath === currentPath) return currentPath;
      if (this.#tree.hasBlob(newPath)) {
        throw githubError(`Destination already exists: ${newPath}`);
      }

      const oldSha = this.#tree.getBlobSha(currentPath);

      // Atomic move: single commit that re-targets the existing
      // blob at the new path and drops the old entry. Reuses the
      // blob, so no XMP rebuild / upload in the happy path.
      let moved = false;
      if (oldSha) {
        const atomicSha = await this.#commitTreeOps(
          [
            { relPath: newPath, existingBlobSha: oldSha },
            { relPath: currentPath, deleteOnly: true },
          ],
          `annot: move ${getFilename(currentPath)} → ${newFolderPath || "/"}`,
        );
        if (atomicSha) moved = true;
      }

      if (!moved) {
        // Fallback to the two-commit Contents-API path.
        const record = await this.getImage(currentPath);
        if (!record?.originalDataUrl) {
          throw githubError(`Cannot move missing image: ${currentPath}`);
        }
        const isJpeg = record.originalDataUrl.startsWith("data:image/jpeg");
        const blob = await this.#buildXmpBlob(record, isJpeg ? "jpg" : "png");
        await this.#putContents(newPath, blob, this.#commitMessage("add", newPath));
        if (oldSha) {
          await this.#deleteContents(
            currentPath,
            oldSha,
            this.#commitMessage("delete", currentPath),
          );
        }
      }

      this.#cache.migrateEntry(currentPath, newPath, (rec) => ({
        ...rec,
        path: newPath,
        folderPath: newFolderPath,
      }));
      currentPath = newPath;
    }

    return currentPath;
  }

  async renameImage(path: string, newName: string): Promise<string> {
    validateName(newName);
    await this.#ensureTreeLoaded();
    if (!this.#tree.hasBlob(path)) return path;

    const folderPath = getParentPath(path);
    const newPath = joinPath(folderPath, newName);
    if (newPath === path) return path;
    if (this.#tree.hasBlob(newPath)) {
      throw githubError(`Image already exists: ${newPath}`);
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
        this.#migrateLocalCachesAfterRename(path, newPath);
        return newPath;
      }
    }

    // Fallback (branch protection, concurrent commit, API error):
    // rebuild the blob via XMP and fall back to the Contents-API
    // two-commit path. Preserves the historical semantics.
    const record = await this.getImage(path);
    if (!record?.originalDataUrl) {
      throw githubError(`Cannot rename missing image: ${path}`);
    }
    const isJpeg = record.originalDataUrl.startsWith("data:image/jpeg");
    const blob = await this.#buildXmpBlob(record, isJpeg ? "jpg" : "png");

    await this.#putContents(newPath, blob, this.#commitMessage("add", newPath));
    if (oldSha) {
      await this.#deleteContents(path, oldSha, this.#commitMessage("delete", path));
    }

    this.#migrateLocalCachesAfterRename(path, newPath);
    return newPath;
  }

  /** Move `path`'s in-memory record / meta / thumbnail entries to
   *  `newPath`. Shared between the atomic and fallback rename
   *  paths so both end up with the same local state. */
  #migrateLocalCachesAfterRename(oldPath: string, newPath: string): void {
    this.#cache.migrateEntry(oldPath, newPath, (rec) => ({ ...rec, path: newPath }));
  }

  async deleteImage(path: string): Promise<void> {
    await this.#ensureTreeLoaded();
    const sha = this.#tree.getBlobSha(path);
    if (!sha) return;
    await this.#deleteContents(path, sha, this.#commitMessage("delete", path));
    this.#cache.purge(path);
  }

  // ===========================================================================
  // StorageProvider — Folders
  // ===========================================================================

  async createFolder(parentPath: string, name: string): Promise<string> {
    validateName(name);
    await this.#ensureTreeLoaded();
    const fullPath = joinPath(parentPath, name);
    if (this.#folderExists(fullPath)) {
      throw githubError(`Folder already exists: ${fullPath}`);
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
    if (!this.#folderExists(oldPath)) return;
    if (this.#folderExists(newPath)) {
      throw githubError(`Folder already exists: ${newPath}`);
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

    this.#rewriteDescendantCaches(oldPath, newPath);
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

  #rewriteDescendantCaches(oldPath: string, newPath: string): void {
    // Record / meta / thumbnail entries are migrated atomically by
    // the cache's prefix-rewrite helper; the record's `path` and
    // `folderPath` fields stay consistent with the new key via the
    // transform callback.
    this.#cache.rewriteEntriesForPrefix(oldPath, newPath, (rec, np) => ({
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
          this.#cache.purge(rel);
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
  // Thumbnail (client-side; identical to other stores)
  // ===========================================================================

  async generateThumbnail(dataUrl: string, maxWidth = 480): Promise<string> {
    try {
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      const bmp = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(1, 1);
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      drawToThumbCanvas(ctx, canvas, bmp, bmp.width, bmp.height, maxWidth);
      bmp.close();
      const outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
      return blobToDataUrl(outBlob);
    } catch {
      return "";
    }
  }

  // ===========================================================================
  // XMP build helper (mirrors GoogleDriveStore.#buildXmpBlob).
  // TODO(oss-cloud-split): factor into a shared helper when a second
  // non-Drive store needs it — this copy exists to keep Phase 2's
  // diff focused on the GitHub-specific pieces.
  // ===========================================================================

  async #buildXmpBlob(record: Partial<ImageRecord>, format: "jpg" | "png"): Promise<Blob> {
    let renderedBlob: Blob;
    if (record.annotationsSvg && record.annotationsSvg.length > 10 && record.originalDataUrl) {
      const renderedDataUrl = await renderImageRecord(
        record.originalDataUrl,
        record.annotationsSvg,
        record.width || 0,
        record.height || 0,
      );
      let finalDataUrl = renderedDataUrl;
      if (format === "png") {
        try {
          const opts = loadEncodeOptions();
          const encoded = await encodeCaptureInWorker(renderedDataUrl, opts);
          finalDataUrl = encoded.dataUrl;
        } catch (e) {
          console.warn("[github-store] rendered-image re-encode failed, keeping PNG-24:", e);
        }
      }
      renderedBlob = await (await fetch(finalDataUrl)).blob();
    } else if (record.originalDataUrl) {
      renderedBlob = await (await fetch(record.originalDataUrl)).blob();
    } else {
      renderedBlob = new Blob([]);
    }
    return createEditableImage({
      renderedBlob,
      originalDataUrl: record.originalDataUrl || "",
      annotationsSvg: record.annotationsSvg || "",
      width: record.width || 0,
      height: record.height || 0,
      format,
      tags: record.tags || {},
    });
  }
}

