/**
 * Multi-segment path router for SPA.
 * Image path occupies the URL path segments after the store,
 * so "/" acts as a natural folder separator.
 *
 * URL patterns (production base = "/annotation"):
 *   /annotation/                                                → gallery (root)
 *   /annotation/folder/Screenshots/Mobile                       → gallery (deep-link)
 *   /annotation/edit/img/browser/image-123.jpg                  → edit image at root
 *   /annotation/edit/img/browser/Screenshots/Mobile/image.png   → edit nested image
 *   /annotation/edit/img/extension/...?extId=...                → edit from extension
 *   /annotation/edit/doc/browser/Manuals/onboarding.annot.html  → edit document
 *
 * In dev (base = "/"):
 *   /                                                           → gallery
 *   /edit/img/<store>/<path...>                                 → edit image
 *   /edit/doc/<store>/<path...>                                 → edit document
 *   /folder/<path...>                                           → gallery deep-link
 *   /capture                                                    → capture workspace
 *
 * Resource type lives between `edit` and `<store>` as a short
 * identifier (`img` / `doc`), matching annot's "short identifier in
 * URLs / package names / element prefixes" convention. Legacy
 * `/edit/<store>/<path>` and `/doc/<store>/<path>` URLs fall through
 * to the gallery (404 policy, mirroring the `local→browser` rename
 * precedent in `docs/url-schemes.md`).
 *
 * Non-ASCII and special characters are percent-encoded per segment,
 * so "/" is never %2F-encoded.
 */

// Base path — matches Vite's base config
const BASE = import.meta.env.BASE_URL.replace(/\/$/, ""); // e.g. "" in dev, "/annotation" in prod

export interface Route {
  type: "gallery" | "edit" | "doc" | "handoff" | "capture";
  store?: string; // "extension" | "device" | "browser" | "googledrive"
  extId?: string; // extension ID (from query param)
  path?: string; // image path (edit) or folder path (gallery deep-link); "" = root
  session?: string; // if set, open the Bulk Editor filtered by this session id
  /** For type "handoff": the source (e.g. "googledrive", future "onedrive"). */
  handoffSource?: string;
  /** For type "handoff": raw `?state=` JSON string as delivered by the source. */
  handoffState?: string;
}

/** Percent-encode each segment but keep the "/" separators. */
function encodePath(path: string): string {
  if (!path) return "";
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Decode percent-encoded segments back to a logical path. */
function decodePath(segments: string[]): string {
  return segments
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join("/");
}

/** Parse current URL into a Route. */
export function parseRoute(): Route {
  const pathname = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const extId = params.get("extId") || undefined;
  const session = params.get("session") || undefined;

  // Strip base prefix
  const relative = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  const parts = relative.split("/").filter(Boolean);

  // /handoff/<source>?state=...  → external-trigger entrypoint
  // Kept separate from /edit/... so filenames like "handoff" inside
  // a storage backend can't collide with the route.
  if (parts[0] === "handoff" && parts[1]) {
    const handoffSource = parts[1];
    const handoffState = params.get("state") || undefined;
    return { type: "handoff", handoffSource, handoffState };
  }

  // /edit/img/:store/<path...>  → image editor
  // /edit/doc/:store/<path...>  → `.annot.html` document editor
  //
  // Resource type lives between `edit` and `<store>` as a short
  // identifier. The doc branch routes through the doc-shell instead
  // of the image editor without sniffing the file extension. Legacy
  // `/edit/<store>/<path>` (no resource segment) and `/doc/<store>/<path>`
  // (top-level) fall through to the gallery — see the docblock above.
  if (parts[0] === "edit" && (parts[1] === "img" || parts[1] === "doc") && parts[2]) {
    const kind = parts[1];
    const store = parts[2];
    const path = decodePath(parts.slice(3));
    if (kind === "img") {
      return { type: "edit", store, path, extId, session };
    }
    return { type: "doc", store, path, extId };
  }

  // /folder/<path...>  → gallery deep-link into a folder
  if (parts[0] === "folder" && parts[1]) {
    const path = decodePath(parts.slice(1));
    return { type: "gallery", path, extId, session };
  }

  // /capture — Phase 2 of `docs/plans/web-capture-redesign.md`.
  // Mode + folderPath aren't in the URL by design (we don't want
  // them in browser history and the workspace can't re-grant
  // getDisplayMedia on a reload anyway). The router-host reads
  // `CapturePendingSession` from memory — direct navigation
  // without a pending session surfaces the no-session hint.
  if (parts[0] === "capture") {
    return { type: "capture" };
  }

  return { type: "gallery", path: "", extId, session };
}

/** Build a URL for editing an image at `imagePath`. */
export function editUrl(store: string, imagePath: string, extId?: string): string {
  const encoded = encodePath(imagePath);
  const qs = extId ? `?extId=${encodeURIComponent(extId)}` : "";
  const suffix = encoded ? `/${encoded}` : "";
  return `${BASE}/edit/img/${encodeURIComponent(store)}${suffix}${qs}`;
}

/** Build a URL for editing an `.annot.html` document at `docPath`.
 *  Sibling of {@link editUrl}; the only difference is the resource
 *  segment (`doc` vs `img`) the router-host dispatches on. */
export function docUrl(store: string, docPath: string, extId?: string): string {
  const encoded = encodePath(docPath);
  const qs = extId ? `?extId=${encodeURIComponent(extId)}` : "";
  const suffix = encoded ? `/${encoded}` : "";
  return `${BASE}/edit/doc/${encodeURIComponent(store)}${suffix}${qs}`;
}

/**
 * Build a URL that opens the Bulk Editor for the given capture session.
 * Optionally includes an initial image path (active frame); otherwise the
 * editor opens with the first frame of the session active.
 */
export function sessionEditUrl(
  store: string,
  sessionId: string,
  imagePath?: string,
  extId?: string,
): string {
  const encoded = imagePath ? encodePath(imagePath) : "";
  const suffix = encoded ? `/${encoded}` : "";
  const params = new URLSearchParams();
  params.set("session", sessionId);
  if (extId) params.set("extId", extId);
  return `${BASE}/edit/img/${encodeURIComponent(store)}${suffix}?${params.toString()}`;
}

/** Build the `/capture` workspace URL. Phase 2 of
 *  `docs/plans/web-capture-redesign.md`. Mode + folder are
 *  intentionally not in the URL — `CapturePendingSession` carries
 *  them between dialog confirm and workspace mount. */
export function captureUrl(): string {
  const base = BASE || "";
  return `${base}/capture`;
}

/** Build the gallery URL, optionally deep-linking to a folder. */
export function galleryUrl(folderPath?: string): string {
  const base = BASE || "";
  if (folderPath) {
    return `${base}/folder/${encodePath(folderPath)}`;
  }
  return base ? `${base}/` : "/";
}

/** Navigate without page reload. */
export function pushRoute(url: string, state?: unknown): void {
  window.history.pushState(state || {}, "", url);
}
