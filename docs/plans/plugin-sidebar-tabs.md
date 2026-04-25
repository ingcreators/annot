# Plugin Sidebar Tabs

> **Status:** Queued. Authored 2026-04-25 as the named follow-up from
> [`app-decomposition.md`](./app-decomposition.md) Phase 5; sign-off
> received 2026-04-25 on the five design questions (see "Decisions"
> at the bottom). Second of three deferred plugin-API extensions,
> after [`plugin-storage-registration.md`](./plugin-storage-registration.md).
>
> **Compatibility:** Touches
> [`packages/web/src/gallery/sidebar.ts`](../../packages/web/src/gallery/sidebar.ts)
> (chip strip + folder tree owner),
> [`packages/web/src/gallery/file-manager.ts`](../../packages/web/src/gallery/file-manager.ts)
> (sidebar callbacks owner), and adds a new entry point on
> [`packages/web/src/app/plugin-host.ts`](../../packages/web/src/app/plugin-host.ts)'s
> `PluginContext`. No schema changes; no
> `StorageProvider` changes.
>
> **Risk:** Low-medium. The sidebar's existing structure (Storage
> chips → Folders tree) stays intact; tabs render as a third section
> with its own heading. Built-ins don't ship a tab in this plan, so
> there's no behaviour change for OSS users; the API is dormant
> until a plugin opts in.

## Context

The Phase 5 audit of `app-decomposition.md` flagged this:

> **Sidebar-tab injection** (Cloud's "Team library").
> `FileManager` owns the sidebar; no tab-insertion API today.

The motivating use case is `annot-cloud`'s **Team library** —
a top-level navigation entry that switches the gallery to a
team-shared view (cross-repo, server-side query). That's
distinct from a `StorageProvider`: the underlying backend may be
the same as the user's personal Cloud store, but the *view* is
different (filter applied, ordering swapped, additional metadata
columns).

`registerStorage` (Phase C of `plugin-storage-registration.md`)
covers the "this is a different backend" case. **Sidebar tabs
cover the "this is a different view of the same data" case.** The
two compose: a Cloud deployment registers one storage backend +
two tabs ("My library", "Team library"), all flowing through the
same plugin.

Other useful tabs that this API would unlock — even without a
plugin landing today — include "Recent", "Starred",
"Shared with me", "Trash". None of those ship in this plan, but
the API has to be flexible enough to host them later.

## Goals

- A plugin can call `ctx.addSidebarTab(tab)` during `register()`
  and have the tab appear in the sidebar's new "Views" section,
  positioned by `priority`.
- Tab clicks dispatch back to the plugin (plugin owns the
  "what does the main content area show now" logic).
- The active tab visually highlights, and the sidebar enforces
  single-active across all tabs (clicking a new tab clears the
  previous tab's highlight automatically).
- Plugin-owned dynamic state (badge counter, visibility, active
  flag) updates via a setter — `ctx.updateSidebarTab(id, partial)`.
  The sidebar diff-renders only the chrome that changed.
- Sidebar layout is **section-priority sorted**, not hardcoded.
  Default priorities place the sections in the current visual
  order:
  ```
  Storage  → priority 10
  Views    → priority 20   ← new section
  Folders  → priority 30
  ```
  Deployments override via `App.init({ sidebarSectionOrder: { ... } })`
  to put Views above Storage, swap Folders + Storage, etc. The
  "New" button stays pinned at the top regardless.
- A built-in **"Recent"** tab ships in Phase 1 as the reference
  implementation: tracks recently-opened image paths in
  localStorage and on click navigates the gallery to the folder
  of the most-recently-opened image. Plays the same role for
  the sidebar-tab API that `github-external-links` plays for
  `addExternalLinkSource`.
- Existing 187-test suite keeps passing; ~10 new tests cover
  registration, ordering, single-active enforcement,
  `updateSidebarTab`, the `disableBuiltinTabs` opt-out, and the
  Recent built-in's localStorage tracking.

## Non-goals

- **Tab content rendering.** The plugin owns its `onClick`
  handler; this plan doesn't provide a "main content area"
  injection point. Cloud's first tab will likely call back into
  its own routing layer, which composes with the existing
  `onRouteChange` plugin hook. The Recent built-in stays
  scoped to "navigate to the right folder" rather than
  rendering its own flat-list view, for the same reason.
- **Tab groups / nested tabs.** Single flat list under "Views".
  If a plugin needs sub-tabs (e.g. "Team library → Mobile" /
  "Team library → Desktop"), it owns the nesting visually inside
  its own panel.
- **Drag-to-reorder.** Tab order is plugin-declared via
  `priority`; users can't reorder. Re-considered when we have
  several plugin authors and ordering becomes contested.
- **Persisted active-tab across reloads.** The plugin owns its
  own selection state. If Cloud wants to remember "user was on
  Team library when they reloaded", it persists that itself
  (localStorage, server-side preference, etc.) and calls
  `updateSidebarTab(id, { isActive: true })` on boot.

## Design

### `SidebarTab` shape (setter-based state)

Exported from
[`packages/web/src/app/plugin-host.ts`](../../packages/web/src/app/plugin-host.ts)
alongside `StorageRegistration`. State fields are plain values
the sidebar reads on every render; plugins mutate them via
`ctx.updateSidebarTab(id, partial)`.

```ts
export interface SidebarTab {
  /** Stable id. Used for the `updateSidebarTab` setter target,
   *  the active-tab single-select check, and (future)
   *  `removeSidebarTab(id)`. Plugin-owned namespace —
   *  e.g. `"cloud.team-library"` to avoid collisions across
   *  plugins. Throws at registration time on duplicate id. */
  readonly id: string;

  /** Visible label. */
  readonly label: string;

  /** Material-symbols icon name (e.g. `"groups"`, `"history"`,
   *  `"star"`). Optional; falls back to a generic glyph. */
  readonly icon?: string;

  /** Render order within the "Views" section. Lower numbers
   *  render first. Falsy = `+Infinity` (appended last). Stable
   *  sort. Built-in "Recent" reserves priority 10. */
  readonly priority: number;

  /** Click handler. Plugin-owned. Typically swaps the main
   *  content area to the plugin's view and (if the plugin wants
   *  a sticky highlight) calls
   *  `ctx.updateSidebarTab(id, { isActive: true })`. The
   *  sidebar's single-active enforcement deactivates other
   *  tabs automatically when one becomes active. */
  onClick(): void;

  /** Initial active state. The sidebar enforces single-active
   *  across plugins: setting one tab to `isActive: true` (via
   *  this initial value or the setter) flips all other tabs to
   *  `isActive: false` automatically. Default: false. */
  readonly isActive?: boolean;

  /** Initial badge text. `undefined` hides the badge.
   *  Mutate via the setter. */
  readonly badge?: string;

  /** Initial visibility. False hides the tab without
   *  un-registering it. Used for Cloud's "show Team library
   *  only when the user has team access" case. Default: true. */
  readonly visible?: boolean;
}
```

### `PluginContext` additions

```ts
interface PluginContext {
  // ... existing methods ...

  /** Register a tab. Throws on duplicate id. Errors are
   *  isolated by `registerAll`'s existing per-plugin try/catch. */
  addSidebarTab(tab: SidebarTab): void;

  /** Mutate a previously-registered tab. Only the supplied
   *  fields change; omitted fields are unchanged. Throws if no
   *  tab matches `id`. The sidebar refreshes the affected row
   *  in place — no full re-render. */
  updateSidebarTab(
    id: string,
    partial: Partial<Pick<SidebarTab, "label" | "icon" | "isActive" | "badge" | "visible">>,
  ): void;
}
```

`updateSidebarTab` is the single mutation surface — there's no
escape-hatch getter the plugin can hand the sidebar that lets
the sidebar pull state from arbitrary plugin internals. This
makes it cheap to add diff-aware DOM updates later (only the
changed row touches the DOM) and makes the state ownership
explicit.

The single-active enforcement happens inside `updateSidebarTab`:
if the partial sets `isActive: true`, the sidebar resets every
other tab's `isActive` to `false` before applying the update +
re-rendering. Plugins can read the resulting state via
(future) `findSidebarTab(id)` if they need to detect "another
plugin took focus", but that's not in the MVP API surface.

### Section ordering — `App.init({ sidebarSectionOrder })`

The sidebar's three sections (Storage, Views, Folders) become
priority-driven. Default priorities place them in the current
visual order:

```ts
// Defaults
{ storage: 10, views: 20, folders: 30 }
```

Deployments override:

```ts
app.init({
  sidebarSectionOrder: { views: 5 },   // Views above Storage
});
```

The "New" button is pinned at the top regardless — it's the
primary action and not part of the priority-sorted section
list. Lower priority renders first; ties fall back to the
fixed-array order (storage, views, folders) for stable layout.

If the user passes `sidebarSectionOrder`, the bridge merges it
over the defaults (so passing only `views: 5` keeps storage at
10 and folders at 30). Numeric values only — no string aliases
for now.

### Built-in "Recent" tab (Phase 1, scope-minimal)

Plays the same role for the sidebar-tab API that
`github-external-links` plays for `addExternalLinkSource` —
proves the API covers a real use case without depending on
external infrastructure.

`packages/web/src/app/plugins/recent-tab.ts` (new file):

```ts
const STORAGE_KEY = "annot-recent-paths";
const MAX_ENTRIES = 50;

interface RecentEntry { path: string; mode: string; openedAt: string; }

export const recentTabPlugin: AnnotPlugin = {
  name: "recent-tab",
  register(ctx) {
    ctx.addSidebarTab({
      id: "recent",
      label: "Recent",
      icon: "history",
      priority: 10,
      onClick: () => {
        const last = loadRecentEntries()[0];
        if (!last) return;          // never opened anything → no-op
        const folder = pathFolder(last.path);
        // Navigate the gallery to the folder containing the most-
        // recently-opened image. Reuses the existing route surface
        // (`pushRoute(galleryUrl(...))`) — no new content area.
        navigateToFolder(folder);
      },
    });

    // Track every opened image. `onEditorReady` fires for every
    // navigation that lands on an editor session — capture, paste,
    // open-from-gallery, transfer, split-editor. That's exactly
    // the surface "Recent" wants to capture.
    ctx.onEditorReady((ev) => {
      if (!ev.path) return;
      pushRecentEntry({ path: ev.path, mode: getStorageMode(), openedAt: new Date().toISOString() });
    });
  },
};
```

Tracking lives in localStorage so it survives reloads but
doesn't leak across browser profiles. Cap at 50 entries
(the oldest dropped when a new one pushes past the cap).

Recent's onClick navigates rather than rendering anything new —
no main-content injection in this MVP. A future plan can add a
"Recent images" flat-list view if usability testing flags the
folder-navigate as insufficient.

### Sidebar reshape

[`gallery/sidebar.ts`](../../packages/web/src/gallery/sidebar.ts)
gains a `#renderViewsSection()` and the existing render loop
becomes section-priority-sorted:

```ts
render(): void {
  this.#container.innerHTML = "";
  this.#container.appendChild(this.#buildNewButton());

  const order = this.#callbacks.getSidebarSectionOrder?.() ?? {
    storage: 10, views: 20, folders: 30,
  };
  const sections: Array<{ priority: number; render: () => void }> = [
    { priority: order.storage,  render: () => this.#renderStorageStrip() },
    { priority: order.views,    render: () => this.#renderViewsSection() },
    { priority: order.folders,  render: () => this.#renderFoldersSection() },
  ];
  sections.sort((a, b) => a.priority - b.priority);
  for (const s of sections) s.render();
}

#renderViewsSection(): void {
  const tabs = (this.#callbacks.getSidebarTabs?.() ?? [])
    .filter((t) => t.visible !== false)
    .sort((a, b) =>
      (Number.isFinite(a.priority) ? a.priority : Number.POSITIVE_INFINITY)
      -
      (Number.isFinite(b.priority) ? b.priority : Number.POSITIVE_INFINITY));
  if (tabs.length === 0) return;     // no tabs → no section heading
  // … render "Views" heading + each tab as a row …
}
```

When zero tabs are registered (and `disableBuiltinTabs: ["recent"]`
hides Recent in OSS deployments that opt out), the section
heading is suppressed entirely, so the sidebar layout for those
deployments stays byte-identical with today.

### Wiring

- `SidebarCallbacks` gains:
  - `getSidebarTabs?(): SidebarTab[]`
  - `getSidebarSectionOrder?(): { storage: number; views: number; folders: number }`
- `FileManagerCallbacks` gains the same two; `FileManager`'s
  constructor passes them through.
- `App.init` wires `getSidebarTabs: () => this.#pluginHost.listSidebarTabs()`
  and `getSidebarSectionOrder: () => this.#sidebarSectionOrder`.
- `App.init({ disableBuiltinTabs: ["recent"] })` filters Recent
  out of the built-in plugin list before `pluginHost.registerAll`,
  same pattern as `disableBuiltinPlugins`.

## Phased plan

Single-PR scope. The implementation splits internally into the
plumbing + the Recent built-in, but lands together so the API
ships with a working consumer.

### Phase 1 — Tabs API + Recent built-in + section-priority order

Plugin-host:

- Export `SidebarTab` from `plugin-host.ts`.
- `PluginContext.addSidebarTab(tab)` + `updateSidebarTab(id, partial)`
  + `PluginHost.listSidebarTabs() / findSidebarTab(id)`.
- `addSidebarTab` validates duplicate id (throws). `updateSidebarTab`
  validates the id exists (throws). Both errors isolated by the
  existing `registerAll` per-plugin try/catch on the registration
  side; a runtime `updateSidebarTab` throw bubbles since it's
  outside the plugin's `register()` window.
- Single-active enforcement: when `updateSidebarTab` sets
  `isActive: true`, every other tab's `isActive` flips to `false`
  before the diff render.

Sidebar:

- `gallery/sidebar.ts` rewrites `render()` to sort sections by
  the deployment's `sidebarSectionOrder`.
- New `#renderViewsSection()` renders heading + tab rows; absent
  if zero tabs visible.
- `setStorageStatus` / setActive / future `notifyTabChange` all
  share the same `render()` re-flow as today.

App / FileManager:

- `gallery/file-manager.ts` adds the two new callbacks
  (`getSidebarTabs`, `getSidebarSectionOrder`).
- `App.init` accepts `sidebarSectionOrder?: { storage?, views?, folders? }`
  and `disableBuiltinTabs?: string[]`. Both default to no-op
  (sections in current order, all built-in tabs registered).
- Recent plugin lands in
  `packages/web/src/app/plugins/recent-tab.ts` and is added to
  the existing built-in plugin list alongside
  `githubExternalLinksPlugin`.

Tests (~10 new, total → ~197):

- `addSidebarTab` registers; duplicate id throws.
- `updateSidebarTab` mutates only specified fields; throws on
  unknown id.
- Single-active enforcement: setting one tab active flips others
  off (across plugins).
- Sort by `priority` is stable; ties fall back to registration
  order.
- `visible: false` hides the tab; section heading absent if all
  tabs hidden.
- Recent built-in: `onEditorReady` push records the latest path;
  cap at 50 entries; `onClick` navigates to folder of latest
  entry.
- `disableBuiltinTabs: ["recent"]` filters Recent out before
  `registerAll`.
- `disableBuiltinTabs: ["unknown"]` warns + no-ops (forward-compat
  with newer-than-config deployments).
- `App.init` with `sidebarSectionOrder: { views: 5 }` puts Views
  above Storage (verified via the section-list construction
  helper rather than a DOM-rendered sidebar — same approach as
  the priority sort tests for `StorageRegistration`).
- Recent's localStorage tracker survives a fake `loadRecentEntries`
  / `pushRecentEntry` round-trip.

Expected delta: ~250 lines net (plumbing ~150, Recent ~70,
tests ~30).

### Phase 2 _(optional)_ — Visual polish

If Phase 1's manual smoke surfaces specific issues —
- single-active state visibly flickers during a re-render
- the Views heading lacks vertical breathing room when only
  one tab is registered
- Recent's "no last entry" no-op feels broken without a hint
- the Recent click in Drive/GitHub mode would benefit from a
  brief "Loading…" indicator since folder navigation triggers a
  network listImages

— address those incrementally. None are gating; this Phase 2 is
purely a placeholder for "we'll see what reviewers / first
users report".

Expected delta: ≤ 50 lines, optional.

## Verification

- `pnpm -r typecheck` passes.
- `pnpm test` — 187 → 193 (estimated +6).
- `pnpm lint` — 0 findings.
- `pnpm --filter @ingcreators/annot-web build` — bundle within
  ±3 % of pre-phase.
- Manual smoke (added to PR test plan):
  - Boot OSS app → no "Views" section appears (zero tabs registered).
  - Boot with a fixture plugin that registers two tabs at
    priorities 10 / 20 → sidebar shows "Views" heading + two
    rows in the right order. Hide one via `visible: false` →
    section keeps showing the other.
  - Click a tab → `onClick` fires, `isActive()`-driven
    highlight updates after `ctx.refreshSidebar()`.
  - Badge text updates after a state change + refresh.

## Migration notes

- **No data migration.** Pure additive API.
- **No URL scheme change.** Tabs don't add routes; the plugin's
  `onClick` may push a route via the existing public router
  surface (caller's choice).
- **Existing plugins unaffected.** No change to
  `addExternalLinkSource`, `onAfterSave`, etc.

## Decisions (sign-off 2026-04-25)

1. **Section position: priority-driven, not fixed.**
   `App.init({ sidebarSectionOrder })` overrides default
   priorities (storage=10, views=20, folders=30). Sections sort
   by priority; "New" button stays pinned at the top. Lower
   priority renders first. Lets a deployment that wants Views
   above Storage say so without forking the sidebar.
2. **Setter-based state updates.**
   `ctx.updateSidebarTab(id, partial)` mutates `label` / `icon`
   / `isActive` / `badge` / `visible`. Explicit ownership; opens
   the door to diff-based DOM updates later (only the changed
   row touches the DOM). State on the registration is plain
   values, not getter functions — the sidebar reads what it
   stores.
3. **Sidebar enforces single-active across plugins.**
   When `updateSidebarTab(id, { isActive: true })` lands, the
   sidebar resets every other tab's `isActive` to `false`
   before the diff render. No two tabs can be active
   simultaneously, and plugins don't have to coordinate
   across each other.
4. **Ship "Recent" as the built-in reference.**
   `recent-tab.ts` registers a `priority: 10` tab, tracks last
   50 opened image paths in localStorage via `onEditorReady`,
   and on click navigates the gallery to the folder of the most
   recently-opened image. No main-content injection — just a
   route push, same as the existing breadcrumb-click flow.
5. **`disableBuiltinTabs` lands now.**
   Mirrors `disableBuiltinStorage` / `disableBuiltinPlugins`.
   Default empty array. Unknown names log a warning + no-op for
   forward-compat. Lets a Cloud-only deployment that doesn't
   want Recent simply pass `disableBuiltinTabs: ["recent"]`
   from day one.

## References

- [`app-decomposition.md`](./app-decomposition.md) — Phase 5
  audit; this is the second named follow-up.
- [`plugin-storage-registration.md`](./plugin-storage-registration.md)
  — sister plan, same shape. The `priority` / `visible` /
  registration-time-throw conventions are inherited from there.
- [`plugin-host.ts`](../../packages/web/src/app/plugin-host.ts)
  — extension surface this plan adds to.
- [`gallery/sidebar.ts`](../../packages/web/src/gallery/sidebar.ts)
  — render owner.
