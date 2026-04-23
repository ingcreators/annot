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
 * side — users can do that from github.com/settings/tokens. */
export function signOut(): void {
  accessToken = null;
  localStorage.removeItem(TOKEN_KEY);
}

function persistToken(token: string): void {
  accessToken = token;
  localStorage.setItem(TOKEN_KEY, token);
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
  return trimmed;
}

// ---- API helpers used by the repo picker ----

/** Fetch the authenticated user. Throws on 401 / network error. */
export async function fetchUserInfo(): Promise<GitHubUserInfo> {
  const body = await authedGet("/user");
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
  let url: string | null = "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member";
  while (url && out.length < max) {
    const { body, nextUrl } = await authedGetWithLink(url);
    for (const entry of body as any[]) {
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
  const body = await authedGet(`/search/repositories?q=${query}&per_page=30`);
  return (body.items ?? [])
    .map(toRepoSummary)
    .filter((r: GitHubRepoSummary) => r.canPush);
}

/** Look up a single repo by "owner/name". Used for direct-entry. */
export async function getRepo(owner: string, name: string): Promise<GitHubRepoSummary> {
  const body = await authedGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
  return toRepoSummary(body);
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
  return (body as any[]).map((b) => ({
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
      typeof v?.owner === "string"
      && typeof v?.repo === "string"
      && typeof v?.branch === "string"
      && typeof v?.basePath === "string"
    ) {
      return v;
    }
  } catch { /* fall through */ }
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

async function authedGet(path: string): Promise<any> {
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

async function authedGetWithLink(path: string): Promise<{ body: any; nextUrl: string | null }> {
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
    if (match && match[2] === "next") return match[1];
  }
  return null;
}

function toRelativeUrl(fullUrl: string): string {
  // The Link header returns absolute URLs back to api.github.com.
  // Strip the host so `authedGetWithLink` rebuilds consistently.
  if (fullUrl.startsWith(GITHUB_API)) return fullUrl.slice(GITHUB_API.length);
  return fullUrl;
}

function toRepoSummary(entry: any): GitHubRepoSummary {
  return {
    fullName: entry.full_name,
    owner: entry.owner?.login ?? entry.full_name.split("/")[0],
    name: entry.name,
    defaultBranch: entry.default_branch ?? "main",
    private: !!entry.private,
    description: entry.description ?? null,
    canPush: !!entry.permissions?.push,
    pushedAt: entry.pushed_at ?? null,
  };
}
