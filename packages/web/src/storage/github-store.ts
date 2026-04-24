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
  ImageRecord,
  ImageRecordUpdate,
  FolderRecord,
  StorageProvider,
} from "@ingcreators/annot-core/storage";
import {
  joinPath,
  getParentPath,
  getFilename,
  validateName,
  ancestorPaths,
  rewritePathPrefix,
  uniquifyFilename,
  drawToThumbCanvas,
} from "@ingcreators/annot-core/storage";
import {
  createEditableImage,
  readEditableImage,
} from "@ingcreators/annot-core/xmp";
import { renderImageRecord } from "@ingcreators/annot-core/editor/export";
import { encodeCaptureInWorker } from "../workers/encode-client.js";
import { loadEncodeOptions } from "../encode-options.js";
import type { GitHubRepoRef } from "./github-auth.js";

const GITHUB_API = "https://api.github.com";

/** Empty-folder marker. Conventional in git-tracked trees; weighs 0 bytes. */
const GITKEEP = ".gitkeep";

/**
 * Hard ceiling we accept via the Contents API. The documented limit
 * is ~100 MB binary / ~1 MB text, but requests approaching those
 * numbers get rate-limit penalized hard. Annot captures are almost
 * always well under this; scroll captures on retina displays can
 * occasionally exceed. Phase 4 will add Git Data API fallback for
 * oversized blobs.
 */
const MAX_CONTENTS_BYTES = 40 * 1024 * 1024; // 40 MB rendered size

interface TreeEntry {
  path: string;            // repo-relative
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

interface GitHubError extends Error {
  status?: number;
  githubError?: true;
  conflict?: true;
}

function githubError(message: string, status?: number, extra?: Partial<GitHubError>): GitHubError {
  const err = new Error(message) as GitHubError;
  err.githubError = true;
  if (status !== undefined) err.status = status;
  if (extra?.conflict) err.conflict = true;
  return err;
}

export class GitHubStore implements StorageProvider {
  #token: string;
  #owner: string;
  #repo: string;
  #branch: string;
  /** "" for repo root; otherwise a repo-relative prefix without
   *  leading/trailing slash (normalized via `normalizeBasePath`). */
  #basePath: string;

  // ---- Tree state (keys are relative paths, i.e. basePath-relative) ----

  /** File path → current blob SHA. Updated on every PUT/DELETE response. */
  #shaByPath = new Map<string, string>();
  /** All file paths that exist in the tree (relative to basePath). */
  #allFilePaths = new Set<string>();
  /** Folder paths that exist *only* because of a `.gitkeep` file we
   *  (or someone else) committed there. Deleting the last child in
   *  such a folder should leave the `.gitkeep` in place so the folder
   *  remains listable until the user explicitly deletes it. */
  #gitkeepFolders = new Set<string>();
  /** Guard: `#loadTree` only runs once per session unless `resync()`
   *  is called. GitHub trees are consistent-enough for a tab session. */
  #treeLoaded = false;
  /** Same dedupe pattern as Drive's refresh — multiple concurrent
   *  first-listImages calls share a single `#loadTree` promise. */
  #treeLoadInFlight: Promise<void> | null = null;

  /** Last-known commit info per file, surfaced to the editor header
   *  (Phase 4). Populated opportunistically on `getImage`. */
  #fileMeta = new Map<string, { createdAt?: string; updatedAt?: string }>();

  /**
   * Mirror of the last full `ImageRecord` we produced per path. Keeps
   * edit-loops fast: `updateImage` needs the original image bytes to
   * re-render, and without this cache every save round-trips through
   * the Contents GET. Kept in sync by every mutation path.
   */
  #recordCache = new Map<string, ImageRecord>();

  // ---- Token refresh ----

  /**
   * Host-supplied callback that returns a fresh PAT when the current
   * one 401s. PATs can't be silently refreshed (unlike Drive's
   * refresh token), so this callback typically shows the PAT paste
   * dialog again. Returning `null` lets the 401 propagate so the
   * caller can surface a user-visible error.
   */
  #refreshToken?: () => Promise<string | null>;
  #refreshInFlight: Promise<string | null> | null = null;

  // ---- Rate limit telemetry ----

  /** Most recent X-RateLimit-Remaining / -Reset values from the
   *  Contents + Git Data APIs. Exposed via `getRateLimit()` so the
   *  UI can render an advisory banner when remaining drops low. */
  #rateLimitRemaining: number | null = null;
  #rateLimitReset: number | null = null;

  constructor(token: string, ref: GitHubRepoRef) {
    this.#token = token;
    this.#owner = ref.owner;
    this.#repo = ref.repo;
    this.#branch = ref.branch;
    this.#basePath = ref.basePath || "";
  }

  setToken(token: string): void {
    this.#token = token;
  }

  setTokenRefresher(refresher: () => Promise<string | null>): void {
    this.#refreshToken = refresher;
  }

  getRateLimit(): { remaining: number | null; resetAt: number | null } {
    return { remaining: this.#rateLimitRemaining, resetAt: this.#rateLimitReset };
  }

  async resync(): Promise<void> {
    this.#shaByPath.clear();
    this.#allFilePaths.clear();
    this.#gitkeepFolders.clear();
    this.#fileMeta.clear();
    this.#recordCache.clear();
    this.#treeLoaded = false;
    this.#treeLoadInFlight = null;
  }

  // ===========================================================================
  // Path helpers — convert between the caller's basePath-relative paths and
  // the repo-absolute paths GitHub's API wants.
  // ===========================================================================

  /** basePath-relative path → repo-absolute path. */
  #fullPath(relPath: string): string {
    if (!relPath) return this.#basePath;
    return this.#basePath ? `${this.#basePath}/${relPath}` : relPath;
  }

  /** repo-absolute path → basePath-relative path, or `null` if
   *  outside basePath. */
  #relPath(fullPath: string): string | null {
    if (!this.#basePath) return fullPath;
    if (fullPath === this.#basePath) return "";
    const prefix = this.#basePath + "/";
    if (fullPath.startsWith(prefix)) return fullPath.slice(prefix.length);
    return null;
  }

  #encodePath(path: string): string {
    // Percent-encode each segment separately so slashes stay intact.
    return path.split("/").map((s) => encodeURIComponent(s)).join("/");
  }

  #contentsUrl(fullPath: string): string {
    const owner = encodeURIComponent(this.#owner);
    const repo = encodeURIComponent(this.#repo);
    return `${GITHUB_API}/repos/${owner}/${repo}/contents/${this.#encodePath(fullPath)}`;
  }

  #commitMessage(verb: "add" | "update" | "delete", relPath: string): string {
    const name = getFilename(relPath) || relPath;
    return `annot: ${verb} ${name}`;
  }

  // ===========================================================================
  // Low-level fetch + 401 auto-recovery (mirrors GoogleDriveStore.#fetch).
  // ===========================================================================

  async #fetch(url: string, init?: RequestInit): Promise<Response> {
    const resp = await this.#fetchOnce(url, init);
    if (resp.ok) {
      this.#updateRateLimit(resp);
      return resp;
    }

    if (resp.status === 401 && this.#refreshToken) {
      await resp.text().catch(() => "");
      const newToken = await (this.#refreshInFlight ??= this.#runRefresh());
      if (newToken) {
        const retry = await this.#fetchOnce(url, init);
        if (retry.ok) {
          this.#updateRateLimit(retry);
          return retry;
        }
        await this.#throwGitHubError(retry);
      }
    }
    await this.#throwGitHubError(resp);
    // Unreachable — `#throwGitHubError` always throws.
    return resp;
  }

  async #fetchOnce(url: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...((init?.headers as Record<string, string>) || {}),
    };
    return fetch(url, { ...init, headers });
  }

  #updateRateLimit(resp: Response): void {
    const remaining = resp.headers.get("X-RateLimit-Remaining");
    const reset = resp.headers.get("X-RateLimit-Reset");
    if (remaining != null) this.#rateLimitRemaining = parseInt(remaining, 10);
    if (reset != null) this.#rateLimitReset = parseInt(reset, 10) * 1000;
  }

  async #throwGitHubError(resp: Response): Promise<never> {
    const text = await resp.text().catch(() => "");
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      if (parsed?.message) detail = parsed.message;
    } catch { /* keep raw text */ }

    // 409 on PUT means our cached SHA was stale — someone else
    // committed to the same path between our read and write. Tag
    // the error so callers (the editor save path) can offer a
    // Refresh-then-retry UX.
    const extra: Partial<GitHubError> = {};
    if (resp.status === 409 || (resp.status === 422 && /sha/i.test(detail))) {
      extra.conflict = true;
    }
    throw githubError(
      `GitHub API ${resp.status}: ${detail}`,
      resp.status,
      extra,
    );
  }

  async #runRefresh(): Promise<string | null> {
    try {
      const token = await this.#refreshToken!();
      if (token) this.#token = token;
      return token;
    } catch (e) {
      console.warn("[github-store] token refresh threw:", e);
      return null;
    } finally {
      this.#refreshInFlight = null;
    }
  }

  // ===========================================================================
  // Tree loading (once per session unless `resync()` is called).
  // ===========================================================================

  #ensureTreeLoaded(): Promise<void> {
    if (this.#treeLoaded) return Promise.resolve();
    return (this.#treeLoadInFlight ??= this.#loadTree().finally(() => {
      this.#treeLoadInFlight = null;
    }));
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
      if (entry.type !== "blob") continue;
      const rel = this.#relPath(entry.path);
      if (rel == null) continue;
      const name = getFilename(rel);
      if (name === GITKEEP) {
        const folder = getParentPath(rel);
        this.#gitkeepFolders.add(folder);
        // Also track the gitkeep file's SHA so we can delete it on
        // `deleteFolder`.
        this.#shaByPath.set(rel, entry.sha);
        this.#allFilePaths.add(rel);
        continue;
      }
      this.#shaByPath.set(rel, entry.sha);
      this.#allFilePaths.add(rel);
    }

    this.#treeLoaded = true;
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
        `File is too large for the GitHub Contents API (${(blob.size / 1024 / 1024).toFixed(1)} MB > 40 MB). `
          + `Large-file support via the Git Data API is planned for a later phase.`,
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
    this.#shaByPath.set(relPath, newSha);
    this.#allFilePaths.add(relPath);
    return newSha;
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
    this.#shaByPath.delete(relPath);
    this.#allFilePaths.delete(relPath);
  }

  /** Fetch a blob by path. Returns the bytes + SHA for cache seeding. */
  async #getContents(relPath: string): Promise<{ bytes: Uint8Array; sha: string } | undefined> {
    const full = this.#fullPath(relPath);
    const branch = encodeURIComponent(this.#branch);
    try {
      const resp = await this.#fetch(
        `${this.#contentsUrl(full)}?ref=${branch}`,
      );
      const data = await resp.json();
      if (typeof data?.content !== "string" || typeof data?.sha !== "string") {
        return undefined;
      }
      const bytes = base64ToBytes(data.content);
      this.#shaByPath.set(relPath, data.sha);
      this.#allFilePaths.add(relPath);
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
      return this.#allFilePaths.has(joinPath(folderPath, candidate));
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
    // virtue of a `.gitkeep`, we can remove the gitkeep now that
    // there's real content — but leave that to the next deleteImage
    // call to batch cleanup. For now the gitkeep stays; it's ignored
    // by listImages.

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
    this.#recordCache.set(relPath, record);
    this.#fileMeta.set(relPath, { createdAt: record.createdAt, updatedAt: record.updatedAt });
    return relPath;
  }

  async getImage(path: string): Promise<ImageRecord | undefined> {
    const cached = this.#recordCache.get(path);
    if (cached) return cached;

    await this.#ensureTreeLoaded();
    if (!this.#allFilePaths.has(path)) {
      // Give the Contents API a chance anyway — the tree cache may
      // be out of date (external commit) even though we haven't
      // explicitly `resync`-ed. If it also 404s we hand back undefined.
      const fresh = await this.#getContents(path);
      if (!fresh) return undefined;
      return this.#decodeRecord(path, fresh.bytes);
    }

    const result = await this.#getContents(path);
    if (!result) return undefined;
    return this.#decodeRecord(path, result.bytes);
  }

  #decodeRecord(relPath: string, bytes: Uint8Array): ImageRecord {
    const folderPath = getParentPath(relPath);
    const xmp = readEditableImage(bytes);
    const meta = this.#fileMeta.get(relPath);
    const originalDataUrl = xmp?.originalImageDataUrl
      || bytesToDataUrl(bytes, inferMimeFromPath(relPath));
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
    this.#recordCache.set(relPath, record);
    return record;
  }

  async listImages(folderPath: string): Promise<ImageRecord[]> {
    await this.#ensureTreeLoaded();
    const results: ImageRecord[] = [];
    for (const path of this.#allFilePaths) {
      if (getFilename(path) === GITKEEP) continue;
      if (getParentPath(path) !== folderPath) continue;
      const meta = this.#fileMeta.get(path);
      results.push({
        path,
        folderPath,
        originalDataUrl: "",
        thumbnailDataUrl: "",
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
    return results;
  }

  async updateImage(path: string, updates: ImageRecordUpdate): Promise<string> {
    await this.#ensureTreeLoaded();
    let currentPath = path;

    // -- Annotation / tag update: re-render + PUT in place.
    if (updates.annotationsSvg !== undefined || updates.tags !== undefined) {
      const record = await this.getImage(currentPath);
      if (!record || !record.originalDataUrl) return currentPath;

      const annotationsSvg = updates.annotationsSvg ?? record.annotationsSvg;
      const tags = updates.tags ?? record.tags;
      const isJpeg = record.originalDataUrl.startsWith("data:image/jpeg");
      const blob = await this.#buildXmpBlob(
        { ...record, annotationsSvg, tags },
        isJpeg ? "jpg" : "png",
      );

      const existingSha = this.#shaByPath.get(currentPath);
      await this.#putContents(
        currentPath,
        blob,
        this.#commitMessage("update", currentPath),
        existingSha,
      );

      this.#recordCache.set(currentPath, {
        ...record,
        annotationsSvg,
        tags,
        updatedAt: new Date().toISOString(),
      });
    }

    // -- Move: implemented as delete-at-old + create-at-new. Two
    // commits per move; `oss-cloud-split.md`-aligned Phase 4 polish
    // switches to a single Git Data API commit.
    if (updates.folderPath !== undefined && updates.folderPath !== getParentPath(currentPath)) {
      const newFolderPath = updates.folderPath;
      const newPath = joinPath(newFolderPath, getFilename(currentPath));
      if (newPath === currentPath) return currentPath;
      if (this.#allFilePaths.has(newPath)) {
        throw githubError(`Destination already exists: ${newPath}`);
      }

      const record = await this.getImage(currentPath);
      if (!record || !record.originalDataUrl) {
        throw githubError(`Cannot move missing image: ${currentPath}`);
      }
      const isJpeg = record.originalDataUrl.startsWith("data:image/jpeg");
      const blob = await this.#buildXmpBlob(record, isJpeg ? "jpg" : "png");

      // Create first; if it fails we haven't lost the original.
      await this.#putContents(newPath, blob, this.#commitMessage("add", newPath));
      const oldSha = this.#shaByPath.get(currentPath);
      if (oldSha) {
        await this.#deleteContents(currentPath, oldSha, this.#commitMessage("delete", currentPath));
      }

      const cached = this.#recordCache.get(currentPath);
      if (cached) {
        this.#recordCache.delete(currentPath);
        this.#recordCache.set(newPath, { ...cached, path: newPath, folderPath: newFolderPath });
      }
      const meta = this.#fileMeta.get(currentPath);
      if (meta) {
        this.#fileMeta.delete(currentPath);
        this.#fileMeta.set(newPath, meta);
      }
      currentPath = newPath;
    }

    return currentPath;
  }

  async renameImage(path: string, newName: string): Promise<string> {
    validateName(newName);
    await this.#ensureTreeLoaded();
    if (!this.#allFilePaths.has(path)) return path;

    const folderPath = getParentPath(path);
    const newPath = joinPath(folderPath, newName);
    if (newPath === path) return path;
    if (this.#allFilePaths.has(newPath)) {
      throw githubError(`Image already exists: ${newPath}`);
    }

    const record = await this.getImage(path);
    if (!record || !record.originalDataUrl) {
      throw githubError(`Cannot rename missing image: ${path}`);
    }
    const isJpeg = record.originalDataUrl.startsWith("data:image/jpeg");
    const blob = await this.#buildXmpBlob(record, isJpeg ? "jpg" : "png");

    await this.#putContents(newPath, blob, this.#commitMessage("add", newPath));
    const oldSha = this.#shaByPath.get(path);
    if (oldSha) {
      await this.#deleteContents(path, oldSha, this.#commitMessage("delete", path));
    }

    const cached = this.#recordCache.get(path);
    if (cached) {
      this.#recordCache.delete(path);
      this.#recordCache.set(newPath, { ...cached, path: newPath });
    }
    const meta = this.#fileMeta.get(path);
    if (meta) {
      this.#fileMeta.delete(path);
      this.#fileMeta.set(newPath, meta);
    }
    return newPath;
  }

  async deleteImage(path: string): Promise<void> {
    await this.#ensureTreeLoaded();
    const sha = this.#shaByPath.get(path);
    if (!sha) return;
    await this.#deleteContents(path, sha, this.#commitMessage("delete", path));
    this.#recordCache.delete(path);
    this.#fileMeta.delete(path);
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
    const gitkeepRel = joinPath(fullPath, GITKEEP);
    // Zero-byte blob is valid; GitHub stores it as an empty file.
    const blob = new Blob([""], { type: "application/octet-stream" });
    await this.#putContents(gitkeepRel, blob, `annot: create folder ${fullPath}`);
    this.#gitkeepFolders.add(fullPath);
    return fullPath;
  }

  async listFolders(parentPath: string): Promise<FolderRecord[]> {
    await this.#ensureTreeLoaded();
    const folders = this.#allExistingFolders();
    const results: FolderRecord[] = [];
    for (const folder of folders) {
      if (getParentPath(folder) !== parentPath) continue;
      if (!folder) continue; // root itself is never listed
      results.push({
        path: folder,
        parentPath: getParentPath(folder),
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

    // Collect entries to move (files + any gitkeep that materialized
    // empty subfolders). Iterate a snapshot so the in-progress mutations
    // of `#allFilePaths` don't invalidate iteration.
    const entries = Array.from(this.#allFilePaths).filter((p) =>
      p === oldPath || p.startsWith(oldPath + "/")
    );

    // Ensure the destination folder materialises even if there are no
    // files under it (edge case: the user renamed an empty folder).
    if (entries.length === 0 && this.#gitkeepFolders.has(oldPath)) {
      const oldGitkeep = joinPath(oldPath, GITKEEP);
      const newGitkeep = joinPath(newPath, GITKEEP);
      await this.#migrateBlob(oldGitkeep, newGitkeep, "move folder");
      this.#gitkeepFolders.delete(oldPath);
      this.#gitkeepFolders.add(newPath);
      return;
    }

    for (const oldFile of entries) {
      const newFile = rewritePathPrefix(oldFile, oldPath, newPath);
      await this.#migrateBlob(oldFile, newFile, this.#commitMessage("update", newFile));
    }

    // Rewrite caches
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
    if (!record || !record.originalDataUrl) return;
    const isJpeg = record.originalDataUrl.startsWith("data:image/jpeg");
    const blob = await this.#buildXmpBlob(record, isJpeg ? "jpg" : "png");
    await this.#putContents(newRelPath, blob, message);
    const oldSha = this.#shaByPath.get(oldRelPath);
    if (oldSha) {
      await this.#deleteContents(oldRelPath, oldSha, this.#commitMessage("delete", oldRelPath));
    }
  }

  #rewriteDescendantCaches(oldPath: string, newPath: string): void {
    // recordCache
    for (const [p, rec] of Array.from(this.#recordCache.entries())) {
      if (p === oldPath || p.startsWith(oldPath + "/")) {
        const np = rewritePathPrefix(p, oldPath, newPath);
        this.#recordCache.delete(p);
        this.#recordCache.set(np, { ...rec, path: np, folderPath: getParentPath(np) });
      }
    }
    // fileMeta
    for (const [p, m] of Array.from(this.#fileMeta.entries())) {
      if (p === oldPath || p.startsWith(oldPath + "/")) {
        const np = rewritePathPrefix(p, oldPath, newPath);
        this.#fileMeta.delete(p);
        this.#fileMeta.set(np, m);
      }
    }
    // gitkeepFolders
    for (const f of Array.from(this.#gitkeepFolders)) {
      if (f === oldPath || f.startsWith(oldPath + "/")) {
        this.#gitkeepFolders.delete(f);
        this.#gitkeepFolders.add(rewritePathPrefix(f, oldPath, newPath));
      }
    }
  }

  async deleteFolder(path: string): Promise<void> {
    if (!path) return;
    await this.#ensureTreeLoaded();
    if (!this.#folderExists(path)) return;

    // Collect all descendants.
    const entries = Array.from(this.#allFilePaths).filter((p) =>
      p === path || p.startsWith(path + "/")
    );
    // Per-file delete. Phase 4 will add a Git Data API bulk commit
    // that removes the whole subtree in a single commit.
    for (const rel of entries) {
      const sha = this.#shaByPath.get(rel);
      if (!sha) continue;
      await this.#deleteContents(rel, sha, this.#commitMessage("delete", rel));
      this.#recordCache.delete(rel);
      this.#fileMeta.delete(rel);
    }
    // Clean up gitkeep folder markers for anything under the removed path.
    for (const f of Array.from(this.#gitkeepFolders)) {
      if (f === path || f.startsWith(path + "/")) this.#gitkeepFolders.delete(f);
    }
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
  // Folder-existence logic — derived from files + .gitkeep markers.
  // ===========================================================================

  #folderExists(path: string): boolean {
    if (!path) return true; // root always exists
    if (this.#gitkeepFolders.has(path)) return true;
    for (const filePath of this.#allFilePaths) {
      if (filePath.startsWith(path + "/")) return true;
    }
    return false;
  }

  /** All folder paths that currently exist (either implicit via file
   *  descendants or explicit via `.gitkeep`). Root is excluded. */
  #allExistingFolders(): Set<string> {
    const out = new Set<string>();
    for (const f of this.#gitkeepFolders) out.add(f);
    for (const filePath of this.#allFilePaths) {
      let parent = getParentPath(filePath);
      while (parent) {
        out.add(parent);
        parent = getParentPath(parent);
      }
    }
    return out;
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

// ===========================================================================
// Module-level helpers (no DOM deps — could live alongside path.ts if
// a second store ever needs them).
// ===========================================================================

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBytes(b64: string): Uint8Array {
  // GitHub's Contents API returns base64 with newlines wrapped at
  // column 60. atob tolerates leading/trailing whitespace but not
  // embedded newlines, so strip them.
  const clean = b64.replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function inferMimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}
