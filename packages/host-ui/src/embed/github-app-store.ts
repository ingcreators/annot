// `GitHubAppStorageProvider` — Phase 6 follow-up 5y-3.
//
// Browser-side `StorageProvider` that proxies reads / writes
// through the cloud-side `/api/embed/load` (5y-2) + future
// `/api/embed/commit` (5y-4) endpoints. The shell mounts an
// `EditorShell` against an instance of this and the editor's
// existing save / load surfaces "just work" against a remote
// GitHub repo via the App installation token (held server-side).
//
// Scope of v1 (5y-3):
//   - `getImage(path)` returns an `ImageRecord` materialised from
//     the cloud's `{ pngBase64, annotationsYaml, repoState }`
//     response. PNG bytes are converted to a `data:image/png;base64`
//     `originalDataUrl`; the `annotationsYaml` is held separately
//     for the OverlayTool yaml-aware path (mounted via the
//     EditorShell `annotationsYamlPath` opt-in) and ALSO surfaced
//     as `annotationsSvg = ""` since the canvas hasn't rendered
//     legacy SVG annotations on a yaml-sourced load.
//   - Every other StorageProvider method throws
//     `EmbedStorageUnsupportedError`. 5y-4 lights up `updateImage`
//     for the save flow; everything else (folder ops, list, move)
//     stays unsupported — the embed surface is single-file by
//     design.

import type {
  FolderRecord,
  ImageRecord,
  ImageRecordUpdate,
  StorageProvider,
} from "@ingcreators/annot-core/storage";

/** Thrown by `GitHubAppStorageProvider` for methods that don't
 *  apply to the single-file embed editor surface. Callers that
 *  surface these to UI should match on `instanceof` rather than
 *  message text. */
export class EmbedStorageUnsupportedError extends Error {
  constructor(operation: string) {
    super(`GitHubAppStorageProvider does not support ${operation} in the embed editor.`);
    this.name = "EmbedStorageUnsupportedError";
  }
}

/** Thrown when the cloud-side commit endpoint returns
 *  `error: "conflict"` (a 409 from GitHub's Contents API —
 *  someone else pushed to the same path). The shell surfaces
 *  this to the user with a reload + retry prompt. */
export class EmbedCommitConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbedCommitConflictError";
  }
}

/** Success / error variants returned by `/api/embed/commit`. */
export type EmbedCommitResponse =
  | {
      ok: true;
      editId: string;
      commitSha: string;
      branch: string;
      prUrl?: string;
      policy: "pr-mode" | "direct-push";
    }
  | { ok: false; error: "conflict"; message: string }
  | { ok: false; error: string; message: string };

/** Response shape returned by `/api/embed/load`. Mirrors the
 *  `EmbedLoadResponseBody` shape exported by the worker but
 *  declared here so host-ui has no compile-time dependency on
 *  the worker package. */
export interface EmbedLoadResponse {
  ok: true;
  installationId: number;
  pngBase64: string;
  annotationsYaml: string;
  repoState: {
    branch: string;
    pngSha: string;
    annotationsSha: string;
    private: boolean;
  };
}

/** Per-load state the shell holds onto for the post-edit commit.
 *  Exposed so 5y-4's commit path can read the sha + branch off
 *  the same store instance without re-fetching. */
export interface GitHubAppRepoState {
  /** Repo slug `owner/name`. */
  repo: string;
  /** PNG path within the repo. */
  pngPath: string;
  /** Annotation yaml path within the repo. */
  annotationsPath: string;
  /** Branch the load resolved against (default-branch or
   *  installation's `default_branch_override`). */
  branch: string;
  /** Blob sha of the PNG at load time (feeds 5y-4's optimistic-
   *  write `sha` parameter). */
  pngSha: string;
  /** Blob sha of the annotations yaml at load time. */
  annotationsSha: string;
  /** GitHub-assigned installation id. */
  installationId: number;
  /** Whether the repo is private. UI uses this to decide
   *  whether to show the "Private repo — Pro plan" badge. */
  private: boolean;
  /** Last-known yaml text, populated on load + updated by the
   *  editor when the user edits annotations. The commit endpoint
   *  reads this. */
  annotationsYaml: string;
}

/** Construction-time deps. `fetchImpl` defaults to the global
 *  `fetch`; tests inject a stub. `cloudUrl` is required so the
 *  shell knows where to POST/GET against (matches the
 *  `<AnnotEditButton cloudUrl=...>` value from Phase 5f). */
export interface GitHubAppStorageProviderOptions {
  /** Cloud-editor origin, e.g. `"https://annot.work"`. The store
   *  appends `/api/embed/load` etc. to it. */
  cloudUrl: string;
  /** Repo slug `owner/name`. From the embed URL params. */
  repo: string;
  /** PNG path within the repo. From the embed URL params. */
  pngPath: string;
  /** Annotation yaml path within the repo. From the embed URL params. */
  annotationsPath: string;
  /** Override the global `fetch` (mostly for tests). */
  fetchImpl?: typeof fetch;
}

/** Convert a base64 PNG to a `data:image/png;base64,…` URL. */
export function pngBase64ToDataUrl(base64: string): string {
  return `data:image/png;base64,${base64.replaceAll("\n", "")}`;
}

/** Read 4-byte big-endian unsigned at `offset` from a Uint8Array. */
function readBE32(bytes: Uint8Array, offset: number): number {
  // Strict-null asserts: caller is responsible for length-check.
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    throw new Error("readBE32: offset out of range");
  }
  // Avoid sign extension by using unsigned right shift.
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

/** Decode a base64 string into raw bytes (browser-safe, no Buffer). */
function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replaceAll("\n", "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Read width + height from a PNG IHDR chunk. The IHDR is the
 *  first chunk after the 8-byte PNG signature. Width is at byte
 *  16 (8 sig + 4 chunk length + 4 chunk type "IHDR"); height at
 *  byte 20. */
export function pngDimensionsFromBase64(base64: string): { width: number; height: number } {
  const bytes = base64ToBytes(base64);
  if (bytes.length < 24) {
    throw new Error("PNG is too short to contain an IHDR chunk");
  }
  const sig = bytes.slice(0, 8);
  const expectedSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i += 1) {
    if (sig[i] !== expectedSig[i]) {
      throw new Error("not a PNG (signature mismatch)");
    }
  }
  return { width: readBE32(bytes, 16), height: readBE32(bytes, 20) };
}

/** `StorageProvider` implementation that proxies through the
 *  cloud-side `/api/embed/*` endpoints. */
export class GitHubAppStorageProvider implements StorageProvider {
  readonly #cloudUrl: string;
  readonly #repo: string;
  readonly #pngPath: string;
  readonly #annotationsPath: string;
  readonly #fetchImpl: typeof fetch;
  #repoState: GitHubAppRepoState | null = null;

  constructor(opts: GitHubAppStorageProviderOptions) {
    this.#cloudUrl = opts.cloudUrl.endsWith("/") ? opts.cloudUrl.slice(0, -1) : opts.cloudUrl;
    this.#repo = opts.repo;
    this.#pngPath = opts.pngPath;
    this.#annotationsPath = opts.annotationsPath;
    this.#fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Current repo state, populated by the most recent `getImage`.
   *  `null` before the first load. 5y-4's commit endpoint reads
   *  this for the optimistic-write `sha` + branch + paths. */
  get repoState(): GitHubAppRepoState | null {
    return this.#repoState;
  }

  /** Update the in-memory annotations yaml after the editor's
   *  OverlayTool persists a change. Lets 5y-4's commit endpoint
   *  read the up-to-date bytes off this store without going
   *  through a separate fetch. */
  setAnnotationsYaml(yaml: string): void {
    if (!this.#repoState) {
      throw new Error("setAnnotationsYaml called before getImage");
    }
    this.#repoState = { ...this.#repoState, annotationsYaml: yaml };
  }

  async saveImage(): Promise<string> {
    throw new EmbedStorageUnsupportedError("saveImage");
  }

  async getImage(path: string): Promise<ImageRecord | undefined> {
    // The shell calls `getImage` with the PNG path; we ignore
    // the value (the embed URL params are the source of truth)
    // but assert it matches for safety.
    if (path !== this.#pngPath) {
      throw new EmbedStorageUnsupportedError(
        `getImage(${path}) — only the load-time pngPath (${this.#pngPath}) is supported`,
      );
    }
    const url = new URL("/api/embed/load", this.#cloudUrl).toString();
    const params = new URLSearchParams({
      repo: this.#repo,
      pngPath: this.#pngPath,
      annotationsPath: this.#annotationsPath,
      // `return` is required by `parseEmbedRequestUrl`; the store
      // forwards a synthetic value since the cloud endpoint
      // doesn't use it. The shell's own return URL is honoured by
      // 5y-5's redirect path.
      return: "https://about:blank/",
      mode: "newTab",
      v: "1",
    });
    const res = await this.#fetchImpl(`${url}?${params.toString()}`, {
      credentials: "include",
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`/api/embed/load ${res.status}: ${body}`);
    }
    const data = (await res.json()) as EmbedLoadResponse;
    const dims = pngDimensionsFromBase64(data.pngBase64);
    const now = new Date().toISOString();
    this.#repoState = {
      repo: this.#repo,
      pngPath: this.#pngPath,
      annotationsPath: this.#annotationsPath,
      branch: data.repoState.branch,
      pngSha: data.repoState.pngSha,
      annotationsSha: data.repoState.annotationsSha,
      installationId: data.installationId,
      private: data.repoState.private,
      annotationsYaml: data.annotationsYaml,
    };
    const folderPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    return {
      path,
      folderPath,
      originalDataUrl: pngBase64ToDataUrl(data.pngBase64),
      thumbnailDataUrl: "",
      // Embed flow always uses the yaml side-channel; the shell
      // mounts EditorShell with `annotationsYamlPath = path` so
      // the OverlayTool's yaml-aware loader picks it up.
      annotationsSvg: "",
      width: dims.width,
      height: dims.height,
      sourceUrl: `https://github.com/${this.#repo}/blob/${data.repoState.branch}/${this.#pngPath}`,
      tags: {},
      createdAt: now,
      updatedAt: now,
    };
  }

  async listImages(): Promise<ImageRecord[]> {
    // The embed surface is single-file. Listing isn't a thing.
    return [];
  }

  /**
   * Persist the current edit via the cloud-side `/api/embed/commit`
   * endpoint. The shell drives this — the StorageProvider
   * interface's `updateImage` doesn't carry an `editId` field, so
   * the shell passes it via an internal channel.
   *
   * Callers from EditorShell pass only `annotationsSvg` updates;
   * we ignore that field (the embed flow round-trips yaml, not
   * SVG) and use `this.repoState.annotationsYaml` (kept current
   * by the shell's `setAnnotationsYaml` calls).
   *
   * For the embed flow, prefer `.commit({ editId, annotationsYaml })`
   * (this class's own method) over the `StorageProvider.updateImage`
   * call — the named method makes the editId requirement explicit.
   */
  async updateImage(_path: string, updates: ImageRecordUpdate): Promise<void> {
    if (!this.#repoState) {
      throw new Error("updateImage called before getImage");
    }
    // Generate a random editId for this save; the shell calling
    // `.commit({ editId })` explicitly passes a known id instead
    // (used by 5y-5's hash-redirect path).
    await this.commit({
      editId: crypto.randomUUID(),
      annotationsYaml: updates.annotationsSvg ?? this.#repoState.annotationsYaml,
      pngBase64: undefined,
      pngSha: undefined,
    });
  }

  /** Cloud-side commit response (mirrors the worker's
   *  `CommitResponseBody` success / conflict / error variants). */
  async commit(opts: {
    editId: string;
    annotationsYaml: string;
    pngBase64?: string;
    pngSha?: string;
  }): Promise<EmbedCommitResponse> {
    if (!this.#repoState) {
      throw new Error("commit called before getImage");
    }
    const url = new URL("/api/embed/commit", this.#cloudUrl).toString();
    const res = await this.#fetchImpl(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installationId: this.#repoState.installationId,
        repo: this.#repoState.repo,
        pngPath: this.#repoState.pngPath,
        annotationsPath: this.#repoState.annotationsPath,
        branch: this.#repoState.branch,
        annotationsYaml: opts.annotationsYaml,
        annotationsSha: this.#repoState.annotationsSha,
        pngBase64: opts.pngBase64,
        pngSha: opts.pngSha,
        editId: opts.editId,
      }),
    });
    const body = (await res.json()) as EmbedCommitResponse;
    if (!body.ok && body.error === "conflict") {
      throw new EmbedCommitConflictError(body.message ?? "Commit conflict");
    }
    if (!body.ok) {
      throw new Error(`/api/embed/commit ${res.status}: ${body.message ?? body.error}`);
    }
    // Refresh the cached annotationsSha so the next commit uses
    // the just-committed blob's sha as the optimistic-write base.
    // The commit endpoint returns the COMMIT sha; we leave the
    // blob sha stale until the next load (worst case is a second
    // save fails with conflict + the user reloads).
    this.#repoState = { ...this.#repoState, annotationsYaml: opts.annotationsYaml };
    return body;
  }

  async moveImage(): Promise<string> {
    throw new EmbedStorageUnsupportedError("moveImage");
  }

  async renameImage(): Promise<string> {
    throw new EmbedStorageUnsupportedError("renameImage");
  }

  async deleteImage(): Promise<void> {
    throw new EmbedStorageUnsupportedError("deleteImage");
  }

  async createFolder(): Promise<string> {
    throw new EmbedStorageUnsupportedError("createFolder");
  }

  async getFolder(): Promise<FolderRecord | undefined> {
    return undefined;
  }

  async listFolders(): Promise<FolderRecord[]> {
    return [];
  }

  async moveFolder(): Promise<string> {
    throw new EmbedStorageUnsupportedError("moveFolder");
  }

  async renameFolder(): Promise<string> {
    throw new EmbedStorageUnsupportedError("renameFolder");
  }

  async deleteFolder(): Promise<void> {
    throw new EmbedStorageUnsupportedError("deleteFolder");
  }

  async getBreadcrumb(): Promise<FolderRecord[]> {
    return [];
  }
}
