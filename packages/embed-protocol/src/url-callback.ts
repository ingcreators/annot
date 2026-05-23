/**
 * URL-callback codec for the embed-protocol's `newTab` transport.
 *
 * Phase 5b of `docs/plans/living-spec-authoring-roadmap.md`.
 *
 * `newTab` mode is the default for `<AnnotEditButton>` per
 * `living-spec-authoring-roadmap.md` OQ-09. A click on the
 * button calls `encodeEmbedRequestUrl(...)` to build the
 * cloud-editor URL, then `window.open`s it. On save, the cloud
 * editor `window.location.assign`s the configured `returnUrl`
 * with the lifecycle signal appended as a hash fragment;
 * the docs-site reads that hash via `parseEmbedReturnHash(...)`
 * (Phase 5g surfaces the toast).
 *
 * Two distinct functions because the two halves of the
 * round-trip happen in opposite codebases (docs site encodes,
 * annot-cloud's `/embed` route on commit redirects back, docs
 * site parses). Keeping them in one Tier A package means both
 * sides import the same canonical encoder / decoder rather
 * than maintaining parallel implementations.
 */

import type { EmbedMode } from "./events.js";

/**
 * Largest URL the encoder will produce. Roughly tracks the
 * legacy 2 KB ceiling several enterprise reverse-proxies / WAFs
 * enforce; cloud editors that need to ship more state should
 * persist it in their own DB and pass an id instead.
 */
export const MAX_EMBED_REQUEST_URL_BYTES = 2048;

/**
 * Input shape for `encodeEmbedRequestUrl`. The caller supplies
 * the cloud editor's base origin, the repo + paths to load,
 * and the URL to return to on save / abandon.
 */
export interface EmbedRequestParams {
  /** Cloud editor origin, e.g. `"https://annot.work"`. Trailing
   *  slash is permitted and stripped. The encoder appends
   *  `/embed?…` to this. */
  readonly cloudUrl: string;
  /** Owner/repo slug, e.g. `"ingcreators/annot"`. */
  readonly repo: string;
  /** Path within the repo of the PNG being edited. */
  readonly pngPath: string;
  /** Path within the repo of the linked `.annotations.yaml`. */
  readonly annotationsPath: string;
  /** Absolute URL the cloud editor will redirect to on save /
   *  abandon. The hash fragment is appended; an existing
   *  fragment is replaced. */
  readonly returnUrl: string;
  /** Optional embed mode. The cloud editor uses this to decide
   *  whether to redirect (`newTab`) vs `postMessage` parent
   *  (`inline`). Defaults to `newTab`. */
  readonly mode?: EmbedMode;
}

/**
 * Error thrown by `encodeEmbedRequestUrl` when the inputs are
 * malformed or the resulting URL exceeds the safe ceiling.
 */
export class EmbedRequestUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbedRequestUrlError";
  }
}

/**
 * Builds the embed-request URL for `<AnnotEditButton>`'s
 * `newTab` mode. Throws `EmbedRequestUrlError` on invalid
 * input or oversized output.
 */
export function encodeEmbedRequestUrl(params: EmbedRequestParams): string {
  if (!params.cloudUrl) {
    throw new EmbedRequestUrlError("cloudUrl is required");
  }
  if (!params.repo) {
    throw new EmbedRequestUrlError("repo is required");
  }
  if (!params.pngPath) {
    throw new EmbedRequestUrlError("pngPath is required");
  }
  if (!params.annotationsPath) {
    throw new EmbedRequestUrlError("annotationsPath is required");
  }
  if (!params.returnUrl) {
    throw new EmbedRequestUrlError("returnUrl is required");
  }

  // Strip a single trailing slash on cloudUrl to canonicalize.
  // Plain character check rather than a `/+$` regex — the
  // quantified form triggers a ReDoS warning, and a single
  // trailing slash is the only case the caller is plausibly
  // hitting (it falls out of how authors type origins, not from
  // adversarial input).
  const cloudUrl = params.cloudUrl.endsWith("/") ? params.cloudUrl.slice(0, -1) : params.cloudUrl;

  let baseUrl: URL;
  try {
    baseUrl = new URL(`${cloudUrl}/embed`);
  } catch {
    throw new EmbedRequestUrlError(`cloudUrl is not a valid absolute URL: ${params.cloudUrl}`);
  }

  // Reject relative returnUrl — the cloud editor lives on a
  // different origin and won't have the docs-site origin to
  // resolve a relative URL against. Throws here rather than
  // silently producing an unreachable callback.
  try {
    // eslint-disable-next-line no-new
    new URL(params.returnUrl);
  } catch {
    throw new EmbedRequestUrlError(`returnUrl must be an absolute URL: ${params.returnUrl}`);
  }

  const mode: EmbedMode = params.mode ?? "newTab";
  baseUrl.searchParams.set("repo", params.repo);
  baseUrl.searchParams.set("pngPath", params.pngPath);
  baseUrl.searchParams.set("annotationsPath", params.annotationsPath);
  baseUrl.searchParams.set("return", params.returnUrl);
  baseUrl.searchParams.set("mode", mode);
  baseUrl.searchParams.set("v", "1");

  const url = baseUrl.toString();
  if (url.length > MAX_EMBED_REQUEST_URL_BYTES) {
    throw new EmbedRequestUrlError(
      `embed-request URL exceeds ${MAX_EMBED_REQUEST_URL_BYTES} bytes (${url.length})`,
    );
  }
  return url;
}

/**
 * Result shape returned by `parseEmbedRequestUrl`. Mirrors
 * `EmbedRequestParams` field-for-field, with the optional
 * `mode` resolved to its default (`"newTab"`) so cloud-side
 * callers don't repeat the fallback. The `version` field is
 * parsed from `?v=` so the cloud editor can detect a future
 * docs-site that ships v2 of the protocol.
 */
export interface ParsedEmbedRequest {
  readonly repo: string;
  readonly pngPath: string;
  readonly annotationsPath: string;
  readonly returnUrl: string;
  readonly mode: EmbedMode;
  readonly version: number;
}

/**
 * Cloud-side parser for the URL `encodeEmbedRequestUrl` produces.
 * Accepts either the full request URL (`https://annot.work/embed?…`)
 * or just the query string (`?repo=…&…` or `repo=…&…`).
 *
 * Throws `EmbedRequestUrlError` on missing / malformed fields so
 * the cloud `/embed` route can surface a stable 400 to the
 * visitor without speculatively running with partial state. Future
 * docs sites that ship a higher protocol version surface here as
 * a non-error — callers decide whether to accept it.
 */
export function parseEmbedRequestUrl(
  urlOrSearch: string | URL | URLSearchParams,
): ParsedEmbedRequest {
  let params: URLSearchParams;
  if (urlOrSearch instanceof URLSearchParams) {
    params = urlOrSearch;
  } else if (urlOrSearch instanceof URL) {
    params = urlOrSearch.searchParams;
  } else if (urlOrSearch.startsWith("?") || !urlOrSearch.includes("://")) {
    // Treat anything without a scheme as a raw query string. Strip
    // a leading `?` if present so `URLSearchParams` handles both
    // `?foo=1` and `foo=1`.
    const trimmed = urlOrSearch.startsWith("?") ? urlOrSearch.slice(1) : urlOrSearch;
    params = new URLSearchParams(trimmed);
  } else {
    try {
      params = new URL(urlOrSearch).searchParams;
    } catch {
      throw new EmbedRequestUrlError(
        `embed-request URL is not a valid absolute URL: ${urlOrSearch}`,
      );
    }
  }

  const required = (name: string): string => {
    const value = params.get(name);
    if (!value) {
      throw new EmbedRequestUrlError(`embed-request URL missing required parameter "${name}"`);
    }
    return value;
  };

  const repo = required("repo");
  const pngPath = required("pngPath");
  const annotationsPath = required("annotationsPath");
  const returnUrl = required("return");

  // Validate `returnUrl` is absolute so the cloud editor's later
  // hash-redirect lands somewhere reachable.
  try {
    new URL(returnUrl);
  } catch {
    throw new EmbedRequestUrlError(`embed-request URL "return" must be absolute: ${returnUrl}`);
  }

  const modeRaw = params.get("mode");
  const mode: EmbedMode =
    modeRaw === "inline" || modeRaw === "disabled" || modeRaw === "newTab" ? modeRaw : "newTab";

  const versionRaw = params.get("v");
  const version = versionRaw ? Number.parseInt(versionRaw, 10) : 1;
  if (!Number.isFinite(version) || version < 1) {
    throw new EmbedRequestUrlError(
      `embed-request URL "v" must be a positive integer: ${versionRaw}`,
    );
  }

  return { repo, pngPath, annotationsPath, returnUrl, mode, version };
}

/**
 * Discriminated union returned by `parseEmbedReturnHash`. The
 * `kind` field distinguishes the two signals the cloud editor
 * forwards via `newTab` mode.
 *
 * Forwards-compatible: future signals would add a new variant
 * here; parsers that don't recognise a future signal return
 * `null` so old docs sites simply don't toast on the unknown
 * signal.
 */
export type EmbedReturnSignal =
  | {
      readonly kind: "complete";
      readonly editId: string;
    }
  | {
      readonly kind: "abandoned";
      readonly reason?: string;
    };

/**
 * Parses the URL hash fragment the cloud editor appended to
 * `returnUrl` on save / abandon. Returns `null` when the hash
 * carries no embed-protocol signal (the docs site renders
 * nothing in that case — every other use of `window.location.hash`
 * stays unaffected).
 *
 * Accepts the hash with or without the leading `#`.
 */
export function parseEmbedReturnHash(hash: string): EmbedReturnSignal | null {
  if (!hash) return null;
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!trimmed) return null;

  // `URLSearchParams` handles `key=value&key2=value2`, including
  // empty values and percent-encoding.
  const params = new URLSearchParams(trimmed);

  const completeRaw = params.get("edit-complete");
  if (completeRaw !== null) {
    if (!completeRaw) return null;
    return { kind: "complete", editId: completeRaw };
  }

  const abandonedRaw = params.get("edit-abandoned");
  if (abandonedRaw !== null) {
    if (abandonedRaw !== "1") return null;
    const reason = params.get("reason");
    return reason ? { kind: "abandoned", reason } : { kind: "abandoned" };
  }

  return null;
}

/**
 * Encodes the return-hash signal an annot-cloud editor would
 * append to `returnUrl` on save / abandon. Used by annot-cloud's
 * `/embed` route on commit; provided here so both halves of the
 * round-trip share one canonical encoder.
 *
 * Returns the leading `#` so callers can do
 * `window.location.assign(`${returnUrl}${encodeEmbedReturnHash(...)}`)`.
 */
export function encodeEmbedReturnHash(signal: EmbedReturnSignal): string {
  if (signal.kind === "complete") {
    const params = new URLSearchParams({ "edit-complete": signal.editId });
    return `#${params.toString()}`;
  }
  // abandoned
  const params = new URLSearchParams({ "edit-abandoned": "1" });
  if (signal.reason) {
    params.set("reason", signal.reason);
  }
  return `#${params.toString()}`;
}
