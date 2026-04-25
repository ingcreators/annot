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
 * Sidebar tab — a top-level navigation entry rendered in the
 * "Views" section between Storage and Folders (default order).
 *
 * Built-ins describe themselves via plain object instances handed
 * to `PluginContext.addSidebarTab` from a built-in plugin's
 * `register`. The "Recent" built-in is the reference example.
 *
 * State (`isActive` / `badge` / `visible`) is a plain value the
 * sidebar reads on render. Plugins mutate via
 * `PluginContext.updateSidebarTab(id, partial)`; the sidebar
 * enforces single-active across all tabs (setting one true flips
 * every other to false before re-render).
 */
export interface SidebarTab {
  /** Stable id. Used by `updateSidebarTab`'s mutation target +
   *  the active-state diff. Plugin-owned namespace —
   *  e.g. `"cloud.team-library"` — to avoid collisions across
   *  plugins. Throws at registration time on duplicate id. */
  readonly id: string;

  /** Visible label. */
  readonly label: string;

  /** Material-symbols icon name (e.g. `"groups"`, `"history"`,
   *  `"star"`). Optional; falls back to a generic glyph. */
  readonly icon?: string;

  /** Render order within the "Views" section. Lower numbers
   *  render first. Falsy = `+Infinity` (appended last). Stable
   *  sort. The built-in "Recent" tab reserves priority 10. */
  readonly priority: number;

  /** Click handler. Plugin-owned. Typically swaps the main
   *  content area to the plugin's view (route push, gallery
   *  filter, modal, …) and (if the plugin wants a sticky
   *  highlight) calls `ctx.updateSidebarTab(id, { isActive: true })`. */
  onClick(): void;

  /** Initial active state. The sidebar enforces single-active
   *  across plugins: setting one tab to `isActive: true` (via
   *  this initial value or via `updateSidebarTab`) flips all
   *  other tabs to `isActive: false` automatically. */
  readonly isActive?: boolean;

  /** Initial badge text. `undefined` hides the badge. */
  readonly badge?: string;

  /** Initial visibility. False hides the tab without
   *  un-registering it. Used for "show this tab only when the
   *  user has access" cases. */
  readonly visible?: boolean;
}

/** Mutable subset of `SidebarTab` — the fields a plugin can
 *  flip via `updateSidebarTab` after registration. */
export type SidebarTabUpdate = Partial<
  Pick<SidebarTab, "label" | "icon" | "isActive" | "badge" | "visible">
>;

/**
 * Per-image context handed to a UI section's `mount` (and to every
 * subsequent `update(ctx)` call on reactive sections). Captures the
 * minimum a typical section needs to render — path, mode, tags —
 * plus a `setTitle` escape hatch for sections whose heading depends
 * on dynamic state (the right-panel's tool-properties / selection-
 * properties sections set their title from the active tool / kind
 * of selection).
 */
export interface UISectionContext {
  /** Path of the open image. Always set when the section is
   *  mounted — sections only render when there's an active editor
   *  session. */
  readonly path: string;
  /** Storage mode at mount / update time. Stable for the section's
   *  lifetime — image swap unmounts + remounts. */
  readonly mode: string;
  /** Snapshot of `tags`. Re-read on each `update(ctx)` call. */
  readonly tags: Readonly<Record<string, string>>;
  /** Override the section heading. Idempotent; calling with the
   *  same string is a no-op. The host re-renders only the heading
   *  element, not the section body. */
  setTitle(title: string): void;
}

/**
 * Lifecycle returned from `UISection.mount`. Plugins pick the shape
 * that fits their needs:
 *
 * - **Function** — simple sections that own their DOM and don't
 *   need notifications when the image state changes. Equivalent
 *   to `{ unmount: fn }`.
 * - **Object** — reactive sections that want to be notified on
 *   rename / save / tag-edit. The host calls `update(ctx)` with a
 *   fresh context, then `unmount()` on session end.
 *
 * The host inspects the return shape: if it's a function, no
 * `update` notifications fire; if it's an object, `update?` runs
 * on every host-level state change.
 */
export type UISectionLifecycle =
  | (() => void)
  | {
      /** Optional. Called when per-image state changes (rename,
       *  save, tag edit). Plugin re-reads from `ctx` and updates
       *  its DOM in place — no remount. */
      update?(ctx: UISectionContext): void;
      /** Called once when the section is unmounted (editor
       *  session ends, opt-out toggled, plugin teardown). */
      unmount(): void;
    };

/**
 * Descriptor for a section in the file-details drawer or the editor
 * right-panel. Built-in sections describe themselves via this same
 * shape (Phase 2 / 3 of `docs/plans/_done/plugin-ui-slots.md` migrate
 * them); plugins fill it from `PluginContext.addDrawerSection` /
 * `addRightPanelSection`. The two targets have independent id
 * namespaces — the same id is allowed across targets so a single
 * plugin can use `"comments"` for both surfaces.
 */
export interface UISection {
  /** Stable id, unique within the section's target namespace.
   *  Plugin-owned namespace — e.g. `"cloud.comments"`. Built-ins
   *  reserve dotted ids: `"drawer.file"` / `"drawer.tags"` /
   *  `"right-panel.tool-properties"` etc. */
  readonly id: string;
  /** Section heading. The host wraps the plugin's mount container
   *  in a section frame matching the existing built-in sections
   *  (heading + content body). Use `ctx.setTitle` to override
   *  later. */
  readonly title: string;
  /** Render order within the target. Lower numbers render first.
   *  Falsy = `+Infinity` (appended last). Stable sort, so ties
   *  fall back to registration order. Built-ins reserve
   *  priorities documented per surface in
   *  `docs/plans/_done/plugin-ui-slots.md`. */
  readonly priority: number;
  /** Mount the section into the supplied container. Returns either
   *  a teardown function (simple) or a lifecycle object with
   *  `update?` + `unmount` (reactive). */
  mount(container: HTMLElement, ctx: UISectionContext): UISectionLifecycle;
  /** Optional: filter at mount time. False skips the section
   *  entirely (no `mount` call, no DOM). Plugins use this for
   *  "hide when no comments exist yet" type cases. Default:
   *  always visible. */
  visible?(ctx: UISectionContext): boolean;
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

  /** Register a sidebar tab. `id` must be unique across all
   *  registered tabs (built-in + plugin); duplicates throw. The
   *  tab appears in the sidebar's "Views" section, sorted by
   *  `priority`. The Recent built-in reserves priority 10. */
  addSidebarTab(tab: SidebarTab): void;

  /** Mutate a previously-registered tab. Only the supplied
   *  fields change; omitted fields are unchanged. Throws if no
   *  tab matches `id`. Setting `isActive: true` flips every
   *  other tab's `isActive` to `false` before the re-render
   *  (single-active across plugins). */
  updateSidebarTab(id: string, partial: SidebarTabUpdate): void;

  /** Register a section in the file-details drawer. `id` must be
   *  unique within the drawer namespace (built-in + plugin
   *  drawer sections); duplicates throw. Sections render sorted
   *  by `priority`. Phase 1 of plugin-ui-slots ships the
   *  registration plumbing; rendering arrives in Phase 2 (drawer
   *  migration), so a plugin can register but the section won't
   *  display until the drawer host learns to consume the list. */
  addDrawerSection(section: UISection): void;

  /** Register a section in the editor right-panel. `id` must be
   *  unique within the right-panel namespace (built-in + plugin
   *  right-panel sections); duplicates throw. Phase 1 of
   *  plugin-ui-slots ships the registration plumbing; rendering
   *  arrives in Phase 3 (right-panel migration). */
  addRightPanelSection(section: UISection): void;
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
          throw new Error(
            `[plugin-host] drawer section id "${section.id}" is already registered.`,
          );
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
