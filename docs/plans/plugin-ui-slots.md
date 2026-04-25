# Plugin UI Slots

> **Status:** Draft. Authored 2026-04-25 as the third and final
> named follow-up from
> [`app-decomposition.md`](./app-decomposition.md) Phase 5; siblings
> are
> [`plugin-storage-registration.md`](./plugin-storage-registration.md)
> (landed) and
> [`plugin-sidebar-tabs.md`](./plugin-sidebar-tabs.md) (Phase 1
> landed). Awaiting sign-off before implementation.
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
> **Risk:** Medium. Both surfaces have fixed internal structures
> that this plan extends; built-ins keep their existing render
> paths byte-for-byte, but the lifecycle plumbing (section mount /
> unmount across editor sessions) is new. Existing 205-test suite
> is the regression net.

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

Built-ins on both surfaces stay hardcoded in this plan — full
migration to the slot model is its own follow-up. Plugin sections
land in a dedicated "trailing" area at the bottom of each panel,
sorted by plugin priority.

## Goals

- A plugin can call `ctx.addUISection(slot)` during `register()`
  and have its section appear at the bottom of either the drawer
  or the right-panel, scoped to the active editor session.
- Per-image data (path, mode, tags) flows into the section's
  mount via a typed context. Plugin updates reactively by
  subscribing to existing `onEditorReady` / `onAfterSave` events
  and re-rendering its own DOM.
- Section mount returns a teardown function the host calls when
  the editor session ends. Mirrors Web Components' connected /
  disconnected semantics.
- Existing built-in sections (drawer's File / Tags / Last commit /
  External links; right-panel's Tool / Selection / Page elements)
  render unchanged byte-for-byte.
- Existing 205-test suite keeps passing; ~8 new tests cover
  registration, target routing, lifecycle, and per-image context.

## Non-goals

- **Migrating built-ins to the slot API.** The drawer's File /
  Tags / Last commit blocks and the right-panel's Tool /
  Selection / Page elements blocks stay hardcoded. Migration is
  a larger refactor with no concrete consumer pressure today;
  tracked as a future follow-up if a plugin needs to land
  *between* two built-in sections.
- **Priority interleaving with built-ins.** Plugin sections all
  render in a dedicated trailing area at the bottom of each
  panel. This avoids exposing built-in priorities (and locking
  in their values for backwards-compat). Re-considered if
  Cloud's comment-thread really needs to land above the
  external-links section.
- **Cross-target sections.** A single section registration
  targets exactly one surface. A plugin that wants both a
  drawer AND a right-panel section calls `addUISection` twice.
- **State injection for built-in DOM (drawer's `setData`,
  right-panel's `setPageMetadata`).** Built-ins keep their
  imperative setters; plugin sections own their DOM and
  subscribe to events for updates.
- **DOM-shape contract.** Plugins are free to use any
  framework / templating / vanilla DOM inside their mount
  container. The host doesn't enforce CSS classes or layout
  conventions beyond providing a flex-column container.

## Design

### `UISection` shape

Exported from
[`packages/web/src/app/plugin-host.ts`](../../packages/web/src/app/plugin-host.ts)
alongside `StorageRegistration` and `SidebarTab`:

```ts
export type UISectionTarget = "drawer" | "right-panel";

export interface UISectionContext {
  /** Path of the open image. Always set when the section is
   *  mounted — sections only render when there's an active
   *  editor session. */
  readonly path: string;
  /** Storage mode at mount time. Stable for the section's
   *  lifetime — image swap unmounts + remounts. */
  readonly mode: string;
  /** Snapshot of `tags` at mount time. To react to tag changes
   *  during a session, the plugin subscribes to `onAfterSave`
   *  via the same `PluginContext` and re-reads from its own
   *  state-management layer. */
  readonly tags: Readonly<Record<string, string>>;
}

export interface UISection {
  /** Stable id, unique across all `addUISection` calls (regardless
   *  of target). Plugin-owned namespace —
   *  e.g. `"cloud.comment-thread"`. Throws on duplicate. */
  readonly id: string;

  /** Which surface this section renders into. */
  readonly target: UISectionTarget;

  /** Sidebar header. The host wraps the plugin's mount container
   *  in a section frame matching the existing built-in sections
   *  (heading + content). */
  readonly title: string;

  /** Render order within the trailing plugin-section area. Lower
   *  numbers render first. Falsy = `+Infinity` (appended last).
   *  Stable sort, ties fall back to registration order. There
   *  are no reserved built-in priorities in this plan since
   *  built-ins don't share the slot. */
  readonly priority: number;

  /** Mount the section. Called when the editor session opens an
   *  image (or when the plugin registers, if a session is already
   *  active). The host hands the plugin an empty `<div>` to render
   *  into. The plugin returns a teardown function the host calls
   *  when the section is unmounted (session ends, image swap,
   *  app close). */
  mount(container: HTMLElement, ctx: UISectionContext): () => void;

  /** Optional: hide the section in this session. Read at mount
   *  time only — to dynamically show/hide during a session, the
   *  plugin removes its own DOM via the teardown returned from
   *  `mount`. Default: visible. */
  visible?(ctx: UISectionContext): boolean;
}
```

### `PluginContext.addUISection(section)`

```ts
interface PluginContext {
  // ... existing methods ...

  /** Register a UI section. `id` must be unique across all
   *  registered sections (regardless of target). The host throws
   *  on duplicates so a misconfigured plugin can't shadow another
   *  plugin's section. */
  addUISection(section: UISection): void;
}
```

Validation at registration time:

- Duplicate `id` (collision with a previously-registered section)
  → throws. Errors are isolated by `registerAll`'s existing
  per-plugin try/catch.
- No collision check against `target`-specific ids — both
  drawer and right-panel ids share a single namespace so a
  plugin migrating a section between targets keeps the same id.

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

Single PR scope; the implementation splits internally but ships
together so the API arrives with both targets working.

### Phase 1 — `UISection` API + drawer + right-panel

- Export `UISection` / `UISectionContext` / `UISectionTarget`
  from `plugin-host.ts`.
- `PluginContext.addUISection(section)` lands; `PluginHost`
  tracks sections in a `Map<id, UISection>` with the same
  duplicate-throw semantics as `addSidebarTab`.
- `PluginHost.listUISections()` accessor for the drawer +
  right-panel deps.
- `editor/file-details-drawer.ts` adds the trailing plugin
  area + lifecycle hooks (`getPluginSections`,
  `getCurrentSectionContext` constructor deps).
- `editor/right-panel.ts` adds the same plumbing.
- `app/editor-session.ts` wires both deps from
  `pluginHost.listUISections()` and the current-image state.
- ~8 new tests (215 → 223 total estimated):
  - `addUISection` registers, validates duplicate-id throw,
    accepts both targets in the same id namespace
  - `listUISections` preserves registration order
  - `findUISection` returns undefined for unknown id
  - mount lifecycle: a fake plugin mounts → teardown is called
    on session end (verified via spy)
  - mount-throw doesn't kill sibling sections + logs to
    console.error
  - teardown-throw doesn't break unmount of subsequent sections
  - `visible: false` skips the mount entirely (no teardown
    accumulated)
  - Per-target filtering: a `target: "right-panel"` section
    doesn't appear in the drawer.

  DOM-touching tests use `// @vitest-environment happy-dom`
  similar to the recent-tab suite.

Expected delta: ~280 lines net (plumbing ~150, tests ~130).

### Phase 2 _(optional)_ — Polish + reference built-in

If Phase 1's manual smoke calls for them:

- A small reference built-in plugin (e.g. an "Image hash"
  drawer section that shows a SHA-1 of the current image
  data — trivial but exercises the lifecycle end-to-end and
  serves as the documentation example).
- `disableBuiltinUISections?: string[]` opt-out on `App.init`,
  mirroring the other three opt-out patterns.
- Section animation polish (slide-in on mount, fade-out on
  teardown).

Lands only if reviewers / first-consumer feedback warrants.

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

## Open questions (sign-off requested)

1. **API granularity.**
   Plan unifies both targets under a single `addUISection({ target })`.
   Alternative: separate `addDrawerSection` / `addRightPanelSection`
   for tighter type-safety on target-specific options (the
   right-panel might later want a `selection: SVGElement[]` field
   on the context, drawer doesn't). Lean: unified for MVP — the
   `target` discriminator is fine.
   ✅ unified / split

2. **Built-in migration.**
   Plan keeps built-ins (drawer's File / Tags / etc.; right-panel's
   Tool / Selection) hardcoded; plugin sections render in a
   trailing area. Alternative: migrate every built-in to the
   `UISection` shape so the panel becomes a generic section host
   and priority interleaving works. Lean: keep hardcoded — full
   migration is a larger refactor with no consumer pressure.
   ✅ hardcoded / migrate-builtins

3. **Mount lifecycle model.**
   Plan: `mount(container) => teardown` (Web Components-style).
   Alternative: section returns a class instance with
   `mount` / `unmount` / `update(state)` hooks (more reactive).
   Lean: `mount → teardown` for MVP; reactive shape is a
   plugin-side concern.
   ✅ mount-teardown / class-with-update

4. **Reference built-in.**
   Plan ships zero built-in sections in Phase 1 (consistent with
   `plugin-storage-registration` Phase C; differs from
   `plugin-sidebar-tabs` which shipped Recent). Alternative:
   ship a small "Image hash" or "Path" demo section.
   ✅ no-builtin / ship-demo-section

5. **`disableBuiltinUISections` opt-out option.**
   Mirrors the existing three. Only useful if we ship built-in
   sections (see #4). Lean: defer until first built-in lands.
   ✅ defer / land-now

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
