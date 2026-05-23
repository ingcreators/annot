// GitHub App JWT signing + installation token caching —
// Phase 6 follow-up 5y-2.
//
// The Worker runtime (Cloudflare V8 isolate) has Web Crypto via
// `crypto.subtle`. We sign App-level JWTs with `RSASSA-PKCS1-v1_5`
// + SHA-256 (RS256) and exchange them at GitHub's
// `POST /app/installations/:id/access_tokens` for short-lived
// installation tokens. Tokens are cached in the `SESSIONS` KV
// namespace (50-minute TTL — GitHub-issued installation tokens
// have a 60-minute lifetime; we expire on the conservative side
// to avoid a request firing right as the token rolls over).
//
// The JWT signer is a small wrapper around `crypto.subtle.sign`;
// no third-party JWT library is pulled in (Workers' bundle size
// is precious and the surface we need is < 50 lines of code).

import type { GitHubAppEnv } from "./github-app.js";

/** Lifetime of the App JWT (sliding window). GitHub mandates ≤ 10 min. */
const APP_JWT_LIFETIME_SECONDS = 9 * 60;
/** Cache TTL for installation tokens. GitHub-issued tokens live
 *  60 min; we expire at 50 min so a token that's cached very close
 *  to its real expiry doesn't get used by a request that arrives
 *  just after the GitHub-side rollover. */
const INSTALLATION_TOKEN_CACHE_SECONDS = 50 * 60;

interface CachedInstallationToken {
  token: string;
  /** Unix ms when the cached value should NOT be returned (best-effort
   *  invalidation alongside KV's own TTL). */
  notAfter: number;
}

/** Build the cache key for an installation token. Namespace under
 *  `gh-app-inst-token:` so a `SESSIONS` KV listing stays scannable. */
function installationTokenCacheKey(installationId: number): string {
  return `gh-app-inst-token:${installationId}`;
}

/** Strip the PEM armour and base64-decode the body to DER bytes. */
function pemToDer(pem: string): Uint8Array {
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  if (!cleaned) {
    throw new Error("PEM body is empty after stripping header / footer.");
  }
  const binary = atob(cleaned);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    der[i] = binary.charCodeAt(i);
  }
  return der;
}

/** Base64URL-encode a `Uint8Array` for JWT segments. */
function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(/=+$/g, "");
}

/** Encode a JSON object as a base64url segment. */
function jsonSegment(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * Sign an App-level JWT. The JWT identifies the App to GitHub
 * (`iss: <app-id>`) and is exchanged for an installation token at
 * `POST /app/installations/:id/access_tokens`.
 *
 * No external dep — we sign with `crypto.subtle` directly because
 * the surface is small.
 */
export async function signGitHubAppJwt(env: GitHubAppEnv): Promise<string> {
  if (!env.GITHUB_APP_ID) {
    throw new Error("GITHUB_APP_ID is not set");
  }
  if (!env.GITHUB_APP_PRIVATE_KEY) {
    throw new Error("GITHUB_APP_PRIVATE_KEY is not set");
  }

  const now = Math.floor(Date.now() / 1000);
  // 60s `iat` skew accommodates a Workers ↔ GitHub clock drift; GitHub's
  // docs recommend setting `iat` 60s in the past.
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 60,
    exp: now + APP_JWT_LIFETIME_SECONDS,
    iss: env.GITHUB_APP_ID,
  };
  const signingInput = `${jsonSegment(header)}.${jsonSegment(payload)}`;

  const keyDer = pemToDer(env.GITHUB_APP_PRIVATE_KEY);
  // PEM armor: a `BEGIN PRIVATE KEY` body is PKCS#8 (what WebCrypto
  // wants). GitHub's App-settings page emits PKCS#1 (`BEGIN RSA
  // PRIVATE KEY`) by default; the GitHub UI documents both forms
  // as acceptable for the App, and `openssl pkey -in <pkcs1>.pem
  // -out <pkcs8>.pem` produces the PKCS#8 form the WebCrypto API
  // accepts. We import as PKCS#8 first and surface a clear error
  // pointing at the conversion when the user supplied PKCS#1.
  let cryptoKey: CryptoKey;
  try {
    // Cast through ArrayBuffer to satisfy the WebCrypto BufferSource type
    // (Uint8Array works at runtime but the type expects ArrayBuffer).
    cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      keyDer.buffer as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (pkcs8Err) {
    if (env.GITHUB_APP_PRIVATE_KEY.includes("RSA PRIVATE KEY")) {
      throw new Error(
        "GITHUB_APP_PRIVATE_KEY is in PKCS#1 format; convert to PKCS#8 with `openssl pkey -in app.pem -out app.pkcs8.pem` and re-bind via `wrangler secret put`.",
      );
    }
    throw pkcs8Err;
  }

  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      new TextEncoder().encode(signingInput),
    ),
  );

  return `${signingInput}.${base64Url(sig)}`;
}

/** Outcome of `mintInstallationToken`: the access token + the
 *  GitHub-issued expiration (Unix ms). */
export interface InstallationToken {
  token: string;
  /** Unix ms. GitHub returns an ISO-8601 string; we parse + cache. */
  expiresAt: number;
}

/** GitHub's API response shape for `POST /app/installations/:id/access_tokens`. */
interface AccessTokenResponse {
  token: string;
  expires_at: string;
}

/**
 * Mint a new installation token via GitHub's REST API. Used by
 * `getInstallationToken` only — callers should go through the
 * cache wrapper rather than re-minting on every request.
 */
async function mintInstallationToken(
  env: GitHubAppEnv,
  installationId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<InstallationToken> {
  const jwt = await signGitHubAppJwt(env);
  const res = await fetchImpl(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "annot-cloud-editor",
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to mint installation token (HTTP ${res.status}): ${body}`);
  }
  const data = (await res.json()) as AccessTokenResponse;
  return {
    token: data.token,
    expiresAt: Date.parse(data.expires_at),
  };
}

/**
 * Returns a valid installation token. Caches the token in
 * `SESSIONS` KV with a 50-minute TTL so subsequent requests
 * within the same Worker isolate reuse it without round-tripping
 * to GitHub.
 *
 * `kv` is the `SESSIONS` namespace; we lean on it instead of a
 * standalone KV to keep wrangler.jsonc untouched in this PR (the
 * cache could move to a dedicated `EMBED_TOKENS` namespace later
 * if scale demands it).
 */
export async function getInstallationToken(
  env: GitHubAppEnv,
  kv: KVNamespace,
  installationId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const cacheKey = installationTokenCacheKey(installationId);
  const cached = await kv.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as CachedInstallationToken;
      if (parsed.notAfter > Date.now()) {
        return parsed.token;
      }
    } catch {
      // Fall through to re-mint on parse error.
    }
  }

  const minted = await mintInstallationToken(env, installationId, fetchImpl);
  const entry: CachedInstallationToken = {
    token: minted.token,
    notAfter: minted.expiresAt - 60_000,
  };
  await kv.put(cacheKey, JSON.stringify(entry), {
    expirationTtl: INSTALLATION_TOKEN_CACHE_SECONDS,
  });
  return minted.token;
}

/** GitHub Contents API response (raw). We pluck just the fields
 *  the embed-load flow needs. */
export interface GitHubFileContents {
  /** SHA of the blob (needed by the commit endpoint in 5y-4 for
   *  the optimistic-write `sha` parameter). */
  sha: string;
  /** Base64-encoded content as returned by GitHub. */
  contentBase64: string;
  /** UTF-8 text decoded from `contentBase64`, available when the
   *  file is small enough to fit in one response (≤ 1 MB per
   *  GitHub's API limit; larger files require the blob API). */
  text: string;
  /** Encoding header from GitHub. Always "base64" for the
   *  Contents API; surfaced so callers can detect "none" (which
   *  indicates the file was too large and only metadata was
   *  returned). */
  encoding: string;
}

/**
 * Read a file from GitHub via the Contents API using an
 * installation token. Returns the decoded text + the raw
 * base64 + the blob sha for downstream optimistic commits.
 */
export async function readRepoFile(opts: {
  installationToken: string;
  repo: string;
  path: string;
  ref?: string;
  fetchImpl?: typeof fetch;
}): Promise<GitHubFileContents> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(`https://api.github.com/repos/${opts.repo}/contents/${opts.path}`);
  if (opts.ref) {
    url.searchParams.set("ref", opts.ref);
  }
  const res = await fetchImpl(url.toString(), {
    headers: {
      Authorization: `token ${opts.installationToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "annot-cloud-editor",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub Contents API ${res.status} for ${opts.repo}/${opts.path}: ${body}`);
  }
  const data = (await res.json()) as {
    sha: string;
    content?: string;
    encoding?: string;
  };
  if (data.encoding !== "base64") {
    throw new Error(
      `GitHub Contents API returned encoding="${data.encoding}" for ${opts.repo}/${opts.path}; only "base64" is supported (file may exceed the 1 MB Contents API limit).`,
    );
  }
  const contentBase64 = (data.content ?? "").replaceAll("\n", "");
  const text = new TextDecoder().decode(base64DecodeBytes(contentBase64));
  return {
    sha: data.sha,
    contentBase64,
    text,
    encoding: data.encoding,
  };
}

/** Base64 → raw bytes (browser-safe, no Buffer). Surfaced so the
 *  load endpoint can return PNG bytes byte-faithfully to the
 *  editor. */
export function base64DecodeBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** GitHub repo metadata response (we only need `private` +
 *  `default_branch`). */
export interface GitHubRepoInfo {
  /** True for private repos. Used by the plan-tier gate. */
  private: boolean;
  /** Default branch name (`main`, `master`, etc). */
  default_branch: string;
}

/** Fetch repo metadata (private flag + default branch) via the
 *  installation token. */
export async function readRepoInfo(opts: {
  installationToken: string;
  repo: string;
  fetchImpl?: typeof fetch;
}): Promise<GitHubRepoInfo> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`https://api.github.com/repos/${opts.repo}`, {
    headers: {
      Authorization: `token ${opts.installationToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "annot-cloud-editor",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub Repo API ${res.status} for ${opts.repo}: ${body}`);
  }
  const data = (await res.json()) as { private: boolean; default_branch: string };
  return { private: data.private, default_branch: data.default_branch };
}
