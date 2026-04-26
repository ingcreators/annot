/**
 * Google Drive HTTP layer — owns the `Authorization: Bearer` header,
 * the 401-driven token-refresh dance, and the Drive-specific error
 * formatter. Has zero knowledge of files, folders, paths, or the
 * cache the store maintains.
 *
 * Mirrors `github-api-client.ts` for consistency. Drive's surface is
 * simpler:
 *
 *   - No rate-limit header parsing (Drive's quotas surface as 403
 *     responses with a structured body, not as headers).
 *   - No `requestOrNull` variant (Drive doesn't have an amend /
 *     atomic-tree path that needs soft failure).
 *   - The error body is plain text — no conflict / SHA discriminator.
 *
 * Lifted out of `google-drive-store.ts` so the request layer can be
 * unit-tested directly via a `fetchImpl` override, the same pattern
 * the GitHub client uses.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Discriminated subclass of `Error` carrying Drive-specific fields.
 * The store's API methods narrow on `.driveError === true`.
 */
export interface DriveError extends Error {
  status?: number;
  driveError?: true;
}

export interface GoogleDriveApiClient {
  /** Issue a Drive API request. Adds the Authorization header,
   *  retries once with a refreshed token on 401, throws a
   *  {@link DriveError} on any non-2xx that survives the retry. */
  request(url: string, init?: RequestInit): Promise<Response>;
  setToken(token: string): void;
  setTokenRefresher(refresher: () => Promise<string | null>): void;
}

export interface CreateApiClientOptions {
  /** Override fetch for tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: FetchLike;
}

/**
 * Build a real {@link GoogleDriveApiClient} backed by the supplied
 * (or global) fetch.
 */
export function createGoogleDriveApiClient(
  initialToken: string,
  options: CreateApiClientOptions = {},
): GoogleDriveApiClient {
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));

  let token = initialToken;
  let refreshToken: (() => Promise<string | null>) | undefined;
  let refreshInFlight: Promise<string | null> | null = null;

  /** Single attempt — no retry / refresh logic. Building block of
   *  `request`. */
  const fetchOnce = (url: string, init?: RequestInit): Promise<Response> => {
    return fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...((init?.headers as Record<string, string>) || {}),
      },
    });
  };

  const throwDriveError = async (resp: Response): Promise<never> => {
    const text = await resp.text().catch(() => "");
    const err = new Error(`Drive API ${resp.status}: ${text.slice(0, 200)}`) as DriveError;
    err.status = resp.status;
    err.driveError = true;
    throw err;
  };

  /** Coalesce concurrent token-refresh attempts so a burst of 401s
   *  from parallel requests results in a single user-visible prompt. */
  const runRefresh = async (): Promise<string | null> => {
    try {
      // `request` only sets `refreshInFlight` after checking
      // `refreshToken` is defined.
      const next = await refreshToken!();
      if (next) token = next;
      return next;
    } catch (e) {
      console.warn("[google-drive-api-client] token refresh threw:", e);
      return null;
    } finally {
      refreshInFlight = null;
    }
  };

  const request = async (url: string, init?: RequestInit): Promise<Response> => {
    const resp = await fetchOnce(url, init);
    if (resp.ok) return resp;
    if (resp.status === 401 && refreshToken) {
      // Drain the body so the underlying fetch impl is happy.
      await resp.text().catch(() => "");
      const next = await (refreshInFlight ??= runRefresh());
      if (next) {
        const retry = await fetchOnce(url, init);
        if (retry.ok) return retry;
        await throwDriveError(retry);
      }
      // Refresh came back null → user cancelled, network gone, or
      // scope was revoked. Fall through to the generic error.
    }
    await throwDriveError(resp);
    // Unreachable — `throwDriveError` always throws.
    return resp;
  };

  return {
    request,
    setToken(next) {
      token = next;
    },
    setTokenRefresher(refresher) {
      refreshToken = refresher;
    },
  };
}
