# `app.ts` Decomposition + Plugin API MVP

> **Status:** Queued. Prerequisite for carving `annot-cloud` out of
> this repo per [`oss-cloud-split.md`](./oss-cloud-split.md). No
> code has been written yet; this plan is the execution spec.
>
> **Compatibility:** Touches `packages/web/src/app.ts` (2.6k lines,
> the PWA host's god-class) and promotes a `PluginHost` entry point
> to the public surface of `@ingcreators/annot-web`. Zero changes
> to `@ingcreators/annot-core` interfaces; existing contract tests
> (165) are the safety net for the refactor.
>
> **Risk:** Medium. `app.ts` owns router handling, storage bridge,
> editor wiring, scratchpad lifecycle, capture/paste flows, and the
> save debounce. Moving the wrong thing breaks a save or a route in
> a subtle way. The staged landing below keeps each PR small enough
> to revert independently.

## Context

`packages/web/src/app.ts` is 2 628 lines. It boots the PWA, owns
routing, wires every editor session, handles save debouncing,
drives scratchpad UX, and implements capture/paste/open flows —
all inside a single `AnnotApp` class. That shape worked while we
were iterating fast, but it now blocks two concrete goals:

1. **`annot-cloud` split** (see
   [`oss-cloud-split.md`](./oss-cloud-split.md)). The cloud-web
   package is meant to be a thin extender over `packages/web`, not
   a fork. With the current shape, "extend" means forking the
   entire `AnnotApp` class and copy-patching methods; every OSS
   change is then a manual rebase. We need extension points.

2. **Plugin surface for third parties** (see
   [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) —
   "headless annotator" north star). Users who embed the editor
   in their own shell want a stable hook surface for "after image
   saved", "enrich file-details drawer", "add toolbar button",
   "register storage backend" without touching Annot source.
   `annot-cloud` becomes the first consumer of this API — if the
   Cloud extensions can land as plugins (not forks), the shape is
   right.

The decomposition and the plugin API are the same piece of work.
Splitting `app.ts` into collaborator modules gives us the
interior seams where the plugin hooks naturally sit.

## Goals

- `app.ts` drops below ~600 lines — just the orchestration of
  collaborators.
- Each collaborator has a single responsibility, owns its state,
  and exposes a narrow interface (no `AnnotApp` back-reference).
- A minimal `PluginHost` contract is in place: cloud-web and any
  third party can register hooks without patching `AnnotApp`.
- Existing tests (165) keep passing through every phase.
- No user-visible regressions in the editor / gallery / capture
  flows — verified manually at phase boundaries.

## Non-goals

- Rewriting `AnnotApp` in Lit / React / framework X. Incremental
  TS-class extraction; Lit migration is a separate plan.
- Full plugin store UI, remote plugin loading, signing, sandboxing.
  MVP is in-tree plugin registration with static imports; remote
  loading is deferred to `annot-cloud`.
- Changing the `StorageProvider` contract. Backend contract tests
  (see `packages/web/src/storage/contract.test-helpers.ts`) lock
  that surface.
- Changing routing or URL schemes (see
  [`url-schemes.md`](../url-schemes.md)).

## Design

### Target layout

```
packages/web/src/app/
  app.ts                  — AnnotApp orchestrator (≤600 lines)
  boot.ts                 — init(), DOM bootstrap, service-worker reg
  router-host.ts          — handleRoute, #handleHandoff, route→view
  storage-bridge.ts       — StorageProvider factory + mode switching
                            (moved from ./storage/bridge.ts, the
                            current module keeps its existing surface)
  editor-session.ts       — setupEditor, #disposePreviousEditor,
                            CanvasManager/History/SelectionManager
                            wiring + teardown
  save-pipeline.ts        — writeAnnotationsToStorage,
                            writeThumbnailToStorage, save debounce,
                            save-in-flight / pending state machine
  scratchpad-host.ts      — #saveSelectionToScratchpad,
                            #openScratchpadPopover, #armScratchpadPaste
  capture-host.ts         — captureScreenAndSave, pasteAndSave,
                            timedCaptureAndSave, openFile, openFileDialog
  header-host.ts          — #buildEditorHeader, breadcrumb, filename
                            rename, file actions cluster
  status-host.ts          — buildEditorStatusbar, zoom controls,
                            SaveStatusIndicator wiring
  session-slice.ts        — (moved from current app.ts) session
                            URL handling + record grouping for
                            Slice export
```

The `app/` directory is new; `packages/web/src/app.ts` becomes
`packages/web/src/app/app.ts` with the other files siblings.

### PluginHost contract (MVP)

```ts
// packages/web/src/app/plugin-host.ts

export interface AnnotPluginHost {
  /** Called at init time. Receives the app's collaborator registry
   *  so the plugin can call into editor-session / save-pipeline /
   *  storage-bridge without touching `AnnotApp` itself. */
  register(ctx: PluginContext): void;
}

export interface PluginContext {
  /** Run `fn` just after the editor has loaded an image but before
   *  the first `onStateChange` fires. Use this to patch the right
   *  panel, inject toolbar items, pre-load metadata, etc. */
  onEditorReady(fn: (ev: EditorReadyEvent) => void): void;

  /** Run `fn` after a save lands successfully. Gets the final path
   *  (post-rename / post-move) and the storage mode. */
  onAfterSave(fn: (ev: AfterSaveEvent) => void): void;

  /** Run `fn` when the gallery transitions to / from a specific
   *  route. Lets a plugin show a "team library" tab without forking
   *  `handleRoute`. */
  onRouteChange(fn: (ev: RouteChangeEvent) => void): void;

  /** Register a storage backend under a string mode key. The plugin
   *  returns a `StorageProvider` factory that boot calls when
   *  `loadLastStorage()` yields the plugin's mode. `annot-cloud`
   *  uses this to slot in its pointer-commit store. */
  registerStorage(mode: string, factory: StorageProviderFactory): void;

  /** Append items to the file-details drawer's "external links"
   *  section. Used today for GitHub "View on GitHub" — plugins can
   *  add their own ("Team comment thread", "JIRA ticket", …). */
  addExternalLinkSource(fn: ExternalLinkSource): void;
}
```

The `ctx` object is constructed once per app init and frozen —
plugins can only add listeners, not replace app state. This is the
key property that keeps the OSS ↔ Cloud boundary clean: Cloud
plugins can observe and extend, not mutate.

Hook registration is synchronous at init time; hook dispatch is
event-based. No `await plugin.fn()` blocks the main flow — plugins
that need to do async work should own their own promise state.

### Collaborator interface shape

Each collaborator is a class with a constructor that takes its
dependencies explicitly. No shared `this` with `AnnotApp`:

```ts
// packages/web/src/app/save-pipeline.ts
export class SavePipeline {
  constructor(
    private readonly storage: () => StorageProvider,
    private readonly pluginCtx: PluginDispatchContext,
  ) {}

  // Public surface callable from other collaborators / AnnotApp.
  async writeAnnotations(path: string, svg: string, tags: Record<string, string>): Promise<void> {
    // ...existing logic from app.ts#writeAnnotationsToStorage
    this.pluginCtx.dispatchAfterSave({ path, mode: getStorageMode() });
  }
}
```

`AnnotApp` holds the collaborators and the plugin context. It's
reduced to:

```ts
class AnnotApp {
  #storage = new StorageBridge();
  #router = new RouterHost(this.#storage);
  #editorSession = new EditorSession(this.#storage, this.#pluginCtx);
  #savePipeline = new SavePipeline(() => this.#storage.current, this.#pluginCtx);
  #captureHost = new CaptureHost(this.#storage, this.#savePipeline);
  // …etc

  async init() { /* wire events, register builtin plugins, handleRoute */ }
}
```

### OSS vs Cloud split mechanism

`annot-cloud` provides its own boot module:

```ts
// annot-cloud/packages/cloud-web/src/main.ts
import { AnnotApp } from "@ingcreators/annot-web";
import { pointerStorePlugin } from "./plugins/pointer-store";
import { teamGalleryPlugin } from "./plugins/team-gallery";
import { commentThreadPlugin } from "./plugins/comment-thread";

const app = new AnnotApp({
  plugins: [pointerStorePlugin, teamGalleryPlugin, commentThreadPlugin],
});
await app.init();
```

Cloud ships its own `main.ts` / `index.html`; OSS `packages/web`
is consumed as a library. No OSS code path imports `annot-cloud`.

## Phased plan

Each phase lands as a focused PR. The contract tests (165 currently)
act as the regression safety net at every phase boundary.

### Phase 0 — Seams without behaviour change _(this PR is the plan doc; Phase 0 is the first implementation PR)_

Extract **pure helpers** out of `app.ts` into sibling files. No
class split yet, just moving free functions to reduce the file's
surface.

- `bumpFilenameSuffix`, `retryFsOp` → `./app/fs-utils.ts`
- `#findSessionRecords` session-matching logic → `./app/session-slice.ts`
- Click-marker rendering (`#addClickMarker`) →
  `./app/click-marker.ts`
- Restore-annotations helper (`restoreAnnotations`) →
  `./app/restore-annotations.ts`

Expected delta: −400 lines from `app.ts`, 4 new small modules,
zero behaviour change. Verified by diffing build output
byte-for-byte with the pre-split state.

### Phase 1 — `SavePipeline` + `CaptureHost`

Extract the save debounce machinery and the capture/paste flows.
These are the cleanest seams — both already live in their own
methods with well-defined inputs (`ImageRecord` / `Blob` / image
data) and outputs (path, save status).

Deliverables:

- `SavePipeline` class (save debounce, `writeAnnotationsToStorage`,
  `writeThumbnailToStorage`, flushPendingSave, saveInFlight
  state machine).
- `CaptureHost` class (`captureScreenAndSave`, `pasteAndSave`,
  `timedCaptureAndSave`, `openFile`, `openFileDialog`).
- Both take `StorageProvider` via a getter (not a snapshot) to
  keep mode-switch semantics.
- `AnnotApp` holds references; its methods forward to the
  collaborators unchanged.
- Expected delta: −600 lines from `app.ts`.

### Phase 2 — `EditorSession` + `HeaderHost` + `StatusHost`

Extract the editor wiring surface. This is where most of `app.ts`'s
complexity lives — canvas setup, history registration, toolbar
plumbing, keyboard help installation, header/statusbar building.

Deliverables:

- `EditorSession` class owning `#currentEditor`,
  `#disposePreviousEditor`, `setupEditor`, right-panel instance,
  scratchpad store hookup.
- `HeaderHost` class owning `#buildEditorHeader`, breadcrumb,
  filename rename, file-actions cluster, external-links section.
- `StatusHost` class owning `buildEditorStatusbar`,
  `SaveStatusIndicator`, zoom controls.
- `AnnotApp#handleRoute` becomes a thin switch that delegates to
  the right collaborator based on parsed route.
- Expected delta: −1000 lines from `app.ts`.

### Phase 3 — `RouterHost` + `StorageBridge` + `ScratchpadHost`

Extract the remaining owner-blocks.

Deliverables:

- `RouterHost` class owning `handleRoute`, `#handleHandoff`,
  `#handleGoogleDriveHandoff`, `parseRoute` integration.
- `StorageBridge` class — current `./storage/bridge.ts` promoted
  to a stateful collaborator instead of a module of globals; the
  bridge decides which `StorageProvider` is active and surfaces
  mode transitions as events.
- `ScratchpadHost` class — `#saveSelectionToScratchpad`,
  `#openScratchpadPopover`, `#armScratchpadPaste`.
- Expected delta: `app.ts` down to ~500 lines (init + collaborator
  wiring + top-level events).

### Phase 4 — Plugin API MVP

At this point `AnnotApp` is a set of wired collaborators. Introduce
`PluginHost` and the `PluginContext` shape.

Deliverables:

- `packages/web/src/app/plugin-host.ts` — the `AnnotPluginHost`
  interface, the dispatch implementation, the `PluginContext`
  factory.
- Built-in plugins:
  - `github-external-links` — existing "View on GitHub" link logic
    moved from `HeaderHost` into a plugin, as the reference
    implementation and validation that the API covers real use.
  - `drive-external-links` — similar for Drive's "Open in Drive".
- `AnnotApp.init(opts: { plugins?: AnnotPlugin[] })` — plugin list
  is constructor-time input, not discovered globally.
- Test: a minimal third-party plugin in
  `packages/web/src/app/plugin-host.test.ts` verifies hook
  dispatch order + isolation.

### Phase 5 — `annot-cloud` readiness check _(gate)_

Before declaring the decomposition done, sanity-check it against
the cloud-web requirements:

- [ ] Is there a hook for injecting a custom `StorageProvider`
      mode? (Cloud needs this for pointer-commit store.)
- [ ] Is there a hook for adding tabs to the gallery sidebar?
      (Cloud needs "Team library".)
- [ ] Is there a hook for adding items to the file-details
      drawer? (Cloud needs "Comment thread", "PR context".)
- [ ] Is there a hook for intercepting save to add server-side
      state (comments, team metadata)? The `onAfterSave` event
      covers observation — Cloud may also need
      `onBeforeSave(cancel?)` if a save needs server validation.
- [ ] Does the editor-session surface let a plugin inject extra
      right-panel sections? (Cloud: team presence, per-image
      comment count.)

Any "no" → add the missing hook as a Phase 5 PR before closing
this plan.

## Verification

At each phase:

- `pnpm -r typecheck` passes.
- `pnpm test` — all 165 (or more, for Phase 4 plugin tests) pass.
- `pnpm lint` — 0 findings.
- `pnpm --filter @ingcreators/annot-web build` succeeds; bundle
  size within ±3 % of pre-phase (larger deltas want a look).
- Manual smoke: open gallery → open image → edit → save → close
  → reopen → see the edit. Repeat with Drive + GitHub backends.

Phase boundary discipline: **merge before starting the next phase**.
Each phase's PR must be revertable in isolation. Don't chain
branches.

## Migration notes

- No user-facing migration. The PWA keeps the same URLs, storage,
  and interaction model.
- Public API consumers: once Phase 4 lands,
  `@ingcreators/annot-web`'s entry point changes from "a bundle"
  to "an exported `AnnotApp` class". Self-hosters currently import
  via the HTML / service-worker flow and won't notice. Plugin
  authors get a new hook surface they didn't have before.
- The `packages/web/src/storage/bridge.ts` shim is kept through
  Phase 3 so the cross-collaborator import tree stays flat during
  the refactor; only Phase 3 formally promotes it to
  `StorageBridge`.

## Open questions

- **Lit migration timing.** Should right-panel / header / file-
  details be migrated to Lit components during this refactor, or
  stay as imperative DOM? Current lean: stay imperative. The
  refactor's job is to clean up `app.ts`; Lit migration is a
  separate plan with its own cost model. Deferred.
- **Plugin discovery.** MVP is constructor-time list. Later,
  static-discovery via `package.json#annot-plugin` entry (à la
  Vite plugins) or runtime registration via a well-known global?
  Deferred to post-MVP; the hook contract doesn't depend on the
  discovery mechanism.
- **Cross-session plugin state.** If a plugin wants to persist
  settings, does it get a slice of `localStorage` under its
  namespace, or bring its own? MVP: "bring your own" (plugins
  namespace their own keys). Revisit if we adopt many plugins.
- **Desktop vs web symmetry.** `packages/desktop` currently owns
  its own thin shell. Should the collaborator split extend there
  too? Probably yes, but as a separate follow-up — desktop's app
  is ~400 lines today and doesn't share `AnnotApp`.

## References

- [`oss-cloud-split.md`](./oss-cloud-split.md) — the split this
  unlocks.
- [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) — "plugin-
  extensible PWA" is listed there under North-Star 3.
- Current `app.ts`: `packages/web/src/app.ts` (2 628 lines at
  HEAD `ae9473e`).
