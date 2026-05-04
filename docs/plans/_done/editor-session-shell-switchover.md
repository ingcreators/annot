# PWA `EditorSession` shell switchover

> **Status:** Done — landed 2026-05-04 across PRs #411–TBD.
> **Compatibility:** Refactor inside `packages/web` only. Public
>                    behaviour (PWA editor opens, edits, saves;
>                    extension transfer / paste / capture flows
>                    work) unchanged. No `StorageProvider` change,
>                    no SVG schema change, no `PageMetadata`
>                    change. The `EditorShell` API gained one
>                    optional knob (`svgRoot?: SVGSVGElement`).
> **Risk:** Medium — touched the editor boot path on every
>           open. Mitigated by (a) fully-additive API change to
>           `EditorShell`, (b) the existing 1146-test suite +
>           shell host-boundary invariant + four new shell tests
>           (svgRoot adoption × 3, restoreAnnotations × 1), (c)
>           keeping `index.html`'s pre-baked `<svg id="svg-root">`
>           so there's no chicken-and-egg with first-render CSS.

## Context

The
[`vscode-extension-host.md`](./vscode-extension-host.md)
plan series landed `EditorShell` as the host-neutral editor
surface and proved it from the VSCode side (PRs #395–#404,
plus #408 / #409 for the Phase 5 deferreds). The PWA
deliberately did NOT switch to `EditorShell` in that series:

> "Doing so cleanly requires a coordinated CSS update (the
> PWA's `app.css` targets `#svg-root`, the shell's anonymous
> `[data-annot-shell-root]` doesn't) plus a record-synthesis
> refactor of `setupEditor`. To avoid risking the live PWA
> editor on a partial refactor, this PR keeps EditorSession's
> direct construction; the shell architecture is proven by 8
> happy-dom tests + the VSCode webview consuming the same
> surface."

This plan retires that deferral. The carrots:

- **One canonical bootstrap path.** Today the PWA's
  `EditorSession.setupEditor` does the same thing as
  `EditorShell.mountFromRecord` (create CanvasManager +
  History + SelectionManager into a container, attach
  selection / history listeners, expose them to consumers).
  Two implementations of the same primitive flow drift over
  time — improving one (e.g. a future "render with
  `OffscreenCanvas` for headless export") only benefits the
  one host that consumes the shell.
- **PWA gains automatic test coverage.** The shell's
  happy-dom test suite + the host-boundary invariant in
  [`packages/editor-shell/src/host-boundary.test.ts`](../../packages/editor-shell/src/host-boundary.test.ts)
  exercise the boot path directly. After switchover, those
  tests effectively become PWA-side regression coverage too.
- **Playwright integration becomes a smaller delta.** The
  TBD `docs/plans/playwright-integration.md` plan needs the
  editor mountable headlessly. With the PWA already going
  through `EditorShell`, the headless path is one more host
  consuming the same surface — no second migration.

## Design

### What stays in `EditorSession`

`EditorSession` keeps owning the PWA-shell-specific
orchestration the shell intentionally doesn't model:

- File-details drawer construction + `document.body.appendChild`.
- Right-panel mount into `#editor-right-panel`.
- Toolbar construction into `#editor-sidebar`.
- Scratchpad popover + paste-tool registration.
- `body.editor-mode` class toggle.
- `#canvas-container` / `#file-manager` / `#statusbar` show /
  hide.
- Keyboard-help install (which is shell-side now but
  triggered per-session by EditorSession).
- `selection.onChange` / `history.onStateChange` wiring to
  `HeaderHost` / `StatusHost` / `SavePipeline`.
- Plugin-host `notifyEditorReady` dispatch.

### What moves to `EditorShell`

The narrow primitives:

- SVG element ensure / clear inside the host-supplied
  container.
- `CanvasManager` + `History` + `SelectionManager`
  construction.
- `disposePreviousEditor` cleanup of stale listeners on the
  reused SVG.
- `restoreAnnotations` of the persisted SVG (currently lives
  in `packages/web/src/app/restore-annotations.ts` — moves
  to editor-shell as `restoreAnnotationsInto(canvas, svg)`).

### One new `EditorShellHost` knob

```ts
interface EditorShellHost {
  container: HTMLElement;
  storage: StorageProvider;
  features?: EditorShellFeatures;
  themeOverrides?: Record<string, string>;

  /**
   * Optional pre-existing `<svg>` element the shell should
   * adopt instead of creating an anonymous one. Lets a host
   * that ships an `<svg id="svg-root">` in its index.html
   * (today: PWA + Tauri desktop) preserve its existing CSS
   * selectors. If omitted (today: VSCode webview), the shell
   * creates an anonymous `<svg data-annot-shell-root="1">`
   * inside `container`.
   *
   * The shell's host-boundary invariant doesn't change — the
   * shell still doesn't `getElementById` anything; the host
   * is responsible for finding + passing the element.
   */
  svgRoot?: SVGSVGElement;
}
```

### CSS strategy

`#svg-root` rules in
[`packages/core/styles/editor.css`](../../packages/core/styles/editor.css)
get a sibling selector so both id-keyed (PWA / Tauri) and
attribute-keyed (VSCode / future hosts) SVGs match:

```css
/* before */
#svg-root { /* ... */ }
#svg-root foreignObject [contenteditable="true"] { /* ... */ }

/* after */
#svg-root,
[data-annot-shell-root] {
  /* ... */
}
#svg-root foreignObject [contenteditable="true"],
[data-annot-shell-root] foreignObject [contenteditable="true"] {
  /* ... */
}
```

This is a one-PR no-behavior-change CSS update — `#svg-root`
match continues to work for the existing PWA / desktop path,
and the shell's anonymous SVG starts matching too. After the
switchover the shell could mark its SVG with `id="svg-root"`
explicitly when adopting an existing one, so the legacy
selector keeps applying without churn.

### `EditorShell.open` vs `mountFromRecord`

PWA call sites pass `(dataUrl, width, height, annotations)`,
not an `ImageRecord`. Two options:

1. **Synthesize a minimal `ImageRecord` at the call site**
   and use `mountFromRecord(path, record)`. Easiest. The
   shell already accepts a sparse record via
   `mountFromRecord` (only `originalDataUrl` / `width` /
   `height` are read by the canvas; everything else is
   forwarded to `record` for the `saveNow` path).
2. **Add `EditorShell.mountFromBytes(...)`** that takes the
   raw arguments. Adds API surface for one use case.

Going with option 1 — simpler, no shell API change.

### `restoreAnnotations` reuse

Currently lives in `packages/web/src/app/restore-annotations.ts`.
The shell needs the same logic on `mountFromRecord` when the
record carries `annotationsSvg`. Two paths:

- **Move it into the shell.** The function is pure DOM
  manipulation (DOMParser + importNode) and depends only on
  `@ingcreators/annot-core/editor` (`readAnnotVersion`) and
  `@ingcreators/annot-editor` (`CanvasManager` type). It
  belongs in editor-shell.
- **Keep it in PWA + call from the consumer side.** Cheaper
  but leaves `mountFromRecord` only half-rebuilding the
  saved state.

Going with the move — `restoreAnnotations` becomes a private
`#restoreAnnotations(canvas, svg)` inside EditorShell, called
from `mountFromRecord` when `record.annotationsSvg` is non-
empty.

### `disposePreviousEditor` semantics

Today `EditorSession.disposePreviousEditor` tears down the
SelectionManager + CanvasManager listeners but keeps the
underlying `<svg>` element alive (so the SVG ref + CSS
position survive across image swaps). The shell's
`destroy()` removes the SVG entirely, which is wrong for the
PWA's reuse pattern.

Solution: `EditorShell.mountFromRecord` already calls
`#disposeCanvas` (clears listeners but keeps the SVG node
when `host.svgRoot` was supplied). `destroy()` removes the
SVG only when the shell created it itself. The added knob
is effectively "host owns the SVG; shell owns the listeners
+ children".

## Phased plan

### Phase 1 — CSS dual-selector

Update
[`packages/core/styles/editor.css`](../../packages/core/styles/editor.css)
so every `#svg-root`-keyed rule has a sibling
`[data-annot-shell-root]` match. Pure CSS change — no JS,
no API. Verifies trivially via dev-server smoke + the
existing renderer goldens (which don't depend on these
selectors but would catch any unexpected cascade impact).

**One PR. Risk: trivial.**

### Phase 2 — `EditorShell.svgRoot` host knob

Add the optional `svgRoot?: SVGSVGElement` field to
`EditorShellHost`. When supplied, the shell adopts it
instead of creating; `destroy()` doesn't remove it from the
DOM (the host owns it). Add 2 happy-dom tests:

- `svgRoot` reuse — supplying an existing SVG mounts the
  canvas inside it; `destroy()` leaves it in place.
- `svgRoot` clear — re-`open()`ing an image with the same
  shell + supplied SVG reuses the SVG (no orphan listeners,
  matching the PWA's
  [`disposePreviousEditor`](../../packages/web/src/app/editor-session.ts:159)
  contract).

**One PR. Risk: small — additive shell API.**

### Phase 3 — Move `restoreAnnotations` into the shell

Move
[`packages/web/src/app/restore-annotations.ts`](../../packages/web/src/app/restore-annotations.ts)
to
`packages/editor-shell/src/restore-annotations.ts` and call
it from `mountFromRecord` when `record.annotationsSvg` is
non-empty. Web-side leaves a thin re-export shim so the
existing `import { restoreAnnotations } from
"./restore-annotations.js"` site in
`editor-session.ts` keeps working until Phase 4 removes it.
Add 1 happy-dom test exercising the
`mountFromRecord(path, recordWithAnnotations)` path.

**One PR. Risk: small.**

### Phase 4 — `EditorSession` switchover

The headline change. `EditorSession.setupEditor`:

- **Before** — manually queries `#svg-root`, constructs
  CanvasManager / History / SelectionManager directly,
  calls `restoreAnnotations` separately.
- **After** — synthesizes a minimal `ImageRecord` from the
  `(dataUrl, width, height, annotations)` parameters, calls
  `this.#shell.mountFromRecord(path, record)`, and reads the
  primitives back via `shell.getCanvas() / getHistory() /
  getSelection()`.

The shell is constructed once per `EditorSession` instance
(in the constructor) with the PWA's `StorageProvider` from
`storage/bridge.ts`, the `#canvas-container` element, and
the `<svg id="svg-root">` from `index.html`. `setupEditor`
reuses the same shell across image opens.

The existing `selection.onChange` / `history.onStateChange`
wiring at lines 377 / 426 of `editor-session.ts` migrates to
`shell.on("selection-change", ...)` / `shell.on("dirty",
...)` for symmetry with the VSCode host. The current
single-slot callback assignment continues to work but is
deprecated for new code.

`disposePreviousEditor` collapses to `this.#shell` reset (a
no-op if the shell already cleared listeners on the next
`mountFromRecord`).

`features` flags passed at construction:
`{ capture: true, fileManager: true, scratchpad: true,
keyboardHelp: true }` — the PWA defaults.

**Verification matrix** (manual smoke, all on PWA dev
server):

| Flow | Expected |
|------|---------|
| Paste from clipboard | Editor opens; canvas shows pasted image; toolbar / right-panel / drawer work. |
| Open via gallery double-click | Existing image loads with annotations restored. |
| Capture from extension transfer | Image arrives + opens in editor; `pageMetadata` reaches the Elements section. |
| Edit + autosave | `dirty` → status indicator → save persists. |
| Undo / redo | History buttons work; cycle returns to clean state. |
| Switch between two images | No leaked SelectionManager listeners (the
  drag-N×-faster-than-cursor symptom from the
  `disposePreviousEditor` regression check). |
| Click marker capture | First-time open of a click-captured tag set draws + saves the marker. |

**One PR. Risk: medium — touches the boot path on every
open. Mitigated by the additive shell API + the test suite.**

### Phase 5 — Cleanup

- Remove the web-side shim at
  `packages/web/src/app/restore-annotations.ts` (Phase 3
  left it there for compat; Phase 4 stops referencing it).
- Remove the `setupEditor`'s manual `#svg-root` queries +
  `CanvasManager` / `History` / `SelectionManager` direct
  construction (now lives in the shell).
- Update CLAUDE.md guardrail #10 with a paragraph noting
  that the PWA goes through the shell now (the
  "deferred to follow-up" wording in the existing
  guardrail goes away).
- Mark
  [`docs/plans/_done/vscode-extension-host.md`](./_done/vscode-extension-host.md)'s
  carry-over list — strike the EditorSession switchover
  bullet.
- Move this plan to `_done/`.

**One PR. Risk: tiny.**

## Verification

- Each phase: `pnpm -r typecheck`, `pnpm test`, `pnpm lint`,
  `pnpm --filter @ingcreators/annot-web build`,
  `pnpm --filter @ingcreators/annot-vscode build`. The
  vscode build is included because the shell API change in
  Phase 2 affects both consumers.
- Phase 4 PR includes a manual smoke run through the
  verification matrix above; record results in the PR body.
- The host-boundary invariant in
  `packages/editor-shell/src/host-boundary.test.ts` continues
  to pass — the new `svgRoot` knob doesn't change which
  DOM ids the shell itself queries (it queries none).

## Migration notes

- **No SVG schema change.** No `data-annot-version` bump.
- **No `StorageProvider` change.** PWA continues to pass the
  same `bridge.ts`-resolved provider; the shell just routes
  reads / writes through it.
- **No `PageMetadata` change.** `setPageMetadata(meta)` /
  `getCurrentPageMetadata()` already on the shell from
  Phase 3 of the parent plan; PWA `EditorSession` uses them
  directly after switchover.
- **`<svg id="svg-root">` stays in
  [`packages/web/index.html`](../../packages/web/index.html)
  + [`packages/desktop/index.html`](../../packages/desktop/index.html)**
  so first-render CSS hits the styled element before JS
  boots. The shell adopts the existing element via
  `host.svgRoot`.
- **`packages/web/src/app/restore-annotations.ts`** ends up
  deleted in Phase 5 (Phase 3 turned it into a re-export
  shim; Phase 5 removes the shim now that all callers use
  the shell). External consumers — none today; the web-only
  module was never exported.

## Forward-looking notes

This plan unlocks two follow-ups already on the radar:

- **`docs/plans/playwright-integration.md`** (TBD). With
  PWA going through the shell, the headless annotator is
  "construct the shell against a Playwright-supplied
  container + an in-memory `StorageProvider`" — no third
  migration of the boot path.
- **Desktop hosts the shell directly.** Today
  `packages/desktop` is a Tauri wrap of the PWA. After this
  plan, the desktop could host the shell + its own
  Tauri-backed `StorageProvider` without going through PWA
  routing — a strict subset of the work needed for VSCode.
  Out of scope here; tracked separately.
