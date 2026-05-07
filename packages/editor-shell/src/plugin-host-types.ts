/**
 * Plugin-host structural types — host-neutral surface area shared
 * between `@ingcreators/annot-web`'s `PluginHost` class and the
 * gallery in `@ingcreators/annot-editor-shell/gallery/*`.
 *
 * Phase 2 of `docs/plans/host-convergence.md` extracts these from
 * `packages/web/src/app/plugin-host.ts` (which still owns the
 * `PluginHost` class itself) so the gallery — now living in
 * editor-shell — can import them without a back-channel through
 * annot-web. Decision 4 of the host-convergence plan narrows
 * Phase 4 to "structural types only" and folds it into Phase 2;
 * the class extraction (`PluginHost`) waits for a separate trigger
 * captured in `docs/plans/plugin-host-extraction.md`.
 *
 * Editor-shell still depends on `@ingcreators/annot-core` only —
 * these are pure type declarations, no runtime behaviour.
 */

import type { IconSpec } from "@ingcreators/annot-core";
import type { StorageProvider } from "@ingcreators/annot-core/storage";
import type {
  UISectionContext as UISectionContextT,
  UISectionLifecycle as UISectionLifecycleT,
  UISection as UISectionT,
} from "./ui-section.js";

// Re-export `UISection*` here so plugin authors / hosts can pull every
// plugin-host structural type from one place.
export type UISection = UISectionT;
export type UISectionContext = UISectionContextT;
export type UISectionLifecycle = UISectionLifecycleT;

export type ExternalLink = { label: string; url: string; icon?: IconSpec };

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
   *  `annot-web/router` for its types. */
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
  /** Icon descriptor — pass `{ kind: "builtin", id: "database" }` for
   *  a host registry icon, or `{ kind: "svg", svg: "<svg…/>" }` for
   *  a plugin-owned logomark. The host renders via `<annot-icon>`. */
  readonly icon?: IconSpec;
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

  /** Icon descriptor — pass `{ kind: "builtin", id: "history" }`
   *  for a host registry icon, or `{ kind: "svg", svg: "…" }` for
   *  a plugin-owned logomark. Optional; falls back to
   *  `view_module` when omitted. */
  readonly icon?: IconSpec;

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
