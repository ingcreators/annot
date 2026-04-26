/**
 * Pure path helpers for GitHubStore. Convert between the caller's
 * basePath-relative paths and the repo-absolute paths GitHub's API
 * expects, plus URL composition + commit-message formatting.
 *
 * Lifted out of `github-store.ts` (Phase-2 of proposal 4) so the
 * trivial-but-omnipresent path math can be unit-tested independently
 * of the store's stateful caches and HTTP layer.
 */

import { getFilename } from "@ingcreators/annot-core/storage";
import { GITHUB_API } from "./github-helpers.js";

/**
 * basePath-relative path → repo-absolute path. Empty `relPath`
 * resolves to `basePath` itself (used when callers want the URL
 * for the basePath root).
 */
export function fullPath(basePath: string, relPath: string): string {
  if (!relPath) return basePath;
  return basePath ? `${basePath}/${relPath}` : relPath;
}

/**
 * repo-absolute path → basePath-relative path, or `null` if the
 * path falls outside `basePath`. Returns `""` when `fullPath`
 * exactly matches `basePath` (the root of the visible tree).
 */
export function relPath(basePath: string, full: string): string | null {
  if (!basePath) return full;
  if (full === basePath) return "";
  const prefix = `${basePath}/`;
  if (full.startsWith(prefix)) return full.slice(prefix.length);
  return null;
}

/**
 * Percent-encode each path segment separately, preserving slashes.
 * Used to build URLs against the GitHub Contents API where slashes
 * in the path stay as path separators but every other reserved
 * character must be encoded.
 */
export function encodePath(path: string): string {
  return path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
}

/**
 * Contents-API URL for a repo-absolute path. The `owner` and `repo`
 * components are URL-encoded; the path is segment-encoded via
 * {@link encodePath}.
 */
export function contentsUrl(owner: string, repo: string, repoFullPath: string): string {
  const o = encodeURIComponent(owner);
  const r = encodeURIComponent(repo);
  return `${GITHUB_API}/repos/${o}/${r}/contents/${encodePath(repoFullPath)}`;
}

/**
 * Format the commit message Annot writes for each mutation. Matches
 * the historical pattern `annot: <verb> <filename>` so external
 * tooling that filters Annot's commits keeps working.
 */
export function commitMessage(verb: "add" | "update" | "delete", path: string): string {
  const name = getFilename(path) || path;
  return `annot: ${verb} ${name}`;
}
