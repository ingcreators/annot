/// <reference path="../types/fs-access-extras.d.ts" />

/**
 * Extension API bridge — communicates with the Annot browser extension
 * (by ingcreators) via chrome.runtime.sendMessage to access its IndexedDB.
 *
 * Falls back to `BrowserStore` (IndexedDB in this origin) if the
 * extension is not installed.
 */
import type { StorageProvider } from "@ingcreators/annot-core/storage";
import { logger } from "../logger.js";
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

/**
 * Built-in backends bundled with `@ingcreators/annot-web`. Plugin
 * code can register additional modes alongside these via the
 * (Phase C) `PluginContext.registerStorage` API; once that lands,
 * `StorageMode` carries any of these strings PLUS plugin-supplied
 * ones, hence the type widening to plain `string` below.
 *
 * Consumers that need to know "is this a built-in?" should
 * iterate this array (or use `BuiltInStorageMode` for type narrowing
 * at the call site). Consumers that just need to compare modes can
 * keep using string literals — `"github"`, `"googledrive"`, etc.
 */
export const BUILT_IN_STORAGE_MODES = [
  "browser",
  "device",
  "googledrive",
  "github",
  "extension",
] as const;

export type BuiltInStorageMode = (typeof BUILT_IN_STORAGE_MODES)[number];

/**
 * A storage mode key. Kept open as `string` so plugin-registered
 * backends (Phase C of `docs/plans/_done/plugin-storage-registration.md`)
 * can introduce their own modes without editing every consumer.
 *
 * Use `BuiltInStorageMode` if you specifically need to refer only
 * to the bundled backends (sidebar layout assertions, the
 * `loadLastStorage` validator, etc.).
 */
export type StorageMode = string;

/**
 * State container for the bridge — collapses the per-backend
 * module-level globals into one object. Phase B of
 * `docs/plans/_done/plugin-storage-registration.md` extracts this so
 * Phase C's `StorageRegistry.registerPluginStore(mode, store)` has
 * a single owner of "what's currently active". The exported
 * functions below stay flat and just delegate, so callers don't
 * move.
 *
 * Extension-handshake state (`extensionId` / `extensionAvailable`)
 * lives here too even though it's not a built-in slot per se: the
 * lifecycle is the same (set once, persisted, read by `getStorage`)
 * and keeping it next to the other globals avoids two parallel
 * "module state" surfaces.
 */
class StorageRegistry {
  // Built-in slots. Named fields rather than a Map<mode, store>
  // because each is initialised on a different code path (Drive
  // and GitHub have their own connect functions; Browser has a
  // lazy fallback) and refer-back narrows correctly with the
  // concrete types.
  browserFallback: StorageProvider | null = null;
  driveStore: GoogleDriveStore | null = null;
  deviceStore: DeviceStore | null = null;
  githubStore: GitHubStore | null = null;
  currentMode: StorageMode = "browser";

  // Extension handshake.
  extensionId: string | null = null;
  /** `null` = haven't tried yet; `true`/`false` = cached probe result. */
  extensionAvailable: boolean | null = null;

  /** Plugin-registered stores keyed by mode. Phase C of
   *  `docs/plans/_done/plugin-storage-registration.md` populates this via
   *  `registerPluginStore`; the bridge's plugin-fallthrough branch
   *  in `app/storage-bridge.ts` reads it back. Empty when no
   *  storage plugins are loaded (the typical OSS case). */
  readonly pluginStores = new Map<string, StorageProvider>();

  /** Pick the active store given the current mode. Falls through
   *  to the plugin store map if the mode isn't a built-in. Returns
   *  `null` for "no concrete store yet" cases the caller (e.g.
   *  `getStorage`) handles (extension probe, browser fallback). */
  active(): StorageProvider | null {
    if (this.currentMode === "googledrive" && this.driveStore) return this.driveStore;
    if (this.currentMode === "github" && this.githubStore) return this.githubStore;
    if (this.currentMode === "device" && this.deviceStore) return this.deviceStore;
    const pluginStore = this.pluginStores.get(this.currentMode);
    if (pluginStore) return pluginStore;
    return null;
  }

  getBrowserStore(): StorageProvider {
    if (!this.browserFallback) this.browserFallback = new BrowserStore();
    return this.browserFallback;
  }

  /** Stash the active plugin-mode store so subsequent `active()` /
   *  `getStorage()` calls find it. Replaces any previous store for
   *  the same mode (fine — a re-`connect` is the supported way to
   *  recover from a session expiry).
   *
   *  Wraps the store's `thumbnailKey` (if present) to enforce the
   *  `plugin:<mode>:<plugin-defined>` namespace convention so two
   *  plugins can't accidentally collide on identical keys, and so
   *  plugins can't read or evict built-in (`browser:` / `device:` /
   *  `github:` / `googledrive:`) cache entries. The plugin author
   *  doesn't need to know about the prefix — they return whatever
   *  identifier is convenient (path, id, hash) and the host
   *  prepends. Plugin uninstall fires
   *  `ThumbnailManager.invalidatePrefix("plugin:<mode>:")` to
   *  cleanup. */
  registerPluginStore(mode: string, store: StorageProvider): void {
    this.pluginStores.set(mode, namespaceThumbnailKeys(mode, store));
  }
}

/**
 * If `store` implements `StorageWithThumbnailCache`, return a
 * proxy that prepends `plugin:<mode>:` to whatever key the store's
 * `thumbnailKey` returns (idempotent — already-prefixed keys pass
 * through unchanged). Returns the store untouched when it doesn't
 * participate.
 */
function namespaceThumbnailKeys(mode: string, store: StorageProvider): StorageProvider {
  const target = store as StorageProvider & {
    thumbnailKey?: (path: string) => string | undefined;
  };
  const tk = target.thumbnailKey;
  if (typeof tk !== "function") return store;
  const prefix = `plugin:${mode}:`;
  // We mutate the store's `thumbnailKey` in place rather than
  // creating a wrapping Proxy: the rest of the storage interface
  // (24+ async methods) shouldn't pay a per-call function-table
  // hop, and the wrap is one-shot at registration time so identity
  // preservation isn't a concern.
  const original = tk.bind(store);
  target.thumbnailKey = (path) => {
    const raw = original(path);
    if (!raw) return raw;
    if (raw.startsWith(prefix)) return raw;
    return `${prefix}${raw}`;
  };
  return store;
}

const registry = new StorageRegistry();

function hasChromeRuntime(): boolean {
  return (
    typeof chrome !== "undefined" &&
    typeof chrome.runtime !== "undefined" &&
    typeof chrome.runtime.sendMessage === "function"
  );
}

/** Try to detect extension by sending a ping. */
async function detectExtension(): Promise<boolean> {
  if (registry.extensionAvailable !== null) return registry.extensionAvailable;

  if (!hasChromeRuntime()) {
    logger.debug("[bridge] chrome.runtime not available — using local storage");
    registry.extensionAvailable = false;
    return false;
  }

  const ids = getExtensionIds();
  if (ids.length === 0) {
    logger.debug("[bridge] No extension ID configured — using local storage");
    registry.extensionAvailable = false;
    return false;
  }

  for (const id of ids) {
    try {
      logger.debug(`[bridge] Pinging extension ${id}...`);
      const resp = await sendToExtension(id, { action: "ping" });
      logger.debug("[bridge] Ping response:", resp);
      if (resp?.ok) {
        registry.extensionId = id;
        registry.extensionAvailable = true;
        logger.debug("[bridge] Connected to extension!");
        return true;
      }
    } catch (e) {
      logger.warn("[bridge] Ping failed:", e);
    }
  }

  registry.extensionAvailable = false;
  return false;
}

function getExtensionIds(): string[] {
  const stored = localStorage.getItem("annot-extension-id");
  if (stored) return [stored];
  return [];
}

/**
 * Cross-extension `chrome.runtime.sendMessage` IPC. The boundary is
 * fundamentally untyped — the Chrome runtime delivers an opaque JSON
 * object to a service worker we don't statically know the shape of.
 * Both `msg` and the response stay `any` here; the per-method
 * `extensionStorage` adapter below trusts each return shape via the
 * surrounding `StorageProvider` contract, and the 165-line shared
 * contract test suite is the actual regression net for shape drift.
 *
 * Tightening these to a discriminated union would require enumerating
 * every action / response pair AND would conflict with the
 * `chrome.runtime.sendMessage` overload signature, which the Chrome
 * types package still pins to `message: any`.
 */
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
  if (registry.extensionId) {
    return sendToExtension(registry.extensionId, msg);
  }
  throw new Error("Extension not connected");
}

// ---- Public API ----

export async function getStorage(): Promise<StorageProvider> {
  const active = registry.active();
  if (active) return active;
  const hasExtension = await detectExtension();
  if (hasExtension) {
    registry.currentMode = "extension";
    return extensionStorage;
  }
  registry.currentMode = "browser";
  return registry.getBrowserStore();
}

/** Set extension ID and try to connect. Optionally set mode. Returns true if connected. */
export async function setExtensionId(id: string, mode?: StorageMode): Promise<boolean> {
  localStorage.setItem("annot-extension-id", id);
  registry.extensionId = null;
  registry.extensionAvailable = null;
  const ok = await detectExtension();
  if (ok) {
    registry.currentMode = mode || "extension";
  }
  return ok;
}

export function setStorageMode(mode: StorageMode): void {
  registry.currentMode = mode;
}

/** Open a local directory and switch to filesystem storage. */
export async function openDeviceDirectory(): Promise<StorageProvider | null> {
  if (!window.showDirectoryPicker) return null;
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    await saveHandle(dirHandle);
    const store = new DeviceStore(dirHandle);
    await store.init();
    registry.deviceStore = store;
    registry.currentMode = "device";
    return store;
  } catch {
    return null;
  }
}

/** Restore previously selected filesystem folder from IndexedDB. */
export async function restoreDevice(): Promise<StorageProvider | null> {
  try {
    const handle = await loadHandle();
    if (!handle) return null;

    const perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      const req = await handle.requestPermission({ mode: "readwrite" });
      if (req !== "granted") return null;
    }

    const store = new DeviceStore(handle);
    await store.init();
    registry.deviceStore = store;
    registry.currentMode = "device";
    return store;
  } catch {
    return null;
  }
}

/** Clear saved filesystem handle. */
export async function disconnectDevice(): Promise<void> {
  registry.deviceStore = null;
  await clearHandle();
  if (registry.currentMode === "device") registry.currentMode = "browser";
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
  const store = new GoogleDriveStore(token, rootFolderId);
  store.setTokenRefresher(refreshDriveToken);
  registry.driveStore = store;
  registry.currentMode = "googledrive";
  return store;
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
          if (registry.githubStore) registry.githubStore.setToken(newToken);
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
  const store = new GitHubStore(token, ref);
  store.setTokenRefresher(refreshGithubToken);
  store.setRateLimitListener(({ remaining, resetAt }) => {
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
  registry.githubStore = store;
  registry.currentMode = "github";
  return store;
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
  if (registry.currentMode !== "github") return null;
  return loadGitHubRef();
}

/** Forget the GitHub token + ref. Does not revoke on GitHub's side. */
export function disconnectGitHub(): void {
  registry.githubStore = null;
  githubSignOut();
  clearGitHubRef();
  if (registry.currentMode === "github") registry.currentMode = "browser";
}

/** Check if GitHub is connected. */
export function isGitHubConnected(): boolean {
  return registry.currentMode === "github" && registry.githubStore !== null;
}

/** Delete an image from Extension IDB (cleanup after transfer). */
export async function deleteExtensionImage(path: string): Promise<void> {
  if (!registry.extensionId) return;
  try {
    await sendToExtension(registry.extensionId, { action: "deleteImage", path });
  } catch {
    /* ignore */
  }
}

/** Check if Google Drive is connected. */
export function isDriveConnected(): boolean {
  return registry.currentMode === "googledrive" && registry.driveStore !== null;
}

/** Get the root folder name of the connected filesystem store. */
export function getDeviceRootName(): string | null {
  return registry.deviceStore?.rootName ?? null;
}

/** Check if extension is connected. */
export function isExtensionConnected(): boolean {
  return registry.extensionAvailable === true;
}

/** Get current storage mode. */
export function getStorageMode(): StorageMode {
  return registry.currentMode;
}

/**
 * Plugin-mode registration entry point — set the active store for a
 * plugin-registered mode and switch the bridge to it. Used by
 * `app/storage-bridge.ts`'s `handleStorageSelect` /
 * `restoreOnBoot` plugin-fallthrough branches once they've called
 * the plugin's `connect` / `restore` factory.
 */
export function setPluginStore(mode: StorageMode, store: StorageProvider): void {
  registry.registerPluginStore(mode, store);
  registry.currentMode = mode;
}

/** True if the active mode is a plugin-registered one (i.e. not a
 *  built-in). Used by the storage-bridge collaborator to decide
 *  whether to take the plugin-fallthrough path on boot rehydrate. */
export function isPluginMode(mode: StorageMode): boolean {
  return !(BUILT_IN_STORAGE_MODES as readonly string[]).includes(mode);
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

/** Load last selected storage mode from localStorage. Returns
 *  whatever non-empty string is stored — built-in or plugin mode.
 *  The caller (`app/storage-bridge.ts:restoreOnBoot`) is responsible
 *  for validating it against the active built-in set + plugin
 *  registry; an unrecognised mode triggers the browser fallback,
 *  matching the behaviour for "device handle revoked". */
export function loadLastStorage(): StorageMode | null {
  const mode = localStorage.getItem("annot-last-storage");
  return mode || null;
}

/**
 * StorageProvider proxy that forwards every call over chrome.runtime.sendMessage
 * to the extension's IDB. The extension must be connected (see setExtensionId).
 */
const extensionStorage: StorageProvider = {
  async saveImage(data, opts) {
    return send({ action: "saveImage", data, opts });
  },
  async getImage(path) {
    return send({ action: "getImage", path });
  },
  async listImages(folderPath) {
    return send({ action: "listImages", folderPath });
  },
  async updateImage(path, updates) {
    await send({ action: "updateImage", path, updates });
  },
  async moveImage(path, newFolderPath) {
    return send({ action: "moveImage", path, newFolderPath });
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
};
// (Thumbnail generation is now a free function — see
//  `image-thumbnail.ts`'s `generateThumbnailFromDataUrl`. Callers
//  that previously did `storage.generateThumbnail(...)` import the
//  helper directly.)
