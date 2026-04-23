/**
 * Google OAuth 2.0 + Google Picker integration.
 * Uses Google Identity Services (GIS) for auth and Picker API for folder selection.
 *
 * Setup required:
 * 1. Create OAuth Client ID at https://console.cloud.google.com/
 * 2. Enable Google Drive API and Google Picker API
 * 3. Replace GOOGLE_CLIENT_ID and GOOGLE_API_KEY below
 */

// Set via environment variables (Vite inlines them into the bundle
// at build time — values are visible in the shipped JS):
//   VITE_GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
//   VITE_GOOGLE_API_KEY=xxx
// For local dev, create `.env.local` in packages/web/.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || "";

// Non-sensitive scope: grants access only to files the app creates
// and to files/folders the user explicitly hands to us through Google
// Picker (§2 of docs/plans/google-drive-integration.md). The broader
// `drive` scope is restricted and would require a CASA audit to ship.
const SCOPES = "https://www.googleapis.com/auth/drive.file";

let accessToken: string | null = null;

/** Load Google Identity Services SDK. */
function loadGisScript(): Promise<void> {
  if (document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(s);
  });
}

/** Load Google API (for Picker). */
function loadGapiScript(): Promise<void> {
  if (document.querySelector('script[src*="apis.google.com/js/api.js"]')) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google API"));
    document.head.appendChild(s);
  });
}

/** Sign in with Google and get an access token. Shows the OAuth
 *  popup (consent screen and/or account picker). Use `silentSignIn`
 *  first when possible — an expired access token can often be
 *  refreshed without any UI interruption if the user is still
 *  signed in to Google and previously granted the scope. */
export async function signIn(): Promise<string> {
  await loadGisScript();

  return new Promise((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: (response: any) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        accessToken = response.access_token;
        localStorage.setItem("google-drive-token", accessToken!);
        resolve(accessToken!);
      },
    });
    client.requestAccessToken();
  });
}

/**
 * Try to get a fresh access token without any UI. Works when the user
 * is still signed in to Google in this browser AND has previously
 * granted the `drive.file` scope to this client id AND third-party
 * cookies are allowed so GIS can do the silent iframe exchange.
 *
 * Resolves with the new token on success, or `null` when any of the
 * above preconditions doesn't hold. The 401 auto-recovery path in
 * `GoogleDriveStore.#fetch` calls this first; only if it resolves
 * `null` does it fall back to the full `signIn` popup, routed
 * through a user-gesture banner in `bridge.ts`.
 *
 * Implementation notes:
 *
 * - `prompt: "none"` is Google's "no UI under any circumstance" flag.
 *   `prompt: ""` doesn't actually mean that; it means "prompt on
 *    first use only", which still triggers a popup when Google
 *    decides a re-consent is needed (e.g. after a scope change
 *    like our `drive` → `drive.file` move in #9).
 * - A hard `SILENT_TIMEOUT_MS` guard is critical. Under blocked
 *   third-party cookies GIS tries to fall back to a popup; the
 *   popup blocker eats it; GIS logs
 *   `[GSI LOGGER]: Failed to open popup window...` but then
 *   neither `callback` nor `error_callback` fires. Without the
 *   timeout the silent-renewal promise hangs forever, the store's
 *   `#refreshInFlight` gate stays locked, and every subsequent
 *   Drive call waits on it instead of reaching the banner.
 */
const SILENT_TIMEOUT_MS = 5000;

export async function silentSignIn(): Promise<string | null> {
  await loadGisScript();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(token);
    };
    const timer = setTimeout(() => finish(null), SILENT_TIMEOUT_MS);

    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      prompt: "none",
      callback: (response: any) => {
        if (response.error) {
          finish(null);
          return;
        }
        accessToken = response.access_token;
        localStorage.setItem("google-drive-token", accessToken!);
        finish(accessToken);
      },
      error_callback: () => finish(null),
    });
    try {
      client.requestAccessToken({ prompt: "none" });
    } catch {
      finish(null);
    }
  });
}

/** Get current access token (from memory or localStorage). */
export function getAccessToken(): string | null {
  if (accessToken) return accessToken;
  accessToken = localStorage.getItem("google-drive-token");
  return accessToken;
}

/** Check if user is signed in. */
export function isSignedIn(): boolean {
  return !!getAccessToken();
}

/** Sign out and clear token. */
export function signOut(): void {
  accessToken = null;
  localStorage.removeItem("google-drive-token");
  if ((window as any).google?.accounts?.oauth2) {
    (window as any).google.accounts.oauth2.revoke(accessToken);
  }
}

/**
 * Show Google Picker to select a folder.
 *
 * This is the gate through which the `drive.file` scope actually
 * gains access to anything. Until the user picks a folder here, the
 * app has no Drive access even after sign-in. Everything Annot
 * stores on Drive from then on lives inside the folder returned by
 * this call. See `docs/plans/google-drive-integration.md` §2.
 *
 * Returns the selected folder's ID and name, or `null` if cancelled.
 */
export async function showFolderPicker(): Promise<{ id: string; name: string } | null> {
  const token = getAccessToken();
  if (!token) return null;

  await loadGapiScript();

  // Load Picker API
  await new Promise<void>((resolve) => {
    (window as any).gapi.load("picker", resolve);
  });

  return new Promise((resolve) => {
    const view = new (window as any).google.picker.DocsView(
      (window as any).google.picker.ViewId.FOLDERS,
    );
    view.setSelectFolderEnabled(true);
    view.setMimeTypes("application/vnd.google-apps.folder");

    const picker = new (window as any).google.picker.PickerBuilder()
      .setTitle("Select a folder for annotating.work")
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setCallback((data: any) => {
        if (data.action === "picked" && data.docs?.[0]) {
          resolve({ id: data.docs[0].id, name: data.docs[0].name });
        } else if (data.action === "cancel") {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

// ---- Drive root-folder persistence ----
//
// Under `drive.file`, the only way the app can access a Drive folder
// is if the user previously picked it via Google Picker. We remember
// that pick across sessions so the user doesn't have to repeat the
// picker flow on every reload. The stored value is just an ID +
// display name; the real authorization lives server-side on Google's
// side, tied to the OAuth token.

const DRIVE_ROOT_KEY = "annot-drive-root";

interface DriveRoot {
  id: string;
  name: string;
}

/** Persist the Picker-selected Drive root folder. */
export function saveDriveRoot(root: DriveRoot): void {
  localStorage.setItem(DRIVE_ROOT_KEY, JSON.stringify(root));
}

/** Load the previously-selected Drive root folder, or null. */
export function loadDriveRoot(): DriveRoot | null {
  const raw = localStorage.getItem(DRIVE_ROOT_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (typeof v?.id === "string" && typeof v?.name === "string") return v;
  } catch { /* fall through */ }
  return null;
}

/** Forget the selected root (e.g. on sign-out or to re-pick). */
export function clearDriveRoot(): void {
  localStorage.removeItem(DRIVE_ROOT_KEY);
}
