# Plugin Storage Registration

> **Status:** Queued. Authored 2026-04-25 as the named follow-up from
> [`app-decomposition.md`](./app-decomposition.md) Phase 5; sign-off
> received 2026-04-25 on the four design questions (see "Decisions"
> at the bottom).
>
> **Compatibility:** Touches
> [`packages/web/src/storage/bridge.ts`](../../packages/web/src/storage/bridge.ts)
> (492 lines, module-level globals), the `StorageMode` literal union
> imported by 7 files, the `app/storage-bridge.ts` collaborator, and
> the gallery sidebar's hardcoded per-mode switch
> ([`gallery/sidebar.ts`](../../packages/web/src/gallery/sidebar.ts)).
> No changes to the `StorageProvider` contract itself — the
> 165-line contract test suite still applies to plugin-registered
> stores.
>
> **Risk:** Medium-high. `bridge.ts` is the single ground-truth for
> "which backend is active" and is read by every collaborator; a
> wrong move breaks every save / list / open. Plan stages so each
> step is independently revertable; the contract test suite is the
> regression net.

## Context

The Phase 4 `PluginHost` ([app/plugin-host.ts](../../packages/web/src/app/plugin-host.ts))
landed `addExternalLinkSource`, `onEditorReady`, `onBeforeSave`,
`onAfterSave`, `onRouteChange`. `registerStorage` was the one
checklist item the plan deferred:

> needs a reshape of `./storage/bridge.ts` to accept plugin-
> registered modes dynamically.

The intended consumer is `annot-cloud`'s **pointer-commit store** —
a `StorageProvider` that writes annotations as small JSON pointer
commits to a Cloud-managed git remote, instead of full SVG files.
Cloud needs to ship this without forking `bridge.ts`.

### Why bridge.ts is hard to extend today

Five concrete coupling points block plugin registration:

1. **`StorageMode` is a closed string-literal union.**
   `"extension" | "browser" | "device" | "googledrive" | "github"`.
   Every consumer imports this and switches on it (`sidebar.ts:8`,
   `header-host.ts`, `router-host.ts`, `storage-bridge.ts`,
   `extension-transfer-host.ts`, `editor-session.ts`,
   `file-manager.ts`). Adding a sixth value at compile time means
   editing every consumer.
2. **Per-backend module-level state** —
   `driveStore`, `deviceStore`, `githubStore`, `currentMode`.
   `getStorage()` switches on `currentMode` and returns the matching
   global. A new mode means a new global + a new branch.
3. **Per-backend `connect*` / `restore*` functions** —
   `connectGoogleDrive`, `restoreGoogleDrive`, `connectGitHub`,
   `restoreGitHub`, `openDeviceDirectory`, `restoreDevice`. The
   `app/storage-bridge.ts` boot logic and `handleStorageSelect`
   wizard call these by name.
3. **Token refresh callbacks** are wired per backend
   (`refreshDriveToken`, `refreshGithubToken`). Drive uses an OAuth
   gesture path; GitHub uses a PAT-paste dialog. The bridge knows
   both.
4. **Sidebar status strip** — `gallery/sidebar.ts` lists every
   storage mode statically and hardcodes per-mode labels in
   `setStorageStatus`. A plugin's mode has no slot in that list.
5. **`isXConnected()` helpers** —
   `isGitHubConnected`, `isDriveConnected`, `isExtensionConnected`,
   `getDeviceRootName`, `getGitHubRef`. Sidebar / header read them
   directly (e.g. `header-host.ts` calls `getGitHubRef()` for the
   breadcrumb). A plugin mode has no analogue.

The decomposition effort already lifted ~200 lines of "app-side"
storage logic into `app/storage-bridge.ts`. **This plan does the
remaining work — the module-side reshape that lets the bridge
itself be open for extension.**

## Goals

- A plugin can call `ctx.registerStorage("cloud", factory)` during
  `register()` and have its mode appear:
  - In the sidebar status strip (with the plugin-supplied label).
  - As a callable target of `handleStorageSelect("cloud")`.
  - As the active backend after `loadLastStorage()` returns "cloud".
- `getStorage()` / `getStorageMode()` / `setStorageMode()` work
  unchanged at the call sites — plugin modes just slot into the
  same getter chain.
- Built-in modes (browser / device / googledrive / github /
  extension) keep their current behaviour byte-for-byte. The
  refactor is "open the door" — not "rewrite the existing four".
- Contract tests (165 today) keep passing across every phase.

## Non-goals

- **Removing the built-in modes.** Browser / Device / Drive /
  GitHub / Extension stay first-class. The plugin path is for
  *additional* backends, not a replacement.
- **Plugin-supplied auth UI for the built-ins.** Drive's GIS
  popup + GitHub's PAT dialog stay where they are.
- **Hot-swapping a registered mode at runtime.** Modes are
  registered once at `init` and live for the app's lifetime.
- **Plugin-driven sidebar order.** The sidebar's left-rail order
  for built-ins stays hardcoded; plugin modes are appended in
  registration order at the bottom of the strip.
- **Persisted-mode forward-compat.** If a user's `loadLastStorage()`
  returns `"cloud"` but the Cloud plugin isn't loaded this session,
  we fall back to `"browser"` — same behaviour as today's
  "device handle revoked" path.

## Design

### `StorageMode` becomes a `string`

The closed union widens to `string`. Built-in modes are still
exported as a const-array so consumers that genuinely need the
five-element list (sidebar's hardcoded order, the `loadLastStorage`
parser) can read from one place.

```ts
// storage/bridge.ts (new shape)
export const BUILT_IN_STORAGE_MODES = [
  "browser",
  "device",
  "googledrive",
  "github",
  "extension",
] as const;
export type BuiltInStorageMode = (typeof BUILT_IN_STORAGE_MODES)[number];
export type StorageMode = string;
```

Consumers that switch on `StorageMode` get TS narrowing via
`if (mode === "browser")` exactly as today; the only change is
that the union has an open tail.

### `StorageRegistry` — a class inside bridge.ts

Replace the module-level globals with a single registry instance:

```ts
// storage/bridge.ts
class StorageRegistry {
  // Built-in slots (kept as named fields so existing
  // connect*/restore* functions don't need rewriting).
  #driveStore: GoogleDriveStore | null = null;
  #deviceStore: DeviceStore | null = null;
  #githubStore: GitHubStore | null = null;
  #browserFallback: StorageProvider | null = null;
  // Plugin-registered slot — keyed on `mode` string.
  #pluginStores = new Map<string, StorageProvider>();
  #currentMode: StorageMode = "browser";

  setActive(mode: StorageMode, store: StorageProvider): void { ... }
  getActive(): StorageProvider | null { ... }
  getMode(): StorageMode { ... }
  // Plugin path:
  registerPluginStore(mode: string, store: StorageProvider): void { ... }
  hasPluginMode(mode: string): boolean { ... }
}
const registry = new StorageRegistry();
```

The existing exported functions (`getStorage`, `setStorageMode`,
`connectGoogleDrive`, etc.) keep their signatures and just delegate
to `registry`. Call sites don't move.

### `PluginContext.registerStorage`

```ts
export interface StorageRegistration {
  /** Mode key. Must not collide with the built-ins. */
  readonly mode: string;
  /** Sidebar label + icon. Plugin-controlled. */
  readonly label: string;
  readonly icon?: string; // material-symbols name
  /** Sidebar order. Lower numbers render first. Built-ins reserve:
   *    Browser=10, Device=20, Drive=30, GitHub=40.
   *  A plugin can interleave (e.g. `priority: 25` lands between
   *  Device and Drive) or append (`priority: 100`). The sort is
   *  stable so plugins with identical priorities fall back to
   *  registration order — predictable and visible at a glance. */
  readonly priority: number;
  /** Build the live `StorageProvider` for this mode. Called when
   *  the user selects this mode from the sidebar OR when
   *  `loadLastStorage()` returns this mode at boot. May return
   *  `null` to signal "user cancelled the picker / not connected
   *  this session". */
  connect(opts: { forcePicker: boolean }): Promise<StorageProvider | null>;
  /** Cheap rehydrate from persisted state without prompting.
   *  Returns `null` if a persisted session can't be reopened. The
   *  bridge falls back to `BrowserStore` when this returns `null`,
   *  same as the existing Drive / GitHub paths. */
  restore(): StorageProvider | null;
  /** Report the connection state for the sidebar status strip.
   *  Mirrors the role of `isDriveConnected()` / `getDeviceRootName()`
   *  for built-ins. `label` ends up as the subtitle under the
   *  storage chip ("owner/repo@branch", "My Drive folder", etc.). */
  status(): { connected: boolean; label?: string };
}

interface PluginContext {
  // ... existing methods ...
  registerStorage(reg: StorageRegistration): void;
}
```

### Sidebar reshape

`gallery/sidebar.ts` today renders a fixed strip of four chips
(plus extension which is always-on). The strip becomes a sorted
render of the combined built-in + plugin registration list, keyed
by `priority`:

```
priority 10  → [ Browser ]
priority 20  → [ Device ]
priority 25  → [ Cloud   ]   ← plugin interleaves
priority 30  → [ Drive   ]
priority 40  → [ GitHub  ]
priority 100 → [ Audit log ] ← plugin appends
```

Built-ins are described internally by the same
`StorageRegistration` shape (constants in `bridge.ts`); plugin
chips come from `pluginHost.listStorageRegistrations()`. Sidebar
already exposes `setStorageStatus(mode, …)` keyed on a
`StorageMode` string, which under the new shape accepts plugin
keys without API change.

Stable sort by `priority` then registration order means a plugin
with a colliding priority lands deterministically after the
built-in (or after a previously-registered plugin), and the
default case ("plugin doesn't pick a priority") still appends —
the registration accepts a falsy priority and treats it as the
sentinel `Number.POSITIVE_INFINITY` for sort purposes.

### `handleStorageSelect("cloud")`

`app/storage-bridge.ts`'s `handleStorageSelect` switch grows a
final `else` branch that consults the plugin registry:

```ts
} else {
  // Plugin-registered mode.
  const reg = pluginHost.findStorageRegistration(mode);
  if (!reg) return false;
  const store = await reg.connect({ forcePicker });
  if (!store) return false;
  registry.setActive(mode, store);
  saveLastStorage(mode);
}
```

`restoreOnBoot` similarly: after the four built-in branches, fall
through to a plugin-mode lookup that calls `reg.restore()`.

### Token refresh

Promote `setTokenRefresher` from a per-backend method (Drive +
GitHub each implement it privately today) to a **standard
optional method on the `StorageProvider` contract**:

```ts
// @ingcreators/annot-core/storage — additive surface change.
export interface StorageProvider {
  // ... existing methods ...
  /** Optional. Network-backed stores call this on a 401 to ask the
   *  host for a fresh token. The refresher returns the new token
   *  string, or `null` if the user dismissed the auth banner /
   *  declined to re-auth. The store retries the failed request
   *  once and gives up if `null` came back. */
  setTokenRefresher?(fn: () => Promise<string | null>): void;
}
```

`bridge.ts` wires built-in refreshers (`refreshDriveToken`,
`refreshGithubToken`) the same way it does today — just via the
contract method instead of a per-class instance method. Local
stores (`BrowserStore`, `DeviceStore`) don't implement it; the
caller checks `if (store.setTokenRefresher)` before calling, same
pattern as the other optional methods on `StorageProvider`.

Plugin stores opt in by implementing `setTokenRefresher` and
calling the refresher from their own `#fetch` 401 path. The
host-side refresher closure can do anything — open an OAuth
gesture, show a "paste a token" dialog, hit a Cloud-managed token
endpoint — the contract just demands `Promise<string | null>`.

This is a small additive change to `@ingcreators/annot-core/storage`
([`packages/core/src/storage/types.ts`](../../packages/core/src/storage/types.ts))
and lands in Phase B alongside the `StorageRegistry` extraction so
both the type widening and the contract addition ship together.

## Phased plan

### Phase A — `StorageMode` widens to `string`

Pure type change. `BUILT_IN_STORAGE_MODES` const array exported
alongside. Consumers that switched exhaustively get one TODO
comment + a fallthrough branch (no behaviour change yet).

Expected delta: 0 runtime change, ~30 lines touched across the 7
importers. **Lands as one PR.**

### Phase B — `StorageRegistry` extraction inside bridge.ts

Move the four globals (`driveStore`, `deviceStore`, `githubStore`,
`browserFallback`, `currentMode`) into a single internal class.
Export functions still flat — they delegate to the registry.

No change to `app/storage-bridge.ts` or any caller. Verifies via
contract tests + a manual smoke of every mode-switch path.

Expected delta: ~50 lines net inside bridge.ts; 0 lines elsewhere.
**Lands as one PR.**

### Phase C — `PluginContext.registerStorage` + sidebar plumbing

The actual feature.

- `PluginHost` grows a `#storageRegistrations: StorageRegistration[]`
  with `findStorageRegistration(mode)` /
  `listStorageRegistrations()` accessors.
- `PluginContext.registerStorage(reg)` validates mode-key
  uniqueness against built-ins + previously-registered plugins.
- `app/storage-bridge.ts` learns the plugin fallthrough branches
  in `restoreOnBoot` and `handleStorageSelect`.
- `gallery/sidebar.ts` accepts a plugin-registration list at
  construction time, renders chips for each. The status strip
  + active highlight already work on string keys.
- New tests: a fake plugin registers a mode, the host resolves
  it, the sidebar lists it. ~6 plugin-host tests.

**Lands as one PR.** No new built-in plugin in this phase — the
in-tree validation is the unit tests; the first real consumer is
`annot-cloud`.

### Phase D _(optional)_ — `last-storage` graceful fallback

If `loadLastStorage()` returns a string the plugin registry
doesn't recognise this session, fall back to `browser` (already
the case for "device handle was revoked"). Add a one-line
`info` banner via `showInfo` so the user understands why their
last-selected mode wasn't restored.

Expected delta: ~10 lines in `restoreOnBoot`. **Optional —
lands only if usability testing flags the silent fallback as
confusing.**

## Verification

At each phase boundary:

- `pnpm -r typecheck` passes.
- `pnpm test` — the 165 (Phase A onwards) / 176+ (Phase C) suite
  passes.
- `pnpm lint` reports 0 findings.
- `pnpm --filter @ingcreators/annot-web build` — bundle size
  within ±3 % of pre-phase.
- Manual smoke at each phase: open the app under every built-in
  mode (browser / device / drive / github), verify open → save →
  reopen still works, sidebar status chips render correctly, the
  `loadLastStorage` rehydrate path picks up the right backend.
- Phase C also smokes: a fixture plugin in
  `packages/web/src/app/plugins/_test-storage-plugin.ts` (not
  shipped) registers a mode, the sidebar shows it, selecting it
  routes through the plugin's `connect`. Tear down before
  declaring the phase done.

## Migration notes

- **No data migration.** Existing browser / device / drive /
  github stores keep working unchanged.
- **No URL scheme change.** `editUrl(mode, path)` already takes
  the mode as a string at the boundary; plugin modes just yield
  longer URL prefixes.
- **`annot-cloud` consumers** import `AnnotPlugin` /
  `StorageRegistration` from `@ingcreators/annot-web` and write a
  registrar plugin. The cloud-web `main.ts` lists the plugin in
  `app.init({ plugins: [...] })`. Out of scope for this plan
  doc — covered in `oss-cloud-split.md` and the cloud repo's
  own plans.

## Open questions

- **Mode-key namespacing.** Should plugin modes carry a prefix
  like `cloud.team-library` to avoid collisions across plugins?
  Lean: no for MVP — the `"cloud"` namespace is fine while
  `annot-cloud` is the only consumer. Revisit when a third party
  ships its first storage plugin.
- **Authority over the active store.** Today `bridge.ts` returns
  the singleton via `getStorage()`. With plugin modes, two plugins
  can't both be "active" — there's still one mode at a time. Fine
  for MVP. Multi-active (read replicas, mirroring) is a separate
  initiative.
- **`StorageRegistration.icon`.** material-symbols only? Or
  arbitrary SVG? Lean: material-symbols string for parity with
  the built-ins; any plugin shipping its own glyph can do so via
  CSS classes set on its sidebar chip's anchor element (future
  hook).

## Decisions (sign-off 2026-04-25)

1. **`StorageMode` widens to `string`** with a const array
   `BUILT_IN_STORAGE_MODES` exported alongside for consumers that
   need the typed list. ✅
2. **`connect({ forcePicker })`** signature: built-ins and plugins
   share the same boolean. ✅
3. **Sidebar order: `priority` field on `StorageRegistration`,
   not append-at-end.** Built-ins are described as
   `StorageRegistration`s with reserved priorities
   (Browser=10, Device=20, Drive=30, GitHub=40); plugins choose
   their own priority and the strip renders them mixed in the
   sorted order. Stable sort by `priority` then registration
   order, falsy priority = `+Infinity` so unspecified-priority
   plugins still append.
4. **Token refresh: promoted to `StorageProvider` contract.**
   `setTokenRefresher?(fn)` becomes a standard optional method on
   `@ingcreators/annot-core/storage`'s `StorageProvider`. The
   built-in network stores (Drive, GitHub) and plugin stores both
   implement it; local stores skip it. `bridge.ts` wires its
   per-backend refresher closures via the same contract method
   instead of a per-class instance method.

## References

- [`app-decomposition.md`](./app-decomposition.md) — the parent
  plan; this is the named follow-up from its Phase 5 audit.
- [`oss-cloud-split.md`](./oss-cloud-split.md) — the strategic
  context: why plugin-extensible storage is a hard requirement
  for the OSS / Cloud split.
- Phase 4's [`PluginHost`](../../packages/web/src/app/plugin-host.ts)
  for the registration shape this plan extends.
