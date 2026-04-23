/**
 * Google OAuth 2.0 + Google Picker integration.
 * Uses Google Identity Services (GIS) for auth and Picker API for folder selection.
 *
 * Setup required:
 * 1. Create OAuth Client ID at https://console.cloud.google.com/
 * 2. Enable Google Drive API and Google Picker API
 * 3. Replace GOOGLE_CLIENT_ID and GOOGLE_API_KEY below
 */

// Set via environment variables (Vite injects at build time):
//   VITE_GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
//   VITE_GOOGLE_API_KEY=xxx
// For local dev, create .env.local in packages/web-annotating/
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || "";
const SCOPES = "https://www.googleapis.com/auth/drive";

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

/** Sign in with Google and get an access token. */
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
 * Returns the selected folder ID and name, or null if cancelled.
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
