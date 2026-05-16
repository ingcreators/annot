# Auto Capture: Visual-Change Detection Beyond `childList`

> **Status:** In progress  
> **Owner:** ichimura@gmail.com  
> **Phase 1 PR:** [#713](https://github.com/ingcreators/annot/pull/713) (landed)  
> **Phase 2 PR:** _(this work)_

## Context

The Chrome extension's Auto Capture mode triggers captures from a
content-script `MutationObserver` installed on `document.body`. Until
[#713](https://github.com/ingcreators/annot/pull/713), the observer
watched only `childList` / `subtree` / `characterData` — every
attribute mutation was intentionally ignored to keep
`:hover` / focus-style noise out of the signal. As a side effect,
two real-world UI patterns produced no auto-capture even though the
visible UI changed:

1. **Attribute-only state toggles** — `aria-expanded` / `aria-hidden`
   / `data-state="open"` / `hidden` / `<details open>` flipped on
   pre-rendered nodes. Headless UI, Radix UI, shadcn/ui, Framer
   Motion's pre-render-then-animate, and native `<details>` /
   `<dialog>` all fall here.
2. **Pure CSS-driven visual changes** — `:hover` reveals, CSS
   transitions, keyframe animations.

Concrete repro: the "Meet Claude" nav dropdown on
[`https://claude.com/product/overview`](https://claude.com/product/overview)
opens visibly but fires neither a `childList` nor a `characterData`
mutation the content script accepts.

The contract Auto Capture should match is *"a frame is saved whenever
the visible content meaningfully changes,"* not *"a frame is saved
whenever the DOM tree mutates."*

## Approach: cheap signals + visual-diff dedup

Two layered changes; each lands as its own PR so either can be
reverted independently.

### Phase 1 — Narrow attribute allowlist on `MutationObserver` (landed)

[#713](https://github.com/ingcreators/annot/pull/713) widened the
observer to watch a deliberately narrow `attributeFilter` allowlist:

- `aria-expanded`, `aria-hidden`, `aria-selected`, `aria-current`
- `data-state`
- `hidden`
- `open`

`class` and `style` stay excluded — they would dominate the signal
with `:hover` / `:focus-visible` / animation-frame noise. The
existing `[data-annot-ui]` ancestor filter absorbs Annot's own
overlays; the existing `stableWaitMs` debounce and SHA-256 dedup
absorb attribute flips that don't produce a pixel change.

### Phase 2 — Interaction-triggered visual-diff probe (this PR)

For pure-CSS / animation-only visual changes Phase 1 still can't
catch, the content script also installs capture-phase listeners for
the four user-interaction kinds that can produce CSS-only reveals:

- `pointerup` — covers click without a separate `click` listener.
- `keyup` — keyboard-driven UI activation.
- `wheel` — scroll-revealed UI (sticky nav, scrollytelling).
- `focusin` — tab-key reveal patterns.

Mutations and interactions share one debounce timer
(`autoStableTimer`). The timer carries an `autoSawMutationInWindow`
flag so the strongest signal wins per settle window:

| What happened in window | Signal fired to service worker |
|---|---|
| Any DOM/attribute mutation (alone or with interaction) | `auto-capture-signal` (DOM-mutation path) |
| Only interaction(s), no mutation | `auto-probe-signal` (visual-diff path) |
| Nothing | (timer never fires) |

The service worker handles `auto-probe-signal` like
`auto-capture-signal` (same min-interval throttle, same SHA dedup)
but adds a pixel-diff gate before persisting the frame:

1. `captureVisibleTab` → encoded PNG.
2. SHA-256 dedup against `lastFrameHash` — if match, drop. (Cheap
   pre-filter avoids the offscreen round-trip for byte-identical
   frames.)
3. If `lastFrameDataUrl` is set: send the new + previous dataUrls
   to the offscreen document's `offscreen-diff` handler. The
   offscreen-side decodes both via `createImageBitmap`, downscales
   to a 320×N `OffscreenCanvas`, runs `computeDiffScore` /
   `isMeaningfulChange` / `isCursorOnly` from
   `@ingcreators/annot-capture/diff`, and reports whether the diff
   is meaningful + not cursor-only.
4. If meaningful → save and update both `lastFrameHash` and
   `lastFrameDataUrl`. Else → drop, but still refresh
   `lastFrameDataUrl` so we don't keep diffing against a stale
   baseline across many inert interactions.

Mutation-triggered (`auto-capture-signal`) captures and the manual
"Add Capture" button (PR [#707](https://github.com/ingcreators/annot/pull/707))
bypass the offscreen diff — manual always saves (user explicit ask),
and a DOM mutation already proves the page changed.

The `auto.trigger` IDB tag widens from `"manual" | "observer"` to
`"manual" | "observer" | "probe"` so the timeline can show *why*
each frame was kept.

### Shared diff utilities

`packages/web/src/capture/diff-detection.ts` (Phase 4 of
[`_done/web-capture-redesign.md`](./_done/web-capture-redesign.md))
moves to `packages/capture/src/diff/diff-detection.ts` with a
matching `./diff` export on `@ingcreators/annot-capture`. The
web `AutoCaptureEngine` and the extension's offscreen document
import the same module, so the per-pixel delta threshold +
cursor-only bbox heuristics are tuned in one place.

### `AutoCaptureOptions` plumb-through

`AutoCaptureOptions.sensitivity`
([`packages/core/src/auto-capture-options.ts`](../../packages/core/src/auto-capture-options.ts))
was declared but never consumed in the extension path. Phase 2
wires `resolved.changeRatioThreshold` and
`opts.ignoreCursorOnlyChanges` into the offscreen-diff call. This
gives the existing setting field semantic meaning in the extension
for the first time.

## Edge cases & safety

- **First probe with no baseline** — `lastFrameDataUrl` is `null`
  on session start and after tab switch; the first probe always
  saves (no diff to run) and seeds the baseline.
- **Tab / window switch** — `lastFrameDataUrl` clears alongside
  `lastFrameHash` so probes never compare across tabs.
- **`chrome.tabs.captureVisibleTab` rate limit (~2/sec)** — the
  existing `minIntervalMs` (≥500ms) keeps us safe.
- **Offscreen diff failure** — fails open: the frame is kept
  rather than silently lost. The SHA dedup above already filtered
  byte-identical duplicates.
- **Manual "Add Capture" button** — unchanged, bypasses every
  gate (user explicit).
- **Sticky-handler nest-safety** — not a concern; the global
  throttle prevents concurrent captures.

## Files touched

### Phase 1 (landed in #713)
- [`packages/extension/src/content/index.ts`](../../packages/extension/src/content/index.ts)
  — observer attribute allowlist.

### Phase 2 (this PR)
- `packages/web/src/capture/diff-detection.ts` →
  [`packages/capture/src/diff/diff-detection.ts`](../../packages/capture/src/diff/diff-detection.ts)
  (moved; test file moves with it).
- [`packages/capture/src/diff/index.ts`](../../packages/capture/src/diff/index.ts)
  — new re-export barrel.
- [`packages/capture/package.json`](../../packages/capture/package.json)
  + [`packages/capture/vite.config.ts`](../../packages/capture/vite.config.ts)
  — `./diff` subpath export + lib entry.
- [`packages/capture/src/shared/messages.ts`](../../packages/capture/src/shared/messages.ts)
  — `auto-probe-signal` (content → bg) and `offscreen-diff`
  (bg → offscreen) message types.
- [`packages/web/package.json`](../../packages/web/package.json)
  + [`packages/web/src/capture/auto-capture.ts`](../../packages/web/src/capture/auto-capture.ts)
  — depend on `@ingcreators/annot-capture`; import diff helpers
  from the new subpath.
- [`packages/extension/src/offscreen/offscreen.ts`](../../packages/extension/src/offscreen/offscreen.ts)
  — `offscreen-diff` handler (`createImageBitmap` +
  `OffscreenCanvas` → `getImageData` → `computeDiffScore`).
- [`packages/extension/src/background/auto-diff.ts`](../../packages/extension/src/background/auto-diff.ts)
  — new service-worker bridge to the offscreen handler.
- [`packages/extension/src/background/service-worker.ts`](../../packages/extension/src/background/service-worker.ts)
  — `AutoCaptureState` gains `lastFrameDataUrl` /
  `changeRatioThreshold` / `ignoreCursorOnlyChanges`;
  `autoCaptureProbe` entry; `performAutoCapture` widens from
  `{ manual }` to `{ kind: "observer" | "probe" | "manual" }`;
  baseline clears on tab / window / nav change.
- [`packages/extension/src/content/index.ts`](../../packages/extension/src/content/index.ts)
  — capture-phase listeners (`pointerup` / `keyup` / `wheel` /
  `focusin`), shared `autoStableTimer` + `autoSawMutationInWindow`
  flag so mutation signals take precedence over probe signals.

## Verification

- [x] `pnpm -r typecheck` — all packages green.
- [x] `pnpm test` — 2779 tests pass (existing `diff-detection`
  goldens carry through the move unchanged).
- [x] `pnpm exec biome check <changed files>` — 0 errors.
- [x] `pnpm --filter @ingcreators/annot-capture build` /
  `--filter @ingcreators/annot-extension build` /
  `--filter @ingcreators/annot-web build`.

Manual e2e (after merge):

1. Load `packages/extension/dist` as an unpacked extension.
2. Start Auto Capture on https://claude.com/product/overview.
3. **Phase 1 case** — click "Meet Claude" nav. Expect a capture
   tagged `auto.trigger=observer` (attribute flip caught).
4. **Phase 2 case** — hover over a CSS-only hover-reveal element
   (no DOM/attr change). Expect a capture tagged
   `auto.trigger=probe` after `stableWaitMs`.
5. **Cursor-only negative** — wiggle the mouse over neutral
   background. Expect NO capture (cursor-only gate).
6. **No-change-click negative** — click an inert area. Expect NO
   capture (offscreen diff rejects).
7. **Regression** — high-mutation page (Twitter / X feed). Capture
   rate stays bounded by `minIntervalMs`.
8. **Regression** — manual "Add Capture" still saves regardless
   of visual change.

## Out of scope

- Continuous polling-based visual diff (autoplay video / timer-
  driven animations). Could be added as an opt-in
  `AutoCaptureOptions` mode later if a concrete need surfaces.
- Surfacing `AutoCaptureOptions` (interval / sensitivity /
  stableWait) in the extension popup. The settings load from
  `chrome.storage` already; UI is the remaining gap.
