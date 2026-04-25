# Plugin UI Slots

> **Status:** Queued. Authored 2026-04-25 as the third and final
> named follow-up from
> [`app-decomposition.md`](./app-decomposition.md) Phase 5; sign-off
> received 2026-04-25 on the five design questions (see "Decisions"
> at the bottom). Siblings are
> [`plugin-storage-registration.md`](./plugin-storage-registration.md)
> (landed) and
> [`plugin-sidebar-tabs.md`](./plugin-sidebar-tabs.md) (Phase 1
> landed).
>
> **Compatibility:** Touches
> [`packages/web/src/editor/file-details-drawer.ts`](../../packages/web/src/editor/file-details-drawer.ts)
> (the per-image side drawer) and
> [`packages/web/src/editor/right-panel.ts`](../../packages/web/src/editor/right-panel.ts)
> (the editor's right-side property panel). Adds a new entry point
> on
> [`packages/web/src/app/plugin-host.ts`](../../packages/web/src/app/plugin-host.ts)'s
> `PluginContext`. No `StorageProvider` changes; no data-schema
> changes.
>
> **Risk:** Medium-high. Both surfaces have fixed internal
> structures today and this plan **migrates every built-in section
> to the same `UISection` shape** (per sign-off decision #2) so
> the panels become generic section hosts instead of bespoke render
> trees. Built-in DOM stays byte-for-byte identical; the difference
> is that each built-in now has a stable id, a `priority`, and
> participates in the same mount / update / unmount lifecycle as
> plugin sections. The 205-test suite is the regression net at
> every phase boundary.

## Context

The Phase 5 audit of `app-decomposition.md` flagged this:

> **File-details-drawer section injection.**
> Cloud needs this for comment-thread + PR-context panels.
> [...]
> **Right-panel section injection** (team presence, per-image
> comment count). `EditorRightPanel` currently owns its section
> list internally.
>
> Drawer section injection tracked alongside the right-panel item
> below under a single `plugin-ui-slots.md` plan.

The motivating use cases — Cloud's **comment thread**, **PR
context**, **team presence**, **per-image comment count** — all
share a shape: "additional UI section that renders alongside
built-in sections, scoped to the current image / editor session".
The two target surfaces (drawer + right-panel) have different
visual roles, but the lifecycle is identical:

- Mount when an editor session starts.
- Unmount when the session ends (gallery navigation, image swap,
  app close).
- Update reactively to image-level state (rename, save, tag
  change) via the existing `onAfterSave` / `onEditorReady`
  events the plugin can subscribe to independently.

**Built-ins migrate to the same `UISection` shape** (sign-off
decision #2). Each existing block (drawer's File / Tags /
External links / Last commit; right-panel's Tool / Selection /
Page elements) becomes a `UISection` with a stable id, `priority`,
and target. The drawer + right-panel render any
`UISection[]` they're handed, with built-in and plugin sections
interleaving by `priority`.

## Goals

- A plugin can call `ctx.addDrawerSection(section)` or
  `ctx.addRightPanelSection(section)` during `register()` and
  have the section appear in the matching surface, sorted by
  `priority` alongside built-ins.
- Per-image data (path, mode, tags) flows into the section's
  mount via a typed context. Reactive updates flow through the
  same context object on `update(ctx)` calls fired by the host
  on rename / save / tag-edit; plugins that don't need
  reactivity can return a plain teardown function and skip the
  update path entirely.
- Both lifecycle shapes are first-class:
  - Simple: `mount(container, ctx) => () => void` — returns a
    teardown function; no update notifications.
  - Reactive: `mount(container, ctx) => { update?(ctx), unmount() }`
    — the host calls `update(ctx)` on relevant state changes
    and `unmount()` on session end.
- Each built-in section has a public id (e.g. `"drawer.file"`,
  `"right-panel.tool-properties"`) and can be opted out of via
  `App.init({ disableBuiltinUISections: ["drawer.file"] })`.
- Existing visible behaviour stays intact — the same heading
  copy, the same row layouts, the same conditional rendering
  (Last commit hidden when no commit, External links hidden
  when none, etc.). The migration is a re-shape, not a
  re-design.
- Existing 205-test suite keeps passing; ~14 new tests cover
  registration on both targets, target-specific id namespaces,
  lifecycle (both shapes), update dispatch, opt-out, and the
  built-in id stability.

## Non-goals

- **Cross-target sections.** A single registration targets
  exactly one surface. A plugin that wants both a drawer AND
  a right-panel section calls both `addDrawerSection` and
  `addRightPanelSection` (different id namespaces, so the
  same plugin can use the same suffix for both:
  `"cloud.comments"` in each).
- **DOM-shape contract.** Plugins are free to use any
  framework / templating / vanilla DOM inside their mount
  container. The host doesn't enforce CSS classes or layout
  conventions beyond providing the section heading + body
  wrapper.
- **Hot-swapping a section's `mount` factory.** Sections are
  registered once at `init` and live for the app's lifetime.
  Re-registering with the same id throws.
- **Migrating away from imperative setters that aren't
  per-section** (drawer's `setData` for header rows; right-panel's
  `setPageMetadata` argument). Those stay imperative; the
  migration is per-section, not a wholesale rewrite of the
  drawer / right-panel APIs.
- **Generalizing the section concept across other surfaces**
  (header chrome, status bar, toolbar). Out of scope; this plan
  is specifically the drawer + right-panel pair.

## Design

### `UISection` shape

Exported from
[`packages/web/src/app/plugin-host.ts`](../../packages/web/src/app/plugin-host.ts)
alongside `StorageRegistration` and `SidebarTab`:

```ts
export interface UISectionContext {
  /** Path of the open image. Always set when the section is
   *  mounted — sections only render when there's an active
   *  editor session. */
  readonly path: string;
  /** Storage mode at mount time / update time. */
  readonly mode: string;
  /** Snapshot of `tags`. Re-read on each `update(ctx)` call. */
  readonly tags: Readonly<Record<string, string>>;
}

/** Lifecycle returned from `mount`. Plugins pick one shape based
 *  on whether they want reactive updates:
 *
 *  - **Function** — simple sections that own their DOM and don't
 *    need notifications when the image state changes. Equivalent
 *    to `{ unmount: fn }`.
 *  - **Object** — reactive sections that want to be notified on
 *    rename / save / tag-edit. The host calls `update(ctx)` with
 *    a fresh context, then `unmount()` on session end.
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

export interface UISection {
  /** Stable id. Unique within the section's target namespace
   *  (drawer ids and right-panel ids are independent — both can
   *  use `"comment-thread"` without colliding). Plugin-owned —
   *  e.g. `"cloud.comments"`. Built-ins reserve dotted ids:
   *  `"drawer.file"`, `"drawer.tags"`, `"right-panel.tool-properties"`,
   *  etc. (full list in the migration section). */
  readonly id: string;

  /** Section heading. The host wraps the plugin's mount container
   *  in a section frame matching the existing built-in sections
   *  (heading + content body). */
  readonly title: string;

  /** Render order within the section's target. Lower numbers
   *  render first. Falsy = `+Infinity` (appended last). Stable
   *  sort, so ties fall back to registration order. Built-ins
   *  reserve priorities documented per surface (see "Built-in
   *  migration" below). */
  readonly priority: number;

  /** Mount the section into the supplied container. Returns
   *  either a teardown function (simple) or a lifecycle object
   *  with `update?` + `unmount`. */
  mount(container: HTMLElement, ctx: UISectionContext): UISectionLifecycle;

  /** Optional: filter at mount time. False skips the section
   *  entirely (no `mount` call, no DOM). Plugins use this for
   *  "hide when no comments exist yet" type cases. Default:
   *  always visible. */
  visible?(ctx: UISectionContext): boolean;
}
```

### `PluginContext` additions — split per target

Per sign-off decision #1, the registration API is split by
target rather than carrying a `target` discriminator. This
gives type safety on target-specific options if either surface
ever needs them (the right-panel context might gain
`selection: SVGElement[]` later; the drawer wouldn't):

```ts
interface PluginContext {
  // ... existing methods ...

  /** Register a section in the file-details drawer. `id` must be
   *  unique across all drawer sections (built-in + plugin);
   *  duplicates throw. Sections render sorted by `priority`. */
  addDrawerSection(section: UISection): void;

  /** Register a section in the editor right-panel. `id` must be
   *  unique across all right-panel sections (built-in + plugin);
   *  duplicates throw. */
  addRightPanelSection(section: UISection): void;
}
```

Each registration goes into its own keyed map on the host;
ids only need to be unique within the target. The two sets of
accessors mirror the existing `listStorageRegistrations`
pattern:

```ts
class PluginHost {
  // ...
  listDrawerSections(): UISection[];
  listRightPanelSections(): UISection[];
  findDrawerSection(id: string): UISection | undefined;
  findRightPanelSection(id: string): UISection | undefined;
}
```

### Built-in migration

Per sign-off decision #2, every existing built-in section
becomes a `UISection`. The drawer + right-panel internal render
loops collapse into "iterate the section list, sort by
`priority`, mount each one in order".

**Drawer built-ins** (defined in
[`editor/file-details-drawer.ts`](../../packages/web/src/editor/file-details-drawer.ts)):

| Id | Title | Priority | Notes |
|----|-------|----------|-------|
| `drawer.file` | "File" | 10 | Filename + folder + dimensions + size + dates + source URL — uses the existing `setData` imperative refresh pattern internally, which the section translates into `update(ctx)` on the lifecycle object. |
| `drawer.tags` | "Tags" | 20 | The tag editor; `update(ctx)` re-reads `ctx.tags`. |
| `drawer.last-commit` | "Last commit" | 30 | GitHub-only, hidden when no commit info; `visible(ctx)` gates on storage mode. |
| `drawer.external-links` | "External links" | 40 | Already plugin-extensible via `addExternalLinkSource` (Phase 4); the migrated section calls `pluginHost.collectExternalLinks` for its data and renders the heading conditionally. |

**Right-panel built-ins** (defined in
[`editor/right-panel.ts`](../../packages/web/src/editor/right-panel.ts)):

| Id | Title | Priority | Notes |
|----|-------|----------|-------|
| `right-panel.tool-properties` | (dynamic — current tool's name) | 10 | Tool-specific property controls. Title comes from the active tool, so the section's `title` field is "(set per tool)" and the actual heading is overridden at mount time. |
| `right-panel.selection-properties` | (dynamic — element kind) | 20 | Properties of the selected element(s). |
| `right-panel.page-elements` | "Page elements" | 30 | DOM metadata sidebar — visible only when `pageMetadata` is set. |

The dynamic-title cases (tool / selection) need a small API
extension: the section can call `ctx.setTitle(newTitle)` from
inside `mount` to override the heading post-construction. This
keeps the registration value type-safe while letting built-ins
that already title themselves dynamically (the existing
right-panel does) keep their behaviour.

Plugin sections that want a dynamic title can use the same
mechanism. To keep the API surface small, the `setTitle`
function is part of the `UISectionContext` (so it's available
on every `mount` and `update` call):

```ts
export interface UISectionContext {
  readonly path: string;
  readonly mode: string;
  readonly tags: Readonly<Record<string, string>>;
  /** Override the section heading. Idempotent; calling with the
   *  same string is a no-op. The host re-renders only the
   *  heading element, not the section body. */
  setTitle(title: string): void;
}
```

### `disableBuiltinUISections` opt-out

Per sign-off decision #5:

```ts
app.init({
  disableBuiltinUISections: [
    "drawer.last-commit",          // hide GitHub commit info
    "right-panel.page-elements",   // hide DOM metadata
  ],
});
```

Semantics:

- The id must match a known built-in id; unknown ids log a
  warning + no-op (forward-compat with newer-than-config
  deployments).
- A disabled built-in is filtered out of the drawer's /
  right-panel's section list before sort, so it doesn't render
  at all.
- Plugin sections cannot be disabled via this option (they're
  the plugin author's responsibility — they have their own
  `visible?(ctx)` predicate).

### Drawer + right-panel host plumbing

Both surfaces shrink to "section list host + sort + mount loop":

**Drawer** (
[`editor/file-details-drawer.ts`](../../packages/web/src/editor/file-details-drawer.ts)):

```ts
class FileDetailsDrawer {
  // ... existing fields ...
  #sectionStates: Array<{
    section: UISection;
    headingEl: HTMLElement;
    bodyEl: HTMLElement;
    lifecycle: UISectionLifecycle;
  }> = [];

  #renderSections(): void {
    this.#disposeSections();
    const all = this.#getAllSections();      // built-ins + plugins, filtered by disable set
    const sorted = all
      .filter((s) => (s.visible ? s.visible(this.#ctx()) : true))
      .sort((a, b) => a.priority - b.priority);
    for (const section of sorted) {
      const sectionEl = this.#createSection(section.title);
      const body = document.createElement("div");
      sectionEl.appendChild(body);
      this.#panel.appendChild(sectionEl);
      try {
        const lifecycle = section.mount(body, this.#ctx());
        this.#sectionStates.push({ section, headingEl: ..., bodyEl: body, lifecycle });
      } catch (e) {
        console.error(`[drawer] section "${section.id}" mount threw:`, e);
        sectionEl.remove();
      }
    }
  }

  /** Dispatch update to every section that opted into the
   *  reactive lifecycle. Called from the existing `setData` and
   *  `setLastCommit` imperative entry points (which now also
   *  re-emit through this path) and from the editor session's
   *  `onAfterSave` hookup. */
  notifyUpdate(): void {
    const ctx = this.#ctx();
    for (const state of this.#sectionStates) {
      if (typeof state.lifecycle === "object" && state.lifecycle.update) {
        try { state.lifecycle.update(ctx); }
        catch (e) {
          console.error(`[drawer] section "${state.section.id}" update threw:`, e);
        }
      }
    }
  }

  #disposeSections(): void {
    for (const state of this.#sectionStates) {
      try {
        if (typeof state.lifecycle === "function") state.lifecycle();
        else state.lifecycle.unmount();
      } catch (e) {
        console.error(`[drawer] section "${state.section.id}" unmount threw:`, e);
      }
    }
    this.#sectionStates = [];
  }
}
```

**Right-panel** mirrors the same shape — `#sectionStates`,
`#renderSections`, `notifyUpdate`, `#disposeSections`. Its
existing imperative entry points (`showToolProperties`,
`showSelectionProperties`, `setPageMetadata`) become section-
internal — each affected built-in section subscribes to the
relevant state via the lifecycle's `update` hook and the
right-panel surface as a whole exposes `notifyUpdate` for
external triggers.

### `EditorSession` wiring

[`app/editor-session.ts`](../../packages/web/src/app/editor-session.ts)
constructs both surfaces today; Phase 1 adds two new dep
callbacks per surface:

```ts
this.#editorSession = new EditorSession(
  {
    // ... existing deps ...
    getDrawerSections: () => this.#composeDrawerSections(),
    getRightPanelSections: () => this.#composeRightPanelSections(),
    isBuiltinUISectionDisabled: (id) =>
      this.#disabledBuiltinUISections.has(id),
  },
  // ...
);
```

`#composeDrawerSections` returns the array of drawer built-in
sections + `pluginHost.listDrawerSections()` filtered by the
disable set; same for right-panel. `EditorSession` passes
these through to the drawer / right-panel constructors as
their `getAllSections` deps.

`notifyUpdate` is wired to fire from the existing
`onAfterSave` dispatcher (after a save lands) and from the
existing rename flow's `setData` call.

### Lifecycle ordering

1. **Session start** — `setupEditor` constructs drawer +
   right-panel; their constructors call `#renderSections()`
   which mounts every visible section in priority order.
2. **Rename / save / tag-edit** — drawer's `setData` and
   right-panel's analogous setters trigger `notifyUpdate`.
   Reactive sections receive the call; simple-teardown
   sections don't.
3. **Session end** — `EditorSession.resetSessionUI()` calls
   `drawer.destroy()` / `rightPanel.destroy()`, which both
   run `#disposeSections()` first.
4. **Image swap** — current `disposePreviousEditor` flow
   tears the previous editor down and rebuilds, so plugin
   sections naturally unmount + remount with the new context.

### Drawer + right-panel host plumbing

Both surfaces gain a "Plugin sections" footer area:

**Drawer** (
[`editor/file-details-drawer.ts`](../../packages/web/src/editor/file-details-drawer.ts)):

```ts
class FileDetailsDrawer {
  // ... existing fields ...
  #pluginSectionTeardowns: Array<() => void> = [];

  #render(): void {
    // ... existing built-in sections ...
    this.#renderPluginSections(); // NEW — appended last
  }

  #renderPluginSections(): void {
    this.#disposePluginSections();
    const sections = this.#getPluginSections?.() ?? [];
    const sorted = sections
      .filter((s) => s.target === "drawer")
      .filter((s) => (s.visible ? s.visible(this.#sectionCtx()) : true))
      .sort(byPriority);
    for (const s of sorted) {
      const wrap = this.#createSection(s.title);
      const body = document.createElement("div");
      body.className = "drawer-section-plugin-body";
      wrap.appendChild(body);
      this.#panel.appendChild(wrap);
      try {
        const teardown = s.mount(body, this.#sectionCtx());
        this.#pluginSectionTeardowns.push(teardown);
      } catch (e) {
        console.error(`[drawer] plugin section "${s.id}" mount threw:`, e);
      }
    }
  }

  #disposePluginSections(): void {
    for (const fn of this.#pluginSectionTeardowns) {
      try { fn(); } catch (e) {
        console.error("[drawer] plugin section teardown threw:", e);
      }
    }
    this.#pluginSectionTeardowns = [];
  }

  destroy(): void {
    this.#disposePluginSections();
    // ... existing teardown ...
  }
}
```

**Right-panel** (
[`editor/right-panel.ts`](../../packages/web/src/editor/right-panel.ts)):

Same shape — a `#renderPluginSections()` method that runs after
the existing built-in section assembly, plus a teardown loop in
`destroy()`. The right-panel rebuilds eagerly in the constructor
today; a small refactor makes "render plugin sections" a public
method the parent can re-trigger if needed.

### `EditorSession` wiring

[`app/editor-session.ts`](../../packages/web/src/app/editor-session.ts)
already constructs both `FileDetailsDrawer` and
`EditorRightPanel`. Phase 1 of this plan adds two new constructor
deps to each:

- `getPluginSections: () => UISection[]` — returns the full
  registered list; the surface filters by `target` itself.
- `getCurrentSectionContext: () => UISectionContext` — produces a
  fresh context object on each call (used for both `mount` and
  `visible`).

`EditorSession` reads these from its own deps, which `App.init`
wires to the plugin host:

```ts
this.#editorSession = new EditorSession(
  {
    // ... existing deps ...
    getPluginSections: () => this.#pluginHost.listUISections(),
    getCurrentSectionContext: () => ({
      path: this.#currentImagePath ?? "",
      mode: getStorageMode(),
      tags: { ...this.#currentTags },
    }),
  },
  // ...
);
```

### Lifecycle ordering

1. **Session start** (image opens):
   `setupEditor` builds the canvas / drawer / right-panel.
   Both surfaces call `#renderPluginSections()` at the end of
   their build; teardown handles registered.

2. **Session end** (gallery navigation / image swap):
   `EditorSession.resetSessionUI()` calls `drawer.destroy()` and
   `rightPanel.destroy()`, which both run their teardowns first.

3. **Image swap during session** (route push that loads a
   different image):
   The current setupEditor path tears the previous editor down
   (`disposePreviousEditor`) and rebuilds, so plugin sections
   naturally unmount + remount with the new context. No new
   notification protocol needed.

4. **Tag / save updates within a session**:
   No automatic section refresh. Plugins that need it subscribe
   via `ctx.onAfterSave` and re-render their own DOM
   imperatively. This matches the existing "plugin owns its
   DOM after mount" pattern and avoids forcing the host into a
   reactive loop the plugin may not want.

## Phased plan

Multi-PR scope. The migration touches enough surface that
shipping it as one PR would make the diff hard to review;
splitting along surface boundaries (drawer first, then
right-panel) keeps each phase independently revertable.

### Phase 1 — `UISection` API + plugin host plumbing

Pure plumbing; no built-in migration in this phase. Plugins
can register sections but the surfaces don't display them yet.

- Export `UISection` / `UISectionContext` / `UISectionLifecycle`
  from `plugin-host.ts`.
- `PluginContext.addDrawerSection` + `addRightPanelSection`.
- `PluginHost.listDrawerSections` / `listRightPanelSections` /
  `findDrawerSection` / `findRightPanelSection` accessors with
  per-target id namespaces.
- `App.init({ disableBuiltinUISections })` lands; the disable
  set is stored on App and exposed via the deps interface
  collaborators consume.
- ~6 plugin-host tests:
  - `addDrawerSection` registers; duplicate id throws.
  - `addRightPanelSection` registers; duplicate id throws.
  - The two namespaces are independent — same id allowed
    across targets.
  - `list*` preserves registration order.
  - Unknown ids in `disableBuiltinUISections` warn + no-op.
  - Setter is plumbed into the dep getter at `App.init`.

**Lands as one PR.** Expected delta: ~150 lines net
(plugin-host + tests). Plugin sections don't render anywhere
yet — that's Phase 2 / 3.

### Phase 2 — Drawer migration

[`editor/file-details-drawer.ts`](../../packages/web/src/editor/file-details-drawer.ts)
becomes a generic section host. The four built-in blocks
(File / Tags / Last commit / External links) migrate to
`UISection` shapes living in
`packages/web/src/editor/drawer-sections/*.ts`. The drawer's
constructor takes a `getAllSections` callback that returns the
built-in + plugin list filtered by the disable set; render +
update + dispose loops replace the existing per-section render
methods.

- `editor/drawer-sections/file-section.ts` — id `drawer.file`,
  priority 10. Reads `data` via the existing imperative
  `setData` path translated to `update(ctx)`. The header rows
  (filename rename, folder, dimensions, file size, dates,
  source URL) move into the section.
- `editor/drawer-sections/tags-section.ts` — id `drawer.tags`,
  priority 20.
- `editor/drawer-sections/last-commit-section.ts` — id
  `drawer.last-commit`, priority 30. `visible(ctx)` returns
  `false` when no `lastCommit` data is present.
- `editor/drawer-sections/external-links-section.ts` — id
  `drawer.external-links`, priority 40. Calls
  `pluginHost.collectExternalLinks` for its data; renders
  conditionally.
- Drawer constructor accepts `getAllDrawerSections` +
  `isBuiltinUISectionDisabled` deps.
- `notifyUpdate` API lands; `setData` / `setLastCommit` route
  through it.
- `app/editor-session.ts` wires the new deps.
- ~5 tests:
  - Built-in sections render in priority order.
  - `disableBuiltinUISections: ["drawer.tags"]` hides Tags.
  - A plugin section with priority 25 lands between Tags and
    Last commit.
  - Lifecycle: mount called once per session, unmount on
    session end (via spy on a fixture section).
  - Reactive update: a fixture section with `update(ctx)`
    sees the new tags after `notifyUpdate` fires.

  DOM-touching tests use `// @vitest-environment happy-dom`.

**Lands as one PR.** Expected delta: ~400 lines net (built-in
sections move, drawer collapses, tests).

### Phase 3 — Right-panel migration

Same shape as Phase 2 for
[`editor/right-panel.ts`](../../packages/web/src/editor/right-panel.ts):

- `editor/right-panel-sections/tool-properties-section.ts` —
  id `right-panel.tool-properties`, priority 10. Hosts the
  current-tool's property controls via the existing
  `toolbar.renderToolProperties` integration. Title is
  dynamic (set via `ctx.setTitle` from inside `update`).
- `editor/right-panel-sections/selection-properties-section.ts`
  — id `right-panel.selection-properties`, priority 20.
- `editor/right-panel-sections/page-elements-section.ts` — id
  `right-panel.page-elements`, priority 30.
  `visible(ctx)` returns false when `pageMetadata` is null
  (which is most non-extension captures).
- Right-panel constructor accepts the matching deps.
- The existing imperative `showToolProperties` /
  `showSelectionProperties` / `setPageMetadata` entry points
  become section-internal; the right-panel surface exposes
  `notifyUpdate` plus narrow forwarders so callers
  (`EditorSession`'s selection.onChange handler) can keep
  their existing call shapes.
- ~5 tests parallel to Phase 2.

**Lands as one PR.** Expected delta: ~400 lines net.

### Phase 4 _(optional)_ — Polish

Animation + accessibility polish (slide-in on mount, focus
management when a plugin section gains an interactive
element). Lands only if usability testing warrants.

## Verification

- `pnpm -r typecheck` passes.
- `pnpm test` — 205 → ~213 (estimated +8).
- `pnpm lint` — 0 findings.
- `pnpm --filter @ingcreators/annot-web build` — bundle within
  ±3 % of pre-phase.
- Manual smoke (added to PR test plan):
  - Boot the OSS app with no plugin sections registered →
    drawer + right-panel render byte-identical with today.
  - Register a fixture plugin with one drawer section + one
    right-panel section → both appear in their respective
    panels at the bottom, with the section title rendered in
    the same chrome as built-ins.
  - Navigate gallery → editor → gallery → editor → no DOM
    nodes leak (plugin teardown called between sessions).
  - Verify the per-image context flows in: a fixture section
    that prints `ctx.path` reflects the correct path on
    each open.

## Migration notes

- **No data migration.** Pure additive API.
- **No URL scheme change.** Sections render inside existing
  surfaces; no new routes.
- **Existing plugins unaffected.** No change to
  `addExternalLinkSource`, `addSidebarTab`, etc.
- **No breaking change to drawer / right-panel public APIs.**
  Existing callers that don't supply the two new constructor
  deps get the legacy "no plugin sections" behaviour.

## Decisions (sign-off 2026-04-25)

1. **Split registration: `addDrawerSection` + `addRightPanelSection`.**
   Keeps each target's id namespace independent (the same suffix
   like `"comments"` can be reused across drawer and right-panel
   without collision). Opens the door to target-specific context
   shapes later (right-panel could carry `selection` later;
   drawer wouldn't).
2. **Migrate every built-in to the `UISection` shape.** Drawer
   gets `drawer.file` / `drawer.tags` / `drawer.last-commit` /
   `drawer.external-links`; right-panel gets
   `right-panel.tool-properties` / `selection-properties` /
   `page-elements`. The two surfaces become generic section
   hosts that iterate the registered list (built-in + plugin)
   sorted by `priority`, mount each into a section frame, and
   manage the lifecycle. Plugin sections naturally interleave
   with built-ins.
3. **Both lifecycle shapes are first-class.** `mount()` returns
   either a teardown function (simple sections) or
   `{ update?(ctx), unmount() }` (reactive sections). The host
   inspects the return shape and dispatches accordingly.
   Reactive sections receive `update(ctx)` calls when the host
   fires `notifyUpdate` (after rename / save / tag-edit etc.);
   simple sections never get notified.
4. **No reference built-in plugin section.** With every built-in
   migrating to the `UISection` shape, the migrated sections
   are themselves the reference implementations. A separate
   demo plugin would be redundant.
5. **`disableBuiltinUISections: string[]` lands now** with the
   migrated built-in ids as the disable targets. Default empty
   array; unknown ids warn + no-op for forward-compat. A
   deployment can hide `"drawer.last-commit"` /
   `"right-panel.page-elements"` (or any other built-in
   section) without touching plugin code.

## References

- [`app-decomposition.md`](./app-decomposition.md) — Phase 5
  audit; this is the third (and final) named follow-up.
- [`plugin-storage-registration.md`](./plugin-storage-registration.md)
  — sibling plan, established the registration-time-throw +
  `priority`-sort + opt-out pattern this plan inherits.
- [`plugin-sidebar-tabs.md`](./plugin-sidebar-tabs.md) — sibling
  plan, established the mid-session-mutation pattern (setter
  for active flags) and the optional-callback-on-host pattern.
- [`editor/file-details-drawer.ts`](../../packages/web/src/editor/file-details-drawer.ts)
  — drawer host being extended.
- [`editor/right-panel.ts`](../../packages/web/src/editor/right-panel.ts)
  — right-panel host being extended.
