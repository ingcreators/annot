# Web Capture Redesign

> **Status:** Queued
> **Compatibility:** PWA only (`packages/web` + `packages/host-ui`).
>           VSCode / Desktop / Extension hosts unchanged. No
>           `StorageProvider`, `ImageRecord`, or SVG schema changes.
> **Risk:** Phased (5 implementation PRs after this plan PR). Each
>           phase independently revertable; no period during which
>           the user has zero working capture surface. Replaces
>           `Timed Capture` with change-detection-driven Auto Capture
>           — strict UX change, but the deletion lands in its own
>           follow-up PR after Auto Capture is on `main`.

## Context

The Annot Web app currently exposes two separate capture entry points
under the New menu: `Capture Screen` (single shot via
`getDisplayMedia`) and `Timed Capture...` (interval-based loop with
PiP overlay). Both already use `getDisplayMedia` — there is **no
extension dependency** in the web capture path today, so any
"replace extension capture with `getDisplayMedia`" framing is moot.
The real gap is conceptual: `Timed Capture` is a fixed-interval
sampler, not the change-detection-based capture assistant the
external spec proposes; there is no candidate / Accept / Delete
model; there is no area capture; there is no save-size / format
selector.

The change-spec the user supplied (kept locally, not checked in)
proposes a single `Capture Screen...` dialog → three modes
(`Auto Capture` / `Capture Once` / `Capture Area`) → a workspace UI
with live preview + candidate list. This plan delivers the spec's
**Phases 1+2+3** (menu + dialog + Capture Once, candidate
management, Auto Capture with diff detection). Spec Phase 4
(Capture Area) and spec Phase 5 (high-DPI warnings, WebP / JPEG,
advanced settings, settings persistence, IDB / OPFS candidate
storage) are explicitly out of scope here and listed under
**Deferred** at the end of this doc.

Confirmed scope decisions (user sign-off):

- **Timed Capture is retired** in favour of Auto Capture. Removal
  is a **separate follow-up PR** that lands after Auto Capture is
  on `main`, so the user always has a working capture surface.
- **Candidate model only for Auto Capture.** Capture Once saves
  directly via `storage.saveImage`, matching today's UX.
- **Workspace lives at a new `/capture` route.** Browser back +
  URL deep-linking work; bare navigation without a pending session
  shows a "Open New > Capture Screen... to start" hint.
- **Accepted Auto Capture images** save to the folder current at
  dialog-open time (same as Capture Once).
- **Stop button** preserves candidates; navigating away with
  unselected candidates surfaces a `showConfirmDialog`
  "Discard N pending candidates?".
- **Edit on a candidate** = Accept + open editor (shortcut, not
  edit-before-save).

## Design

### Architectural decisions (locked)

- **Module home**: all new capture code lives under
  `packages/web/src/capture/`. No promotion to
  `@ingcreators/annot-core` unless a non-web host actually
  consumes it. Type definitions live colocated in
  `packages/web/src/capture/types.ts`.
- **Diff detection**: pure function in
  [`packages/web/src/capture/diff-detection.ts`](../../packages/web/src/capture/diff-detection.ts),
  takes two `ImageData` on a downscaled comparison canvas. Testable
  under happy-dom.
- **Auto Capture state machine**: a small class `AutoCaptureEngine`
  in [`packages/web/src/capture/auto-capture.ts`](../../packages/web/src/capture/auto-capture.ts).
  States `idle → changing → stable-wait → captured → idle`.
- **Candidate store**: in-memory `CandidateStore` class in
  [`packages/web/src/capture/candidate-store.ts`](../../packages/web/src/capture/candidate-store.ts)
  with `EventTarget`-style change events, explicit
  `URL.revokeObjectURL` on delete / clear. IDB / OPFS persistence is
  spec Phase 5 (deferred).
- **Workspace**: `<annot-capture-workspace>` Lit element, mounted
  by the `/capture` route. Owns the `MediaStream`, the
  `CaptureSession` wrapper, the `CandidateStore`, and (when
  `mode === "auto"`) the `AutoCaptureEngine`. All teardown happens
  in `disconnectedCallback`.
- **Cursor preference**: `loadCursorPreference` /
  `saveCursorPreference` (currently in
  [`packages/web/src/capture/interval-dialog.ts`](../../packages/web/src/capture/interval-dialog.ts))
  move to a new `packages/web/src/capture/capture-prefs.ts` in
  Phase 1 so they survive the Phase 5 deletion of
  `interval-dialog.ts`.
- **Format / size in Phases 1–4**: keep current behaviour — direct
  `canvas.toDataURL("image/jpeg", 0.92)` (today's
  [`pwa-capture.ts:49`](../../packages/web/src/capture/pwa-capture.ts:49)
  / `:331` path), no resize from source. The format work in spec
  Phase 5 routes captures through the existing
  [`encodeCapture()`](../../packages/core/src/encode/index.ts:39)
  smart pipeline — sampled-color PNG-8 quantisation via
  `@ingcreators/annot-imagequant`, with JPEG fallback for
  photo-heavy frames per `EncodeOptions.smartFallback`. **WebP is
  not on the roadmap** — the PNG-8-centric approach the extension
  already uses is the target here too.

### Reuse map

| Existing | Path | How we reuse |
|---|---|---|
| `<annot-dialog>` base | [`packages/host-ui/src/ui/annot-dialog.ts`](../../packages/host-ui/src/ui/annot-dialog.ts) | Backs the new mode-picker dialog. Same Promise-wrapper pattern as `interval-dialog.ts`. |
| `getDisplayMedia` capture | [`packages/web/src/capture/pwa-capture.ts:16`](../../packages/web/src/capture/pwa-capture.ts:16) (`captureScreen`) | Phase 2 extracts the `<video>` + canvas-grab into `capture-session.ts` (shared by workspace). |
| Sidebar New menu | [`packages/host-ui/src/gallery/sidebar.ts:551`](../../packages/host-ui/src/gallery/sidebar.ts:551) (`#renderNewMenu`) | Phase 1 adds `Capture Screen...` entry; Phase 5 removes the two old entries. |
| `SidebarCallbacks` wiring | [`packages/web/src/app.ts:623`](../../packages/web/src/app.ts:623) | Add `onCaptureScreenDialog` callback. |
| `CaptureHost` orchestrator | [`packages/web/src/app/capture-host.ts:60`](../../packages/web/src/app/capture-host.ts:60) | Phase 1 adds `captureScreenDialogAndSave()`. Phase 5 deletes `captureScreenAndSave` + `timedCaptureAndSave`. The `saveDataUrlAndOpen` helper (lines 244–274) is reused unchanged. |
| Feature predicate | [`packages/host-ui/src/capture-predicates.ts`](../../packages/host-ui/src/capture-predicates.ts) (`isScreenCaptureSupported`) | Gates the new menu entry. |
| Router | [`packages/web/src/router.ts`](../../packages/web/src/router.ts) + [`packages/web/src/app/router-host.ts`](../../packages/web/src/app/router-host.ts) | Phase 2 adds `/capture` route + `route.type === "capture"` branch. |
| Thumbnail | `generateThumbnailFromDataUrl` from host-ui (already imported in [`capture-host.ts:19`](../../packages/web/src/app/capture-host.ts:19)) | Reused by candidate Accept path. |
| ID generation | `newIdB58` from `@ingcreators/annot-core/utils` | Used for `captureId` / `session` tags. |
| Confirm dialog | `showConfirmDialog` from host-ui | Used for "Discard N pending candidates?" prompt on workspace exit. |
| Settings persistence pattern | `interval-dialog.ts` `CURSOR_PREF_KEY` | Mirror for `annot-capture-mode` key. |
| Storybook config | [`packages/web/.storybook/main.ts`](../../packages/web/.storybook/main.ts) (glob covers `packages/web/src/**/*.stories.ts`) | New stories drop in colocated; no config change. |

### Type definitions

```ts
// packages/web/src/capture/types.ts
export type CaptureMode = "auto" | "once" | "area"; // "area" = spec Phase 4 (deferred)

export type AutoCaptureState =
  | "idle"
  | "changing"
  | "stable-wait"
  | "captured";

export type CaptureCandidateStatus = "candidate" | "accepted" | "deleted";
// TODO(spec-phase-5): "editing" | "export-ready"

export interface CaptureSettings {
  mode: CaptureMode;
  includeCursor: boolean;
  ignoreCursorOnlyChanges: boolean;
  // Auto-only:
  intervalMs: number;
  stableWaitMs: number;
  minMsBetweenCaptures: number;
  comparisonWidth: number;
  // TODO(spec-phase-5): saveSizePreset, encodeFormat ("smart" | "png" | "jpeg"
  //                     mirroring `EncodeOptions.format`),
  //                     changeSensitivity, thumbnailWidth,
  //                     keepOriginalForAccepted.
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  mode: "auto",
  includeCursor: true,
  ignoreCursorOnlyChanges: true,
  intervalMs: 1000,
  stableWaitMs: 700,
  minMsBetweenCaptures: 1500,
  comparisonWidth: 320,
};

export interface CaptureCandidate {
  id: string;
  status: CaptureCandidateStatus;
  createdAt: string;
  sourceWidth: number;
  sourceHeight: number;
  imageBlob: Blob;
  thumbnailDataUrl: string;
  diffScore?: number;
  // TODO(spec-phase-5): title, savedWidth/Height, format, sourceRect.
}
```

`CaptureSession` from the spec is **not** introduced as a separate
type — it is the `<annot-capture-workspace>` element + its owned
`CaptureSession` class. One source of truth.

## Phased plan

### Phase 0 — Plan doc (this PR)

- **Branch**: `docs/web-capture-redesign-plan`
- **Add**: `docs/plans/web-capture-redesign.md` (this file).
- **Modify**: [`docs/plans/README.md`](./README.md) index entry.
- **Verify**: `pnpm -r typecheck` (unaffected); markdown render.

### Phase 1 — Menu rename + dialog scaffold + Capture Once via dialog

- **PR title**: `feat(web): add Capture Screen dialog with Capture Once mode`
- **Branch**: `feat/capture-screen-dialog`
- **What lands**: `Capture Screen...` entry in the New menu opens
  `<annot-capture-screen-dialog>`. Three mode chips rendered;
  only **Capture Once** enabled (others show "Coming soon"). On
  confirm with `Capture Once`, calls existing `captureScreen()` →
  `saveDataUrlAndOpen()` → editor — same end state as today. Old
  `Capture Screen` and `Timed Capture...` entries remain
  untouched (additive, non-destructive).
- **Add**:
  - `packages/web/src/capture/types.ts`
  - `packages/web/src/capture/annot-capture-screen-dialog.ts`
  - `packages/web/src/capture/annot-capture-screen-dialog.stories.ts`
    (`Capture / CaptureScreenDialog` — `Default`, `OnceSelected`,
    `AutoDisabled`)
  - `packages/web/src/capture/capture-screen-dialog.ts` (Promise
    wrapper `showCaptureScreenDialog()`)
  - `packages/web/src/capture/capture-screen-dialog.test.ts`
  - `packages/web/src/capture/capture-prefs.ts` (extract
    `loadCursorPreference` + `saveCursorPreference`; add
    `loadModePreference` / `saveModePreference` for key
    `annot-capture-mode`, default `auto`)
  - `packages/web/src/capture/capture-prefs.test.ts`
- **Modify**:
  - `packages/host-ui/src/gallery/sidebar.ts` — add
    `onCaptureScreenDialog` to `SidebarCallbacks`, render the new
    menu entry (label `Capture Screen...`, icon
    `screenshot_monitor`).
  - `packages/web/src/app.ts` (~line 623) — wire the new callback.
  - `packages/web/src/app/capture-host.ts` — add
    `captureScreenDialogAndSave()`; for Phase 1, when mode is
    `once` it reuses `captureScreen()` + `saveDataUrlAndOpen()`.
  - `packages/web/src/capture/interval-dialog.ts` — re-export
    `loadCursorPreference` / `saveCursorPreference` from
    `capture-prefs.ts` so existing imports keep working.
- **Tests**: dialog open + click + resolve assertions; prefs
  round-trip via in-memory localStorage.
- **Manual verify**: `pnpm --filter @ingcreators/annot-web dev` →
  New menu shows three capture entries → click `Capture Screen...`
  → dialog opens → pick Capture Once → confirm → screen picker →
  image lands in gallery.
- **Revertability**: clean (additive only).

### Phase 2 — `/capture` route + workspace shell

- **PR title**: `feat(web): add /capture workspace route and screen preview`
- **Branch**: `feat/capture-workspace-route`
- **What lands**: New `/capture` route mounts
  `<annot-capture-workspace>`. The dialog's confirm now stores a
  pending session in memory and calls `pushRoute("/capture")`. The
  workspace immediately calls `getDisplayMedia()` (the click that
  submitted the dialog IS the user gesture for the
  newly-mounted workspace). Live `<video>` preview, "Source / Save"
  static label, `Capture Once` button in the toolbar saves directly
  to storage. `Stop` button → returns to `/`. Browser back from
  `/capture` cleanly stops tracks via `disconnectedCallback`. Right
  panel renders an empty placeholder (`No candidates yet`). Direct
  navigation to `/capture` without a pending session shows
  `Open New > Capture Screen... to start.`
- **Add**:
  - `packages/web/src/capture/annot-capture-workspace.ts`
  - `packages/web/src/capture/annot-capture-workspace.stories.ts`
    (uses `<canvas>.captureStream()` for fake `MediaStream`)
  - `packages/web/src/capture/annot-capture-preview.ts` (the
    `<video>` + status overlay; reused later by Capture Area)
  - `packages/web/src/capture/annot-capture-preview.stories.ts`
  - `packages/web/src/capture/annot-capture-toolbar.ts`
  - `packages/web/src/capture/annot-capture-toolbar.stories.ts`
  - `packages/web/src/capture/annot-candidate-panel.ts`
    (empty-state only in Phase 2)
  - `packages/web/src/capture/annot-candidate-panel.stories.ts`
  - `packages/web/src/capture/capture-session.ts` (extracted
    `MediaStream` + `<video>` + `captureFrame()` from
    `pwa-capture.ts`)
  - `packages/web/src/capture/capture-session.test.ts`
  - `packages/web/src/capture/annot-capture-workspace.test.ts`
    (mount → `Capture Once` click → assert `storage.saveImage`
    call; remove element while sharing → assert tracks reach
    `readyState === "ended"`)
- **Modify**:
  - `packages/web/src/router.ts` — add `/capture` route case +
    `captureUrl()` helper.
  - `packages/web/src/app/router-host.ts` — add
    `route.type === "capture"` branch →
    `deps.showCaptureWorkspace()`.
  - `packages/web/src/app.ts` — implement `showCaptureWorkspace()`
    (mirrors `EditorSession` mount lifecycle).
  - `packages/web/src/app/capture-host.ts` —
    `captureScreenDialogAndSave` no longer captures inline;
    instead stores `{ mode, settings, folderPath }` in a
    `CapturePendingSession` singleton + `pushRoute("/capture")`.
- **Manual verify**: dialog → Capture Once → URL flips to
  `/capture` → preview visible → toolbar `Capture Once` → image in
  gallery → `Stop` returns to `/`. Browser back mid-stream stops
  tracks (verify in DevTools `chrome://media-internals`).
- **Revertability**: clean. Reverting leaves Phase 1's dialog
  working with the inline save path.

### Phase 3 — Candidate model scaffold

- **PR title**: `feat(web): add capture candidate store and panel scaffold`
- **Branch**: `feat/capture-candidate-store`
- **What lands**: `CandidateStore` class +
  `<annot-candidate-card>` + populated `<annot-candidate-panel>`.
  Workspace owns one store per session. Capture Once still saves
  directly (not via store). To exercise the panel before Auto
  Capture lands, add a `[debug] Push test candidate` button gated
  on `import.meta.env.DEV` — **removed in Phase 4**. Accept calls
  `storage.saveImage(...)` with the candidate's blob → `ImageRecord`
  (tags `{ captureId, session, sessionKind: "auto", sessionIndex,
  sessionTotal }`, `folderPath` = workspace's `folderPath` prop =
  the folder current at dialog-open). Delete removes from store +
  revokes object URL. Edit = Accept + navigate to editor (the
  user-confirmed shortcut).
- **Add**:
  - `packages/web/src/capture/candidate-store.ts`
  - `packages/web/src/capture/candidate-store.test.ts`
  - `packages/web/src/capture/annot-candidate-card.ts`
  - `packages/web/src/capture/annot-candidate-card.stories.ts`
- **Modify**:
  - `packages/web/src/capture/annot-candidate-panel.ts` — render
    list, wire actions to passed-in store.
  - `packages/web/src/capture/annot-candidate-panel.stories.ts` —
    add `Populated` story.
  - `packages/web/src/capture/annot-capture-workspace.ts` —
    instantiate store, pass to panel, implement
    Accept / Delete / Edit handlers, add the dev-only debug button
    to the toolbar.
- **Manual verify**: workspace → click `[debug] Push test candidate`
  3× → 3 cards appear → Accept on one → image lands in gallery,
  card disappears → Delete on another → card disappears.

### Phase 4 — Auto Capture engine

- **PR title**: `feat(web): add Auto Capture mode with diff detection`
- **Branch**: `feat/capture-auto-mode`
- **What lands**: Auto Capture chip enabled and default-selected in
  the dialog. When the workspace mounts with `mode === "auto"`,
  `AutoCaptureEngine` starts and pushes candidates to the store.
  Status overlay cycles through state messages
  (`Watching for screen changes`, `Screen change detected`,
  `Waiting for the screen to settle`, `Candidate image added`,
  `Ignored cursor-only movement`). Toolbar `Auto OFF` toggle
  pauses / resumes the engine. Cursor-only ignore heuristic.
  Workspace exit with unaccepted candidates triggers
  `showConfirmDialog` "Discard N pending candidates?". The
  Phase 3 dev-only debug button is removed. Cap on candidate
  buffer (`MAX_CANDIDATES = 200`); when reached, info bar
  `Candidate buffer full — accept or delete some to keep capturing.`
  + engine pause.
- **Add**:
  - `packages/web/src/capture/diff-detection.ts` — pure functions:
    `computeDiffScore(a, b)`,
    `boundingBoxOfChanges(a, b, threshold)`,
    `isCursorOnly(box, ratio, opts)`. Constants
    `CURSOR_ONLY_MAX_BOUNDS_WIDTH = 48` etc.
  - `packages/web/src/capture/diff-detection.test.ts` — synthetic
    `ImageData`: identical → 0, full repaint → high, single-pixel
    cursor at corner → flagged cursor-only.
  - `packages/web/src/capture/auto-capture.ts` —
    `AutoCaptureEngine` class with state machine,
    fake-clock-friendly interval loop, downsample-to-comparison-
    canvas + `diff-detection` call, full-size
    `session.captureFrame()` on `STABLE_WAIT → CAPTURED`.
  - `packages/web/src/capture/auto-capture.test.ts` — drives the
    engine with fake timers + scripted diff results; asserts
    state transitions and `minMsBetweenCaptures` cap.
- **Modify**:
  - `packages/web/src/capture/annot-capture-screen-dialog.ts` —
    enable Auto chip, default to `auto`.
  - `packages/web/src/capture/annot-capture-workspace.ts` — when
    `mode === "auto"`, instantiate `AutoCaptureEngine`, wire
    `onState` to the preview status overlay, stop on
    `disconnectedCallback`. Implement `MAX_CANDIDATES = 200` cap
    with auto-pause + info bar. Implement `showConfirmDialog`
    discard prompt on exit when `store.size > 0`.
  - `packages/web/src/capture/annot-capture-preview.ts` — accept
    `state` prop, render status copy.
  - `packages/web/src/capture/annot-capture-toolbar.ts` — wire
    `Auto OFF` toggle; remove debug button.
- **Stories**: extend `annot-capture-preview.stories.ts` with
  `WatchingState`, `ChangeDetected`, `StableWait`, `Captured`.
- **Manual verify**: dialog → Auto Capture (default) → share a
  window → type in another app → status flips through
  `Screen change detected` → `Waiting for the screen to settle` →
  `Candidate image added`. Move cursor with no other change →
  `Ignored cursor-only movement`. Stop sharing via browser UI →
  engine stops, candidates retained. Accept all → images in
  gallery. Try to navigate away with candidates remaining →
  confirm dialog appears.

### Phase 5 — Delete Timed Capture

- **PR title**: `refactor(web): remove Timed Capture in favor of Auto Capture`
- **Branch**: `refactor/remove-timed-capture`
- **What lands**: pure deletion. Lands AFTER Phase 4 is on `main`.
  After this PR, `Capture Screen...` is the only capture entry in
  the New menu.
- **Modify**:
  - `packages/host-ui/src/gallery/sidebar.ts` — remove
    `onCaptureScreen` and `onTimedCapture` callbacks + their menu
    items.
  - `packages/web/src/app/capture-host.ts` — delete
    `captureScreenAndSave` and `timedCaptureAndSave`; drop imports
    of `showIntervalCaptureDialog` / `showIntervalCaptureProgress`
    / `startIntervalCapture`.
  - `packages/web/src/app.ts` — drop the corresponding callback
    wiring (~lines 623–625).
  - `packages/web/src/capture/pwa-capture.ts` — delete
    `startIntervalCapture` (lines 249–361),
    `IntervalCaptureOptions`, `IntervalCaptureHandle`,
    `createCaptureOverlay`. Inspect `captureScreen` callers
    (likely none after Phase 5; if `capture-session.ts` no longer
    routes through it, delete it too). Keep `pasteFromClipboard`,
    `CursorMode`.
  - `packages/web/src/capture/interval-dialog.ts` — delete the
    file. Its prefs already moved to `capture-prefs.ts` in Phase 1.
- **Delete**:
  - `packages/web/src/capture/annot-interval-capture-dialog.ts`
    + `.stories.ts`
  - `packages/web/src/capture/annot-capture-progress-toast.ts`
    + `.stories.ts`
  - `packages/web/src/capture/interval-dialog.ts`
- **Manual verify**: New menu shows exactly one capture entry
  (`Capture Screen...`). `git grep -i "timed[- ]capture"` returns
  zero source matches.
- **Revertability**: a revert resurrects Timed Capture alongside
  the now-on-main Auto Capture — two capture surfaces in parallel,
  not a regression.

## Risk register

1. **Diff thresholds misfire on real content** (video pages →
   endless captures; subtle UI changes → missed). Mitigation:
   every threshold is a named constant in `auto-capture.ts` (no
   magic numbers in logic). The engine emits state events the
   workspace surfaces, so misfires are user-visible.
   `MAX_CANDIDATES = 200` cap prevents filling RAM with screenshots
   of a YouTube page.

2. **`getDisplayMedia()` requires a fresh user gesture.** Direct
   navigation to `/capture` (bookmark, back-then-forward after
   gesture expired) cannot legally call the API. Mitigation:
   workspace checks for `CapturePendingSession`; absence shows
   `Open New > Capture Screen... to start.` + a `Start` button
   that re-opens the dialog. The dialog submit IS the gesture
   for the newly-mounted workspace.

3. **Memory pressure from candidate buffer.** 200 × ~1–3 MB JPEG ≈
   200–600 MB. Mitigation: cap + explicit `URL.revokeObjectURL`
   on delete / clear / disconnect.

4. **CPU from 1 Hz pixel-delta on low-end machines.** 320×180 =
   57.6k pixels per loop is trivial on desktop, possibly visible on
   Chromebooks. Mitigation: tight typed-array scan in
   `diff-detection.ts`; spec Phase 5 will expose `intervalMs` /
   `comparisonWidth` to the user.

5. **Workspace navigation away mid-capture leaks the stream.**
   Mitigation: `disconnectedCallback` calls `session.stop()` which
   calls `stream.getTracks().forEach(t => t.stop())`. Test in
   `annot-capture-workspace.test.ts` covers the
   "remove element while sharing" case.

## Verification

Common per-phase commands:

```
pnpm -r typecheck
pnpm test
pnpm --filter @ingcreators/annot-web build
pnpm --filter @ingcreators/annot-web storybook    # smoke new stories
pnpm lint                                          # 0 findings
```

Then `pnpm --filter @ingcreators/annot-web dev` and walk the
"Manual verify" steps under each phase above.

End-state acceptance (after Phase 5 lands):

- New menu has exactly one capture entry (`Capture Screen...`).
- Dialog defaults to Auto Capture; Once and Area chips present
  (Area disabled with "Coming soon" until spec Phase 4 lands).
- `/capture` is a real route; workspace mounts on demand,
  `disconnectedCallback` cleans up tracks.
- Auto Capture cycles through state events, candidates land in the
  panel, Accept saves to storage, Delete removes, Edit
  Accept-and-opens-editor.
- Workspace exit with unaccepted candidates surfaces the
  `showConfirmDialog` "Discard N pending candidates?" prompt.
- No `Timed Capture` references in source (`git grep` clean).

## Migration notes

No data migration. Pre-release product — captures saved by today's
`Timed Capture` are regular `ImageRecord`s with session tags; they
remain in the gallery untouched. The deletion in Phase 5 only
removes the *capture entry point*, not the resulting records.

`StorageProvider`, `ImageRecord`, `PageMetadata`, and the SVG
schema are all unchanged. No `data-annot-version` bump.

## Deferred (spec Phases 4 + 5, future PRs)

- **Capture Area** (spec §12). Selection overlay on preview,
  `previewRectToVideoRect` coordinate mapping, `Use Previous Area`,
  letterboxing offset for `object-fit: contain`.
- **Save size presets** (spec §6.5, §13.2). `Light 1280px` /
  `Standard 1920px` / `High Quality 2560px` / `Original`.
- **Smart PNG-8 encode pipeline adoption** (replaces spec §14's
  WebP / JPEG selector framing). Route captured frames through
  [`encodeCapture()`](../../packages/core/src/encode/index.ts:39)
  from `@ingcreators/annot-core/encode` (the same pipeline the
  Chrome Extension uses): `format: "smart"` samples pixel colours
  via `isPhotoHeavy()` against
  `EncodeOptions.smartColorThreshold` (default 15000). Below the
  threshold → libimagequant PNG-8 quantisation
  (`@ingcreators/annot-imagequant`). Above → fall back per
  `smartFallback` (PNG-24 or JPEG @ `jpegPercent`, default 92).
  User-facing setting reduces to a 3-way `format: "smart" | "png"
  | "jpeg"` mirroring `EncodeOptions`. WebP is **explicitly
  out of scope** — the PNG-8-centric approach is the product
  decision. Migration note: today's PWA capture path
  ([`pwa-capture.ts:49`](../../packages/web/src/capture/pwa-capture.ts:49)
  / `:331`) calls `canvas.toDataURL("image/jpeg", 0.92)`
  directly; switching means producing PNG-24 from the canvas first
  (as `encodeCapture` expects a PNG data URL), then handing it to
  the smart encoder.
- **High-DPI warnings** (spec §13.4). Mild ≥ 2560px,
  strong ≥ 3840px.
- **Advanced settings panel** (spec §6.6). `Capture interval`,
  `Change sensitivity`, `Stable wait`, `Thumbnail size`,
  `Keep original for accepted`.
- **Settings persistence** (spec §22 Phase 5). Per-key localStorage
  for the new dialog settings.
- **IDB / OPFS candidate storage** (spec §18.3). Replace the
  in-memory `CandidateStore` for long sessions.
- **Optional Chrome Conditional Focus** (spec §7.2).
  `CaptureController.setFocusBehavior('focus-capturing-application')`.
