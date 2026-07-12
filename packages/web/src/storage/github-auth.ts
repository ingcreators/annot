/**
 * GitHub auth (individual-user flow, OSS edition).
 *
 * Per `docs/plans/github-integration.md` §1, this module owns:
 *   - Personal Access Token paste as the sole auth path. See §1 for
 *     why: OAuth Web Flow can't complete a token exchange purely
 *     client-side (GitHub's `github.com/login/oauth/access_token`
 *     doesn't send CORS headers), Device Flow hits the same CORS
 *     block on `github.com/login/device/code`, and draw.io solves it
 *     by running a server-side proxy — which would break the OSS
 *     "static PWA, no backend" property. Fine-grained PATs give a
 *     better per-repo scope than a `repo`-scoped OAuth App anyway.
 *     A proper one-click OAuth UX will land on the commercial
 *     `annot-cloud` side once that repo exists; the OSS side stays
 *     server-free.
 *   - Repo / branch / basePath picker persistence.
 *
 * Phase 1 deliverable: all of the above, exposed as library functions.
 * `GitHubStore` (Phase 2) and sidebar integration (Phase 3) consume
 * these from here; nothing in this file talks to `StorageProvider`.
 */

const TOKEN_KEY = "annot-github-token";
const REF_KEY = "annot-github-ref";
const AUTH_SOURCE_KEY = "annot-github-auth-source";
const TOKEN_EXPIRES_KEY = "annot-github-token-expires-at";

const GITHUB_API = "https://api.github.com";

let accessToken: string | null = null;

// ---- Types ----

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  branch: string;
  /** "" = repo root, "screenshots" = under that folder. No leading/trailing slash. */
  basePath: string;
}

export interface GitHubRepoSummary {
  /** "owner/repo" */
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  /** From `permissions.push` on the API response. */
  canPush: boolean;
  pushedAt: string | null;
}

export interface GitHubBranchSummary {
  name: string;
  isDefault: boolean;
  protected: boolean;
}

export interface GitHubUserInfo {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

// ---- Token state ----

/** Get current access token (from memory or localStorage). */
export function getAccessToken(): string | null {
  if (accessToken) return accessToken;
  accessToken = localStorage.getItem(TOKEN_KEY);
  return accessToken;
}

export function isSignedIn(): boolean {
  return !!getAccessToken();
}

/** Forget the access token. Does NOT revoke the token on GitHub's
 * side — users can do that from github.com/settings/tokens (PAT)
 * or github.com/settings/apps/authorizations (cloud). Keeps the
 * auth source so a reconnect can offer the same path first. */
export function signOut(): void {
  accessToken = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRES_KEY);
}

function persistToken(token: string): void {
  accessToken = token;
  localStorage.setItem(TOKEN_KEY, token);
}

// ---- Auth source (PAT vs annot.work cloud) ----

/**
 * Where the current bearer token came from:
 *   - `"pat"`   — hand-pasted personal access token (the default,
 *     and the only path on self-hosted / static deployments).
 *   - `"cloud"` — GitHub App user-to-server token minted by the
 *     annot.work Worker (`GET /api/github/token`). Short-lived
 *     (8 h); silently refreshable server-side while the cloud
 *     session + App authorization stay valid.
 *
 * Everything downstream of `getAccessToken()` is source-agnostic —
 * both flavours are bearer tokens on `api.github.com`.
 */
export type GitHubAuthSource = "pat" | "cloud";

export function getAuthSource(): GitHubAuthSource {
  return localStorage.getItem(AUTH_SOURCE_KEY) === "cloud" ? "cloud" : "pat";
}

function setAuthSource(source: GitHubAuthSource): void {
  localStorage.setItem(AUTH_SOURCE_KEY, source);
}

/** Unix ms when the persisted cloud token expires, or null for PAT
 *  tokens / non-expiring tokens. Advisory — the real authority is
 *  GitHub's 401, which routes through the token refresher. */
export function getTokenExpiresAt(): number | null {
  const raw = localStorage.getItem(TOKEN_EXPIRES_KEY);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/** Error from the cloud token endpoint carrying the Worker's
 *  error code so callers can branch re-auth vs retry vs connect. */
export class CloudTokenError extends Error {
  /** `no_session` (cloud cookie dead) / `not_connected` (user never
   *  authorized the App) / `reauth_required` (refresh token dead) /
   *  `transport` (network / 5xx — retryable). */
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Result of a successful cloud token fetch. */
export interface CloudTokenResult {
  token: string;
  expiresAt: number | null;
  githubLogin: string | null;
}

/**
 * Fetch a currently-valid user-to-server token from the annot.work
 * Worker (`GET /api/github/token`, cookie-authenticated; the Worker
 * refreshes server-side when the stored token is near expiry).
 * Persists the token + expiry and flips the auth source to
 * `"cloud"` on success.
 *
 * `baseUrl` is the cloud API base (empty string = same-origin,
 * matching `AnnotCloudStore`); callers pass
 * `loadCloudBaseUrl() ?? ""` from `cloud-auth.ts`.
 */
export async function fetchCloudToken(baseUrl: string): Promise<CloudTokenResult> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/github/token`, { credentials: "include" });
  } catch (e) {
    throw new CloudTokenError("transport", (e as Error).message);
  }
  if (!res.ok) {
    let code = "transport";
    let message = `GitHub token endpoint failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      if (body.error) code = body.error;
      if (body.message) message = body.message;
    } catch {
      /* non-JSON body — keep transport defaults */
    }
    // The Worker's session-auth 401s (`no_session` / `expired_session`)
    // and the token-flow 401 (`reauth_required`) both surface here
    // with their own codes; 5xx stays "transport" so callers retry.
    if (res.status >= 500) code = "transport";
    throw new CloudTokenError(code, message);
  }
  const body = (await res.json()) as {
    token: string;
    expiresAt: number | null;
    githubLogin: string | null;
  };
  persistToken(body.token);
  setAuthSource("cloud");
  if (body.expiresAt != null) {
    localStorage.setItem(TOKEN_EXPIRES_KEY, String(body.expiresAt));
  } else {
    localStorage.removeItem(TOKEN_EXPIRES_KEY);
  }
  return {
    token: body.token,
    expiresAt: body.expiresAt ?? null,
    githubLogin: body.githubLogin ?? null,
  };
}

/**
 * Silent-refresh flavour of `fetchCloudToken` for the 401-driven
 * token refresher: returns the new token, or `null` when the
 * failure needs user action (cloud session gone, authorization
 * revoked, network down). Never throws.
 */
export async function refreshCloudTokenSilently(baseUrl: string): Promise<string | null> {
  try {
    const { token } = await fetchCloudToken(baseUrl);
    return token;
  } catch {
    return null;
  }
}

/**
 * Best-effort disconnect on the Worker side (`DELETE
 * /api/github/token` — drops the stored pair + revokes the grant).
 * Local sign-out is the caller's job (`signOut()`); this only
 * clears the server side so a later `fetchCloudToken` starts clean.
 */
export async function revokeCloudToken(baseUrl: string): Promise<void> {
  try {
    await fetch(`${baseUrl}/api/github/token`, {
      method: "DELETE",
      credentials: "include",
    });
  } catch {
    /* best-effort */
  }
}

// ---- Personal Access Token sign-in ----

/**
 * Validate a pasted PAT by calling `GET /user`. Persists and returns
 * the token on success; throws on failure so the UI can render the
 * server-returned error message (401 wrong token, 403 blocked, etc.).
 *
 * Fine-grained PATs (recommended): scope the token to the single repo
 * you want to use with Annot and grant "Contents: Read and write"
 * plus the implicit "Metadata: Read-only". This is strictly narrower
 * than the `repo` scope a classic PAT / OAuth App would use.
 *
 * Classic PATs: the `repo` scope covers everything Annot needs.
 */
export async function signInWithPat(pat: string): Promise<string> {
  const trimmed = pat.trim();
  if (!trimmed) throw new Error("Please paste a personal access token.");
  // We don't hard-fail on token shape because GitHub introduces new
  // prefixes over time (ghp_, github_pat_, ghs_, gho_, …); the `/user`
  // call is the real validity check.
  const res = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Authorization: `Bearer ${trimmed}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 401) {
    throw new Error("Token rejected. Check that it hasn't expired or been revoked.");
  }
  if (res.status === 403) {
    throw new Error("Token accepted but forbidden from reading /user (SSO not authorized?).");
  }
  if (!res.ok) {
    throw new Error(`GitHub /user check failed: ${res.status} ${res.statusText}`);
  }
  persistToken(trimmed);
  // A validated paste is an explicit source switch — a stale
  // "cloud" marker would send the 401 refresher to the Worker for
  // a token the user just replaced.
  setAuthSource("pat");
  localStorage.removeItem(TOKEN_EXPIRES_KEY);
  return trimmed;
}

// ---- API helpers used by the repo picker ----

/** Fetch the authenticated user. Throws on 401 / network error. */
export async function fetchUserInfo(): Promise<GitHubUserInfo> {
  const body = (await authedGet("/user")) as {
    login: string;
    name?: string | null;
    avatar_url?: string | null;
  };
  return {
    login: body.login,
    name: body.name ?? null,
    avatarUrl: body.avatar_url ?? null,
  };
}

/**
 * List repositories the authenticated user has write access to.
 *
 * Paginates via the Link header up to `maxRepos` (default 300) to
 * cover typical individual accounts without burning rate limit on
 * maintainers of 1000-repo orgs. The picker offers a search box for
 * those edge cases (`searchRepos`).
 *
 * Fine-grained PATs are typically scoped to a single repo anyway,
 * in which case this returns just that one entry.
 */
export async function listWritableRepos(
  opts: { maxRepos?: number } = {},
): Promise<GitHubRepoSummary[]> {
  const max = opts.maxRepos ?? 300;
  const out: GitHubRepoSummary[] = [];
  let url: string | null =
    "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member";
  while (url && out.length < max) {
    const { body, nextUrl } = await authedGetWithLink(url);
    for (const entry of body as unknown as GitHubRepoPayload[]) {
      if (!entry.permissions?.push) continue;
      out.push(toRepoSummary(entry));
      if (out.length >= max) break;
    }
    url = nextUrl ? toRelativeUrl(nextUrl) : null;
  }
  return out;
}

/**
 * Search across all of GitHub for repos matching `q` that the user
 * can access (scoped by the OAuth token). Used as a fallback when
 * the target repo is beyond the `listWritableRepos` paging window.
 */
export async function searchRepos(q: string): Promise<GitHubRepoSummary[]> {
  const query = encodeURIComponent(q);
  const body = (await authedGet(`/search/repositories?q=${query}&per_page=30`)) as {
    items?: GitHubRepoPayload[];
  };
  return (body.items ?? []).map(toRepoSummary).filter((r) => r.canPush);
}

/** Look up a single repo by "owner/name". Used for direct-entry. */
export async function getRepo(owner: string, name: string): Promise<GitHubRepoSummary> {
  const body = (await authedGet(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
  )) as GitHubRepoPayload;
  return toRepoSummary(body);
}

export interface GitHubCommitSummary {
  sha: string;
  shortSha: string;
  url: string; // https://github.com/<owner>/<repo>/commit/<sha>
  authorName: string;
  authorAvatarUrl?: string;
  date: string; // ISO
  messageHeadline: string; // first line only
}

/**
 * Return the most recent commit that touched `{owner}/{name}:{path}` on
 * the given branch. The commits-by-path API is what the GitHub blob
 * UI uses itself, so the result matches what a user would see on
 * `github.com/<owner>/<repo>/blob/<branch>/<path>`.
 *
 * Returns `null` if the file has no commit history yet (just created
 * via our PUT and propagation hasn't caught up) or on any error —
 * the drawer section is a nice-to-have and we don't want its failure
 * to disrupt the edit flow.
 */
export async function getLastCommitForPath(
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<GitHubCommitSummary | null> {
  const token = getAccessToken();
  if (!token) return null;
  const url =
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(branch)}&per_page=1`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const entry = Array.isArray(body) ? body[0] : undefined;
    if (!entry) return null;
    const sha = entry.sha as string | undefined;
    if (!sha) return null;
    const commit = entry.commit ?? {};
    const author = commit.author ?? {};
    const userAuthor = entry.author ?? {}; // user object when the commit email matches a GitHub user
    const message = (commit.message as string | undefined) ?? "";
    const headline = message.split("\n", 1)[0] || "(no message)";
    return {
      sha,
      shortSha: sha.slice(0, 7),
      url:
        entry.html_url ??
        `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commit/${sha}`,
      authorName: author.name || userAuthor.login || "Unknown",
      authorAvatarUrl: userAuthor.avatar_url,
      date: author.date || userAuthor.updated_at || "",
      messageHeadline: headline,
    };
  } catch {
    return null;
  }
}

/**
 * Probe whether the current token can actually write to `owner/name`'s
 * Contents. Needed because `permissions.push` on the `/user/repos`
 * response reflects the **user's** role-based permission, not the
 * token's scope:
 *
 *   Fine-grained PATs always have implicit read-only access to the
 *   authenticated user's public repositories (GitHub's "Also
 *   includes public repositories (read-only)" — on by design and
 *   not togglable). That makes user-owned public repos appear in
 *   `/user/repos` with `permissions.push: true` (because the user
 *   owns them) even though the token itself can only read. The only
 *   reliable way to tell what the token can do is to attempt a
 *   write.
 *
 * The probe is a conditional `PUT /contents/…` with a deliberately
 * impossible SHA so nothing actually gets written:
 *
 *   - `403 Forbidden` → token lacks Contents: Write on this repo.
 *   - `404 Not Found` → token can't see this repo (private without
 *     grant). Treated as "can't write".
 *   - `409 Conflict` / `422 Unprocessable Entity` → token HAS
 *     Contents: Write; the server went past the auth check and
 *     tripped on the fake SHA. No write happened.
 *   - Any 2xx → unexpected (nothing should have been created,
 *     because `sha` was provided so the call is treated as an
 *     update, and no file matches `0…0`). Treat as success.
 */
export async function verifyWriteAccess(owner: string, name: string): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return false;
  const url =
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}` +
    `/contents/${encodeURIComponent(".annot-perm-probe")}`;
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "annot: permission probe (ignore)",
        content: "",
        sha: "0000000000000000000000000000000000000000",
      }),
    });
    if (res.status === 403 || res.status === 404) return false;
    return true;
  } catch {
    return false;
  }
}

/** List branches for a repo (up to 100; mono-repos beyond that are
 *  Phase 4 territory per the plan's open questions). */
export async function listBranches(
  owner: string,
  name: string,
  defaultBranch: string,
): Promise<GitHubBranchSummary[]> {
  const body = await authedGet(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches?per_page=100`,
  );
  return (body as unknown as GitHubBranchPayload[]).map((b) => ({
    name: b.name,
    isDefault: b.name === defaultBranch,
    protected: !!b.protected,
  }));
}

// ---- Repo ref persistence ----

export function saveRepoRef(ref: GitHubRepoRef): void {
  localStorage.setItem(REF_KEY, JSON.stringify(ref));
}

export function loadRepoRef(): GitHubRepoRef | null {
  const raw = localStorage.getItem(REF_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (
      typeof v?.owner === "string" &&
      typeof v?.repo === "string" &&
      typeof v?.branch === "string" &&
      typeof v?.basePath === "string"
    ) {
      return v;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function clearRepoRef(): void {
  localStorage.removeItem(REF_KEY);
}

/**
 * Normalize a user-entered basePath into the canonical form we
 * store: no leading slash, no trailing slash, no `./` or `../`
 * segments. Empty string means "repo root".
 */
export function normalizeBasePath(input: string): string {
  const cleaned = input.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!cleaned) return "";
  const segments = cleaned.split("/").filter((s) => s && s !== "." && s !== "..");
  return segments.join("/");
}

// ---- Internal: authenticated fetch ----

/**
 * Minimal shape of the GitHub REST repo payload, scoped to the
 * fields `toRepoSummary` actually reads. Stays narrow on purpose
 * — `@octokit/types` is the official source of truth but is
 * 100s of KB of typings; we read 7 fields, this is fine.
 */
interface GitHubRepoPayload {
  full_name: string;
  name: string;
  owner?: { login?: string };
  default_branch?: string;
  private?: boolean;
  description?: string | null;
  permissions?: { push?: boolean };
  pushed_at?: string | null;
}

interface GitHubBranchPayload {
  name: string;
  protected?: boolean;
}

/** GitHub REST responses are heterogeneous JSON; helpers return
 *  `unknown` and each caller casts to its endpoint-specific shape.
 *  More verbose than `any` but every cast becomes a documented
 *  assertion of "I expect this endpoint to return X." */
async function authedGet(path: string): Promise<unknown> {
  const token = getAccessToken();
  if (!token) throw new Error("Not signed in to GitHub.");
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 401) {
    // Session-level auth failure. Clear and signal.
    signOut();
    throw new Error("GitHub session expired. Please sign in again.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json();
}

async function authedGetWithLink(path: string): Promise<{ body: unknown; nextUrl: string | null }> {
  const token = getAccessToken();
  if (!token) throw new Error("Not signed in to GitHub.");
  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 401) {
    signOut();
    throw new Error("GitHub session expired. Please sign in again.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
  const body = await res.json();
  const nextUrl = parseLinkHeader(res.headers.get("Link"));
  return { body, nextUrl };
}

function parseLinkHeader(header: string | null): string | null {
  if (!header) return null;
  // `<https://api.github.com/...>; rel="next", <...>; rel="last"`
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (match && match[2] === "next") return match[1]!;
  }
  return null;
}

function toRelativeUrl(fullUrl: string): string {
  // The Link header returns absolute URLs back to api.github.com.
  // Strip the host so `authedGetWithLink` rebuilds consistently.
  //
  // Use a real URL parse + origin equality rather than a `startsWith`
  // prefix check so a hostile / malformed Link header value like
  // `https://api.github.com.evil.example/...` doesn't satisfy the
  // prefix (CodeQL `js/incomplete-url-substring-sanitization`).
  try {
    const u = new URL(fullUrl);
    if (u.origin === GITHUB_API) return u.pathname + u.search;
  } catch {
    // Fall through — non-URL input keeps the original return path.
  }
  return fullUrl;
}

function toRepoSummary(entry: GitHubRepoPayload): GitHubRepoSummary {
  return {
    fullName: entry.full_name,
    owner: entry.owner?.login ?? entry.full_name.split("/")[0]!,
    name: entry.name,
    defaultBranch: entry.default_branch ?? "main",
    private: !!entry.private,
    description: entry.description ?? null,
    canPush: !!entry.permissions?.push,
    pushedAt: entry.pushed_at ?? null,
  };
}
