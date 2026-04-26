/**
 * GitHub HTTP layer — owns the `Authorization` header, the 401-driven
 * token-refresh dance, the rate-limit telemetry, and the GitHub-specific
 * error mapping. Has zero knowledge of paths, caches, image formats,
 * or annotations.
 *
 * Lifted out of `github-store.ts` so the request layer can be:
 *   - **Unit-tested** in isolation by stubbing `globalThis.fetch`
 *     (no MSW / no contract scaffolding required).
 *   - **Replaced** by tests that want to drive the store without any
 *     fetch at all — `GitHubStore` accepts an arbitrary `GitHubApiClient`,
 *     so a mock implementation can short-circuit the network entirely.
 *
 * The store still synthesises a real client by default in its public
 * constructor, so callers building a `new GitHubStore(token, ref)` see
 * no API change.
 */

import {
  type GitHubError,
  githubError,
  parseGitHubErrorBody,
  parseRateLimitHeaders,
  RATE_LIMIT_WARN_AT,
  shouldFireRateLimitWarning,
} from "./github-helpers.js";

export interface RateLimitInfo {
  remaining: number | null;
  resetAt: number | null;
}

export type RateLimitListener = (info: { remaining: number; resetAt: number | null }) => void;

/**
 * Public surface the store depends on. Both shapes (real and mock)
 * must satisfy this; tests can construct an inert implementation
 * with `vi.fn()` for each method.
 */
export interface GitHubApiClient {
  /** Issue a GitHub API request. Throws a {@link GitHubError} on
   *  any non-2xx response (after one optional 401 → token refresh
   *  retry). Returns the raw `Response` so the caller can `.json()`
   *  / `.text()` / read headers itself. */
  request(url: string, init?: RequestInit): Promise<Response>;
  /** Issue a request whose failures should NOT be fatal — used by
   *  the amend / atomic-tree paths where any error gracefully
   *  falls through to the per-file Contents API loop. Returns
   *  `null` instead of throwing on non-2xx (after the same 401
   *  retry as `request`). */
  requestOrNull(url: string, init?: RequestInit): Promise<Response | null>;
  setToken(token: string): void;
  setTokenRefresher(refresher: () => Promise<string | null>): void;
  setRateLimitListener(listener: RateLimitListener | undefined): void;
  getRateLimit(): RateLimitInfo;
}

/** Minimum surface a fetch-like has to satisfy for the client — used
 *  by tests so we don't have to monkey-patch `globalThis.fetch`. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface CreateApiClientOptions {
  /** Override fetch for tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: FetchLike;
  /** Threshold below which the rate-limit listener fires. Defaults to
   *  {@link RATE_LIMIT_WARN_AT}. */
  rateLimitWarnAt?: number;
}

/**
 * Build a real {@link GitHubApiClient} backed by the supplied (or
 * global) fetch.
 */
export function createGitHubApiClient(
  initialToken: string,
  options: CreateApiClientOptions = {},
): GitHubApiClient {
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const warnThreshold = options.rateLimitWarnAt ?? RATE_LIMIT_WARN_AT;

  // Mutable state owned by the client. Every member is private to
  // the closure — the store reads/writes it only through the
  // returned interface methods.
  let token = initialToken;
  let refreshToken: (() => Promise<string | null>) | undefined;
  let refreshInFlight: Promise<string | null> | null = null;
  let rateLimitRemaining: number | null = null;
  let rateLimitReset: number | null = null;
  let rateLimitWarnedFor: number | null = null;
  let rateLimitListener: RateLimitListener | undefined;

  /** Add the Authorization + GitHub-specific headers and call fetch.
   *  Single attempt — no retry / refresh logic. Used as the
   *  building block of `request` and `requestOrNull`. */
  const fetchOnce = (url: string, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...((init?.headers as Record<string, string>) || {}),
    };
    return fetchImpl(url, { ...init, headers });
  };

  const updateRateLimit = (resp: Response): void => {
    const parsed = parseRateLimitHeaders(resp.headers);
    if (parsed.remaining != null) rateLimitRemaining = parsed.remaining;
    if (parsed.resetAt != null) rateLimitReset = parsed.resetAt;

    const decision = shouldFireRateLimitWarning({
      remaining: rateLimitRemaining,
      resetAt: rateLimitReset,
      threshold: warnThreshold,
      lastWarnedFor: rateLimitWarnedFor,
    });
    if (decision.fire && rateLimitListener) {
      rateLimitWarnedFor = decision.nextWarnedFor;
      try {
        rateLimitListener({
          // `decision.fire === true` implies a numeric remaining,
          // since `shouldFireRateLimitWarning` returns false for null.
          remaining: rateLimitRemaining as number,
          resetAt: rateLimitReset,
        });
      } catch {
        // Listener threw — swallow so a UI bug can't cascade into
        // API request failures.
      }
    } else if (!decision.fire) {
      // Keep nextWarnedFor in sync (it may be null when remaining
      // recovered above the threshold so the next dip re-fires).
      rateLimitWarnedFor = decision.nextWarnedFor;
    }
  };

  const throwGitHubError = async (resp: Response): Promise<never> => {
    const text = await resp.text().catch(() => "");
    const parsed = parseGitHubErrorBody(resp.status, text);
    const extra: Partial<GitHubError> = {};
    if (parsed.conflict) extra.conflict = true;
    throw githubError(`GitHub API ${resp.status}: ${parsed.detail}`, resp.status, extra);
  };

  /** Coalesce concurrent token-refresh attempts so a burst of 401s
   *  from parallel requests results in a single PAT prompt. */
  const runRefresh = async (): Promise<string | null> => {
    try {
      // `request` only sets `refreshInFlight` after checking
      // `refreshToken` is defined.
      const next = await refreshToken!();
      if (next) token = next;
      return next;
    } catch (e) {
      console.warn("[github-api-client] token refresh threw:", e);
      return null;
    } finally {
      refreshInFlight = null;
    }
  };

  const request = async (url: string, init?: RequestInit): Promise<Response> => {
    const resp = await fetchOnce(url, init);
    if (resp.ok) {
      updateRateLimit(resp);
      return resp;
    }
    if (resp.status === 401 && refreshToken) {
      // Drain the body so the underlying fetch impl is happy.
      await resp.text().catch(() => "");
      const next = await (refreshInFlight ??= runRefresh());
      if (next) {
        const retry = await fetchOnce(url, init);
        if (retry.ok) {
          updateRateLimit(retry);
          return retry;
        }
        await throwGitHubError(retry);
      }
    }
    await throwGitHubError(resp);
    // Unreachable — `throwGitHubError` always throws.
    return resp;
  };

  const requestOrNull = async (url: string, init?: RequestInit): Promise<Response | null> => {
    try {
      const resp = await fetchOnce(url, init);
      if (resp.ok) {
        updateRateLimit(resp);
        return resp;
      }
      // Mirror the 401 auto-refresh semantics of `request`, sharing
      // the same `refreshInFlight` so a burst of soft + hard
      // requests doesn't spawn multiple PAT banners.
      if (resp.status === 401 && refreshToken) {
        await resp.text().catch(() => "");
        const next = await (refreshInFlight ??= runRefresh());
        if (next) {
          const retry = await fetchOnce(url, init);
          if (retry.ok) {
            updateRateLimit(retry);
            return retry;
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  };

  return {
    request,
    requestOrNull,
    setToken(next) {
      token = next;
    },
    setTokenRefresher(refresher) {
      refreshToken = refresher;
    },
    setRateLimitListener(listener) {
      rateLimitListener = listener;
    },
    getRateLimit() {
      return { remaining: rateLimitRemaining, resetAt: rateLimitReset };
    },
  };
}
