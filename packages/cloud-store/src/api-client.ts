// Thin fetch wrapper used by `AnnotCloudStore` to talk to the
// `@ingcreators/annot-worker` HTTP surface.
//
// Responsibilities:
//   - Build URLs against the configured base
//   - Send `credentials: "include"` so the session cookie rides
//     along on every request (the worker rejects without it)
//   - Normalise transport-level failures into shapes the
//     `StorageProvider` error contract expects
//
// Error mapping rules:
//   - 401 → `StoragePermissionError`
//   - 413 with body.error === "quota_exceeded" → `StorageQuotaError`
//   - 413 with body.error === "payload_too_large" → plain `Error`
//     (a single oversized upload, not a workspace quota issue)
//   - 409 → caller decides (`StorageConflictError` for renames /
//     `path_conflict` business response for uploads)
//   - other 4xx / 5xx → plain `Error` with the server's `message`
//     when present
//
// `fetchImpl` is injectable so tests can swap in a mock without
// monkey-patching `globalThis.fetch`.

import { StoragePermissionError, StorageQuotaError } from "@ingcreators/annot-core/storage";

/** Standard error envelope every worker handler returns on
 *  non-2xx. Keys beyond `ok` / `error` / `message` vary per
 *  endpoint (e.g. `existingImageId`, `plan`, `exceeded`). */
export interface ApiErrorBody {
  ok: false;
  error: string;
  message?: string;
  // Quota-specific extras (only present on 413 quota_exceeded).
  exceeded?: "storage" | "documents" | "shares";
  plan?: string;
  usage?: { storageBytes: number; documentCount: number; shareCount: number };
  limits?: {
    storageBytes: number | null;
    activeDocuments: number | null;
    activeShares: number | null;
  };
  // Conflict-specific extras (only present on 409).
  existingImageId?: string;
  existingDocumentId?: string;
}

export interface ApiClientOptions {
  /** Base URL of the worker, e.g. `https://api.annot.work`.
   *  No trailing slash. Tests pass `http://localhost:8787` or
   *  a fixture URL like `http://test.local`. */
  baseUrl: string;
  /** Override `globalThis.fetch`. Tests pass a mock; production
   *  code leaves it undefined to get the browser fetch. */
  fetchImpl?: typeof fetch;
}

/** Thrown when the server returns a non-2xx that doesn't map to a
 *  more specific `StorageError` subclass. Carries the parsed body
 *  for callers that want to inspect the error code (e.g.
 *  `path_conflict` on POST /api/images). */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;
  constructor(status: number, body: ApiErrorBody | null, message?: string) {
    super(message ?? body?.message ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export class ApiClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: ApiClientOptions) {
    // Strip trailing slash so `joinUrl` can concatenate without
    // worrying about double-slashes.
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /** Build an absolute URL from a worker-relative path. The path
   *  may include a query string; encoding is the caller's
   *  responsibility. */
  url(pathAndQuery: string): string {
    if (!pathAndQuery.startsWith("/")) {
      throw new Error(`ApiClient.url: path must start with "/": ${pathAndQuery}`);
    }
    return `${this.#baseUrl}${pathAndQuery}`;
  }

  /**
   * Run a fetch with credentials. Returns the raw `Response` so
   * callers can stream bytes or parse JSON themselves. Does NOT
   * raise on non-2xx — call `parseError` for that.
   */
  async request(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
    return await this.#fetch(this.url(pathAndQuery), {
      ...init,
      credentials: "include",
    });
  }

  /**
   * Parse a non-OK response into the appropriate `StorageError`
   * subclass + throw. Called by every typed helper below after
   * `response.ok` returns false. `path` is the StorageProvider
   * path the operation was attempted on; folded into the thrown
   * error so callers can recover the failing record.
   */
  async raiseForStatus(response: Response, path: string): Promise<never> {
    let body: ApiErrorBody | null = null;
    try {
      const json = (await response.json()) as ApiErrorBody;
      // Best-effort shape check — the worker always returns this
      // shape on non-2xx but a misconfigured upstream might not.
      if (json && typeof json === "object" && "error" in json) {
        body = json;
      }
    } catch {
      // Body wasn't JSON. Leave `body` null.
    }

    if (response.status === 401) {
      throw new StoragePermissionError(
        path,
        body?.message ?? "Cloud session expired; sign in again.",
      );
    }
    if (response.status === 413 && body?.error === "quota_exceeded") {
      throw new StorageQuotaError(path, body.message ?? "Workspace quota exceeded.");
    }
    throw new ApiError(response.status, body, body?.message ?? `HTTP ${response.status}`);
  }

  // ── Typed JSON helpers ──────────────────────────────────────

  async getJson<T>(pathAndQuery: string, providerPath: string): Promise<T> {
    const res = await this.request(pathAndQuery, { method: "GET" });
    if (!res.ok) await this.raiseForStatus(res, providerPath);
    return (await res.json()) as T;
  }

  async postJson<T>(pathAndQuery: string, body: unknown, providerPath: string): Promise<T> {
    const res = await this.request(pathAndQuery, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) await this.raiseForStatus(res, providerPath);
    return (await res.json()) as T;
  }

  async patchJson<T>(pathAndQuery: string, body: unknown, providerPath: string): Promise<T> {
    const res = await this.request(pathAndQuery, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) await this.raiseForStatus(res, providerPath);
    return (await res.json()) as T;
  }

  async deleteJson(pathAndQuery: string, providerPath: string): Promise<void> {
    const res = await this.request(pathAndQuery, { method: "DELETE" });
    if (!res.ok) await this.raiseForStatus(res, providerPath);
    // 204 No Content — nothing to parse.
  }

  // ── Byte-streaming helpers ──────────────────────────────────

  async postBytes<T>(
    pathAndQuery: string,
    body: BodyInit,
    headers: Record<string, string>,
    providerPath: string,
  ): Promise<T> {
    const res = await this.request(pathAndQuery, { method: "POST", headers, body });
    if (!res.ok) await this.raiseForStatus(res, providerPath);
    return (await res.json()) as T;
  }

  async patchBytes<T>(
    pathAndQuery: string,
    body: BodyInit,
    headers: Record<string, string>,
    providerPath: string,
  ): Promise<T> {
    const res = await this.request(pathAndQuery, { method: "PATCH", headers, body });
    if (!res.ok) await this.raiseForStatus(res, providerPath);
    return (await res.json()) as T;
  }

  /** Stream a body endpoint without parsing it. The caller handles
   *  the `Response` (e.g. `.arrayBuffer()`, `.text()`, or piping
   *  to a Blob for thumbnail prefetch). 404 returns null so
   *  callers can distinguish "no annotations yet" from a real
   *  error. */
  async getBody(pathAndQuery: string, providerPath: string): Promise<Response | null> {
    const res = await this.request(pathAndQuery, { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) await this.raiseForStatus(res, providerPath);
    return res;
  }
}
