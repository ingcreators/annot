# Design system foundations

> **Status:** In progress (2026-04-28). Phase 1 implementation in
> branch `claude/pedantic-raman-a71a24` (this PR).
>
> **Compatibility:** No breaking changes for any package. CSS
> token names stay identical in Phase 1 — only grouping comments,
> persistence, a small new public API in
> `@ingcreators/annot-editor`, and a new top-level
> [`docs/design-system.md`](../design-system.md) reference are
> introduced. SVG schema unchanged. `StorageProvider` unchanged.
>
> **Risk:** Low and phased. Phase 1 is additive (no token
> renames). Later phases that DO rename — Phase 2's `--annot-*`
> namespace migration — are gated behind one-cycle backwards-
> compatibility aliases and ship as their own PRs.

## Context

Today's design system (per the 2026-04-28 survey) is a single
flat CSS-variable block in
[`packages/core/styles/editor.css`](../../packages/core/styles/editor.css)
with two palettes (`:root` dark, `:root.light` light), wired into
the host via a class toggle on `document.documentElement`. The
foundation is good:

- **One source of truth.** All ~30 tokens live in `editor.css`.
- **Consistent usage.** `var(--token)` references in every
  secondary stylesheet (`app.css`, `file-manager.css`,
  `toolbar.css`, `property-panel.css`); near-zero hardcoded UI
  colors.
- **Light DOM + global CSS** for Lit components — global tokens
  reach every component automatically (no shadow-DOM piercing
  needed).
- **WCAG AA contrast** annotated inline next to each token.

Three gaps block "easy user theme customisation":

1. **No semantic grouping.** The flat list mixes background tiers,
   text tiers, accent surfaces, interaction states, form inputs,
   canvas chrome, and the focus ring with no visible structure.
   Newcomers (and Claude Code in fresh sessions) can't tell which
   tokens are "primary brand" vs "interaction state" vs
   "decoration", so customisation guidance is ad-hoc.

2. **No persistence.** `createThemeToggle` flips the class but
   never writes the choice. Every reload starts from dark. This is
   a one-line fix that's been waiting for someone to notice.

3. **No customisation API.** A user (or plugin) wanting to swap
   `--accent` from blue to corporate-purple has to either edit
   `editor.css` in source (not durable) or run
   `document.documentElement.style.setProperty(...)` by hand. No
   normalised entry point, no persistence, no list of "what is
   safe to override".

This plan addresses (1)–(3) in three tightly-scoped phases plus
two later phases that build on top.

## Design

### Token taxonomy (Phase 1)

Group the existing flat list into four semantic sections, each
with a comment header in `editor.css`. **No token renames in
Phase 1** — only comments. The grouping mirrors the future
`--annot-*` namespacing that Phase 2 introduces, so the comment
section names ARE the future prefixes:

| Section | Tokens | Purpose |
|---------|--------|---------|
| **Surface** | `bg-primary`, `bg-secondary`, `bg-panel`, `bg-panel-deep`, `border-color`, `border-subtle`, `shadow` | Page / panel / divider backgrounds and chromeless decoration. |
| **Content** | `text-primary`, `text-secondary`, `text-muted`, `preview-line` | Foreground text + drawing primitives the user reads. |
| **Accent** | `accent`, `accent-2`, `accent-bg`, `accent-hover`, `active-bg`, `active-border`, `chip-bg`, `focus-ring` | Brand colour, interactive highlight, focus indication. |
| **Interaction** | `hover-bg`, `hover-border`, `choice-bg`, `choice-hover`, `choice-active`, `input-bg`, `input-border` | Pointer / form interaction states. |
| **Canvas** | `canvas-bg`, `canvas-check` | Editor canvas backdrop + transparency-grid checkerboard. |

The taxonomy is **descriptive of current usage**, not aspirational
— every token already fits one bucket. If a future token doesn't
fit, that's a signal to either reuse an existing token or
introduce a new section, not to backfill into a poorly-fitting
existing one.

### Theme persistence (Phase 1)

Single `localStorage` key: `annot.theme` with values
`"light" | "dark"`. Read at boot in `packages/web/src/main.ts`
BEFORE any CSS module imports complete paint. The choice is
applied by toggling the existing `light` class on
`document.documentElement` — no new CSS surface, no churn in
any consumer.

`createThemeToggle` becomes the writer: on click it toggles AND
persists. A new sibling helper `applyPersistedTheme()` (also in
`@ingcreators/annot-editor/theme-toggle`) is the reader, called
once at boot. The two helpers share the constant
`THEME_STORAGE_KEY` so there's exactly one string literal.

System-preference auto mode (a third state that follows
`prefers-color-scheme`) is **out of scope for Phase 1** — Phase 5
introduces it on top of the persistence baseline without
breaking the two-state API.

### User overrides (Phase 1)

New public API in `@ingcreators/annot-editor`:

```ts
// packages/editor/src/theme-overrides.ts
export type ThemeOverrides = Partial<Record<ThemeTokenName, string>>;

export type ThemeTokenName =
  | "bg-primary" | "bg-secondary" | "bg-panel" | "bg-panel-deep"
  | "border-color" | "border-subtle" | "shadow"
  | "text-primary" | "text-secondary" | "text-muted" | "preview-line"
  | "accent" | "accent-2" | "accent-bg" | "accent-hover"
  | "active-bg" | "active-border" | "chip-bg" | "focus-ring"
  | "hover-bg" | "hover-border"
  | "choice-bg" | "choice-hover" | "choice-active"
  | "input-bg" | "input-border"
  | "canvas-bg" | "canvas-check";

export function setThemeOverrides(overrides: ThemeOverrides): void;
export function clearThemeOverrides(): void;
export function getThemeOverrides(): ThemeOverrides;
```

Implementation:

- Overrides are applied to `document.documentElement.style` as
  `--<token>` inline custom properties. Inline styles beat any
  `:root` rule, so overrides win regardless of light/dark mode.
- Persisted under `annot.themeOverrides` (JSON object). Re-applied
  at boot by `applyPersistedTheme()` after the dark/light class
  is set.
- `setThemeOverrides` MERGES (not replaces) — passing
  `{ accent: "#ff00aa" }` doesn't clear other overrides.
  `clearThemeOverrides()` removes all overrides AND clears the
  storage entry.
- The `ThemeTokenName` union is the **public surface** —
  exported as a type so plugin authors get autocomplete. New
  tokens added to `editor.css` MUST be reflected in this union
  in the same PR (test below catches drift).

The API lives in `@ingcreators/annot-editor` (not
`@ingcreators/annot-core`) because it touches
`document.documentElement` and is therefore Tier C per CLAUDE.md.
A pure-data subset (the union itself + JSON validation) could
move to Tier B later if a Node-side use case emerges, but Phase 1
keeps it simple.

A drift test in
`packages/editor/src/theme-overrides.test.ts` parses
`packages/core/styles/editor.css`, extracts every `--token` from
the `:root { ... }` block, and asserts the set equals the
`ThemeTokenName` union members. CI fails if a new CSS token
isn't reflected in the API surface, or vice versa.

### Documentation (Phase 1)

New top-level [`docs/design-system.md`](../design-system.md)
covers:

- The five-section taxonomy with each token's role + WCAG
  contrast target (lifted from the inline comments in
  `editor.css`).
- The persistence contract (storage key, valid values, fallback
  behaviour when storage is full / blocked).
- The override API with a copy-pasteable "set my brand colour"
  example.
- A "what NOT to override" callout — `text-primary` /
  `bg-primary` should keep their AA contrast ratio; the doc
  shows how to use the WebAIM contrast checker against the
  override.
- A forward-looking "Phase 2 token namespace migration" note so
  future readers don't think the unprefixed names are
  permanent.

CLAUDE.md gains a short pointer to the new doc under
"Map of documentation".

## Phased plan

### Phase 1 — Foundations (this PR)

1. Group tokens in `packages/core/styles/editor.css` with
   `/* === Surface === */` style section comments. **No renames.**
   Same for the `:root.light` block. Light/dark token order matches
   1:1 so a side-by-side diff stays readable.
2. Extract `THEME_STORAGE_KEY` and add `applyPersistedTheme()` +
   `setThemeOverrides` / `clearThemeOverrides` /
   `getThemeOverrides` in
   `packages/editor/src/theme-overrides.ts`. Re-export from the
   editor entry. Update `theme-toggle.ts` to persist on click.
3. Call `applyPersistedTheme()` from
   `packages/web/src/main.ts` at the very top — before any module
   that triggers paint. (Module-import order: the CSS imports run
   first, but they don't paint until the body content is appended,
   so reading the class on `<html>` before `new App()` is enough
   to avoid a flash.)
4. Add `packages/editor/src/theme-overrides.test.ts` — parses
   `editor.css`, asserts token set ↔ union symmetry, asserts
   `setThemeOverrides({ accent: "#abc" })` writes the inline style,
   asserts `clearThemeOverrides()` removes it, asserts
   round-trip through `localStorage`.
5. Write `docs/design-system.md` and add the pointer in
   CLAUDE.md.

**Verification:** `pnpm -r typecheck` + `pnpm test` + the new
test passes + `pnpm --filter @ingcreators/annot-editor build` +
`pnpm --filter @ingcreators/annot-web build`. Manual: toggle
theme in dev server, reload, confirm choice persists; in console
run `setThemeOverrides({ accent: "#ff00aa" })` and visually
confirm the accent colour changes everywhere it's used.

### Phase 2 — Namespace migration (`--annot-*`)

Goal: rename every CSS token from `--accent` →
`--annot-accent-primary`, etc., to give Annot's design surface
its own namespace and make collisions with host-page CSS (when
embedded in another app, or when a plugin pulls in third-party
styles) impossible.

Mechanism: add the new names FIRST as aliases:

```css
:root {
  /* Phase 2 transitional aliases — old names kept for one
   * release cycle so external plugin CSS keeps working.
   * Remove in the cycle after Phase 2 lands. */
  --accent: var(--annot-color-accent-primary);
  /* ... */
}
```

Then sweep every consuming CSS file to use the new names. Then
in a third PR, remove the aliases. Three independent PRs, each
revertable. The override API surface migrates with the rename
— `ThemeTokenName` becomes `"color-accent-primary" | …`, with
the old names accepted-but-deprecated for one cycle.

Defer Phase 2 until at least one cycle after Phase 1 ships, so
external plugin authors (when they exist) get a heads-up window.

### Phase 3 — Settings UI

A "Theme" tab in the Settings drawer (or a new dedicated drawer
section) with:

- Light / dark toggle (already exists; the new UI is the canonical
  home).
- Per-token colour pickers for the **Accent** section first
  (highest signal-to-noise). Surface + Content sections need WCAG
  contrast guidance to avoid users painting themselves into an
  unreadable corner — the picker shows live contrast ratio against
  `bg-primary` / `text-primary`.
- "Reset" button per token + global reset.
- "Export" button that copies the current overrides as JSON for
  sharing (forward-compatible with Phase 4 plugin themes).

### Phase 4 — Plugin theme registration

`AnnotPlugin` gains an optional `themes?: ThemePreset[]` field:

```ts
type ThemePreset = {
  id: string;
  label: string;
  base: "light" | "dark";
  overrides: ThemeOverrides;
};
```

The PluginHost merges all plugin themes into a registry the
Settings UI lists for one-click application. Built-in themes
(default dark, default light, plus 1–2 brand presets) ship via
the same mechanism so the codepath is consistent.

### Phase 5 — System mode

Add a third state: `"system"` follows `prefers-color-scheme`.
`THEME_STORAGE_KEY` accepts `"system" | "light" | "dark"`.
`applyPersistedTheme()` registers a `matchMedia` listener when
`"system"` is active. The toggle button cycles through three
states (with appropriate icons). New default for first-time
visitors: `"system"`.

## Verification

Phase 1 only (later phases get their own verification when they
ship).

- [ ] `pnpm -r typecheck`
- [ ] `pnpm test` (note pass count delta in commit's `Verified:`)
- [ ] `pnpm lint` — 0 findings
- [ ] `pnpm --filter @ingcreators/annot-editor build`
- [ ] `pnpm --filter @ingcreators/annot-web build`
- [ ] New `theme-overrides.test.ts` covers token-set symmetry,
      inline style write, localStorage round-trip, clear semantics.
- [ ] Manual: toggle theme → reload → choice persists.
- [ ] Manual: `window.AnnotDevtools?.setThemeOverrides({ accent:
      "#ff00aa" })` from the console (or import the function in a
      throwaway script) → accent colour changes; reload →
      override survives; `clearThemeOverrides()` → reverts.

## Migration notes

Phase 1 introduces no breaking changes. External CSS or
TypeScript referencing the existing `--token` names continues to
work. The `class="light"` toggle on `<html>` is unchanged.

The `localStorage` keys (`annot.theme`,
`annot.themeOverrides`) are new — first-time use of Phase 1 build
on top of an existing install reads "no preference" and defaults
to dark (matching the pre-Phase-1 behaviour). Subsequent toggles
persist.

Phase 2 is a renaming migration with one-cycle backwards-compat
aliases — see the Phase 2 section above.
