/// <reference path="../types/google-globals.d.ts" />

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
 *  popup (consent screen and/or account picker).
 *
 *  `forceAccountPicker: true` routes through GIS's
 *  `prompt: "select_account"`, which mirrors the GitHub setup
 *  dialog's "Use a different personal access token" escape hatch
 *  — without it, Google silently re-selects the last-used account,
 *  so once a user is connected there's no visible path to switch
 *  Google accounts. The sidebar's "Change Drive folder" reselect
 *  icon passes `true` so the user can swap accounts or just
 *  confirm the same one before the Picker opens. */
export async function signIn(opts: { forceAccountPicker?: boolean } = {}): Promise<string> {
  await loadGisScript();

  return new Promise((resolve, reject) => {
    if (!window.google) {
      reject(new Error("Google Identity Services failed to initialise"));
      return;
    }
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      prompt: opts.forceAccountPicker ? "select_account" : "",
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        if (!response.access_token) {
          reject(new Error("Google sign-in returned no access token"));
          return;
        }
        accessToken = response.access_token;
        localStorage.setItem("google-drive-token", accessToken);
        resolve(accessToken);
      },
    });
    client.requestAccessToken();
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
  if (window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken);
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
  await new Promise<void>((resolve, reject) => {
    if (!window.gapi) {
      reject(new Error("Google API loader not available"));
      return;
    }
    window.gapi.load("picker", resolve);
  });

  return new Promise((resolve, reject) => {
    if (!window.google) {
      reject(new Error("Google Picker namespace not available"));
      return;
    }
    const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS);
    view.setSelectFolderEnabled(true);
    view.setMimeTypes("application/vnd.google-apps.folder");

    const picker = new window.google.picker.PickerBuilder()
      .setTitle("Select a folder for annotating.work")
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setCallback((data) => {
        const firstDoc = data.docs?.[0];
        if (data.action === "picked" && firstDoc) {
          resolve({ id: firstDoc.id, name: firstDoc.name });
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
  } catch {
    /* fall through */
  }
  return null;
}

/** Forget the selected root (e.g. on sign-out or to re-pick). */
export function clearDriveRoot(): void {
  localStorage.removeItem(DRIVE_ROOT_KEY);
}
