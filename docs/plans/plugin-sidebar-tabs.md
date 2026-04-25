# Plugin Sidebar Tabs

> **Status:** Draft. Authored 2026-04-25 as the named follow-up from
> [`app-decomposition.md`](./app-decomposition.md) Phase 5; second
> of three deferred plugin-API extensions, after
> [`plugin-storage-registration.md`](./plugin-storage-registration.md).
> Awaiting sign-off before implementation.
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
- The active tab visually highlights (same convention as the
  active storage chip).
- Plugin-owned dynamic state (badge counter, visibility, active
  flag) updates without re-registration — the sidebar reads via
  getters at render time.
- Sidebar order:
  ```
  [ New button ]
  ── Storage ──
    chips (built-ins + plugin storages, by priority)
  ── Views ──         ← new section, only renders if any tab is registered
    plugin tabs (by priority)
  ── Folders ──
    folder tree
  ```
- Existing 187-test suite keeps passing; ~6 new tests cover
  registration, ordering, dynamic state.

## Non-goals

- **Built-in tabs in this plan.** The "Recent" / "Starred"
  ideas are listed in Context as motivating examples; they ship
  as separate follow-ups when the data they need is available.
- **Tab content rendering.** The plugin owns its `onClick`
  handler; this plan doesn't provide a "main content area"
  injection point. Cloud's first tab will likely call back into
  its own routing layer, which composes with the existing
  `onRouteChange` plugin hook.
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
  (localStorage, server-side preference, etc.) and reflects
  it via `isActive()` on next boot.

## Design

### `SidebarTab` shape

Exported from
[`packages/web/src/app/plugin-host.ts`](../../packages/web/src/app/plugin-host.ts)
alongside `StorageRegistration`:

```ts
export interface SidebarTab {
  /** Stable id, used for the active-state callback and for
   *  `removeSidebarTab(id)` (future). Plugin-owned namespace —
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
   *  sort, so identical priorities fall back to registration
   *  order. There are no reserved built-in priorities here —
   *  no built-in tabs ship in this plan. */
  readonly priority: number;

  /** Click handler. Plugin-owned. Typically swaps the main
   *  content area to the plugin's view (e.g. by calling its own
   *  router) and updates whatever drives `isActive()`. */
  onClick(): void;

  /** Optional: getter for the active-state highlight. The
   *  sidebar re-reads on every render, so the plugin doesn't
   *  notify the sidebar of state changes — it just calls
   *  `sidebar.refresh()` (or whatever wakeup mechanism we land,
   *  see Open Questions) and the sidebar re-asks. Default:
   *  always inactive. */
  isActive?(): boolean;

  /** Optional: badge / counter rendered next to the label.
   *  Returning `undefined` hides the badge. Re-read every
   *  render. */
  badge?(): string | undefined;

  /** Optional: visibility predicate. False hides the tab from
   *  the strip without un-registering it. Used for Cloud's
   *  "show Team library only when the user has team access"
   *  case. Default: always visible. */
  visible?(): boolean;
}
```

### `PluginContext.addSidebarTab(tab)`

```ts
interface PluginContext {
  // ... existing methods ...
  addSidebarTab(tab: SidebarTab): void;
}
```

Validation at registration time:

- Duplicate id (collision with a previously-registered tab) →
  throws. Errors are isolated by `registerAll`'s existing
  per-plugin try/catch — one bad registration doesn't kill init.
- No collision check against storage modes — tabs and storage
  registrations live in separate namespaces by design.

### Sidebar reshape

[`gallery/sidebar.ts`](../../packages/web/src/gallery/sidebar.ts)
gains a `#renderViewsSection()` private method called between the
existing chip strip and folder tree builds:

```ts
render(): void {
  this.#container.innerHTML = "";
  this.#container.appendChild(this.#buildNewButton());
  this.#renderStorageStrip();        // existing
  this.#renderViewsSection();        // NEW
  this.#renderFoldersSection();      // existing
}

#renderViewsSection(): void {
  const tabs = (this.#callbacks.getSidebarTabs?.() ?? [])
    .filter((t) => (t.visible ? t.visible() : true))
    .sort((a, b) =>
      (Number.isFinite(a.priority) ? a.priority : Number.POSITIVE_INFINITY)
      -
      (Number.isFinite(b.priority) ? b.priority : Number.POSITIVE_INFINITY));
  if (tabs.length === 0) return;     // no plugin tabs → no section
  // … render heading + each tab as a row …
}
```

Section heading is hidden when no tabs are registered, so OSS
sidebar layout is byte-identical with today.

### Refresh trigger

The plan above says "re-read every render". The sidebar's `render()`
fires on every `setStorageStatus` and `setActiveMode` call today.
For tabs, we need an external way for plugins to trigger a re-read
when their `isActive()` / `badge()` returns change.

Two options:

**A. Plugin calls a host-supplied refresh callback.** New on the
   context: `ctx.refreshSidebar()`. Plugins call it after their
   own state changes (Team-library badge counter ticked up).

**B. Sidebar exposes a public `refresh()` method on the singleton
   the host-context mediates.** Same effect, slightly heavier API
   surface.

Lean: **A**. Refreshing the sidebar isn't something a plugin should
have a direct handle on (could be abused as a forced re-render
loop); routing it through the context lets future scoping (e.g.
debouncing, rate-limiting) happen in one place.

### Wiring

Same shape as `getPluginStorages` from Phase C:

- `SidebarCallbacks` gains `getSidebarTabs?(): SidebarTab[]`.
- `FileManagerCallbacks` gains the same; `FileManager`'s
  constructor passes it through to the `Sidebar`.
- `App.init` wires `getSidebarTabs: () => this.#pluginHost.listSidebarTabs()`
  on the `FileManager` callbacks.
- `App.init({ disableBuiltinPlugins })` already handles the
  built-in side; nothing new there since this plan ships zero
  built-in tabs.

## Phased plan

Single-PR scope — the change is self-contained and the existing
tests are the regression net.

### Phase 1 — `SidebarTab` + `addSidebarTab` + sidebar render

- Export `SidebarTab` from `plugin-host.ts`.
- `PluginContext.addSidebarTab(tab)` lands; `PluginHost`
  tracks tabs in a `Map<id, SidebarTab>` with the same dup-key
  throw the storage path uses.
- `PluginContext.refreshSidebar()` lands as a no-op stub the
  sidebar wires later.
- `gallery/sidebar.ts` gets the `#renderViewsSection()`
  build path + tab-row chrome.
- `gallery/file-manager.ts` gets the new callback wiring.
- `app.ts` wires `getSidebarTabs` + `refreshSidebar` deps.
- `~6 plugin-host tests`: register, find by id, list preserves
  order, duplicate id throws, isolated registration error,
  filtering of `visible:false`.

Expected delta: ~120 lines net across plugin-host / sidebar /
file-manager / app.ts.

### Phase 2 _(optional)_ — Active-state polish

If the manual smoke after Phase 1 reveals that the active-tab
highlight glitches under specific timing (e.g. `isActive()`
changes between two `render()` calls without a `refreshSidebar`
fire), add a `MutationObserver` or `requestAnimationFrame`-based
auto-refresh limited to the Views section.

Expected delta: ~30 lines, optional. Land only if the issue is
real.

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

## Open questions (sign-off requested)

1. **Section position.** Plan puts "Views" between Storage and
   Folders. Alternatives: above Storage (top-of-sidebar prominence),
   below Folders (de-emphasised), or interleaved with Folders so
   plugin tabs can sit alongside the user's folders. Lean: between
   Storage and Folders matches the natural reading flow
   (where the data lives → which view of it → which folder).
   ✅ / propose-alternative

2. **Refresh trigger model.** Plan goes with `ctx.refreshSidebar()`.
   Alternative: setter-based (`updateSidebarTab(id, partial)`) so
   the host knows what changed and can do diff-based DOM updates.
   Setter is more code now, more headroom later. Lean: getter
   model for MVP — matches `StorageRegistration.status()` and
   keeps plugin code declarative.
   ✅ / setter-based

3. **Selection model.** Plan: at most one tab is "active" at a
   time, plugin enforces (its `isActive()` returns true for at
   most one of its own tabs). The sidebar doesn't enforce
   single-selection across plugins — two plugins can both report
   active simultaneously. Lean: keep enforcement plugin-side; the
   sidebar's job is to render what plugins report.
   ✅ / sidebar-enforces-single

4. **Reference plugin.** `plugin-storage-registration.md`
   shipped Phase C without a built-in plugin (Cloud was the first
   real consumer); same approach here. The 6 unit tests cover
   the registration plumbing, manual smoke covers the sidebar
   rendering. Alternative: ship a small "Recent" built-in tab
   in this plan as a reference + smoke-test target.
   ✅ no-builtin / ship-Recent-as-builtin

5. **`disableBuiltinTabs` opt-out option on `App.init`.** Mirrors
   `disableBuiltinStorage` / `disableBuiltinPlugins`. Only useful
   if we add built-in tabs (see #4). Lean: defer until the first
   built-in lands; the option is trivial to add then and the
   shape will be exactly parallel to the existing two.
   ✅ defer / land-now-with-empty-list

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
