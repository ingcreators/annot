/**
 * Plugin host — the stable extension surface for `@ingcreators/annot-web`.
 *
 * Phase 4 of the app.ts decomposition plan
 * (see `docs/plans/app-decomposition.md`). The plugin API is the key
 * enabler for the `annot-cloud` carve-out: Cloud-specific features
 * (team library, per-image comment threads, pointer-commit storage)
 * land as plugins on top of OSS `packages/web`, not as a fork of
 * `AnnotApp`.
 *
 * ## Design invariants
 *
 * - **Observer, not mutator.** `PluginContext` only lets plugins
 *   register listeners / contribute items to well-defined extension
 *   points. There's no `getState()` / `setState()` surface and no
 *   back-reference to `AnnotApp`. This keeps the OSS ↔ Cloud
 *   boundary clean: Cloud can observe and extend, never rewrite.
 * - **Synchronous registration, event-based dispatch.** `register()`
 *   runs once at `AnnotApp.init()` and is expected to complete
 *   synchronously (callbacks themselves can do async work). No
 *   plugin ever blocks the main flow — `dispatchAfterSave` etc.
 *   fire-and-forget into registered listeners.
 * - **Listener errors are isolated.** A plugin that throws in an
 *   `onAfterSave` handler doesn't prevent other plugins from
 *   receiving the event, and doesn't bubble into Annot's own save
 *   path. Errors are `console.error`-logged with the event name so
 *   they're debuggable.
 *
 * ## MVP scope (Phase 4) + Phase 5 additions
 *
 * Shipped:
 *
 * 1. `addExternalLinkSource` — drives the drawer's "External links"
 *    section. The built-in `github-external-links` plugin is the
 *    reference implementation (moved out of `HeaderHost`).
 * 2. `onAfterSave` / `onEditorReady` / `onRouteChange` — fire-and-
 *    forget lifecycle events carried into `SavePipeline`,
 *    `EditorSession`, and `RouterHost` respectively.
 * 3. `onBeforeSave` — added in Phase 5 with cancellation semantics
 *    (a listener throw cancels the save and routes through the
 *    existing error banner). Unlocks `annot-cloud`'s "server
 *    validates before a commit lands" path without a fork.
 *
 * Deferred follow-ups (tracked in
 * `docs/plans/app-decomposition.md` — Phase 5 gate):
 *
 * - `registerStorage` — needs a reshape of `./storage/bridge.ts`.
 * - Sidebar-tab injection — needs a `FileManager`/`Sidebar` API
 *   review.
 * - Drawer-section + right-panel-section injection — needs shared
 *   "UI slot" shape across both surfaces.
 */

import type { StorageProvider } from "@ingcreators/annot-core/storage";
import { BUILT_IN_STORAGE_MODES } from "../storage/bridge.js";

export type ExternalLink = { label: string; url: string; icon?: string };

/** A contributor function invoked each time the drawer rebuilds its
 *  "External links" section for an open image. Returns zero or more
 *  links to append. Receives the current storage backend so plugins
 *  that only apply to one backend can type-guard (`instanceof`) and
 *  no-op for other backends. */
export type ExternalLinkSource = (
  path: string,
  storage: StorageProvider | null,
) => ExternalLink[] | undefined;

export interface EditorReadyEvent {
  path: string | null;
  tags: Record<string, string>;
}

export interface BeforeSaveEvent {
  path: string;
  mode: string;
  /** Tags snapshot that's about to be written. Listeners may read
   *  but must NOT mutate; the real payload goes through the SavePipeline
   *  getter chain and a mid-flight mutation here desyncs that. */
  readonly tags: Record<string, string>;
}

export interface AfterSaveEvent {
  path: string;
  mode: string;
}

export interface RouteChangeEvent {
  /** `parseRoute()`'s return value, forwarded verbatim. Plugins that
   *  care about the exact shape should import `parseRoute` from
   *  `./router.js` for its types. */
  route: unknown;
}

/**
 * Storage backend descriptor — used by both built-ins and plugins.
 *
 * Built-ins describe themselves via internal const instances inside
 * `storage/bridge.ts` (with `connect` / `restore` wrapping the
 * existing per-backend functions). Plugins fill the same shape from
 * `PluginContext.registerStorage`. The sidebar takes the combined
 * sorted list and renders chips; the bridge consults the same list
 * for `handleStorageSelect` / `restoreOnBoot` fallthrough on
 * non-built-in modes.
 */
export interface StorageRegistration {
  /** Mode key. Must not collide with another registration's mode.
   *  Built-ins reserve `"browser"` / `"device"` / `"googledrive"` /
   *  `"github"` / `"extension"`. */
  readonly mode: string;
  /** Sidebar chip label (visible to the user). */
  readonly label: string;
  /** Material-symbols icon name (e.g. `"database"`, `"hub"`). */
  readonly icon?: string;
  /** Sidebar order. Lower numbers render first. Built-ins reserve
   *  Browser=10, Device=20, Drive=30, GitHub=40. Plugins choose any
   *  number; missing / falsy = `+Infinity` (appended last). Stable
   *  sort, so ties fall back to registration order. */
  readonly priority: number;
  /** Optional: hide the chip if false. Used by the Device built-in
   *  to gate on `showDirectoryPicker` API availability; plugins can
   *  use it to hide their chip on platforms they don't support. */
  visible?(): boolean;
  /** Optional tooltip on the "change" / "reselect" icon shown next
   *  to a connected chip. Drive uses "Change Drive folder", GitHub
   *  uses "Change repository". When omitted, the reselect icon is
   *  not rendered. */
  readonly reselectTitle?: string;
  /** Build the live `StorageProvider`. Called from
   *  `handleStorageSelect`. May return `null` if the user cancelled
   *  a picker or a connection failed. */
  connect(opts: { forcePicker: boolean }): Promise<StorageProvider | null>;
  /** Cheap rehydrate from persisted state without prompting. Returns
   *  `null` if a persisted session can't be reopened — the bridge
   *  falls back to `BrowserStore`. */
  restore(): StorageProvider | null;
  /** Connection state for the sidebar status strip. `label` is the
   *  subtitle ("owner/repo@branch", "My Drive folder", etc.). */
  status(): { connected: boolean; label?: string };
}

/**
 * A plugin exposes a single `register` entry point that wires itself
 * into the host. `ctx` is constructed once per app init and frozen
 * after `register()` returns so plugins can't hold onto it and keep
 * adding listeners from random call sites.
 */
export interface AnnotPlugin {
  /** Human-readable name, shown in console diagnostic messages. */
  readonly name: string;
  register(ctx: PluginContext): void;
}

export interface PluginContext {
  /** Register a contributor for the drawer's "External links"
   *  section. Called each time the drawer rebuilds (per editor
   *  session + after every rename). */
  addExternalLinkSource(source: ExternalLinkSource): void;

  /** Run `fn` just after the editor has loaded an image, once the
   *  canvas + history are wired but before the first `onStateChange`
   *  fires. Use this to patch the right panel, inject toolbar items,
   *  pre-load metadata, etc. */
  onEditorReady(fn: (ev: EditorReadyEvent) => void): void;

  /** Run `fn` before a save hits storage. Listeners are awaited
   *  sequentially; a listener that throws (or returns a rejecting
   *  Promise) cancels the save — the save-status indicator goes to
   *  `error` and the exception propagates to the SavePipeline's
   *  existing error-handling path. Use for server-side validation
   *  (Cloud: comment-thread cross-check) or to block saves while a
   *  CRDT/presence handshake is in flight. */
  onBeforeSave(fn: (ev: BeforeSaveEvent) => void | Promise<void>): void;

  /** Run `fn` after a save lands successfully. Gets the final path
   *  (post-rename / post-move) and the storage mode. */
  onAfterSave(fn: (ev: AfterSaveEvent) => void): void;

  /** Run `fn` when the router finishes parsing + dispatching a new
   *  URL. Fires before the per-route collaborator (editor / split /
   *  gallery) takes over, so a plugin that wants to veto a route
   *  can't — that's deliberate for MVP. */
  onRouteChange(fn: (ev: RouteChangeEvent) => void): void;

  /** Register a custom storage backend. The mode key must be unique
   *  across built-ins (`"browser"` / `"device"` / `"googledrive"` /
   *  `"github"` / `"extension"`) and previously-registered plugins;
   *  duplicates throw at registration time so misconfigurations
   *  surface immediately. Use a non-built-in `priority` (>40) to
   *  append after the built-ins, or interleave at e.g. 25 to land
   *  between Device and Drive. */
  registerStorage(reg: StorageRegistration): void;
}

export class PluginHost {
  readonly #externalLinkSources: ExternalLinkSource[] = [];
  readonly #editorReadyListeners: Array<(ev: EditorReadyEvent) => void> = [];
  readonly #beforeSaveListeners: Array<
    (ev: BeforeSaveEvent) => void | Promise<void>
  > = [];
  readonly #afterSaveListeners: Array<(ev: AfterSaveEvent) => void> = [];
  readonly #routeChangeListeners: Array<(ev: RouteChangeEvent) => void> = [];
  readonly #storageRegistrations = new Map<string, StorageRegistration>();

  /**
   * Register every plugin in `plugins`. Called once from
   * `AnnotApp.init`. After this returns, the listener arrays are
   * effectively read-only — plugins that try to register more via
   * a stale `ctx` reference will no-op (the context passed in is
   * freshly made per call; nothing keeps it alive).
   */
  registerAll(plugins: AnnotPlugin[]): void {
    for (const plugin of plugins) {
      const ctx = this.#makeContext(plugin.name);
      try {
        plugin.register(ctx);
      } catch (e) {
        console.error(`[plugin-host] "${plugin.name}" threw during register():`, e);
      }
    }
  }

  /** Collect all external-link contributions for `path`. Callers
   *  (HeaderHost, EditorSession's drawer builder) fold this into the
   *  drawer's `externalLinks` field. */
  collectExternalLinks(
    path: string | null,
    storage: StorageProvider | null,
  ): ExternalLink[] | undefined {
    if (!path) return undefined;
    const all: ExternalLink[] = [];
    for (const source of this.#externalLinkSources) {
      try {
        const links = source(path, storage);
        if (links?.length) all.push(...links);
      } catch (e) {
        console.error("[plugin-host] external-link source threw:", e);
      }
    }
    return all.length > 0 ? all : undefined;
  }

  dispatchEditorReady(ev: EditorReadyEvent): void {
    for (const fn of this.#editorReadyListeners) {
      try {
        fn(ev);
      } catch (e) {
        console.error("[plugin-host] onEditorReady listener threw:", e);
      }
    }
  }

  /**
   * Run every `onBeforeSave` listener in order. If any throws (or
   * returns a rejecting Promise), the save is cancelled — the error
   * propagates so the SavePipeline's existing error-handling path
   * surfaces the "save failed" banner instead of swallowing it.
   *
   * Unlike `dispatchAfterSave` / `dispatchRouteChange`, listener
   * errors here are NOT isolated: a `onBeforeSave` throw is the
   * intended cancel signal, and silently swallowing it would defeat
   * the purpose. Plugins that need fire-and-forget "about to save"
   * notifications should use `onAfterSave` instead.
   */
  async dispatchBeforeSave(ev: BeforeSaveEvent): Promise<void> {
    for (const fn of this.#beforeSaveListeners) {
      await fn(ev);
    }
  }

  dispatchAfterSave(ev: AfterSaveEvent): void {
    for (const fn of this.#afterSaveListeners) {
      try {
        fn(ev);
      } catch (e) {
        console.error("[plugin-host] onAfterSave listener threw:", e);
      }
    }
  }

  dispatchRouteChange(ev: RouteChangeEvent): void {
    for (const fn of this.#routeChangeListeners) {
      try {
        fn(ev);
      } catch (e) {
        console.error("[plugin-host] onRouteChange listener threw:", e);
      }
    }
  }

  /** Look up a plugin-registered storage by its mode key. Returns
   *  `undefined` for built-in or unknown modes — the bridge handles
   *  built-ins separately, and unknown is the silent-fallback
   *  case for "user's persisted last-mode is from a plugin that
   *  isn't loaded this session". */
  findStorageRegistration(mode: string): StorageRegistration | undefined {
    return this.#storageRegistrations.get(mode);
  }

  /** Snapshot the registered list (in registration order). The
   *  caller composes this with built-in registrations and sorts by
   *  `priority` for sidebar render. */
  listStorageRegistrations(): StorageRegistration[] {
    return Array.from(this.#storageRegistrations.values());
  }

  #makeContext(_pluginName: string): PluginContext {
    // Capture references — a plugin could stash `ctx` and call these
    // later, which is fine: the underlying arrays live on the host
    // for the lifetime of the app.
    return Object.freeze({
      addExternalLinkSource: (source) => {
        this.#externalLinkSources.push(source);
      },
      onEditorReady: (fn) => {
        this.#editorReadyListeners.push(fn);
      },
      onBeforeSave: (fn) => {
        this.#beforeSaveListeners.push(fn);
      },
      onAfterSave: (fn) => {
        this.#afterSaveListeners.push(fn);
      },
      onRouteChange: (fn) => {
        this.#routeChangeListeners.push(fn);
      },
      registerStorage: (reg) => {
        if ((BUILT_IN_STORAGE_MODES as readonly string[]).includes(reg.mode)) {
          throw new Error(
            `[plugin-host] storage mode "${reg.mode}" collides with a built-in. ` +
              "Pick a different mode key (e.g. \"cloud\", \"team-library\").",
          );
        }
        if (this.#storageRegistrations.has(reg.mode)) {
          throw new Error(
            `[plugin-host] storage mode "${reg.mode}" is already registered.`,
          );
        }
        this.#storageRegistrations.set(reg.mode, reg);
      },
    } satisfies PluginContext);
  }
}
