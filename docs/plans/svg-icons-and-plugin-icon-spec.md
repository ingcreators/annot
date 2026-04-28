# SVG Icon Unification + Plugin `IconSpec` I/F

> **Status:** Queued. Authored 2026-04-28 from a chat-room discussion
> about consolidating Material Symbols + ad-hoc inline SVG into a
> single icon system that is also exposed to plugins. Sign-off
> received 2026-04-28 on the five "Decisions to confirm" questions
> at the bottom — see "Decisions" section for the locked answers.
>
> **Compatibility:** Touches every UI surface that currently renders
> a Material Symbols glyph (~131 occurrences across 41 files; 72
> distinct glyph names) plus three plugin API fields (`icon?: string`
> on `StorageRegistration`, `ExternalLink`, `SidebarTab`). Adds
> Tier A `IconSpec` type and a Tier B icon registry to
> `@ingcreators/annot-core`. Drops two copies of
> `MaterialSymbolsOutlined.ttf` (~977 KB each) and the matching
> `@font-face` CSS.
>
> **Risk:** Medium. The migration itself is mechanical (string →
> registry id), but the plugin-API change is a **breaking change** to
> a published-shaped surface — pre-release so we can take it without
> aliases, but it lands across two phases (additive new field +
> deprecation removal) so any in-flight plugin work has a window.
> Sanitiser correctness for plugin-supplied SVG (`kind: "svg"`)
> deserves real review — XSS via `<svg>` is a known class of bug.

## Context

Today, icon rendering in Annot is split across two systems that have
been growing in opposite directions:

1. **Material Symbols (font-icon).** A 977 KB TTF
   (`MaterialSymbolsOutlined.ttf`) is bundled in
   [`packages/core/fonts/`](../../packages/core/fonts/) AND
   [`packages/extension/public/fonts/`](../../packages/extension/public/fonts/),
   loaded via
   [`packages/core/styles/material-symbols.css`](../../packages/core/styles/material-symbols.css).
   Renders as `<span class="material-symbols-outlined">edit</span>`
   — the ligature name resolves at glyph-rendering time inside the
   font.
2. **Ad-hoc inline SVG.** When the Material Symbols catalogue lacks a
   visually distinct glyph at toolbar scale, we hand-roll inline
   SVG. Current homes:
   [`packages/core/src/editor/toolbar-icons.ts`](../../packages/core/src/editor/toolbar-icons.ts)
   carries `SHAPE_ICON_SVG` (rect / rounded / ellipse outlines —
   Material's `square` / `rectangle` / `crop_square` are
   indistinguishable at 36 px), `ARROW_ICON_SVG` (Material has no
   "single line, both ends arrowed" glyph — `sync_alt` is two
   parallel lines), and `COUNTER_ICON_SVG` (Material's `looks_one` /
   `filter_1` show a flat numeral, not a counter-marker badge).

The two systems coexist uneasily:

- **Distinct glyphs in use:** 72 (counted via `grep`). The bundled
  font ships thousands. We pay a 977 KB × 2 = ~1.95 MB shipping cost
  for ~1 % utilisation. After Brotli the actual on-wire cost is
  smaller but still in the hundreds of KB per fresh install.
- **Visual cohesion:** the inline SVGs were sized + stroked to match
  Material's optical weight, but every new ad-hoc SVG is a fresh
  judgement call. The codebase has accumulated subtly different
  stroke widths and viewBox sizes (some `0 0 24 24`, some `0 0 20 20`,
  some unspecified).
- **CSP friction:** font-icon resolution depends on a `<link>`-loaded
  webfont (or, in our case, the bundled TTF). For a future stricter
  CSP — or, more concretely, for the Chrome extension's MV3
  service-worker context where font loading rules differ from the
  document realm — inline SVG is unconditionally cleaner.
- **Plugin authorability gap.** The existing plugin API
  ([`packages/web/src/app/plugin-host.ts`](../../packages/web/src/app/plugin-host.ts))
  has three `icon?: string` fields:
  - `StorageRegistration.icon` (line 113) — sidebar chip glyph for
    a plugin-registered storage backend.
  - `SidebarTab.icon` (line 168) — Views-section nav glyph.
  - `ExternalLink.icon` (line 57) — drawer external-link glyph.

  Each is documented as "Material-symbols icon name". This binds
  every plugin author to the exact subset of Material Symbols we
  happen to ship — they cannot supply their own logo (e.g. an
  `annot-cloud` pointer-commit store wanting to show an annot-cloud
  mark, a hypothetical Notion plugin wanting the Notion logomark, a
  social-graph plugin wanting a custom node glyph) without
  monkey-patching our font setup. They also can't tell whether the
  ligature name they pick is one we actually ship — Material's full
  catalogue is ~3,000 names; ours is whatever the bundled TTF
  contains plus whatever the user agent's font-shaping happens to
  resolve.

The combination — bundle bloat we don't need, cohesion drift, CSP
friction, and a plugin API that closes itself by accident to
non-Material glyphs — is the case for unifying onto a single SVG-
based icon system that is **simultaneously the host's icon API and
the plugin's icon API**.

### Why now

Three forces converge on this being the right moment:

1. **Pre-release window is closing.** `pre-release-final-pieces.md`
   and `oss-cloud-split.md` are explicit that the plugin API is
   about to crystallise. Changing `icon?: string` →
   `icon?: IconSpec` after `annot-cloud` ships against the current
   shape is a real cost; doing it before is free.
2. **The "headless core" direction.** `PRODUCT_DIRECTION.md`'s
   Tier A boundary intends `@ingcreators/annot-core` to be
   importable from pure Node. Today's `material-symbols.css` +
   font-face setup is browser-only; an SVG registry is pure data
   and slots into Tier A / B cleanly.
3. **Existing `toolbar-icons.ts` precedent.** The Tier B
   inline-SVG file already lives where the new registry would —
   adding to it is mechanical, not architectural.

### License posture (Apache-2.0 — already covered, needs annotation)

Material Symbols is distributed under Apache License 2.0
([github.com/google/material-design-icons](https://github.com/google/material-design-icons)).
We are already shipping the TTF; the obligations are:

- **Attribution in NOTICE.** §4(d) of Apache-2.0 requires existing
  NOTICE attributions to be preserved, and recommends crediting
  used third-party Apache-2.0 works. The current
  [`NOTICE`](../../NOTICE) lists our major dependencies but does
  NOT credit Material Symbols / the font asset. **This is a gap
  today**, regardless of whether we migrate to SVG — fix
  alongside.
- **Source preservation for asset extraction.** When we extract SVG
  paths from the upstream repo, recording the source commit hash
  in the registry file lets future maintainers re-extract /
  diff against newer Google releases.
- **No commercial-use restriction.** Apache-2.0 is permissive;
  OSS distribution and commercial SaaS use both fine.
- **No trademark grant.** We don't need to display "Material" /
  "Google" branding.

The migration is licence-compatible by construction: extracting SVG
paths from an Apache-2.0-licensed icon set into a registry file is
exactly the use-case Apache-2.0 covers. We just need to carry the
attribution forward into our distribution.

## Goals

1. **One icon API for everyone.** Host code, built-in plugins, and
   external plugins all render icons via the same
   `IconSpec` discriminated union — `kind: "builtin"` (registry id),
   `kind: "svg"` (raw SVG string), or `kind: "url"` (data: or
   same-origin URL).
2. **Plugin-owned icons.** A plugin can ship its own logomark
   without monkey-patching the host's font set. The annot-cloud
   pointer-commit-store plugin is the immediate concrete consumer.
3. **Zero font-icon dependency in the shipped bundle** by the end of
   the migration. `MaterialSymbolsOutlined.ttf` × 2 deleted,
   `material-symbols.css` deleted, `@font-face` rule deleted.
4. **Apache-2.0 attribution for the icons we keep.** NOTICE updated
   to credit Material Symbols (also closes the existing gap from
   shipping the TTF without a NOTICE credit).
5. **Tier-correct placement.** `IconSpec` is Tier A (pure data
   types). The icon registry is Tier B (SVG strings — pure data, no
   DOM). The renderer + sanitiser are Tier B (jsdom-friendly
   element creation). The Lit `<annot-icon>` element is Tier C
   (live-DOM convenience wrapper).
6. **No regression in visual cohesion.** Every replaced
   `material-symbols-outlined` site renders an icon that's optically
   indistinguishable from the original at the spot it appears
   (same effective size, same effective stroke weight, same
   `currentColor` behaviour). DOM byte-equivalence is NOT the
   bar — we're swapping `<span class=ms>edit</span>` for `<svg>…</svg>`,
   so we use a per-component visual check (Storybook screenshot
   diff during PR) instead.

## Non-goals

- **Reducing the icon palette.** We migrate every icon currently
  used; we don't take this opportunity to simplify down to a
  smaller "design-system" set. That's a separate UX exercise.
- **Replacing the inline SVGs in `toolbar-icons.ts`.** Those
  hand-rolled glyphs (`SHAPE_ICON_SVG`, `ARROW_ICON_SVG`,
  `COUNTER_ICON_SVG`) stay as-is — they're already the pattern we're
  migrating onto. They get *folded into* the new registry so the
  retrieval API is uniform, but the SVG content is unchanged.
- **A Storybook icon gallery.** Nice-to-have, not a blocker.
  Tracked as an optional follow-up.
- **CDN-served icons.** Plugins can supply `kind: "url"` with same-
  origin or `data:` URLs for self-contained packaging; we will not
  whitelist external domains. Plugin authors who want to load from
  a CDN inline-fetch on their side and pass `kind: "svg"`.
- **Unicode-emoji fallback.** Some early diagnostic UI used emoji
  characters as makeshift icons. Out of scope; treated as bugs to
  fix on sight, not a system to formalise.

## Design

### Tier-A type: `IconSpec`

Lives in [`packages/core/src/icons/types.ts`](../../packages/core/src/icons/types.ts)
(new). Exported from `@ingcreators/annot-core` (root) AND
`@ingcreators/annot-core/icons` (subpath, for plugin authors who
want minimal imports).

```ts
// packages/core/src/icons/types.ts (Tier A — pure types, no DOM)

/**
 * Identity of an icon shipped with the Annot host. The full set is
 * defined by the Tier B registry; this string-literal union is the
 * type-level handle plugin authors program against.
 *
 * Add a new id by editing
 * `packages/core/src/editor/icons/registry.ts` (the registry IS the
 * source of truth; this union is generated from it via `keyof typeof`
 * and re-exported here).
 */
export type BuiltinIconId = string;
// ^ The actual narrow union is exported from the registry module
// itself; this Tier A file declares the broad type so consumers
// downstream of annot-core/icons can name it without dragging in
// the registry's data.

/**
 * Plugin-friendly icon descriptor. Discriminated on `kind`:
 *
 * - `"builtin"` — refers to a host-provided registry icon by id.
 *   Cheapest at runtime (no parsing); recommended whenever a
 *   suitable host icon exists. Plugins cross-check the available
 *   ids by importing `BUILTIN_ICON_IDS` from the registry.
 * - `"svg"` — raw inline SVG markup. Use for plugin-owned logomarks
 *   not present in the host registry. Sanitised at render time
 *   (allow-list; see "Sanitiser" section). Plugins MUST author
 *   stand-alone `<svg>` elements (no surrounding HTML); the renderer
 *   refuses anything that doesn't parse as a single SVG root.
 * - `"url"` — same-origin or `data:` URL pointing at an SVG asset.
 *   Used by plugins that ship their logomark as a static asset
 *   bundled with the plugin's JS. The host renders this via
 *   `<img src=…>` so the SVG is sandboxed (no CSS / script access
 *   to the host page). External-origin URLs are rejected at
 *   registration time.
 */
export type IconSpec =
  | { readonly kind: "builtin"; readonly id: BuiltinIconId }
  | { readonly kind: "svg"; readonly svg: string }
  | { readonly kind: "url"; readonly url: string };

/** Convenience constructors. Plugin authors usually write
 *  `icon: { kind: "builtin", id: "cloud" }` directly; these helpers
 *  keep test fixtures and complex registrations less noisy. */
export const builtinIcon = (id: BuiltinIconId): IconSpec => ({ kind: "builtin", id });
export const svgIcon = (svg: string): IconSpec => ({ kind: "svg", svg });
export const urlIcon = (url: string): IconSpec => ({ kind: "url", url });
```

### Tier-B registry

Lives in `packages/core/src/editor/icons/registry.ts` (new). Folds
in `toolbar-icons.ts`'s existing inline SVGs and adds the 72 names
currently consumed via the font. The file exports:

```ts
// Pure data — strings only. No DOM, no Element manipulation.

export const BUILTIN_ICONS = {
  // Material Symbols-derived (Apache-2.0, Google LLC,
  // material-design-icons @ <commit-hash>).
  add: `<svg viewBox="0 0 24 24" …><path …/></svg>`,
  edit: `<svg …>…</svg>`,
  cloud: `<svg …>…</svg>`,
  // … 70 more …

  // Hand-rolled (folded in from toolbar-icons.ts):
  "shape.rect": SHAPE_ICON_SVG.rect,
  "shape.rounded": SHAPE_ICON_SVG.rounded,
  "shape.ellipse": SHAPE_ICON_SVG.ellipse,
  "arrow.none": ARROW_ICON_SVG.none,
  // … etc …
} as const;

export type BuiltinIconId = keyof typeof BUILTIN_ICONS;
export const BUILTIN_ICON_IDS = Object.keys(BUILTIN_ICONS) as readonly BuiltinIconId[];
```

The registry's id namespace is **flat strings, dotted-grouped by
convention** for the hand-rolled ones (`shape.rect`,
`arrow.none`, `counter.circle`). Material-derived ids match their
upstream ligature names (`add`, `edit`, `cloud_off`) so the migration
is a literal find/replace.

A header comment in the registry file records the upstream commit
hash from which the SVG paths were extracted:

```
/**
 * Source: https://github.com/google/material-design-icons
 *         pinned at commit <SHA> on 2026-04-28.
 * Upstream license: Apache-2.0, Copyright Google LLC.
 *
 * To re-extract from a newer upstream snapshot, see
 * `scripts/extract-material-symbols.mjs` (Phase 2 deliverable).
 */
```

### Tier-B renderer + sanitiser

Lives in `packages/core/src/editor/icons/render.ts` and
`packages/core/src/editor/icons/sanitize.ts` (new). Operates on
strings and `Element`s — no `<canvas>`, jsdom-friendly.

**Allow-list-based sanitiser.** Plugin-supplied SVG is the
attack-surface concern; this is the security-critical code in the
plan. The sanitiser walks the parsed SVG DOM and:

- Allows ONLY: `svg`, `g`, `path`, `circle`, `ellipse`, `rect`,
  `line`, `polyline`, `polygon`, `defs`, `linearGradient`,
  `radialGradient`, `stop`, `symbol`, `use`, `title`, `desc`.
- Allows ONLY safe attributes (allow-listed by tag — `viewBox`, `d`,
  `cx`, `cy`, `r`, `rx`, `ry`, `x`, `y`, `width`, `height`,
  `fill`, `stroke`, `stroke-width`, `stroke-linecap`,
  `stroke-linejoin`, `transform`, `fill-rule`, `points`,
  `aria-hidden`, `role`, `id` (only inside `<defs>`), `href`
  (only on `<use>`, only `#`-internal)).
- **Rejects all `on*` attributes** (`onclick`, `onload`, …).
- **Rejects `<script>`** entirely (not in the allow-list).
- **Rejects `href="javascript:…"`** even on allowed elements.
- **Rejects external URL references** (`href="https://…"`).
- **Rejects `<style>` and `style=` attributes** by default — icons
  use `currentColor` and the host's CSS sets size; per-plugin styling
  isn't permitted. (If we hit a real-world need, we relax via a
  narrower `style=` allow-list later.)

The sanitiser is a small (~150 LOC) hand-written walker. We
considered `DOMPurify` but its bundle weight (~22 KB min+gz) and
feature surface vastly exceed our needs — we accept ~30 SVG-relevant
elements + ~25 attributes; DOMPurify's allow-list is HTML-focused
and would still need our SVG-side narrowing on top. The hand-written
sanitiser also keeps Tier B headless-clean (no DOM-only
dependencies).

The sanitiser is unit-tested with explicit attack vectors:

- Inline `<script>` → rejected.
- `onload="…"` on `<svg>` → attribute stripped, SVG kept.
- `<a href="javascript:alert(1)">` → element removed.
- `<image href="https://evil/x.png">` → element removed.
- `<use href="https://evil/sprite#x">` → element removed; internal
  `<use href="#shape-1">` kept.
- Nested `<foreignObject>` → element removed (not in allow-list).

**Renderer surface.**

```ts
// Tier B — returns sanitised SVG markup as a string.
// String form so consumers can route through Lit `unsafeHTML`,
// directly assign to `innerHTML`, or post-process further.
export function renderIconHtml(spec: IconSpec): string;

// Tier B — convenience: parses + returns the live <svg> element.
// Throws on invalid spec.
export function renderIconElement(spec: IconSpec, doc?: Document): SVGElement;
```

`kind: "url"` returns a string of the form
`<img src="…" alt="" aria-hidden="true" class="annot-icon-img"/>` so
the SVG is rendered in image-document context — sandboxed away
from the host's CSS and JS. Plugins relying on `currentColor` for
icons should use `kind: "svg"` instead (data URLs work, but they
inherit `<img>` sandboxing).

### Tier-C Lit element (web-only convenience)

Lives in `packages/web/src/ui/annot-icon.ts` (new). Thin Lit
wrapper around `renderIconHtml`:

```ts
@customElement("annot-icon")
class AnnotIconElement extends LitElement {
  static override properties = { spec: { attribute: false } };
  declare spec: IconSpec | null;
  override createRenderRoot() { return this; }   // light DOM
  override render() {
    return this.spec ? unsafeHTML(renderIconHtml(this.spec)) : nothing;
  }
}
```

CSS sizing comes from the host context: `<annot-icon>` is
`display: inline-flex; width: 1em; height: 1em` by default; consumers
override with parent-scoped CSS just like they do for the existing
Material spans (`.editor-right-panel-empty-icon` etc.).

The element is registered globally in
`packages/web/src/main.ts` (alongside existing built-in elements)
so plugin code that imports `<annot-icon>` doesn't need to register
it themselves. Per CLAUDE.md's Lit conventions: `annot-` prefix,
`static override properties` (no decorators), light DOM during
migration.

### Plugin-API migration

Three fields shift from `icon?: string` (Material ligature name) to
`icon?: IconSpec`:

| File | Field | Today | After |
|------|-------|-------|-------|
| `packages/web/src/app/plugin-host.ts` | `StorageRegistration.icon` | `string` | `IconSpec` |
| `packages/web/src/app/plugin-host.ts` | `SidebarTab.icon` | `string` | `IconSpec` |
| `packages/web/src/app/plugin-host.ts` | `ExternalLink.icon` | `string` | `IconSpec` |

Migration strategy: **additive then remove**, two phases apart.

- **Phase 5a (additive):** add a new field `iconSpec?: IconSpec`
  alongside the existing `icon?: string`. Sidebar / drawer
  consumers prefer `iconSpec` when present, else fall back to
  treating the legacy `icon` string as `{ kind: "builtin", id: icon }`.
  All built-in registrations switch to `iconSpec`. Deprecation
  JSDoc lands on `icon`.
- **Phase 5b (removal):** delete `icon?: string`. By this point
  every built-in is on `iconSpec` and any external plugin had a
  release window to migrate. Pre-release ergonomics (no aliases,
  no shims) per `design-system-foundations.md`'s precedent.

The `iconSpec` field is renamed to plain `icon` at the deletion
boundary, matching the existing field name. (Two-phase migration
is the only reason it carries a temporary name in 5a.)

### Asset-extraction tooling

A small Node script under `scripts/extract-material-symbols.mjs`
takes a list of glyph names + a Material Symbols repo path / npm
package and emits the `BUILTIN_ICONS` registry entries. The script
is checked in but **not** part of any CI step — it's authored
once, run once, and the output is the source of truth in the
registry file. Future re-runs are explicit human-driven actions
(e.g. rebasing onto a newer Google release; re-checking a glyph's
visual identity).

The script's reproducibility matters for licence hygiene:

- Reads the upstream commit hash at run time, prints it.
- Writes the hash + run timestamp into the registry header
  comment.
- Diffs against the existing registry and reports glyphs that
  changed paths so the reviewer can eyeball them.

## Phased plan

Each phase is its own PR per CLAUDE.md's "phased plans: one PR per
phase" rule. Phases are independent reverts where possible — Phase 0
(NOTICE) and Phase 1 (`IconSpec` types) can land in either order;
Phases 2-4 sequence on Phase 1; Phase 5 sequences on Phase 4; Phase
6 sequences on Phase 5; Phase 7 documents what shipped. Phase 4
itself is broken into seven sub-PRs (4a–4g) for independent
review + revert; the rest of the phases are single PRs.

### Phase 0 — NOTICE attribution for Material Symbols

**Standalone.** This closes the existing Apache-2.0 attribution gap
regardless of whether the rest of the migration ships.

- Update [`NOTICE`](../../NOTICE) to credit Material Symbols
  (Apache-2.0, Copyright Google LLC) under the major-dependencies
  bullet list.
- Add a one-line note saying which file ships the asset
  (`packages/core/fonts/MaterialSymbolsOutlined.ttf` and the
  duplicate in `packages/extension/public/fonts/`).

This phase has no code change. It's the licence-hygiene PR.

### Phase 1 — `IconSpec` type + Tier-A wiring

- New file `packages/core/src/icons/types.ts` exporting `IconSpec`,
  `builtinIcon` / `svgIcon` / `urlIcon` helpers, broad
  `BuiltinIconId` alias.
- Re-export from `packages/core/src/headless.ts` so the root
  `@ingcreators/annot-core` and `/headless` subpath both expose it.
- Add a new subpath export
  `@ingcreators/annot-core/icons` → `dist/icons/index.js` for
  plugin authors who want minimal imports.
- Update `packages/core/src/headless.test.ts` probe to confirm
  the new subpath stays Tier A (no DOM, no Element imports).
- No callers change yet — this is the type land-grab.

### Phase 2 — Registry + extraction script

- `scripts/extract-material-symbols.mjs` authored.
- Run script for the 72 glyph names (output of the
  `grep -rEho` audit).
- Write `packages/core/src/editor/icons/registry.ts` with
  `BUILTIN_ICONS` (~75 entries: 72 Material + 3 hand-rolled
  groups folded in), `BuiltinIconId` narrow union,
  `BUILTIN_ICON_IDS` array.
- `toolbar-icons.ts`'s `SHAPE_ICON_SVG` / `ARROW_ICON_SVG` /
  `COUNTER_ICON_SVG` are `re-export`-ed from the new registry for
  back-compat; existing imports keep working but the canonical
  home is the registry.
- Header comment in `registry.ts` records source repo + commit
  hash + extraction date (Apache-2.0 attribution at the file level
  on top of the project-wide NOTICE entry from Phase 0).
- Vitest snapshot test on the registry's keys (catches accidental
  removals during future merges).

### Phase 3 — Renderer + sanitiser

- `packages/core/src/editor/icons/sanitize.ts` —
  allow-list walker, ~150 LOC, no third-party deps.
- `packages/core/src/editor/icons/render.ts` —
  `renderIconHtml` + `renderIconElement`, dispatching on
  `IconSpec.kind`.
- Vitest tests:
  - `kind: "builtin"` for every id in `BUILTIN_ICON_IDS` round-
    trips (no SVG corruption).
  - `kind: "svg"` accepts a stand-alone valid SVG, returns the
    sanitised form.
  - `kind: "svg"` rejects each documented attack vector (script
    tag, on* attrs, javascript: href, external image href,
    foreignObject).
  - `kind: "url"` accepts `data:image/svg+xml,…` and `/relative`
    paths; rejects `https://example.test/icon.svg`.
- Headless probe: importing `render` / `sanitize` does NOT pull
  in any `packages/editor/` or `packages/render/` modules.

### Phase 4 — Migrate first-party usage to the new registry

Sub-phased by surface area, each shipping its own PR. The Storybook
stories for each migrated component double as the visual-regression
net (CI builds Storybook, fails on broken renders; reviewers eyeball
the screenshot).

- **4a — `<annot-icon>` Lit element + main.ts registration.**
  Adds the rendering primitive without removing any callers.
- **4b — Editor surfaces.**
  [`right-panel.ts`](../../packages/web/src/editor/right-panel.ts) (14 sites),
  [`editor-header.ts`](../../packages/web/src/editor/editor-header.ts) (7),
  [`editor-statusbar.ts`](../../packages/web/src/editor/editor-statusbar.ts) (2),
  [`save-status-indicator.ts`](../../packages/web/src/editor/save-status-indicator.ts) (1),
  [`keyboard-help.ts`](../../packages/web/src/editor/keyboard-help.ts) (1),
  [`toolbar.ts`](../../packages/web/src/editor/toolbar.ts) (3),
  [`tool-property-renderer.ts`](../../packages/web/src/editor/tool-property-renderer.ts) (1),
  [`annot-toolbar.ts`](../../packages/web/src/editor/annot-toolbar.ts) (2),
  [`annot-tool-flyout.ts`](../../packages/web/src/editor/annot-tool-flyout.ts) (1),
  [`annot-file-details-drawer.ts`](../../packages/web/src/editor/annot-file-details-drawer.ts) (1),
  [`annot-scratchpad-section.ts`](../../packages/web/src/editor/annot-scratchpad-section.ts) (2),
  drawer-sections / right-panel-sections subdirs.
- **4c — Gallery + file-manager surfaces.**
  [`sidebar.ts`](../../packages/web/src/gallery/sidebar.ts) (8),
  [`annot-gallery-page.ts`](../../packages/web/src/gallery/annot-gallery-page.ts) (3),
  [`file-manager-shell.ts`](../../packages/web/src/gallery/file-manager-shell.ts) (7),
  [`annot-context-menu.ts`](../../packages/web/src/gallery/annot-context-menu.ts) (1),
  [`file-manager.css`](../../packages/web/src/styles/file-manager.css) (7 selectors).
- **4d — Capture + UI shell.**
  [`annot-capture-progress-toast.ts`](../../packages/web/src/capture/annot-capture-progress-toast.ts) (1),
  [`error-bar.ts`](../../packages/web/src/ui/error-bar.ts) (1),
  [`app.ts`](../../packages/web/src/app.ts) (3),
  [`main.ts`](../../packages/web/src/main.ts) (1).
- **4e — `annot-editor` package.**
  [`property-controls.ts`](../../packages/editor/src/property-controls.ts) (1),
  [`property-panel-renderer.ts`](../../packages/editor/src/property-panel-renderer.ts) (2),
  [`canvas-context-menu.ts`](../../packages/editor/src/canvas-context-menu.ts) (5),
  [`custom-select.ts`](../../packages/editor/src/custom-select.ts) (1),
  [`theme-toggle.ts`](../../packages/editor/src/theme-toggle.ts) (1).
  Inline-snapshot tests under `property-panel-renderer.test.ts` /
  `tool-property-renderer.test.ts` are updated as part of this PR.
  CLAUDE.md's "DOM byte-equivalence is the migration contract" for
  these snapshots is **deliberately broken** here — that's the
  visible change called out in the PR description.
- **4f — Tier B `tool-registry.ts` + `property-schema.ts`.**
  These reference Material ligature names as data; rewrite them as
  `IconSpec` literals. No DOM in the source code, just data swaps.
- **4g — Desktop `index.html`.** 3 plain-HTML
  `<button class="material-symbols-outlined">` sites in
  [`packages/desktop/index.html`](../../packages/desktop/index.html) — switch to
  `<annot-icon spec=…>` once the element is registered, OR to
  inline SVG since the desktop shell loads before the Lit
  registration runs (decide at PR time; inline SVG is the safer
  zero-dep path for the shell HTML).

### Phase 5 — Plugin-API migration (single PR)

Decisions §2: Phase 5a (additive) and the original Phase 5b
(rename + remove) collapsed into ONE PR. No external plugin
authors today and the only real downstream consumer
(`annot-cloud`, private) is ours; pre-release ergonomics let us
take the breaking change in a single shot.

- Change `icon?: string` → `icon?: IconSpec` on
  `StorageRegistration`, `SidebarTab`, and `ExternalLink` in
  [`packages/web/src/app/plugin-host.ts`](../../packages/web/src/app/plugin-host.ts).
- Update `addExternalLink` / `registerStorage` / `addSidebarTab`
  JSDoc to say
  "icon: IconSpec — pass `{ kind: 'builtin', id: 'cloud' }` for a
  host icon, `{ kind: 'svg', svg: '…' }` for plugin-owned art".
- Flip `BUILTIN_CHIP_DESCRIPTORS` in
  [`sidebar.ts`](../../packages/web/src/gallery/sidebar.ts) to
  `IconSpec` (every entry becomes `{ kind: "builtin", id: "…" }`).
- Update sidebar / drawer consumers to read `IconSpec` and route
  through `<annot-icon spec={…}>` (or `renderIconHtml(spec)` where
  a string is needed).
- Refresh Storybook stories that exercise the plugin API surface
  (sidebar + drawer external-link section + sidebar-tabs) with
  the new shape.

### Phase 6 — Drop the font

Sequence: must follow Phase 4 (no remaining
`material-symbols-outlined` sites in code) AND Phase 5 (no
remaining `icon: string` plugin fields).

- Delete
  [`packages/core/styles/material-symbols.css`](../../packages/core/styles/material-symbols.css).
- Delete
  [`packages/core/fonts/MaterialSymbolsOutlined.ttf`](../../packages/core/fonts/MaterialSymbolsOutlined.ttf).
- Delete
  [`packages/extension/public/fonts/MaterialSymbolsOutlined.ttf`](../../packages/extension/public/fonts/MaterialSymbolsOutlined.ttf).
- Remove the `<link>` / import wires that load the CSS (`main.ts`,
  Storybook `preview.ts`, desktop `index.html`).
- Update [`NOTICE`](../../NOTICE) — Material Symbols entry stays
  (we still use the SVG paths) but the "TTF font shipped at <path>"
  note from Phase 0 is removed since the font is gone; the
  attribution shifts to "SVG paths derived from Material Symbols
  @ <commit-hash>, see registry header for full attribution".
- Verify the build size delta in the PR description (expect ~977 KB
  removed from core's dist + ~977 KB from extension's
  `public/`).

This is a satisfying small PR — pure deletion plus the link/import
sweeps.

### Phase 7 — Plugin author guide + plan archive

- New doc `docs/plugin-api/icons.md` covering:
  - The three `IconSpec` kinds and when to use each.
  - The full `BUILTIN_ICON_IDS` list (auto-generated table).
  - The sanitiser's allow-list (so plugin authors know what
    will / won't survive — saves them debugging surprise stripping).
  - A worked example: an `annot-cloud` plugin registering its
    pointer-commit store with `iconSpec: { kind: "svg", svg: "…" }`
    pointing at a bundled logomark.
- CLAUDE.md gains a one-line entry under "Architectural guardrails"
  pointing to the icon plugin doc — same shape as the existing
  PropertyPanel / Toolbar registry entries.
- Move this plan to `_done/` with the standard one-liner pointer
  in `docs/plans/README.md`.

## Verification

Per phase, the standard checklist:

- [ ] `pnpm -r typecheck`
- [ ] `pnpm test` — note pass count; phases 2–3 add new tests
- [ ] `pnpm lint` reports 0 findings
- [ ] `pnpm --filter @ingcreators/annot-core build`
- [ ] `pnpm --filter @ingcreators/annot-web build`
- [ ] `pnpm --filter @ingcreators/annot-extension build` (Phase 6
      onwards needs this; the others touch web only)
- [ ] Storybook static build green (CLAUDE.md's CI-blocking rule)
- [ ] No new DOM dependencies in `packages/core` outside Tier B's
      jsdom-friendly carve-out (`headless.test.ts` probe)

Phase-specific:

- **Phase 3 (sanitiser).** Manual review of the attack-vector test
  table. If we miss a class of attack, every later phase's
  `kind: "svg"` plugin path inherits the gap.
- **Phase 4b–4g (UI migration).** Eyeball each migrated component
  in Storybook. Material Symbols' optical weight at `font-size: 20px`
  matches the new SVGs at `width: 20px; stroke-width: 2` — most
  callers should "just work", but anywhere we hard-coded
  `font-size` in the parent CSS will need an `--annot-icon-size`
  CSS variable / tweak.
- **Phase 5a/5b (plugin API).** Type-check that
  `app.ts` builds against the `iconSpec` field; `app.ts` mounts a
  built-in plugin so it exercises the API surface end-to-end.
- **Phase 6 (font deletion).** Bundle size delta in the PR body.
  Web build size should drop noticeably (TTF Brotli compresses to
  ~150 KB; extension build similar).

## Migration notes

- **External plugin authors (none today).** Once `annot-cloud`
  starts authoring against this API, the Phase 5a → 5b window is
  one release cycle. If a third-party plugin author appears
  between now and then, we accommodate them by extending the 5b
  delay; the deprecation JSDoc + the additive shape of 5a means
  no one is forced to migrate at the same time we do.
- **Re-extracting newer Material Symbols releases.** Run
  `scripts/extract-material-symbols.mjs` against a fresh upstream
  checkout, eyeball the diff, commit. Apache-2.0's attribution
  obligation is satisfied as long as the registry header stays
  accurate.
- **Plugin-supplied SVG identity.** A plugin's `kind: "svg"` icon
  is rendered as inline SVG with `currentColor` + parent-controlled
  size. Plugins authoring icons should:
  - Author at viewBox `0 0 24 24` to match the host's optical
    weight.
  - Use `fill="currentColor"` (or `stroke="currentColor"`) — never
    hard-coded colours, so theme switching works.
  - Set `aria-hidden="true"` (the host adds this if missing during
    sanitisation).
  - Strip XML preamble / `<!DOCTYPE>` (sanitiser tolerates but
    skips them).
- **Forward-looking: icon variant grouping.** If we end up wanting
  light/dark-specific icons (rare — `currentColor` covers most
  cases), the registry id namespace is flat enough to encode them
  as `cloud.dark` / `cloud.light` without a schema change. We
  cross that bridge when a real case appears; not designing for it
  upfront.

## Decisions

Sign-off received 2026-04-28 on the five locked-in answers below.

1. **Sanitiser approach: hand-written allow-list walker.** ~150 LOC
   in `packages/core/src/editor/icons/sanitize.ts`, no third-party
   deps. Tier B-clean; bundle-size-friendly; the allow-list is
   small enough (≈30 SVG-relevant elements + ≈25 attributes) that
   pulling in DOMPurify (~22 KB min+gz) is a poor trade. Phase 3
   ships the walker with the explicit attack-vector test table
   (script tag, `on*` attrs, `javascript:` href, external image
   href, `<foreignObject>`); reviewer scrutiny lands on the
   walker itself, not on DOMPurify-config tuning.
2. **Phase-5 deprecation window: collapsed to a single PR.** No
   external plugin authors today, and the only real consumer
   (`annot-cloud`, private, our own) lands against `IconSpec`
   directly. Phases 5a (additive) and 5b (rename + remove) merge
   into a **single Phase 5 PR** that switches `icon?: string` →
   `icon?: IconSpec` in one shot — built-in registrations updated
   in the same diff. Pre-release ergonomics per
   `design-system-foundations.md`'s precedent (no aliases, no
   shims). The plan body's "Phase 5a / Phase 5b" split is now
   historical; treat Phase 5 as one unit.
3. **`<annot-icon>` Lit element: ship it.** The element centralises
   the `unsafeHTML` cast (one place to scrutinise during reviews
   instead of N call sites) and gives plugin authors an idiomatic
   render handle. The Phase 4a sub-phase remains as written.
4. **`kind: "url"` rendering: `<img>` sandboxed.** The renderer
   emits `<img src="…" alt="" aria-hidden="true"
   class="annot-icon-img"/>` for url-kind specs; SVG content is
   sandboxed away from host CSS / JS. Plugins that need theme-aware
   `currentColor` icons use `kind: "svg"` (inlined asset) instead.
   We can relax this later if a real case appears.
5. **`kind: "builtin"` id type: narrow string-literal union.**
   `BuiltinIconId = keyof typeof BUILTIN_ICONS` (exported from the
   Tier B registry, re-exported from the Tier A `IconSpec` module
   as the narrowed concrete type). Plugin authors importing
   `@ingcreators/annot-core/icons` get TypeScript autocomplete +
   compile-time errors on typos. The Tier A
   `packages/core/src/icons/types.ts` keeps a broad `string`-typed
   structural alias as a fallback only for downstream consumers
   that genuinely don't want the registry as a value-level
   dependency (rare; `oss-cloud-split` plugin authors won't hit
   this).

The plan is otherwise self-contained — file paths, phase
boundaries, attack-vector tests, and verification steps are all
spelled out. Implementation can start at Phase 0 (NOTICE
attribution).

## Forward-looking

After this lands, several follow-ups become natural:

- **Icon gallery in Storybook.** Trivial once the registry is the
  source of truth — one story per id, auto-generated from
  `BUILTIN_ICON_IDS`.
- **`annot-cloud` plugin shipping its own logomark.** The first
  real-world `kind: "svg"` consumer; validates the sanitiser in
  production.
- **Plugin theme presets** (`design-system-foundations.md` Phase
  4). Theme presets and the icon system are orthogonal but share
  the same "plugins can contribute first-class brand assets"
  story.
- **Tightening allow-list-walker into a shared `safeSvg(string)`
  Tier B util.** If we ever accept user-pasted SVG into annotations
  themselves (e.g. embedding a logo into a screenshot), the same
  sanitiser is the right starting point.
