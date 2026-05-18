// Annot Cloud auth helpers — persists the base URL the user
// connected to. The actual session lives server-side in an
// HttpOnly cookie that the worker manages; this file only
// remembers WHICH worker base URL to talk to.
//
// Parallel to `github-auth.ts` / `google-auth.ts` but smaller
// because there's no token to handle.

/** Production default. Self-hosters can override via the
 *  "Connect to Annot Cloud" dialog. */
export const DEFAULT_CLOUD_BASE_URL = "https://api.annot.work";

const STORAGE_KEY = "annot-cloud-base-url";

/** Read the persisted base URL. Returns `null` when the user has
 *  never connected. */
export function loadCloudBaseUrl(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/** Persist the base URL after a successful connect so the next
 *  reload can rehydrate without prompting. */
export function saveCloudBaseUrl(baseUrl: string): void {
  localStorage.setItem(STORAGE_KEY, baseUrl);
}

/** Forget the base URL on disconnect. Does not touch the
 *  worker-side session cookie (that requires hitting
 *  `/api/auth/logout` against the worker). */
export function clearCloudBaseUrl(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Best-effort logout — POSTs `/api/auth/logout` against the
 *  worker so the session cookie is invalidated server-side too.
 *  Swallows transport errors because the local state is already
 *  cleared and we don't want a network blip to block the
 *  disconnect UX. */
export async function logoutCloudSession(baseUrl: string): Promise<void> {
  try {
    await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    /* best-effort */
  }
}
