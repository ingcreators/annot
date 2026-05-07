/**
 * Plugin host — the stable extension surface for `@ingcreators/annot-web`.
 *
 * Phase 4 of the app.ts decomposition plan
 * (see `docs/plans/_done/app-decomposition.md`). The plugin API is the key
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
 * `docs/plans/_done/app-decomposition.md` — Phase 5 gate):
 *
 * - `registerStorage` — needs a reshape of `./storage/bridge.ts`.
 * - Sidebar-tab injection — needs a `FileManager`/`Sidebar` API
 *   review.
 * - Drawer-section + right-panel-section injection — needs shared
 *   "UI slot" shape across both surfaces.
 */

import type { StorageProvider } from "@ingcreators/annot-core/storage";
import { BUILT_IN_STORAGE_MODES } from "../storage/bridge.js";

// Phase 2 of `docs/plans/host-convergence.md` (Decision 4 — fold-in)
// moved every plugin-host structural type into
// `@ingcreators/annot-host-ui/plugin-host-types` so the gallery
// (now in editor-shell) imports them directly. The class itself
// (`PluginHost`, `#makeContext`, dispatchers) stays here in web —
// `docs/plans/plugin-host-extraction.md` (Draft) covers eventually
// pulling the runtime out as well, gated on "Desktop or VSCode wants
// to load plugins".
//
// Re-export every structural type so existing `import { … } from
// "../app/plugin-host.js"` call sites compile untouched.
export type {
  AfterSaveEvent,
  AnnotPlugin,
  BeforeSaveEvent,
  EditorReadyEvent,
  ExternalLink,
  ExternalLinkSource,
  PluginContext,
  RouteChangeEvent,
  SidebarTab,
  SidebarTabUpdate,
  StorageRegistration,
  UISection,
  UISectionContext,
  UISectionLifecycle,
} from "@ingcreators/annot-host-ui/plugin-host-types";

import type {
  AfterSaveEvent,
  AnnotPlugin,
  BeforeSaveEvent,
  EditorReadyEvent,
  ExternalLink,
  ExternalLinkSource,
  PluginContext,
  RouteChangeEvent,
  SidebarTab,
  SidebarTabUpdate,
  StorageRegistration,
  UISection,
} from "@ingcreators/annot-host-ui/plugin-host-types";

export class PluginHost {
  readonly #externalLinkSources: ExternalLinkSource[] = [];
  readonly #editorReadyListeners: Array<(ev: EditorReadyEvent) => void> = [];
  readonly #beforeSaveListeners: Array<(ev: BeforeSaveEvent) => void | Promise<void>> = [];
  readonly #afterSaveListeners: Array<(ev: AfterSaveEvent) => void> = [];
  readonly #routeChangeListeners: Array<(ev: RouteChangeEvent) => void> = [];
  readonly #storageRegistrations = new Map<string, StorageRegistration>();
  /** Sidebar tabs in mutation-friendly form: a `Map` keyed by id
   *  so `updateSidebarTab` can locate the entry in O(1) and so
   *  iteration order is registration order (which then feeds into
   *  the sidebar's stable `priority` sort). */
  readonly #sidebarTabs = new Map<string, SidebarTab>();
  /** Listeners that re-render the sidebar when tabs change. Wired
   *  by `App.init` so the sidebar's render() is the only side
   *  effect; plugin authors don't see this hook directly. */
  readonly #sidebarChangeListeners: Array<() => void> = [];
  /** Drawer + right-panel section registrations. Two separate
   *  `Map`s so the id namespaces are independent per target —
   *  the same id is allowed across surfaces. Phase 2 / 3 of
   *  plugin-ui-slots add the surfaces that consume these. */
  readonly #drawerSections = new Map<string, UISection>();
  readonly #rightPanelSections = new Map<string, UISection>();

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

  /** Find a sidebar tab by id. Returns `undefined` if no tab
   *  matches — the typical reason is a stale id from before
   *  `unloadSidebarTab` (future). */
  findSidebarTab(id: string): SidebarTab | undefined {
    return this.#sidebarTabs.get(id);
  }

  /** Snapshot of registered tabs in registration order. The
   *  caller (sidebar) sorts by `priority` for render. */
  listSidebarTabs(): SidebarTab[] {
    return Array.from(this.#sidebarTabs.values());
  }

  /** Subscribe to "tabs changed" — fires after every
   *  `updateSidebarTab` mutation (and after the initial
   *  `addSidebarTab` calls during `registerAll`). Wired by
   *  `App.init` so the sidebar re-renders without the plugin
   *  having to know about the sidebar. */
  onSidebarChange(fn: () => void): void {
    this.#sidebarChangeListeners.push(fn);
  }

  /** Snapshot of registered drawer sections in registration
   *  order. The drawer surface (Phase 2) composes built-ins +
   *  this list, applies the disable filter, sorts by `priority`,
   *  and renders. */
  listDrawerSections(): UISection[] {
    return Array.from(this.#drawerSections.values());
  }

  /** Find a drawer section by id. Returns `undefined` for
   *  built-ins (which the drawer surface tracks separately) and
   *  for unknown ids. */
  findDrawerSection(id: string): UISection | undefined {
    return this.#drawerSections.get(id);
  }

  /** Snapshot of registered right-panel sections in
   *  registration order. */
  listRightPanelSections(): UISection[] {
    return Array.from(this.#rightPanelSections.values());
  }

  findRightPanelSection(id: string): UISection | undefined {
    return this.#rightPanelSections.get(id);
  }

  #fireSidebarChange(): void {
    for (const fn of this.#sidebarChangeListeners) {
      try {
        fn();
      } catch (e) {
        // The listener is host-supplied (sidebar render hook), not
        // plugin-supplied — a throw here is a host bug, not a
        // plugin bug. Log and continue so a single broken hook
        // doesn't take down subsequent dispatches.
        console.error("[plugin-host] onSidebarChange listener threw:", e);
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
              'Pick a different mode key (e.g. "cloud", "team-library").',
          );
        }
        if (this.#storageRegistrations.has(reg.mode)) {
          throw new Error(`[plugin-host] storage mode "${reg.mode}" is already registered.`);
        }
        this.#storageRegistrations.set(reg.mode, reg);
      },
      addSidebarTab: (tab) => {
        if (this.#sidebarTabs.has(tab.id)) {
          throw new Error(`[plugin-host] sidebar tab id "${tab.id}" is already registered.`);
        }
        // If the registration self-declares isActive, enforce
        // single-active right away so a misconfigured plugin
        // can't have two tabs both initial-active.
        if (tab.isActive) {
          for (const [id, existing] of this.#sidebarTabs) {
            if (existing.isActive) {
              this.#sidebarTabs.set(id, { ...existing, isActive: false });
            }
          }
        }
        this.#sidebarTabs.set(tab.id, tab);
        this.#fireSidebarChange();
      },
      updateSidebarTab: (id, partial) => {
        const existing = this.#sidebarTabs.get(id);
        if (!existing) {
          throw new Error(`[plugin-host] sidebar tab id "${id}" is not registered.`);
        }
        // Single-active enforcement: if the partial activates
        // this tab, deactivate every other tab in the same pass
        // so the sidebar's render sees a consistent state with
        // exactly one active row.
        if (partial.isActive === true) {
          for (const [otherId, otherTab] of this.#sidebarTabs) {
            if (otherId !== id && otherTab.isActive) {
              this.#sidebarTabs.set(otherId, { ...otherTab, isActive: false });
            }
          }
        }
        this.#sidebarTabs.set(id, { ...existing, ...partial });
        this.#fireSidebarChange();
      },
      addDrawerSection: (section) => {
        if (this.#drawerSections.has(section.id)) {
          throw new Error(`[plugin-host] drawer section id "${section.id}" is already registered.`);
        }
        this.#drawerSections.set(section.id, section);
      },
      addRightPanelSection: (section) => {
        if (this.#rightPanelSections.has(section.id)) {
          throw new Error(
            `[plugin-host] right-panel section id "${section.id}" is already registered.`,
          );
        }
        this.#rightPanelSections.set(section.id, section);
      },
    } satisfies PluginContext);
  }
}
