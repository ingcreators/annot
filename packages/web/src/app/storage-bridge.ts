/**
 * Storage bridge (app-side) — owns which `StorageProvider` is active,
 * the boot-time restore logic, the mode-switch wizard, the sidebar
 * status strip, and the `currentRootName` label.
 *
 * Extracted from `app.ts` as part of the Phase 3 decomposition
 * (see `docs/plans/app-decomposition.md`). This class collects the
 * app-level state that the old module-level `./storage/bridge.ts`
 * globals don't know about: the `#deviceStore` cache, the "last
 * selected mode" rehydration on boot, and the UI wiring that keeps
 * the sidebar's status chips in sync with real connection state.
 *
 * The module-level `./storage/bridge.ts` is still the one place that
 * tracks the *current* storage mode string + extension-id + token
 * refreshers; that's imported by many callers and not in scope to
 * rename in this phase.
 */

import type { StorageProvider } from "@ingcreators/annot-core/storage";
import type { FileManager } from "../gallery/file-manager.js";
import {
  BUILT_IN_STORAGE_MODES,
  connectGitHub,
  connectGoogleDrive,
  getDeviceRootName,
  getGitHubRef,
  getStorageMode,
  isDriveConnected,
  isGitHubConnected,
  loadLastStorage,
  openDeviceDirectory,
  restoreDevice,
  restoreGitHub,
  restoreGoogleDrive,
  saveLastStorage,
  setPluginStore,
  setStorageMode,
  type StorageMode,
} from "../storage/bridge.js";
import {
  type GitHubRepoRef,
  getAccessToken as getGitHubToken,
  isSignedIn as isGitHubSignedIn,
  loadRepoRef as loadGitHubRef,
} from "../storage/github-auth.js";
import { loadDriveRoot, saveDriveRoot, showFolderPicker, signIn } from "../storage/google-auth.js";
import { showError } from "../ui/error-bar.js";
import type { StorageRegistration } from "./plugin-host.js";

export interface StorageBridgeDeps {
  getFileManager(): FileManager | null;
  /** Look up a plugin-registered storage mode. Returns `undefined`
   *  if the mode is built-in or no plugin matches. */
  findPluginStorage(mode: string): StorageRegistration | undefined;
  /** All plugin-registered storage modes. Used when refreshing the
   *  sidebar status strip so plugin chips reflect the latest
   *  `connected` / `label` state. */
  listPluginStorages(): StorageRegistration[];
  /** Set of built-in modes the caller has opted out of via
   *  `App.init({ disableBuiltinStorage })`. Disabled built-ins
   *  short-circuit `handleStorageSelect` and `restoreOnBoot`. */
  isBuiltinDisabled(mode: string): boolean;
}

export class StorageBridge {
  #storage: StorageProvider | null = null;
  /** Cached Device store so a later "switch to Device" in the sidebar
   *  reuses the previously-granted handle without re-prompting. */
  #deviceStore: StorageProvider | null = null;

  constructor(private readonly deps: StorageBridgeDeps) {}

  getStorage(): StorageProvider | null {
    return this.#storage;
  }

  setStorage(storage: StorageProvider): void {
    this.#storage = storage;
  }

  getDeviceStore(): StorageProvider | null {
    return this.#deviceStore;
  }

  /**
   * Boot-time rehydration: silently restore the device handle if
   * previously granted, then pick up whichever storage the user was
   * last using. Returns the `BrowserStore` fallback so `App.init`
   * keeps a concrete reference for later transient operations.
   */
  async restoreOnBoot(browserStore: StorageProvider): Promise<void> {
    this.#storage = browserStore;
    setStorageMode("browser");

    // Silently restore the filesystem handle if previously granted — this only
    // populates #deviceStore so the user can switch to Device without re-picking.
    // It must NOT override the user's last-selected storage mode (and skip
    // entirely if the deployment opted Device out).
    if (!this.deps.isBuiltinDisabled("device")) {
      const restored = await restoreDevice();
      if (restored) {
        this.#deviceStore = restored;
      }
    }

    // Respect the user's last-selected storage across reloads.
    const lastMode = loadLastStorage();
    // Disabled built-ins fall through to the browser default — same
    // behaviour as "device handle revoked" / "drive token expired".
    if (lastMode && this.deps.isBuiltinDisabled(lastMode)) {
      this.#storage = browserStore;
      setStorageMode("browser");
      return;
    }
    if (lastMode === "device" && this.#deviceStore) {
      this.#storage = this.#deviceStore;
      setStorageMode("device");
    } else if (lastMode === "googledrive") {
      // If we have a persisted OAuth token AND a previously-picked
      // root folder, rehydrate the Drive store without prompting. A
      // stale token will surface as a failed API call later; users
      // can then re-select Drive to re-auth.
      const driveStore = restoreGoogleDrive();
      if (driveStore) {
        this.#storage = driveStore;
        setStorageMode("googledrive");
        // No boot-time root verification: under `drive.file` a
        // re-authorized session legitimately loses `files.get`
        // access to the previously-picked folder even when the
        // files INSIDE that folder are still fully usable (since
        // they're app-created and stay in scope). The gallery's
        // list queries work, saves work — but `files.get(rootId)`
        // 404s, which misfired as an "isn't accessible" banner
        // every page load. Real folder-loss scenarios (different
        // account, trashed root) still surface through operation
        // errors.
      } else {
        this.#storage = browserStore;
        setStorageMode("browser");
      }
    } else if (lastMode === "github") {
      // Same shape as Drive's restore: token + ref in localStorage
      // → instantiate the GitHubStore without prompting. Expired
      // PATs surface as a 401 on the first real API call, which
      // routes through the bridge's `refreshGithubToken` banner.
      const githubStore = restoreGitHub();
      if (githubStore) {
        this.#storage = githubStore;
        setStorageMode("github");
      } else {
        this.#storage = browserStore;
        setStorageMode("browser");
      }
    } else if (lastMode && !(BUILT_IN_STORAGE_MODES as readonly string[]).includes(lastMode)) {
      // Plugin-registered mode rehydrate. The plugin's `restore`
      // factory does the same "no network on boot" cheap rehydrate
      // that the built-in `restoreGoogleDrive` / `restoreGitHub`
      // do — returning `null` falls back to the browser store the
      // same way as a stale Drive session.
      const reg = this.deps.findPluginStorage(lastMode);
      const pluginStore = reg?.restore() ?? null;
      if (pluginStore) {
        this.#storage = pluginStore;
        setPluginStore(lastMode, pluginStore);
      } else {
        this.#storage = browserStore;
        setStorageMode("browser");
      }
    } else {
      // Default / "browser" / everything else → Browser (BrowserStore)
      this.#storage = browserStore;
      setStorageMode("browser");
    }
  }

  /**
   * Click-to-switch: if already connected, reuse the existing storage.
   * `forcePicker = true` is the sidebar's "reselect" icon — force a
   * fresh picker / account prompt.
   *
   * Returns `true` if the switch committed (storage changed, last-mode
   * persisted) so the caller knows to clear the folder path + refresh
   * the gallery. Returns `false` when the user cancelled the picker or
   * a connection failed; the caller then leaves the existing storage
   * untouched.
   */
  async handleStorageSelect(mode: StorageMode, forcePicker = false): Promise<boolean> {
    // Refuse to switch into a disabled built-in. The sidebar
    // shouldn't even render the chip in that case (Phase C of
    // plugin-storage-registration filters the chip list), so
    // this is a defence-in-depth check for callers reaching the
    // bridge through other paths (Drive handoff URL, etc.).
    if (this.deps.isBuiltinDisabled(mode)) {
      console.warn(`[storage-bridge] mode "${mode}" is disabled; ignoring select.`);
      return false;
    }
    try {
      if (mode === "browser") {
        const { BrowserStore } = await import("../storage/browser-store.js");
        this.#storage = new BrowserStore();
        setStorageMode("browser");
        saveLastStorage("browser");
      } else if (mode === "device") {
        if (!forcePicker && this.#deviceStore) {
          // Reuse the previously selected folder
          this.#storage = this.#deviceStore;
          setStorageMode("device");
          saveLastStorage("device");
        } else {
          const store = await openDeviceDirectory();
          if (!store) return false;
          this.#deviceStore = store;
          this.#storage = store;
          saveLastStorage("device");
        }
      } else if (mode === "googledrive") {
        try {
          // `forcePicker` means the user came in via the sidebar's
          // reselect icon ("Change Drive folder"). Escalate that
          // into Google's `select_account` prompt too so the user
          // can pick a different Google account in the same gesture
          // — without it, GIS silently reuses the last-used account
          // and there's no visible path to switch. Mirrors the
          // GitHub setup dialog's "Use a different personal access
          // token" escape hatch.
          const token = await signIn({ forceAccountPicker: forcePicker });
          // Reuse the previously-picked root when available — under
          // `drive.file` that picker result is the app's only handle
          // onto the user's Drive, so skipping the picker here just
          // skips an extra click, not an access grant.
          let folder = forcePicker ? null : loadDriveRoot();
          if (!folder) {
            folder = await showFolderPicker();
            if (!folder) return false;
            saveDriveRoot(folder);
          }
          const store = connectGoogleDrive(token, folder.id);
          this.#storage = store;
          saveLastStorage("googledrive");
        } catch (e) {
          console.error("[app] Drive connection failed:", e);
          return false;
        }
      } else if (mode === "github") {
        // First-click: if we already have a persisted PAT + ref,
        // rehydrate without prompting. Reselect / no ref → open the
        // reconfigure menu so the user can change just the piece
        // they care about (repo / branch / base path) instead of
        // walking the full connect wizard every time.
        let ref: GitHubRepoRef | null = loadGitHubRef();
        const needsConnect = !ref || !isGitHubSignedIn();
        if (needsConnect) {
          // First connect or session expired → full wizard.
          const { connectGitHub: runConnect } = await import("../storage/github-setup-ui.js");
          ref = await runConnect();
          if (!ref) return false;
        } else if (forcePicker) {
          // Reselect click. `needsConnect` is false so `ref` is
          // non-null, but TS can't narrow across the branch, so we
          // assert. The menu lets the user target a single
          // dimension (branch switch is the common "I want to
          // check another feature branch" case and used to require
          // redoing the whole wizard).
          const { showReconfigureMenu } = await import("../storage/github-setup-ui.js");
          const updated = await showReconfigureMenu(ref as GitHubRepoRef);
          if (!updated) return false; // cancelled or no change
          ref = updated;
        }
        const token = getGitHubToken();
        if (!token) {
          showError({
            message: "GitHub sign-in is required. Please try again.",
            severity: "warning",
          });
          return false;
        }
        const store = connectGitHub(token, ref!);
        this.#storage = store;
        saveLastStorage("github");
      } else {
        // Plugin-registered mode. The plugin owns the picker UX +
        // any token / handshake; the bridge just stashes the
        // resulting store and persists the mode for next reload.
        const reg = this.deps.findPluginStorage(mode);
        if (!reg) {
          console.warn(
            `[storage-bridge] no plugin or built-in registered for mode "${mode}".`,
          );
          return false;
        }
        const store = await reg.connect({ forcePicker });
        if (!store) return false;
        this.#storage = store;
        setPluginStore(mode, store);
        saveLastStorage(mode);
      }
      return true;
    } catch (e) {
      console.error("[app] Storage switch error:", e);
      return false;
    }
  }

  /**
   * Display name for the root of the currently-active storage.
   * Shown under the top-level FOLDERS node in the sidebar so the
   * user sees WHICH device folder / Drive folder is in use. Null
   * when the backend has no meaningful user-facing root (e.g.
   * Browser/Local stores to per-origin IDB).
   */
  currentRootName(): string | undefined {
    const mode = getStorageMode();
    if (mode === "device") return getDeviceRootName() || undefined;
    if (mode === "googledrive") return loadDriveRoot()?.name;
    if (mode === "github") {
      const ref = getGitHubRef();
      if (!ref) return undefined;
      // Show `owner/repo` with optional basePath + branch qualifier
      // so the sidebar subtitle conveys all three dimensions without
      // a second row.
      const base = ref.basePath ? `/${ref.basePath}` : "";
      return `${ref.owner}/${ref.repo}${base}@${ref.branch}`;
    }
    // Plugin-registered mode — use the registration's own status
    // label as the sidebar subtitle (mirrors what built-ins surface
    // for "Connected ← drive root name / repo ref").
    const reg = this.deps.findPluginStorage(mode);
    return reg?.status().label;
  }

  /** Refresh the sidebar's per-backend connected / label state. No-op
   *  when the file manager isn't mounted (i.e. mid-editor session). */
  updateSidebarStatus(activeMode: StorageMode): void {
    const fm = this.deps.getFileManager();
    if (!fm) return;
    const sidebar = fm.sidebar;
    sidebar.setStorageStatus("browser", true, "Local");
    sidebar.setStorageStatus(
      "device",
      !!this.#deviceStore,
      getDeviceRootName() || "Not connected",
    );
    const driveRoot = loadDriveRoot();
    sidebar.setStorageStatus(
      "googledrive",
      isDriveConnected(),
      isDriveConnected() ? (driveRoot?.name ?? "Connected") : "Not connected",
    );
    const ghRef = getGitHubRef();
    sidebar.setStorageStatus(
      "github",
      isGitHubConnected(),
      isGitHubConnected()
        ? ghRef
          ? `${ghRef.owner}/${ghRef.repo}@${ghRef.branch}`
          : "Connected"
        : "Not connected",
    );
    // Plugin chips report their own connected / label state.
    for (const reg of this.deps.listPluginStorages()) {
      const s = reg.status();
      sidebar.setStorageStatus(reg.mode, s.connected, s.label);
    }
    sidebar.setActiveMode(activeMode);
  }
}
