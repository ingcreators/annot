# Web — dynamic-import failure recovery across deploys

> **Status:** Done
> **Compatibility:**
>   - `@ingcreators/annot-web` only. No `StorageProvider` / SVG /
>     `PageMetadata` schema changes. No new dependencies.
>   - Adds a generated `dist/version.txt` artefact (plain text,
>     contents = build version SHA / fallback). Cloudflare serves it
>     un-hashed at `/version.txt`.
>   - Adds a Vite `define` substitution `__APP_VERSION__` (ambient TS
>     declaration in `packages/web/src/global.d.ts`).
>   - Adds two new modules under `packages/web/src/recovery/`.
>   - Extends `showInfo` in `packages/web/src/ui/error-bar.ts`
>     additively (existing 3 callers continue to compile via
>     back-compat overload).
> **Risk:** Two sequential phases, each independently revertable.
>     Phase 1 (proactive banner) never reloads on its own — pure
>     additive UX. Phase 2 (auto-reload on chunk failure) introduces
>     the destructive `location.reload()` call; the 60 s
>     sessionStorage loop-guard and the `Promise.race`-capped
>     pre-flush bound the worst-case blast radius.

## Context

`@ingcreators/annot-web` deploys to Cloudflare Workers Static Assets
via `wrangler deploy`. Each deploy replaces the whole `dist/` asset
bucket, so the moment a new deploy lands every previously hashed
chunk under `dist/assets/` 404s. The PWA has 55 dynamic `import("…")`
call sites (storage backend lazy-init, document creation, PPTX
export, template picker dialogs, etc.) all wrapped in local
`try/catch` blocks that surface
`showSaveError(\`Couldn't …: ${err.message}\`)` — so an operating
user mid-session sees a cryptic save-error toast with no recovery
path beyond a manual hard reload.

Goal: users running an old tab when a new deploy lands should
**either** be gently prompted to reload before they hit a broken
chunk **or** automatically reload as a safety net if the prompt is
missed, without ever seeing a raw "dynamic import failed" error.
Unsaved editor state must be flushed before any reload to preserve
in-progress work.

The fix is the industry-standard combined approach (e.g. Figma,
Vercel dashboard): event-driven proactive version detection +
`vite:preloadError`-driven reactive auto-reload. We deliberately
prefer this over (a) CDN-side retention of old chunks (Cloudflare
Workers Static Assets makes this non-trivial — would need versioned
subdirectories) or (b) a full Service Worker (heavyweight; doesn't
on its own solve the chunk-404 problem and adds an offline-cache
contract we don't otherwise need).

## Design

### Component A — Proactive version detection (Phase 1)

1. **Build-time** — resolve a build version (`GITHUB_SHA` →
   `git rev-parse HEAD` → `dev-${Date.now()}` fallback) and:
   - Inject it as a bare constant via Vite
     `define: { __APP_VERSION__: JSON.stringify(version) }`.
   - Write the same value to `packages/web/public/version.txt` so it
     copies into `dist/version.txt` un-hashed and serves at
     `/version.txt`.
   - Combine both into a small local Vite plugin
     (`packages/web/vite/version-plugin.ts`) so the script and the
     `define` cannot drift.
2. **Runtime poller** (`packages/web/src/recovery/version-poller.ts`):
   - Event-driven only — no `setInterval`. Listen for
     `visibilitychange` (visible) + `pageshow` (bfcache restore),
     plus one initial check 30 s after boot.
   - `fetch("/version.txt", { cache: "no-store" })`, compare to
     `__APP_VERSION__`. On mismatch, fire `onNewVersion` once.
   - Skip entirely when `__APP_VERSION__.startsWith("dev-")` so
     `vite dev` is silent.
3. **UI** — persistent info banner via the existing
   `<annot-error-bar>`:
   ```ts
   showInfo("A new version is available", {
     persist: true,
     action: { label: "Reload", onClick: () => location.reload() },
   });
   ```
   Requires a small additive extension to `showInfo` — current
   signature `(message, durationMs)` becomes `(message, opts?)`
   with `opts: { durationMs?, persist?, action? }`. The 3 existing
   single-string+number callers stay compiling via overload.

### Component B — Reactive safety net (Phase 2)

1. **Install global handler** as the first import in
   `packages/web/src/main.ts` (before CSS / `applyPersistedTheme()`
   / `new App()`):
   ```ts
   import "./recovery/chunk-reload.js"; // side-effect installs the listener
   ```
2. **Listeners** in `packages/web/src/recovery/chunk-reload.ts`:
   - `vite:preloadError` (canonical Vite event)
   - `unhandledrejection` with message matching one of three
     high-specificity strings:
     `"Failed to fetch dynamically imported module"` (Chromium),
     `"error loading dynamically imported module"` (Safari),
     `"Importing a module script failed"` (Firefox).
     Belt-and-suspenders for non-Vite or nested imports that bypass
     `vite:preloadError`.
3. **Handler logic**:
   - If `sessionStorage["annot:chunk-reload-at"]` exists and is
     within the last **60 seconds** → reload loop detected. Surface
     a sticky error bar
     `"Failed to load update. Please reload manually."` with a
     manual Reload action button. Do NOT reload again.
   - Otherwise: set `sessionStorage["annot:chunk-reload-at"] =
     Date.now()` + `sessionStorage["annot:chunk-reload-pending"] =
     "1"`, set module-level `chunkReloadInProgress = true`, flush
     pending saves (next bullet), then `location.reload()`.
   - `event.preventDefault()` on both event types to suppress
     Vite's default re-throw and the browser's default
     unhandled-rejection console noise.
4. **Pending-save flush** — reuse existing API, no new public
   surface. `SavePipeline.flushPending()` already lives at
   `packages/host-ui/src/orchestrators/save-pipeline.ts` (cancels
   debounce, awaits in-flight upload, flushes thumbnail) and is
   already called from `app.ts:693`. In `App.init`, register a
   flush hook one-liner:
   ```ts
   setChunkReloadFlushHook(() => this.#savePipeline.flushPending());
   ```
   The recovery module stores the hook in a module-level variable
   (no `App` import → no circular dep) and `await`s it on chunk
   failure with a `Promise.race` 1500 ms cap so the user never
   perceives a freeze if Drive is offline.
5. **Suppress per-call-site error toasts** during reload — single
   chokepoint at the top of `showError` in
   `packages/web/src/ui/error-bar.ts`:
   ```ts
   import { chunkReloadInProgress } from "../recovery/chunk-reload.js";
   export function showError(opts: ErrorBarOptions): void {
     if (chunkReloadInProgress) return; // reload imminent
     // …existing body
   }
   ```
   Avoids editing the 33+ `showSaveError` call sites in `app.ts`.
6. **Post-reload toast** — after the reload completes, `App.init`
   calls `consumePostReloadFlag()` (clears the sessionStorage key
   and returns `true` if it was set) and shows
   `showInfo("Updated to new version", 4000)`. Place this after the
   first `requestAnimationFrame` so `<annot-error-bar>`'s
   `#toolbar` anchor is mounted.

### `beforeunload` interaction

`app.ts:486` already prompts on `beforeunload` when
`SavePipeline.hasPendingWork()` is true. Because the recovery
module calls `flushPending()` first, `hasPendingWork()` returns
`false` by the time `beforeunload` fires → no prompt → silent
reload. Edge case (1500 ms cap elapsed before flush completed,
e.g. Drive offline): the prompt fires, user can choose to lose the
last 1500 ms of edits or cancel — which is exactly the existing
data-preservation behavior.

### Unsaved dialog form text — explicitly out of scope

Half-typed text in dialogs (create-card-document title, GitHub
setup branch name, etc.) will be lost on reload. Listed as a
Phase 3 follow-up if telemetry / reports show real losses. The
reload-loop guard means if the user hits a chunk failure while
typing, the next failure surfaces as a sticky error bar with a
manual Reload button — giving them a chance to copy the text
first.

## Critical files

### New files (Phase 1)

- `packages/web/vite/version-plugin.ts` — local Vite plugin
  resolving build version + writing `public/version.txt` +
  exposing `__APP_VERSION__` via `define`.
- `packages/web/src/recovery/app-version.ts` — `__APP_VERSION__`
  re-export with helpful predicates (`isDevVersion()`).
- `packages/web/src/recovery/version-poller.ts` —
  visibility-driven poller.
- `packages/web/src/recovery/version-poller.test.ts` — Vitest with
  `vi.useFakeTimers()` + mocked `fetch`.

### New files (Phase 2)

- `packages/web/src/recovery/chunk-reload.ts` — listener,
  loop-guard, flush-hook, `chunkReloadInProgress` flag,
  `consumePostReloadFlag()`.
- `packages/web/src/recovery/chunk-reload.test.ts` — single-fire
  reload, loop guard, cross-browser message matchers, flush-hook
  timeout.
- `packages/web/src/recovery/post-reload-banner.ts` — trivial
  wrapper that reads the flag and calls `showInfo`.

### Modified files

- `packages/web/vite.config.ts` — register the new plugin.
- `packages/web/src/global.d.ts` (create if absent) —
  `declare const __APP_VERSION__: string`.
- `packages/web/.gitignore` (create or extend) — generated
  `public/version.txt`.
- `packages/web/src/main.ts` — Phase 2 adds `import
  "./recovery/chunk-reload.js"` as line 1.
- `packages/web/src/app.ts` — Phase 1 wires
  `startVersionPolling`. Phase 2 wires flush hook + post-reload
  banner.
- `packages/web/src/ui/error-bar.ts` — Phase 1 extends `showInfo`
  signature additively. Phase 2 adds the
  `chunkReloadInProgress` short-circuit at the top of `showError`.
- `packages/web/src/ui/error-bar.stories.ts` — add
  `InfoWithAction` + `NewVersionAvailable` stories per project
  Storybook convention.

### Reused (no edit, just import)

- `SavePipeline.flushPending()` / `SavePipeline.hasPendingWork()`
  — `packages/host-ui/src/orchestrators/save-pipeline.ts`. Already
  exported and used at `app.ts:486` + `:693`.
- `showError` / `showInfo` / `<annot-error-bar>` — already
  supports `severity: "info"` and
  `action: { label, onClick }`.
- `beforeunload` listener at `app.ts:485`.

## Phased plan

Two sequential PRs, each independently revertable.

### Phase 1 PR — `feat(web): proactive deploy-version banner`

Build-version injection (Vite plugin + `version.txt`) + poller +
`showInfo` extension + banner UI + stories + tests. Low-risk: the
poller never reloads on its own; the user must click. Ship and
watch one deploy cycle before Phase 2 lands.

### Phase 2 PR — `feat(web): auto-reload on dynamic-import failure`

Reactive listener + loop guard + flush hook + post-reload banner +
`showError` short-circuit + tests. Higher-risk because it
auto-reloads, so Phase 1's version-detection wiring should be
proven first.

### Phase 3 (deferred, document-only)

Dialog form-state preservation. Add only if data-loss reports
surface.

## Edge cases

| Case | Handling |
|------|---------|
| Reload loop (e.g. `version.txt` stuck at the edge) | 60 s sessionStorage timestamp guard → sticky error bar with manual Reload. |
| Multiple deploys mid-session | Banner stays up; clicking Reload loads whichever is latest at click time. |
| `/version.txt` 404 mid-deploy race | Poller silent; reactive net still catches actual chunk failures. |
| User offline | Both `fetch` + dynamic-import succeed against the HTTP cache; nothing fires. If somehow they do, the loop guard contains it. |
| `vite dev` mode | `__APP_VERSION__` starts with `dev-` → poller early-returns; HMR replaces modules, not chunks → reactive handler never fires. |
| Storybook | Recovery imports come only via `main.ts`, not stories — Storybook unaffected. |
| Non-chunk rejection containing "Failed to fetch" | Matcher requires the full phrase `"Failed to fetch dynamically imported module"` — false-positive risk negligible. |
| Cloudflare cache TTL on `version.txt` | `cache: "no-store"` bypasses HTTP cache; if observed staleness, follow up with `?t=${Date.now()}` cache-buster. |

## Verification

### Manual end-to-end (primary)

1. `pnpm --filter @ingcreators/annot-web build`, serve `dist/` via
   `pnpm exec wrangler dev` or `npx serve dist`.
2. Open the PWA, capture an image, start drawing (creates pending
   autosave).
3. In a separate terminal: edit `dist/version.txt` to a new SHA
   and rename one hashed chunk in `dist/assets/` (simulates a
   Cloudflare bucket swap).
4. Trigger a dynamic import in the running tab (open the "Create
   card document" dialog from the toolbar).
5. **Expected:** no error toast; reload within ~1500 ms; new tab
   shows `"Updated to new version"` for 4 s; the drawing is
   persisted.
6. Immediately repeat step 4 to test the loop guard.
   **Expected:** sticky error bar with manual Reload action.

### Proactive banner

1. Open the PWA.
2. Tab away (visibility hidden).
3. Edit `dist/version.txt` to a new value.
4. Return to the tab. **Expected:** within ~100 ms, persistent
   info banner `"A new version is available"` + Reload button
   appears.

### Unit tests

- `version-poller.test.ts` (Phase 1) — visibilitychange triggers
  fetch, identical version no-ops, differing version fires
  callback exactly once, fetch rejection silent, dev-mode never
  fetches.
- `chunk-reload.test.ts` (Phase 2) — single `vite:preloadError`
  reloads once + writes sessionStorage; second event within 60 s
  shows sticky banner and does NOT reload; second event after
  60 s reloads again with updated timestamp; `consumePostReloadFlag`
  clears the flag; non-chunk `unhandledrejection` ignored; all
  three cross-browser message strings matched.

### Pre-landing checklist (per CLAUDE.md)

- [ ] `pnpm -r typecheck` passes (with `__APP_VERSION__` ambient
      declaration)
- [ ] `pnpm test` passes — record new pass count in the
      `Verified:` paragraph
- [ ] `pnpm lint` reports 0 findings
- [ ] `pnpm --filter @ingcreators/annot-web build` passes and
      `dist/version.txt` is emitted
- [ ] No new dependencies; `StorageProvider` and `PageMetadata`
      untouched
- [ ] No DOM dependencies introduced into `packages/core`
- [ ] Storybook stories build (CI-blocking per CLAUDE.md
      §Storybook)

## Migration notes

None — purely additive. Existing tabs without the new code see
their dynamic-import errors as before (same `showSaveError`
behavior). Tabs with the new code never see the error.

The generated `dist/version.txt` is a new asset path under `/`;
Cloudflare's SPA fallback (`not_found_handling:
single-page-application` in `wrangler.jsonc`) still matters
because we want `/version.txt` to return 404 mid-deploy rather
than `index.html` (so the poller's `res.ok` check correctly
suppresses the banner during a deploy race). Confirmed in
[Cloudflare's docs](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/):
the SPA fallback only fires for paths the browser-style
`Accept: text/html` content negotiation would treat as HTML
navigation, not for plain-text asset fetches.
