/**
 * GitHub OAuth integration (individual-user flow).
 *
 * Per `docs/plans/github-integration.md` §1, this module owns:
 *   - OAuth Device Flow (primary): polls `github.com/login/device/code`
 *     and `github.com/login/oauth/access_token` so users can authorize
 *     the app without a server-side redirect URI.
 *   - Personal Access Token paste (fallback): for users on networks /
 *     browsers where GitHub's OAuth endpoints are CORS-blocked, and
 *     for users who want a more restrictive token scope than the
 *     OAuth App provides.
 *   - Repo / branch / basePath picker persistence.
 *
 * Phase 1 deliverable: all of the above, exposed as library functions.
 * `GitHubStore` (Phase 2) and sidebar integration (Phase 3) consume
 * these from here; nothing in this file talks to `StorageProvider`.
 *
 * Setup: register an OAuth App at
 * https://github.com/settings/developers → "New OAuth App". Enable
 * "Device Flow" on the app settings page. Set `VITE_GITHUB_CLIENT_ID`
 * in `packages/web/.env.local`.
 */

// Inlined at build time; the client ID is public (it's meant to be).
const GITHUB_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID || "";

// Broad enough to write to public + private repos the user hands us.
// The repo picker narrows the actually-touched repo down to one.
// See `docs/plans/github-integration.md` §10 for the trade-off.
const SCOPE = "repo";

const TOKEN_KEY = "annot-github-token";
const REF_KEY = "annot-github-ref";

const GITHUB_API = "https://api.github.com";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

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

/** Emitted by `signIn` at each stage of the device flow so the UI can
 * render the current state (user code, waiting, completed). */
export interface DeviceFlowState {
  phase: "starting" | "awaiting-authorization" | "authorized" | "error" | "cancelled";
  /** Short human-facing code the user types at `verificationUri`. */
  userCode?: string;
  /** Usually https://github.com/login/device. */
  verificationUri?: string;
  /** Convenience URL with the code pre-filled (may be null). */
  verificationUriComplete?: string;
  /** Seconds until the device_code expires. */
  expiresIn?: number;
  /** Error message for the `error` phase. */
  error?: string;
}

export type DeviceFlowListener = (state: DeviceFlowState) => void;

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

interface AccessTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  interval?: number;
}

// ---- Configuration check ----

export function hasClientId(): boolean {
  return !!GITHUB_CLIENT_ID;
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

/** Forget the access token. Does NOT revoke the grant on GitHub's
 * side — users can do that from github.com/settings/applications. */
export function signOut(): void {
  accessToken = null;
  localStorage.removeItem(TOKEN_KEY);
}

function persistToken(token: string): void {
  accessToken = token;
  localStorage.setItem(TOKEN_KEY, token);
}

// ---- Device Flow ----

/**
 * OAuth Device Flow. Resolves with the acquired token, rejects on
 * error, or resolves `null` if the caller calls `cancel()`.
 *
 * Two-step dance:
 *   1. `POST /login/device/code` → get `user_code` + `device_code`.
 *   2. Poll `POST /login/oauth/access_token` with `device_code` every
 *      `interval` seconds until the user finishes authorizing.
 *
 * CORS caveat: GitHub's `github.com/login/*` endpoints historically
 * don't advertise CORS headers for arbitrary origins. We attempt the
 * call anyway; if the browser blocks it the caller catches the
 * `TypeError: Failed to fetch` and surfaces the PAT-paste fallback.
 */
export interface DeviceFlowHandle {
  /** Promise that resolves with the token on success, `null` on
   * cancel, or rejects on error. */
  result: Promise<string | null>;
  /** Stop polling; resolves `result` with `null`. */
  cancel: () => void;
}

export function signIn(listener?: DeviceFlowListener): DeviceFlowHandle {
  let cancelled = false;
  let resolveOuter!: (token: string | null) => void;
  let rejectOuter!: (err: Error) => void;
  const result = new Promise<string | null>((resolve, reject) => {
    resolveOuter = resolve;
    rejectOuter = reject;
  });

  const emit = (state: DeviceFlowState) => {
    try { listener?.(state); } catch { /* ignore listener errors */ }
  };

  (async () => {
    if (!GITHUB_CLIENT_ID) {
      const err = new Error(
        "VITE_GITHUB_CLIENT_ID is not set. Register an OAuth App at "
          + "https://github.com/settings/developers and set the env var.",
      );
      emit({ phase: "error", error: err.message });
      rejectOuter(err);
      return;
    }

    emit({ phase: "starting" });

    let deviceResp: DeviceCodeResponse;
    try {
      deviceResp = await requestDeviceCode();
    } catch (e) {
      const msg = (e as Error).message;
      emit({ phase: "error", error: msg });
      rejectOuter(e as Error);
      return;
    }

    if (cancelled) {
      emit({ phase: "cancelled" });
      resolveOuter(null);
      return;
    }

    emit({
      phase: "awaiting-authorization",
      userCode: deviceResp.user_code,
      verificationUri: deviceResp.verification_uri,
      verificationUriComplete: deviceResp.verification_uri_complete,
      expiresIn: deviceResp.expires_in,
    });

    const deadline = Date.now() + deviceResp.expires_in * 1000;
    let interval = Math.max(1, deviceResp.interval) * 1000;

    while (!cancelled && Date.now() < deadline) {
      await sleep(interval);
      if (cancelled) break;

      let pollResp: AccessTokenResponse;
      try {
        pollResp = await pollAccessToken(deviceResp.device_code);
      } catch (e) {
        emit({ phase: "error", error: (e as Error).message });
        rejectOuter(e as Error);
        return;
      }

      if (pollResp.access_token) {
        persistToken(pollResp.access_token);
        emit({ phase: "authorized" });
        resolveOuter(pollResp.access_token);
        return;
      }

      switch (pollResp.error) {
        case "authorization_pending":
          // Keep polling at the current interval.
          break;
        case "slow_down":
          // RFC 8628: increase interval by 5s per GitHub's response or
          // the default +5s if the body didn't include `interval`.
          interval = (pollResp.interval ?? interval / 1000 + 5) * 1000;
          break;
        case "expired_token":
        case "access_denied":
        case "unsupported_grant_type":
        case "incorrect_client_credentials":
        case "incorrect_device_code":
        case "device_flow_disabled":
        default: {
          const msg = pollResp.error_description
            ?? pollResp.error
            ?? "Unknown device-flow error.";
          emit({ phase: "error", error: msg });
          rejectOuter(new Error(msg));
          return;
        }
      }
    }

    if (cancelled) {
      emit({ phase: "cancelled" });
      resolveOuter(null);
    } else {
      const msg = "Authorization timed out. Please try again.";
      emit({ phase: "error", error: msg });
      rejectOuter(new Error(msg));
    }
  })().catch((e) => {
    // Safety net for unexpected throws inside the async IIFE.
    emit({ phase: "error", error: (e as Error).message });
    rejectOuter(e as Error);
  });

  return {
    result,
    cancel: () => { cancelled = true; },
  };
}

async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams();
  body.set("client_id", GITHUB_CLIENT_ID);
  body.set("scope", SCOPE);

  let res: Response;
  try {
    res = await fetch(GITHUB_DEVICE_CODE_URL, {
      method: "POST",
      headers: { "Accept": "application/json" },
      body,
    });
  } catch (e) {
    // Almost certainly a CORS failure — GitHub doesn't send
    // Access-Control-Allow-Origin from github.com/login/*. Surface a
    // specific message so the UI can offer the PAT fallback.
    throw new Error(
      "Could not reach GitHub from the browser (likely CORS). "
        + "Use a personal access token instead.",
    );
  }

  if (!res.ok) {
    throw new Error(`GitHub device code request failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<DeviceCodeResponse>;
}

async function pollAccessToken(deviceCode: string): Promise<AccessTokenResponse> {
  const body = new URLSearchParams();
  body.set("client_id", GITHUB_CLIENT_ID);
  body.set("device_code", deviceCode);
  body.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code");

  let res: Response;
  try {
    res = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { "Accept": "application/json" },
      body,
    });
  } catch (e) {
    throw new Error(
      "Network error while polling for authorization. "
        + "Use a personal access token instead.",
    );
  }

  if (!res.ok) {
    throw new Error(`GitHub token poll failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<AccessTokenResponse>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Personal Access Token fallback ----

/**
 * Validate a pasted PAT by calling `GET /user`. Persists and returns
 * the token on success; throws on failure so the UI can render the
 * server-returned error message (401 wrong token, 403 blocked, etc.).
 *
 * Fine-grained PATs: the repo picker will need the token to see the
 * picked repo, so the PAT must include at least "Contents: read and
 * write" permission on the target repo(s).
 *
 * Classic PATs: the `repo` scope covers everything Annot needs.
 */
export async function signInWithPat(pat: string): Promise<string> {
  const trimmed = pat.trim();
  if (!trimmed) throw new Error("Please paste a personal access token.");
  // Sanity check — GitHub tokens all look like
  // ghp_/github_pat_/ghs_/gho_ prefixes, but we don't hard-fail on
  // shape in case GitHub introduces new prefixes.
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
