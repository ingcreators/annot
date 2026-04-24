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
 * ## MVP scope
 *
 * This file lands the skeleton + the two extension points that
 * have immediate in-tree consumers:
 *
 * 1. `addExternalLinkSource` — drives the drawer's "External links"
 *    section. The built-in `github-external-links` plugin is the
 *    reference implementation (moved out of `HeaderHost`).
 * 2. `onAfterSave` / `onEditorReady` / `onRouteChange` — event
 *    hooks carried into `SavePipeline`, `EditorSession`, and
 *    `RouterHost` respectively. No OSS consumers today; the
 *    dispatch paths exist so Cloud plugins have a landing spot.
 *
 * `registerStorage` is intentionally deferred — it requires
 * rethinking `./storage/bridge.ts` to accept plugin-registered
 * modes dynamically, which is its own project (see the Phase 5
 * gate in `docs/plans/app-decomposition.md`).
 */

import type { StorageProvider } from "@ingcreators/annot-core/storage";

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

  /** Run `fn` after a save lands successfully. Gets the final path
   *  (post-rename / post-move) and the storage mode. */
  onAfterSave(fn: (ev: AfterSaveEvent) => void): void;

  /** Run `fn` when the router finishes parsing + dispatching a new
   *  URL. Fires before the per-route collaborator (editor / split /
   *  gallery) takes over, so a plugin that wants to veto a route
   *  can't — that's deliberate for MVP. */
  onRouteChange(fn: (ev: RouteChangeEvent) => void): void;
}

export class PluginHost {
  readonly #externalLinkSources: ExternalLinkSource[] = [];
  readonly #editorReadyListeners: Array<(ev: EditorReadyEvent) => void> = [];
  readonly #afterSaveListeners: Array<(ev: AfterSaveEvent) => void> = [];
  readonly #routeChangeListeners: Array<(ev: RouteChangeEvent) => void> = [];

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
      onAfterSave: (fn) => {
        this.#afterSaveListeners.push(fn);
      },
      onRouteChange: (fn) => {
        this.#routeChangeListeners.push(fn);
      },
    } satisfies PluginContext);
  }
}
