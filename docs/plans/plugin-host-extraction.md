# Plugin host extraction (`PluginHost` class → host-ui)

> **Status:** Draft
>
> **Trigger to flip Draft → Queued:** Desktop or VSCode (or any
> non-PWA host) signals an intent to load plugins. Until then this
> plan stays warm — the design is captured, the dependencies are
> audited, but the actual code move waits for a concrete consumer.
>
> **Compatibility:** No public API change visible to plugin authors.
> The `AnnotPlugin` shape and `PluginContext` surface stay byte-for-
> byte equivalent. Only the import path changes
> (`@ingcreators/annot-web/app/plugin-host` →
> `@ingcreators/annot-host-ui/plugin-host`); plugin authors
> who import the old path get a re-export shim during the migration
> that gets cleaned up in the final phase.
>
> **Risk:** Low. Pure code reorganisation. The class is mostly host-
> agnostic already; one PWA-specific dependency
> (`BUILT_IN_STORAGE_MODES` from `web/src/storage/bridge.ts`) gets
> injected as a constructor option instead of imported.

## Context

[`host-convergence.md`](./host-convergence.md) Phase 4 moves the
plugin-host **types** (`SidebarTab`, `StorageRegistration`,
`NewMenuItem`, `UISection*`, `ExternalLink*`, etc.) into
`@ingcreators/annot-host-ui` so the gallery (also moving to
host-ui in Phase 2) can import them without back-channelling
through `annot-web`. That's the minimum needed for the gallery
move.

This plan covers the **next step** — moving the `PluginHost` class
itself. After this plan lands, any host that mounts `EditorShell`
can also load plugins without depending on `@ingcreators/annot-web`.

The plan is queued separately because:

- The class move has no immediate consumer (Desktop and VSCode
  don't load plugins yet). Doing it now would be code reorganisation
  for its own sake.
- The trigger is concrete: when Desktop's plan to expose annotation
  plugins lands, OR when VSCode's plan to expose plugins (e.g. via
  the extension manifest's `contributes` field) lands, this plan
  becomes the prerequisite.
- Until that trigger, [`host-convergence.md`](./host-convergence.md)
  Phase 4 is a clean stopping point: types in host-ui, class
  in `annot-web`, no host beyond PWA needs the class.

## Current state

`packages/web/src/app/plugin-host.ts` (~580 LOC):

| Responsibility | Lines (approx) | Host-agnostic? |
|---|---|---|
| Type declarations (`AnnotPlugin`, `PluginContext`, `StorageRegistration`, `SidebarTab`, `ExternalLink*`, `EditorReadyEvent`, `BeforeSaveEvent`, `AfterSaveEvent`, `RouteChangeEvent`) | ~150 | ✅ (host-convergence Phase 4 moves these) |
| `PluginHost` class — registries (Maps + arrays) | ~40 | ✅ |
| `PluginHost.registerAll(plugins)` — dispatch + error isolation | ~30 | ✅ |
| `dispatchEditorReady` / `dispatchBeforeSave` / `dispatchAfterSave` / `dispatchRouteChange` | ~80 | ✅ |
| `getExternalLinksFor` (drawer collaborator) | ~30 | ✅ |
| `getStorageRegistrations` / `getSidebarTabs` / `getDrawerSections` / `getRightPanelSections` | ~40 | ✅ |
| `registerStorage` validation against `BUILT_IN_STORAGE_MODES` | ~20 | ❌ — depends on PWA's built-in modes list |
| `addSidebarTab` / `updateSidebarTab` validation (id uniqueness) | ~50 | ✅ |

Imports today:

```ts
import type { IconSpec } from "@ingcreators/annot-core";                       // shared
import type { StorageProvider } from "@ingcreators/annot-core/storage";        // shared
import { BUILT_IN_STORAGE_MODES } from "../storage/bridge.js";                  // PWA-only
import type { ... } from "@ingcreators/annot-host-ui/ui-section";         // already shared
```

The lone PWA-internal dependency is `BUILT_IN_STORAGE_MODES`, used
only for `registerStorage`'s collision-check against the PWA's
built-in storage backends.

## Convergence target

```
packages/host-ui/src/
  plugin-host-types.ts           ← from host-convergence Phase 4
  plugin-host.ts                 ← NEW (this plan)
```

`PluginHost`'s constructor takes the host-specific built-in modes
as an option, defaulting to an empty list:

```ts
new PluginHost({ builtinStorageModes: BUILT_IN_STORAGE_MODES })
```

PWA passes its modes; Desktop / VSCode pass `[]` (or their own
list when / if they grow built-in modes worth colliding against).

`packages/web/src/app/plugin-host.ts` collapses to a thin
re-export shim during the migration and disappears in the final
phase:

```ts
// During migration (Phase 1):
export { PluginHost } from "@ingcreators/annot-host-ui/plugin-host";
export type { ... } from "@ingcreators/annot-host-ui/plugin-host";

// After cleanup (Phase 2):
// (file deleted)
```

## Phases

### Phase 1 — Move + inject

1. Copy `packages/web/src/app/plugin-host.ts` → `packages/host-ui/src/plugin-host.ts`.
2. Replace the `BUILT_IN_STORAGE_MODES` import with a constructor option:
   ```ts
   constructor(opts: { builtinStorageModes?: readonly string[] } = {}) {
     this.#builtinStorageModes = new Set(opts.builtinStorageModes ?? []);
   }
   ```
3. Update `registerStorage` to read `this.#builtinStorageModes` instead of the imported constant.
4. Add the new subpath export to `packages/host-ui/package.json` (`"./plugin-host": "./src/plugin-host.ts"`).
5. Replace `packages/web/src/app/plugin-host.ts` with a re-export shim.
6. PWA's `app.ts` updates `new PluginHost()` → `new PluginHost({ builtinStorageModes: BUILT_IN_STORAGE_MODES })`.
7. PWA's tests (`plugin-host.test.ts`) move with the class to `host-ui/src/plugin-host.test.ts`. Tests pass with the same fixtures because the constructor option default-empty matches the legacy "no built-ins" code path the tests already use.

**Verification.**
- `pnpm -r typecheck`, `pnpm test`.
- The PWA's existing 1k+ tests pass unchanged because the shim preserves the import path.
- `plugin-host.test.ts` passes after the move.

### Phase 2 — PWA migrates off the shim

1. Rewrite PWA imports of `./app/plugin-host.js` to `@ingcreators/annot-host-ui/plugin-host`.
2. Delete the re-export shim at `packages/web/src/app/plugin-host.ts`.

**Verification.**
- `pnpm -r typecheck`, `pnpm test`.
- No file in `packages/web/src/` resolves the old path.

### Phase 3 — Documentation + plan archival

1. Update [`docs/plugin-api/storage.md`](../plugin-api/storage.md) and any other plugin-author docs that reference the old import path.
2. Update CLAUDE.md's "Public API of `@ingcreators/annot-host-ui`" guardrail to mention the new `plugin-host` subpath.
3. Move this plan to `_done/` with a `Done (YYYY-MM-DD)` status header.

## Concrete consumer scenarios

The trigger to queue this plan is "Desktop or VSCode wants
plugins." Two plausible scenarios:

### Scenario A — Desktop loads a "team library" plugin

A future `annot-cloud` plugin contributes:
- A `cloud` storage backend (registered via `registerStorage`).
- A "Team library" sidebar tab (via `addSidebarTab`).
- A drawer section showing the image's comment thread (via `addDrawerSection`).

Today this works on PWA only because `PluginHost` is PWA-side. After
this plan, Desktop's `bootstrap.ts` can take a `plugins?: AnnotPlugin[]`
option and pass it to a `PluginHost` instance. The same plugin code
loads on both hosts.

### Scenario B — VSCode loads a Markdown-link plugin

A "Link to repository" plugin contributes:
- An external-link source mapping the current file path to its
  GitHub URL via the workspace's git remote.

Today VSCode has no plugin loading; the link is hardcoded. After
this plan, VSCode's webview can mount a `PluginHost` with a
single-plugin array, and the plugin contributes the link via the
shared `addExternalLinkSource` API.

Either scenario lands as a separate plan; both depend on this
plan's Phase 1.

## Out of scope

- **Plugin manifest fetching.** Today plugins are passed as ES
  modules to `App.init({ plugins: [...] })`. Loading from a manifest
  URL is a separate, larger concern; not addressed here.
- **Sandboxing.** Plugins run in the host's main context. A
  sandbox (iframe, web-worker, vm-context) is a separate plan.
- **Plugin discovery / registry / marketplace.** Out of scope.
- **Built-in plugins** (`github-external-links`, `recent-tab`).
  These target PWA-specific backends (`GitHubStore`,
  `localStorage` recent-tab state) and stay in `annot-web/app/plugins/`.
- **Lifecycle (enable / disable / configure).** Today plugins
  register once at boot and live for the session. Per-plugin
  enable / disable is a separate UX concern.

## Open questions

- _(none currently — awaiting trigger)_

## Resolved decisions

- **Class moves to host-ui, not a new dedicated package.** Recommendation captured here: the class is small (~580 LOC including types) and has zero external dependencies beyond `annot-core` + `host-ui/ui-section`. Spinning up a new `@ingcreators/annot-plugin-host` package would add publishing + versioning overhead with no payoff. Editor-shell is the right home — every plugin-loading host already consumes host-ui.
- **Built-in storage modes injected as constructor option.** Avoids circular dependency (`host-ui` → `web/storage/bridge`) and keeps the class host-agnostic. Default-empty preserves test fixtures.
- **PWA's plugin entry-point shape (`App.init({ plugins })`) unchanged.** The class moves; the integration point stays in `AnnotApp`. No plugin author rewrites their manifest.
