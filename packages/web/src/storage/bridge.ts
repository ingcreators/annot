/**
 * Extension API bridge — communicates with the Annot browser extension
 * (by ingcreators) via chrome.runtime.sendMessage to access its IndexedDB.
 *
 * Falls back to `BrowserStore` (IndexedDB in this origin) if the
 * extension is not installed.
 */
import type { StorageProvider } from "@ingcreators/annot-core/storage";
import { hideError, showAuthError, showError } from "../ui/error-bar.js";
import { BrowserStore } from "./browser-store.js";
import { DeviceStore } from "./device-store.js";
import { clearHandle, loadHandle, saveHandle } from "./fs-handle-store.js";
import {
  clearRepoRef as clearGitHubRef,
  type GitHubRepoRef,
  getAccessToken as getGitHubToken,
  signOut as githubSignOut,
  loadRepoRef as loadGitHubRef,
} from "./github-auth.js";
import { GitHubStore } from "./github-store.js";
import { getAccessToken, loadDriveRoot, signIn } from "./google-auth.js";
import { GoogleDriveStore } from "./google-drive-store.js";

// chrome-types omits `chrome.runtime.lastError` from its public typings,
// even though it exists at runtime (set during callback-style API calls).
// Augment locally so the callback forms below typecheck.
declare global {
  namespace chrome.runtime {
    let lastError: { message?: string } | undefined;
  }
}

export type StorageMode = "extension" | "browser" | "device" | "googledrive" | "github";

let extensionId: string | null = null;
let extensionAvailable: boolean | null = null;
let browserFallback: StorageProvider | null = null;
let driveStore: GoogleDriveStore | null = null;
let deviceStore: DeviceStore | null = null;
let githubStore: GitHubStore | null = null;
let currentMode: StorageMode = "browser";

function hasChromeRuntime(): boolean {
  return (
    typeof chrome !== "undefined" &&
    typeof chrome.runtime !== "undefined" &&
    typeof chrome.runtime.sendMessage === "function"
  );
}

/** Try to detect extension by sending a ping. */
async function detectExtension(): Promise<boolean> {
  if (extensionAvailable !== null) return extensionAvailable;

  if (!hasChromeRuntime()) {
    console.log("[bridge] chrome.runtime not available — using local storage");
    extensionAvailable = false;
    return false;
  }

  const ids = getExtensionIds();
  if (ids.length === 0) {
    console.log("[bridge] No extension ID configured — using local storage");
    extensionAvailable = false;
    return false;
  }

  for (const id of ids) {
    try {
      console.log(`[bridge] Pinging extension ${id}...`);
      const resp = await sendToExtension(id, { action: "ping" });
      console.log("[bridge] Ping response:", resp);
      if (resp?.ok) {
        extensionId = id;
        extensionAvailable = true;
        console.log("[bridge] Connected to extension!");
        return true;
      }
    } catch (e) {
      console.warn("[bridge] Ping failed:", e);
    }
  }

  extensionAvailable = false;
  return false;
}

function getExtensionIds(): string[] {
  const stored = localStorage.getItem("annot-extension-id");
  if (stored) return [stored];
  return [];
}

function sendToExtension(id: string, msg: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!hasChromeRuntime()) {
      reject(new Error("Chrome runtime not available"));
      return;
    }
    try {
      chrome.runtime.sendMessage(id, msg, (response: any) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function send(msg: any): Promise<any> {
  if (extensionId) {
    return sendToExtension(extensionId, msg);
  }
  throw new Error("Extension not connected");
}

function getBrowserStore(): StorageProvider {
  if (!browserFallback) browserFallback = new BrowserStore();
  return browserFallback;
}

// ---- Public API ----

export async function getStorage(): Promise<StorageProvider> {
  if (currentMode === "googledrive" && driveStore) return driveStore;
  if (currentMode === "github" && githubStore) return githubStore;
  if (currentMode === "device" && deviceStore) return deviceStore;
  const hasExtension = await detectExtension();
  if (hasExtension) {
    currentMode = "extension";
    return extensionStorage;
  }
  currentMode = "browser";
  return getBrowserStore();
}

/** Set extension ID and try to connect. Optionally set mode. Returns true if connected. */
export async function setExtensionId(id: string, mode?: StorageMode): Promise<boolean> {
  localStorage.setItem("annot-extension-id", id);
  extensionId = null;
  extensionAvailable = null;
  const ok = await detectExtension();
  if (ok) {
    currentMode = mode || "extension";
  }
  return ok;
}

export function setStorageMode(mode: StorageMode): void {
  currentMode = mode;
}

/** Open a local directory and switch to filesystem storage. */
export async function openDeviceDirectory(): Promise<StorageProvider | null> {
  try {
    const dirHandle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
    await saveHandle(dirHandle);
    deviceStore = new DeviceStore(dirHandle);
    await deviceStore.init();
    currentMode = "device";
    return deviceStore;
  } catch {
    return null;
  }
}

/** Restore previously selected filesystem folder from IndexedDB. */
export async function restoreDevice(): Promise<StorageProvider | null> {
  try {
    const handle = await loadHandle();
    if (!handle) return null;

    const perm = await (handle as any).queryPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      const req = await (handle as any).requestPermission({ mode: "readwrite" });
      if (req !== "granted") return null;
    }

    deviceStore = new DeviceStore(handle);
    await deviceStore.init();
    currentMode = "device";
    return deviceStore;
  } catch {
    return null;
  }
}

/** Clear saved filesystem handle. */
export async function disconnectDevice(): Promise<void> {
  deviceStore = null;
  await clearHandle();
  if (currentMode === "device") currentMode = "browser";
}

/**
 * Refresh the Drive access token when the current one 401s.
 * Always goes through the visible "Sign in" banner — opening a
 * popup from a non-gesture code path (idle-tab gallery refresh,
 * handoff arrival, etc.) gets blocked
 * by Chrome's popup blocker, and in the typical 3rd-party-cookie-
 * blocked environment GIS's "silent" path ends up behaving the
 * same way anyway — it falls back to a popup that also gets
 * blocked, just with an extra 5-second wait and a "Failed to open
 * popup window" console line to show for it. Cutting the silent
 * attempt entirely gives a tighter, more predictable UX: every
 * 401 lands on the banner immediately, the user clicks "Sign in",
 * the OAuth popup opens on that gesture, and Drive resumes.
 *
 * Returns the new token, or `null` if the user dismissed the
 * banner. Registered on every `GoogleDriveStore` instance so
 * `#fetch` auto-retries `listImages`, `saveImage`, `updateImage`
 * etc. without each having to bolt on its own 401 handler.
 */
async function refreshDriveToken(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const settle = (token: string | null) => {
      if (settled) return;
      settled = true;
      hideError();
      resolve(token);
    };
    showAuthError(
      () => {
        // User-gesture path: the click on "Sign in" is what the
        // popup blocker is waiting for.
        signIn()
          .then((token) => settle(token))
          .catch(() => settle(null));
      },
      () => {
        // User dismissed the banner. Release the shared refresh
        // promise so subsequent Drive calls can queue a fresh
        // attempt instead of hanging on a never-resolved gate.
        settle(null);
      },
      { provider: "Google Drive" },
    );
  });
}

/** Connect to Google Drive with a selected root folder. */
export function connectGoogleDrive(token: string, rootFolderId: string): StorageProvider {
  driveStore = new GoogleDriveStore(token, rootFolderId);
  driveStore.setTokenRefresher(refreshDriveToken);
  currentMode = "googledrive";
  return driveStore;
}

/**
 * Try to re-establish the Drive connection from previously-persisted
 * token + root folder. Returns the store on success, or `null` if
 * either value is missing. The caller should fall back to the
 * sign-in + Picker flow when this returns `null`.
 *
 * Does NOT proactively validate the token with Drive — a stale token
 * will surface as a failed API call later. Keeping the cheaper path
 * (no network on boot) is worth the slightly worse error UX.
 */
export function restoreGoogleDrive(): StorageProvider | null {
  const token = getAccessToken();
  const root = loadDriveRoot();
  if (!token || !root) return null;
  return connectGoogleDrive(token, root.id);
}

/**
 * Refresh the GitHub PAT when the current one 401s. Unlike Drive
 * there's no silent refresh — the user has to paste a new PAT. The
 * callback surfaces the auth banner; clicking "Sign in" lazy-loads
 * `github-setup-ui.ts` and opens the PAT dialog. Returns the new
 * token, or `null` if the user dismissed the banner.
 *
 * Registered on every `GitHubStore` instance so the underlying
 * `#fetch` auto-retries on 401 without every call site bolting on
 * its own handler.
 */
async function refreshGithubToken(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const settle = (token: string | null) => {
      if (settled) return;
      settled = true;
      hideError();
      resolve(token);
    };
    showAuthError(
      async () => {
        try {
          // Lazy load the UI module so the main bundle doesn't carry
          // it when the user never signs into GitHub.
          const mod = await import("./github-setup-ui.js");
          // Opening the full connect flow is overkill for a refresh;
          // Phase 3 can swap this for a narrower "paste a new token"
          // dialog. For now the full flow re-validates repo access
          // too, which is defensible.
          const ref = await mod.connectGitHub();
          if (!ref) {
            settle(null);
            return;
          }
          // Re-read the token the UI just persisted.
          const newToken = getGitHubToken();
          if (!newToken) {
            settle(null);
            return;
          }
          if (githubStore) githubStore.setToken(newToken);
          settle(newToken);
        } catch {
          settle(null);
        }
      },
      () => settle(null),
      { provider: "GitHub" },
    );
  });
}

/** Connect to GitHub with a selected repo ref. */
export function connectGitHub(token: string, ref: GitHubRepoRef): StorageProvider {
  githubStore = new GitHubStore(token, ref);
  githubStore.setTokenRefresher(refreshGithubToken);
  githubStore.setRateLimitListener(({ remaining, resetAt }) => {
    // Advisory info banner; non-blocking. Fires at most once per
    // reset window (the store dedupes), so the user sees it when
    // they dip below the threshold and then it stays quiet until
    // GitHub's next hourly reset. Rate-limit information is
    // approximate — GitHub's per-minute rounding can nudge the
    // displayed reset time by up to a minute either way.
    const resetText = resetAt ? ` Resets at ${new Date(resetAt).toLocaleTimeString()}.` : "";
    showError({
      message:
        `GitHub API rate limit is low (${remaining} requests left).` +
        ` Consider pausing editing for a few minutes.${resetText}`,
      severity: "warning",
      autoDismiss: 12000,
    });
  });
  currentMode = "github";
  return githubStore;
}

/**
 * Try to re-establish the GitHub connection from persisted token +
 * repo ref. Returns the store on success, or `null` if either value
 * is missing. The caller should fall back to the PAT + picker flow
 * when this returns `null`.
 *
 * Does NOT proactively validate the token — a stale PAT surfaces as
 * a failed API call later, which routes through the 401 refresh
 * callback (same pattern as Drive).
 */
export function restoreGitHub(): StorageProvider | null {
  const token = getGitHubToken();
  const ref = loadGitHubRef();
  if (!token || !ref) return null;
  return connectGitHub(token, ref);
}

/** Get the connected repo ref (e.g. for the sidebar label). */
export function getGitHubRef(): GitHubRepoRef | null {
  if (currentMode !== "github") return null;
  return loadGitHubRef();
}

/** Forget the GitHub token + ref. Does not revoke on GitHub's side. */
export function disconnectGitHub(): void {
  githubStore = null;
  githubSignOut();
  clearGitHubRef();
  if (currentMode === "github") currentMode = "browser";
}

/** Check if GitHub is connected. */
export function isGitHubConnected(): boolean {
  return currentMode === "github" && githubStore !== null;
}

/** Delete an image from Extension IDB (cleanup after transfer). */
export async function deleteExtensionImage(path: string): Promise<void> {
  if (!extensionId) return;
  try {
    await sendToExtension(extensionId, { action: "deleteImage", path });
  } catch {
    /* ignore */
  }
}

/** Check if Google Drive is connected. */
export function isDriveConnected(): boolean {
  return currentMode === "googledrive" && driveStore !== null;
}

/** Get the root folder name of the connected filesystem store. */
export function getDeviceRootName(): string | null {
  return deviceStore?.rootName ?? null;
}

/** Check if extension is connected. */
export function isExtensionConnected(): boolean {
  return extensionAvailable === true;
}

/** Get current storage mode. */
export function getStorageMode(): StorageMode {
  return currentMode;
}

/** Save last selected storage mode to localStorage. */
export function saveLastStorage(mode: StorageMode): void {
  localStorage.setItem("annot-last-storage", mode);
}

/** Persist the last-viewed folder path so it can be restored on fresh tab load. */
export function saveLastFolder(folderPath: string): void {
  localStorage.setItem("annot-last-folder", folderPath);
}

export function loadLastFolder(): string {
  return localStorage.getItem("annot-last-folder") || "";
}

/** Load last selected storage mode from localStorage. */
export function loadLastStorage(): StorageMode | null {
  const mode = localStorage.getItem("annot-last-storage");
  if (
    mode === "browser" ||
    mode === "device" ||
    mode === "googledrive" ||
    mode === "github" ||
    mode === "extension"
  ) {
    return mode as StorageMode;
  }
  return null;
}

/**
 * StorageProvider proxy that forwards every call over chrome.runtime.sendMessage
 * to the extension's IDB. The extension must be connected (see setExtensionId).
 */
const extensionStorage: StorageProvider = {
  async saveImage(data) {
    return send({ action: "saveImage", data });
  },
  async getImage(path) {
    return send({ action: "getImage", path });
  },
  async listImages(folderPath) {
    return send({ action: "listImages", folderPath });
  },
  async updateImage(path, updates) {
    return send({ action: "updateImage", path, updates });
  },
  async renameImage(path, newName) {
    return send({ action: "renameImage", path, name: newName });
  },
  async deleteImage(path) {
    return send({ action: "deleteImage", path });
  },

  async createFolder(parentPath, name) {
    return send({ action: "createFolder", parentPath, name });
  },
  async listFolders(parentPath) {
    return send({ action: "listFolders", parentPath });
  },
  async getFolder(path) {
    return send({ action: "getFolder", path });
  },
  async renameFolder(path, name) {
    return send({ action: "renameFolder", path, name });
  },
  async moveFolder(path, newParentPath) {
    return send({ action: "moveFolder", path, newParentPath });
  },
  async deleteFolder(path) {
    return send({ action: "deleteFolder", path });
  },
  async getBreadcrumb(path) {
    return send({ action: "getBreadcrumb", path });
  },

  async generateThumbnail(dataUrl, maxWidth) {
    return getBrowserStore().generateThumbnail(dataUrl, maxWidth);
  },
};
