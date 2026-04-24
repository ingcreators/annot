/**
 * In-memory simulator for the subset of the GitHub REST API that
 * {@link GitHubStore} calls into.
 *
 * The simulator covers:
 *   - `GET  /repos/:owner/:repo/git/trees/:branch?recursive=1`
 *   - `GET  /repos/:owner/:repo/contents/:path?ref=...`
 *   - `PUT  /repos/:owner/:repo/contents/:path`
 *   - `DELETE /repos/:owner/:repo/contents/:path`
 *   - `GET  /repos/:owner/:repo/git/refs/heads/:branch` → always 404
 *     so the store's amend path (`#tryAmendCommit`) short-circuits and
 *     falls back to the Contents PUT it has regression coverage for.
 *
 * It deliberately does NOT cover the full Git Data API (blobs, trees,
 * commits, force-push) — the contract tests exercise every feature
 * through the single-file Contents API, which is the only path every
 * backend must agree on. The amend / atomic-tree paths are
 * GitHub-specific optimisations and live in their own unit tests.
 *
 * The SHA we hand out is `sha1(path + ":" + body)` — not the same
 * algorithm GitHub uses (blob SHAs are `sha1("blob " + len + "\0" +
 * bytes)`) but stable and unique per byte-sequence, which is all
 * the store relies on.
 */
import { createHash } from "node:crypto";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const API = "https://api.github.com";

/** Repo filesystem state. Keys are repo-absolute paths (no leading slash). */
interface FileEntry {
  sha: string;
  content: string; // base64-encoded bytes
}

export interface GitHubRepoState {
  files: Map<string, FileEntry>;
  /** Explicit folder set, for folders that exist without any file
   *  under them. Populated via {@link GitHubRepoState.mkdir}. */
  folders: Set<string>;
}

export function createRepoState(): GitHubRepoState {
  return { files: new Map(), folders: new Set() };
}

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

/** Build the GitHub tree listing from the repo state. */
function buildTree(state: GitHubRepoState): Array<{
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}> {
  const entries: Array<{ path: string; mode: string; type: "blob" | "tree"; sha: string }> = [];
  const seenFolders = new Set<string>();

  const addFolder = (folder: string) => {
    if (!folder || seenFolders.has(folder)) return;
    seenFolders.add(folder);
    // Fold in ancestors so `a/b/c` produces `a`, `a/b`, `a/b/c`
    // tree entries, matching GitHub's recursive listing.
    const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
    if (parent) addFolder(parent);
    entries.push({
      path: folder,
      mode: "040000",
      type: "tree",
      sha: sha1(`tree:${folder}`),
    });
  };

  for (const [path, { sha }] of state.files) {
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (parent) addFolder(parent);
    entries.push({ path, mode: "100644", type: "blob", sha });
  }
  for (const folder of state.folders) addFolder(folder);
  return entries;
}

/**
 * Build MSW handlers against the given repo state. Multiple tests can
 * share a single `setupServer` and swap the backing state between runs.
 */
export function buildGitHubHandlers(state: GitHubRepoState) {
  return [
    // --------------------------------------------------------------
    // Git tree — the store calls this once to populate `#shaByPath`.
    // --------------------------------------------------------------
    http.get(`${API}/repos/:owner/:repo/git/trees/:branch`, () => {
      return HttpResponse.json({
        sha: "tree-sha",
        tree: buildTree(state),
        truncated: false,
      });
    }),

    // --------------------------------------------------------------
    // Contents GET — single-file read.
    // --------------------------------------------------------------
    http.get(`${API}/repos/:owner/:repo/contents/:path*`, ({ params }) => {
      const rawPath = Array.isArray(params.path) ? params.path.join("/") : (params.path as string);
      const decoded = decodeURIComponent(rawPath);
      const entry = state.files.get(decoded);
      if (!entry) {
        return HttpResponse.json({ message: "Not Found" }, { status: 404 });
      }
      return HttpResponse.json({
        type: "file",
        encoding: "base64",
        content: entry.content,
        sha: entry.sha,
        path: decoded,
      });
    }),

    // --------------------------------------------------------------
    // Contents PUT — create or update.
    // --------------------------------------------------------------
    http.put(`${API}/repos/:owner/:repo/contents/:path*`, async ({ request, params }) => {
      const rawPath = Array.isArray(params.path) ? params.path.join("/") : (params.path as string);
      const decoded = decodeURIComponent(rawPath);
      const body = (await request.json()) as {
        message: string;
        content: string;
        sha?: string;
      };
      const existing = state.files.get(decoded);
      if (existing && body.sha && existing.sha !== body.sha) {
        return HttpResponse.json(
          { message: `sha mismatch: expected ${existing.sha}, got ${body.sha}` },
          { status: 409 },
        );
      }
      if (!existing && body.sha) {
        // GitHub rejects a PUT with sha on a missing file.
        return HttpResponse.json({ message: "Not Found" }, { status: 404 });
      }
      const sha = sha1(`${decoded}:${body.content}`);
      state.files.set(decoded, { sha, content: body.content });
      return HttpResponse.json({
        content: { sha, path: decoded, name: decoded.split("/").pop() },
        commit: { sha: sha1(`commit:${decoded}:${sha}`) },
      });
    }),

    // --------------------------------------------------------------
    // Contents DELETE — remove file.
    // --------------------------------------------------------------
    http.delete(`${API}/repos/:owner/:repo/contents/:path*`, async ({ request, params }) => {
      const rawPath = Array.isArray(params.path) ? params.path.join("/") : (params.path as string);
      const decoded = decodeURIComponent(rawPath);
      const body = (await request.json()) as { sha: string };
      const existing = state.files.get(decoded);
      if (!existing) {
        return HttpResponse.json({ message: "Not Found" }, { status: 404 });
      }
      if (existing.sha !== body.sha) {
        return HttpResponse.json(
          { message: `sha mismatch: expected ${existing.sha}, got ${body.sha}` },
          { status: 409 },
        );
      }
      state.files.delete(decoded);
      return HttpResponse.json({ commit: { sha: sha1(`delete:${decoded}`) } });
    }),

    // --------------------------------------------------------------
    // Git Data API — always 404 so `#tryAmendCommit` bails and the
    // store falls through to the Contents PUT path. Covering the
    // amend optimisation itself requires a fuller simulator and is
    // out of scope for the cross-backend contract.
    // --------------------------------------------------------------
    http.get(`${API}/repos/:owner/:repo/git/refs/heads/:branch`, () => {
      return HttpResponse.json({ message: "Not Found" }, { status: 404 });
    }),
  ];
}

/** One-liner for tests that don't need to share state across files. */
export function startGitHubMockServer(): {
  server: ReturnType<typeof setupServer>;
  state: GitHubRepoState;
  reset: () => void;
} {
  const state = createRepoState();
  const server = setupServer(...buildGitHubHandlers(state));
  return {
    server,
    state,
    reset: () => {
      state.files.clear();
      state.folders.clear();
    },
  };
}
