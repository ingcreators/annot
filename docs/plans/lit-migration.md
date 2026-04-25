# Lit Web Component Migration

> **Status:** Queued. Authored 2026-04-25 alongside
> [`storybook-introduction.md`](./storybook-introduction.md);
> sign-off received 2026-04-25 on the seven design questions
> (see "Decisions" at the bottom). Lit migration assumes
> Storybook is already in place to act as the component
> playground + visual regression net for the migration.
>
> **Compatibility:** Adds `lit` to runtime deps in
> `packages/web` (~5 KB gzipped). Multi-phase migration touching
> drawer sections, right-panel sections, sidebar items, editor
> chrome, dialogs, and (eventually) the toolbar. Existing public
> APIs — class facades, callbacks — are preserved per phase so
> consumers don't move.
>
> **Risk:** Medium-high cumulative; medium-low per phase. Each
> phase ships independently revertable. The 233-test suite +
> per-phase Storybook stories are the regression net.

## Context

The recently-landed
[`app-decomposition.md`](./app-decomposition.md) acknowledged
that "Lit migration is a separate plan" and parked the question
in its Open questions. Three subsequent plans —
[`plugin-storage-registration.md`](./plugin-storage-registration.md),
[`plugin-sidebar-tabs.md`](./plugin-sidebar-tabs.md), and
[`plugin-ui-slots.md`](./plugin-ui-slots.md) — have since
landed, completing the plugin-extensibility surface that
`annot-cloud` will target.

With the architectural cleanup done, the remaining UI
investment is **shape**: today's UI is 100 % imperative DOM,
which works but has well-known costs:

- **State + render are interleaved** in every component.
  `FileDetailsDrawer.#render` rebuilds DOM end-to-end on every
  `setData`; per-section reactive updates exist but are bolted
  on after the fact. Lit's `render()` + reactive properties
  collapse the two into one declarative path.
- **No prop / state typing at the boundary.** Today a
  `FileDetailsData` change requires the caller to remember to
  call `setData()`; missing that call leaves stale UI. Lit's
  `@property` decorator makes the contract explicit: assign,
  re-render automatically.
- **Limited testability.** Imperative components are hard to
  isolate — most tests mock heavy dependencies (Toolbar,
  CanvasManager, etc.) or skip the host entirely. Lit
  components, by design, render in any DOM (happy-dom,
  Storybook iframe, real browser) with the same API.
- **No ergonomic story authoring.** Storybook stories of
  imperative components have to construct + mount + tear down
  by hand. Lit components express a story as `<my-foo
  prop="value"></my-foo>` — declarative, copy-paste-able,
  designer-friendly.

The `app-decomposition` work + the three plugin-API plans
already isolated UI sections behind small interfaces (`UISection`,
`SidebarTab`, `StorageRegistration`). Each section is now a
self-contained candidate for Lit conversion — the deliverable
boundaries are already drawn.

## Goals

- The UI section modules
  (`drawer-sections/`, `right-panel-sections/`) and their
  surface hosts (`FileDetailsDrawer`, `EditorRightPanel`)
  become Lit elements. Plugin authors get the same
  developer experience for their own sections.
- Component public APIs stay intact across each migration
  PR — every existing import / instantiation point keeps
  working without churn at the call site.
- Each migrated component ships:
  - A Lit class extending `LitElement` with typed
    `@property`/`@state` declarations.
  - Co-located Storybook stories covering its visible states.
  - Existing unit tests preserved or rewritten against the
    Lit element's public API (typically simpler post-Lit:
    set props, query DOM, assert).
- Editor chrome (header, status bar, file-actions cluster)
  follows the same path.
- Toolbar's complex flyout / dropdown machinery converts last,
  with extra care because of the depth of state it carries.
- The 233-test suite (drawer + right-panel + plugin host)
  continues to pass through every phase boundary.

## Non-goals

- **Migrating SVG canvas code to Lit.** `CanvasManager`,
  `SelectionManager`, and the per-tool drawing logic
  (`packages/core/src/editor/tools/*`) manipulate SVG
  directly. They're not "components" in the UI sense and
  don't benefit from Lit's render loop. Stay vanilla.
- **Migrating `@ingcreators/annot-core` to Lit.** Core is
  shared with the future headless annotator path
  (`PRODUCT_DIRECTION.md`'s P2: "core runs without a
  browser"). Lit pulls in DOM APIs that would break the
  DOM-free guarantee. Lit lives only in `packages/web`.
  As part of Phase 5 (per sign-off decision #5), the
  `Toolbar` class relocates **out** of core and **into**
  web since it's the only browser-only-imported surface
  still living in core. The relocation hardens core's
  DOM-free boundary — after Phase 5, every core module
  (including the currently-browser-only ones) can be
  loaded from the headless entry point without pulling DOM
  APIs transitively.
- **Adopting a state-management library.** Lit's built-in
  reactive properties + lit-context (if needed) are enough
  for our component graph. No Redux / Zustand / signals
  library in this plan.
- **Server-side rendering / hydration.** Useful future
  direction but out of scope until we have a marketing /
  landing-page surface that benefits.
- **Migrating `PropertyPanel`** (the embedded selection
  property editor in core). It's already encapsulated, has
  its own internal state machine, and the right-panel
  section borrows it as a black box. Touching it is a
  separate plan with its own complexity.
- **Big-bang rewrite.** Each phase is a focused PR;
  intermediate states have a mix of Lit + vanilla
  components, which is fine — Lit elements interoperate
  with regular DOM transparently.

## Design

### Boundary — what becomes Lit, what stays vanilla

| Component | Phase | Notes |
|-----------|-------|-------|
| `SaveStatusIndicator` | 0 | Smallest UI surface — proof-of-concept |
| `ErrorBar` (info / warning / auth) | 0 | Same. |
| `drawer-sections/file-section` | 1 | Includes inline rename. |
| `drawer-sections/tags-section` | 1 | Wraps existing TagEditor (kept vanilla initially). |
| `drawer-sections/last-commit-section` | 1 | Read-only. |
| `drawer-sections/external-links-section` | 1 | Read-only. |
| `FileDetailsDrawer` (host) | 1 end | Becomes the section host shell. |
| `right-panel-sections/tool-properties-section` | 2 | Renders Toolbar's tool-property DOM (kept vanilla). |
| `right-panel-sections/selection-properties-section` | 2 | Borrows PropertyPanel host (kept vanilla). |
| `right-panel-sections/page-elements-section` | 2 | Including hover overlay + click-to-annotate. |
| `EditorRightPanel` (host + Actions chrome) | 2 end | |
| `Sidebar` (chrome + tab rows) | 3 | Per-mode chip variants. |
| `gallery/file-manager` shell + breadcrumbs | 3 | Grid stays vanilla — high-perf list rendering. |
| Editor `HeaderHost` + `StatusHost` | 4 | Includes inline rename + zoom controls. |
| `Toolbar` + variant flyouts | 5 | Heaviest. **Also relocates from core to web** per sign-off decision #5. Split into 5a (relocate) / 5b (Lit shell) / 5c (Lit flyouts). |
| Dialog UIs (`alert`, `prompt`, interval-capture) | 6 | Polish phase. |
| `TagEditor` | (deferred) | Self-contained; not user-facing as a section. Migrate only if it gets in the way. |
| `PropertyPanel` (in core) | (deferred) | Out of scope per Non-goals. |
| `CanvasManager` / SVG tools | (never) | Not Lit-suitable. |
| `FileManager` grid rendering | (never) | Performance-sensitive. |

### Lit conventions

```ts
// packages/web/src/editor/save-status-indicator.ts
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("annot-save-status")
export class SaveStatusElement extends LitElement {
  @property({ type: String }) status: "idle" | "pending" | "saving" | "saved" | "error" = "idle";

  static styles = css`
    :host { display: inline-flex; align-items: center; gap: 4px; }
    .saving { color: var(--accent); }
    .error { color: var(--err); }
  `;

  render() {
    return html`<span class=${this.status}>${this.#label()}</span>`;
  }

  #label(): string { /* ... */ }
}
```

- Custom-element prefix: `annot-` namespace.
- One Lit class per file. Default-exported alongside the
  decorated `@customElement` definition.
- Public API is the **`@property`** surface. Existing class
  facades (e.g. `SaveStatusIndicator.setStatus(s)`) are
  **retired in the same PR** that introduces their Lit
  replacement. Per sign-off decision #3 (break per phase),
  each migration phase touches every call site of the
  affected components so the end state has exactly one way
  to construct each UI element. The `annot-foo` element is
  the only API consumers see:
  ```ts
  // After Phase 0's PR: old class is gone, callers use the
  // element directly.
  const el = document.createElement("annot-save-status") as SaveStatusElement;
  parent.appendChild(el);
  el.status = "saving";
  ```
  Scope trade-off: each phase PR is bigger (touches every
  caller of the migrated component), but the end state
  avoids the "ambient facade class that's nominally public
  but nobody should use" confusion that kept-facades would
  create. The 233-test suite + per-phase Storybook stories
  catch regressions.
- Styling: prefer scoped `static styles` for new component
  CSS; keep referencing global tokens via CSS custom
  properties (`var(--bg-panel)` etc.) so theme switches
  still work. Existing `editor.css` rules stay in place
  during migration; only newly-written CSS lives in `static
  styles`.
- Tests: each Lit component gets a `*.test.ts` that mounts
  the element via `document.createElement("annot-foo")`,
  sets properties, and asserts against the rendered shadow
  DOM. happy-dom supports this.
- Stories: each Lit component gets a `*.stories.ts` per
  the storybook-introduction plan's convention.

### TS decorator setup

Annot is on `typescript@^6.0.3`. Lit 3 supports both:

- **Stage-3 / TC39 standard decorators** (TS 5+ default).
  No `experimentalDecorators` flag.
- **Legacy experimental decorators** (`experimentalDecorators: true`).

Lean: **use the standard decorators**. They're the future
default, are spec-stable, and TS 6 is well past the
threshold. Decision documented in CLAUDE.md so contributors
don't accidentally enable the experimental flag.

### State + reactivity

- **Component-local state** → `@state()` (Lit re-renders on
  property change).
- **Cross-component state** → continue passing via
  constructor deps / property assignments. Lit-context
  (`@lit/context`) is available if a deep component tree
  forces it; defer until needed.
- **Subscribing to host events** (e.g. drawer sections
  reacting to save) — keep the existing
  `notifyUpdate` / `update(ctx)` pattern. Lit's reactive
  property assignment + Lit-context are alternatives;
  evaluate per phase.

### Break-per-phase migration shape

Per sign-off decision #3, each migration PR:

1. Ships the new Lit element with its `annot-` custom name.
2. **Deletes the old imperative class / factory** in the
   same PR.
3. Updates every call site to construct + use the Lit
   element directly.
4. Includes tests against the Lit element's `@property`
   surface and Storybook stories per the
   `storybook-introduction.md` convention.

Example — `SaveStatusIndicator` (Phase 0):

```ts
// Before (imperative class):
//   const ind = new SaveStatusIndicator(header);
//   ind.setStatus("saving");
//
// After (Phase 0 PR):
//   const el = document.createElement("annot-save-status") as SaveStatusElement;
//   header.appendChild(el);
//   el.status = "saving";
```

The `SaveStatusIndicator` class, its `.ts` file, and every
import statement pointing at it either move or disappear in
the same PR. Phase 0 updates `HeaderHost` + the
`SavePipeline` status-indicator getter dep. After the PR
lands, grepping the repo for `SaveStatusIndicator` returns
zero matches.

Trade-off acknowledged: the "one PR per phase" promise
means every phase carries both the shape change and the
call-site churn. Sign-off chose this over the alternative
(keep facades, retire in a follow-up) on the grounds that
the end state avoids nominally-public facades nobody
should use, and the `233`-test suite + Storybook stories
catch regressions.

Phase 5 (toolbar) will split further because of its size —
see the phased plan below.

### `@ingcreators/annot-web/lit` re-export

Per sign-off decision #6, `packages/web` ships a tiny
re-export module so plugin authors can author Lit
components without taking a direct `lit` dependency.

```ts
// packages/web/src/lit.ts (new in Phase 0)
export {
  LitElement,
  css,
  html,
  nothing,
  render,
  svg,
  type CSSResultGroup,
  type PropertyValues,
  type TemplateResult,
} from "lit";
export {
  customElement,
  property,
  query,
  queryAll,
  state,
} from "lit/decorators.js";
```

`packages/web/package.json` adds the subpath export:

```json
"exports": {
  ".": "./dist/index.js",
  "./lit": "./dist/lit.js"
}
```

Plugin authors write:

```ts
import { LitElement, html, customElement, property } from "@ingcreators/annot-web/lit";

@customElement("cloud-comment-thread")
export class CommentThreadElement extends LitElement {
  @property({ type: String }) path = "";
  render() { return html`...`; }
}
```

Benefits:

- Plugin authors don't add `lit` to their own `package.json`
  — one fewer dep to manage.
- Annot controls the Lit version centrally. If a future
  Lit 4 lands, we bump once in `packages/web` and every
  plugin gets it on their next annot-web update.
- Plugin + annot-web code use the **same** Lit
  identity — `instanceof LitElement` checks work across
  the boundary.

The re-export is part of Phase 0 so it's available to
subsequent phases (built-in UI sections migrating to Lit
will also import from `@ingcreators/annot-web/lit`, not
from `lit` directly, for the same version-consistency
reason).

### Bundle impact

- Lit core: ~5 KB gzipped, tree-shakeable.
- The migration adds ~500 B-1 KB per element (template
  literals + decorators + scoped CSS), but removes the
  imperative DOM construction code, which often nets out
  flat or smaller.
- Storybook stays dev-only (no production-bundle impact).

The PWA's current production bundle is ~415 KB
(`packages/web/dist/assets/index-*.js`). Lit's runtime adds
~5 KB up front; per-component net change tracked per phase.
A ±5 KB swing per phase is acceptable; >10 KB needs
investigation.

## Phased plan

Six phases (after Phase 0 setup) following the boundary
table above. Each phase is its own PR; intermediate states
mix Lit + vanilla.

### Phase 0 — tooling + proof of concept

- Add `lit` to `packages/web` runtime deps.
- TS config sanity (no `experimentalDecorators`).
- Convert `SaveStatusIndicator` and `ErrorBar` (smallest
  surfaces with clear states) as the first Lit elements,
  with backward-compat facades.
- Co-located stories + tests per
  `storybook-introduction.md`'s convention.
- Tiny CLAUDE.md addition: "Lit conventions" subsection
  documenting `annot-` prefix + standard decorators.

Expected delta: ~300-400 lines net, including stories.

### Phase 1 — drawer sections + drawer host

Migrate the four drawer sections + the host:

- `drawer-sections/file-section.ts` →
  `<annot-drawer-file-section>`.
- `drawer-sections/tags-section.ts` →
  `<annot-drawer-tags-section>` (TagEditor stays vanilla).
- `drawer-sections/last-commit-section.ts` →
  `<annot-drawer-last-commit-section>`.
- `drawer-sections/external-links-section.ts` →
  `<annot-drawer-external-links-section>`.
- `FileDetailsDrawer` host → `<annot-file-details-drawer>`
  with its existing `setData` / `setLastCommit` / `destroy`
  facade preserved.

The `UISection` API stays type-stable (built-in factories
return Lit-rendering closures); plugin sections continue
returning whatever they want via `mount`. Mixed
plugin-vanilla + builtin-Lit is fine because the section
host treats `mount` opaquely.

Stories: every section + every visible variant from the
existing test fixture data. The drawer host story
demonstrates section interleave + opt-out.

Expected delta: ~600-800 lines net.

### Phase 2 — right-panel sections + right-panel host

Same shape as Phase 1 for the right-panel:

- Three section files become Lit elements.
- `EditorRightPanel` host becomes a Lit element with the
  Actions chrome, sections-host, and empty-state
  composed inside.
- PropertyPanel stays vanilla (out of scope per non-goals);
  the selection-section's Lit element accepts the
  PropertyPanel host element via a slot or property and
  attaches it on `firstUpdated`.

Expected delta: ~700-900 lines net.

### Phase 3 — sidebar + file-manager shell

- `Sidebar` → `<annot-sidebar>` with the chrome (heading
  text, sections, "New" button) plus child elements for
  storage chips, sidebar tab rows, and folder tree rows.
- The folder-tree's recursive list stays vanilla initially;
  wrapping it in Lit hot-spot eats too much render time
  for marginal cleanup. Trackable as a follow-up.
- `FileManager` shell (breadcrumb + count display + view-
  mode toggle) becomes a Lit element. The image grid
  itself stays vanilla — it's the highest-traffic render
  path in the editor and we don't want to introduce
  reactivity overhead.

Expected delta: ~500-700 lines net.

### Phase 4 — header + status bar

- `HeaderHost`'s output → `<annot-editor-header>`. Inline
  filename rename is a `<annot-editable-filename>` child
  element so it can be storied in isolation.
- `StatusHost`'s output → `<annot-editor-statusbar>` with
  zoom controls + dimensions + tool-name elements.
- File-actions cluster (`Open` / `Copy` / `Save ▼`) becomes
  reusable `<annot-icon-action>` children.

Expected delta: ~400-600 lines net.

### Phase 5 — toolbar relocation + Lit migration (heaviest)

The toolbar is `@ingcreators/annot-core`'s single largest
UI module (~2k lines) and the trickiest to convert because
of its dropdown / flyout / preset state machine. Per
sign-off decision #5, it also **relocates from core to
web** so core's DOM-free guarantee no longer relies on
import-path discipline. Three PRs split to keep each
reviewable:

- **Phase 5a — relocate toolbar.ts from core to web.**
  Move `packages/core/src/editor/toolbar.ts` (+ any
  toolbar-only helpers) to `packages/web/src/editor/toolbar.ts`.
  Update every import — `import { Toolbar } from "@ingcreators/annot-core"`
  becomes `import { Toolbar } from "./editor/toolbar.js"` or
  cross-package wherever applicable. `packages/core`'s
  public surface shrinks; `Toolbar` type re-exports from
  core are deleted. After this PR, core is purely DOM-free
  and can be loaded from the headless entry point without
  a build-time exclusion. No Lit changes yet — just code
  movement + imports. Expected delta: ~500-700 lines net
  across many files.
- **Phase 5b — Lit toolbar shell + tool buttons.** The
  primary toolbar element + its tool-button children
  become Lit elements. Variant flyouts still use their
  existing imperative code. Expected delta: ~800 lines
  net.
- **Phase 5c — Lit variant flyouts + property dropdowns.**
  The remaining dropdown / flyout machinery converts.
  Completes the toolbar migration. Expected delta:
  ~700-1000 lines net.

Each sub-phase is its own PR and independently revertable.
Phase 5a is especially worth landing separately — the
relocation is mechanical but wide, and merging it alone
lets CI confirm no regression before touching the bigger
Lit work in 5b / 5c.

### Phase 6 — dialog UIs

`alert` / `prompt` / `interval-capture-dialog` /
`scratchpad-paste-tool` UI become Lit elements. These are
modal-ish interactions — they're well-suited to Lit because
they have clearly-defined entry / dismiss states.

Expected delta: ~300-500 lines net.

## Verification

At every phase boundary:

- `pnpm -r typecheck` clean.
- `pnpm test` — current pass count maintained; new tests
  per phase add to the count.
- `pnpm lint` — 0 findings.
- `pnpm --filter @ingcreators/annot-web build` succeeds.
- `pnpm --filter @ingcreators/annot-web build-storybook`
  succeeds.
- **Storybook visual check — required per sign-off
  decision #7.** Each phase PR's description includes
  **screenshot(s)** of the Storybook stories for every
  migrated component, taken from `pnpm storybook` locally.
  Screenshots demonstrate the pre-Lit / post-Lit visual
  equivalence for every state variant the component
  supports. Before / after images either side-by-side in
  the PR description, or two separate collapsed `<details>`
  sections if volume warrants. This is a reviewer aid, not
  a CI gate — the expectation is a human looking at the
  diffs.
- Manual smoke (per phase PR's test plan section):
  open the relevant UI surface and exercise the variants
  the migration touched. The UI should look + behave
  identical to pre-Lit.
- Bundle delta: ±5 KB per phase is acceptable; larger
  swings warrant inspection.

## Migration notes

- **No data migration.** Pure UI shape change.
- **No URL / storage / plugin-API changes.** Existing
  callers keep working. Plugin authors writing UI sections
  see the same `UISection` shape — they can author Lit or
  vanilla as they prefer.
- **Backward-compat facades** are temporary. After the
  migration completes, a follow-up plan can retire the
  facades by migrating call sites to use the Lit elements
  directly. Not in scope of this plan.

## Decisions (sign-off 2026-04-25)

1. **TS standard / TC39 stage-3 decorators.** No
   `experimentalDecorators` flag in tsconfig. Lit 3
   supports both; standard is the spec-stable future and
   the project's TS 6 is well past the adoption
   threshold.
2. **`annot-` custom-element prefix.** Short, reads
   cleanly (`<annot-save-status>`,
   `<annot-file-details-drawer>`). No cross-company
   collision risk today.
3. **Break per phase.** Each migration PR deletes the old
   imperative class / factory and updates every call site
   to use the Lit element directly. No ambient
   backward-compat facades lingering through the
   migration. Trade-off: bigger per-PR diffs; benefit:
   the end state has one way to construct each UI
   element, no deprecated-but-public class to grep for.
4. **Hybrid CSS.** Global tokens (`var(--bg-panel)`,
   `var(--accent)`, etc.) stay referenced from Lit
   elements' `static styles` via CSS custom properties.
   Per-component class selectors migrate into scoped
   `static styles` blocks as each component lands —
   opportunistic, not a wholesale stylesheet rewrite.
5. **Phase 5 relocates toolbar from core to web.** On top
   of Lit-ifying the toolbar, the `toolbar.ts` module
   moves from `packages/core/src/editor/` to
   `packages/web/src/editor/`. Import paths across the
   codebase update. Phase 5 splits into 5a (relocate —
   no Lit), 5b (Lit shell), 5c (Lit flyouts) so each sub-
   phase is independently revertable. Result: core
   becomes purely DOM-free, the headless entry point no
   longer needs import-path discipline to stay clean.
6. **Ship `@ingcreators/annot-web/lit` re-export.** Adds
   a subpath export to `packages/web/package.json` that
   re-exports `LitElement` / `html` / `css` / decorators
   from `lit`. Plugin authors import from
   `@ingcreators/annot-web/lit` without taking a direct
   `lit` dependency. Lands in Phase 0 so subsequent
   phases can use it for their own Lit imports too
   (single-Lit-version invariant across host + plugin
   code).
7. **Storybook visual check required per phase PR.**
   Every phase PR description includes screenshots of the
   Storybook stories for every migrated component,
   demonstrating pre-Lit / post-Lit visual equivalence for
   each state variant. Reviewer aid, not a CI gate.
   Baked into each PR's test plan template so the
   expectation is explicit.

## References

- [`storybook-introduction.md`](./storybook-introduction.md)
  — sister plan; Storybook is the showroom for the Lit
  components landed here.
- [`app-decomposition.md`](./app-decomposition.md) — Open
  Questions section parked Lit migration as a separate plan.
- [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) — P2
  "core runs without a browser" is why Lit stays out of
  `@ingcreators/annot-core/headless`.
- Lit 3 docs: https://lit.dev/docs/
- Existing UI surfaces:
  [`packages/web/src/editor/file-details-drawer.ts`](../../packages/web/src/editor/file-details-drawer.ts),
  [`packages/web/src/editor/right-panel.ts`](../../packages/web/src/editor/right-panel.ts),
  [`packages/web/src/gallery/sidebar.ts`](../../packages/web/src/gallery/sidebar.ts).
