# Design system

> Reference for Annot's design tokens, theme switching, and the
> user-driven theme override API.
>
> Source of truth for the token *values* is
> [`packages/core/styles/editor.css`](../packages/core/styles/editor.css).
> Source of truth for the token *names* (the public API surface) is
> `THEME_TOKEN_NAMES` in
> [`packages/editor/src/theme-overrides.ts`](../packages/editor/src/theme-overrides.ts).
> The two are kept in sync by the symmetry test in
> [`packages/editor/src/theme-overrides.test.ts`](../packages/editor/src/theme-overrides.test.ts) —
> the build fails if a token exists in one but not the other.
>
> See [`docs/plans/design-system-foundations.md`](./plans/design-system-foundations.md)
> for the roadmap. Phase 1 covered token grouping + persistence +
> the runtime override API. Phase 2 (this doc reflects it) renamed
> every CSS variable to the `--annot-*` namespace so Annot's design
> surface can be embedded into a host page without colliding with
> the host's own custom properties. Phase 3 ships a Settings UI on
> top of the override API. Phase 4 opens the API to
> plugin-authored theme presets. Phase 5 adds a "follow system
> preference" mode.
>
> **Override API keys remain unprefixed.** Even though every CSS
> variable is now `--annot-bg-primary`, the public API still uses
> the short suffix as the key:
> `setThemeOverrides({ "bg-primary": "..." })`. The `--annot-`
> prefix is an implementation detail of the wire-level
> `style.setProperty(...)` call.

## TL;DR

```ts
import {
  applyPersistedTheme,
  setThemeOverrides,
  clearThemeOverrides,
} from "@ingcreators/annot-editor";

// At boot — restore last theme + overrides:
applyPersistedTheme();

// At runtime — replace specific tokens:
setThemeOverrides({ accent: "#ff00aa", "accent-bg": "rgba(255,0,170,0.18)" });

// Reset to the built-in palette:
clearThemeOverrides();
```

Toggling between dark and light continues to happen via the
existing `createThemeToggle` button — clicking it now persists
the choice in `localStorage` automatically.

## Token taxonomy

The CSS file groups tokens into five sections. **Pick a section
by USE, not by colour family.** A new green token used as a
brand accent goes under `Accent`, not invented as
`green-something` under a new section.

### Surface — backdrops and chromeless decoration

| Token | Role |
|-------|------|
| `--annot-bg-primary` | Page / app shell background. AAA contrast vs `--annot-text-primary`. |
| `--annot-bg-secondary` | Recessed regions (sidebars, settings drawers). |
| `--annot-bg-panel` | Floating panels, dropdowns, popovers. |
| `--annot-bg-panel-deep` | Deepest layer (e.g. modal backdrops, status bar). |
| `--annot-border-color` | Visible UI boundaries. ≥3:1 against `--annot-bg-primary` for non-text contrast. |
| `--annot-border-subtle` | Decorative dividers. Below 3:1; do not gate interactivity on these. |
| `--annot-shadow` | Drop-shadow value (full CSS shadow shorthand, not just colour). |

### Content — foreground reading primitives

| Token | Role |
|-------|------|
| `--annot-text-primary` | Body text. AAA contrast vs `--annot-bg-primary`. |
| `--annot-text-secondary` | Labels, secondary metadata. AAA where possible, AA floor. |
| `--annot-text-muted` | Placeholder, disabled-state, lowest-importance text. AA floor. |
| `--annot-preview-line` | Stroke colour for editor preview overlays (line previews, marquee). |

### Accent — brand colour, active highlight, focus

| Token | Role |
|-------|------|
| `--annot-accent` | Primary brand colour. Used for active nav, primary buttons, focused links. |
| `--annot-accent-2` | Secondary brand colour (Annot uses green to contrast the blue accent). |
| `--annot-accent-bg` | Subtle accent-tinted backdrop (selected list rows, light-touch highlights). |
| `--annot-accent-hover` | Accent backdrop on hover — slightly stronger than `--annot-accent-bg`. |
| `--annot-active-bg` | Background for the currently-active toolbar/tab item. |
| `--annot-active-border` | Border for the currently-active item; usually equals `--annot-accent`. |
| `--annot-chip-bg` | Pill / chip backgrounds (tags, filter chips). |
| `--annot-focus-ring` | Keyboard focus indicator. Annot deliberately uses `--annot-accent-2` (green) so it stands out from the blue `--annot-accent`. ≥3:1 and ≥2px thick. |

### Interaction — pointer / form states

| Token | Role |
|-------|------|
| `--annot-hover-bg` | Pointer-hover backdrop (neutral, not accent-tinted). |
| `--annot-hover-border` | Pointer-hover border bump (e.g. hovered toolbar buttons). |
| `--annot-choice-bg` | Idle background for radio-like "choice" lists. Default `transparent`. |
| `--annot-choice-hover` | Hover backdrop on a choice list item. |
| `--annot-choice-active` | Selected backdrop on a choice list item. |
| `--annot-input-bg` | Form-input background. |
| `--annot-input-border` | Form-input border. ≥3:1 for visible field boundaries. |

### Canvas — editor backdrop + transparency grid

| Token | Role |
|-------|------|
| `--annot-canvas-bg` | Solid backdrop behind the editor's `<svg>` viewport. |
| `--annot-canvas-check` | Second colour in the transparency-grid checkerboard. |

## Theme switching (`light` / `dark`)

Annot ships a dark default and a light alternative. The mode
toggle is the `<button>` factory `createThemeToggle()` in
[`packages/editor/src/theme-toggle.ts`](../packages/editor/src/theme-toggle.ts).

How it works:

- The `light` palette is gated by a `light` class on
  `document.documentElement`. The dark palette is the
  unscoped `:root` block.
- Clicking the toggle flips the class AND persists the choice
  to `localStorage` under `annot.theme` (values: `"light"` or
  `"dark"`).
- The host's entry point calls `applyPersistedTheme()` at boot
  to restore the choice before the first paint that depends
  on it. In the web shell, that's the first non-import line of
  [`packages/web/src/main.ts`](../packages/web/src/main.ts).

A "follow system preference" mode (a third state that respects
`prefers-color-scheme`) is planned for Phase 5 and is not yet
shipped. Until then, the choice is binary.

## User overrides

Any of the tokens above can be replaced at runtime via
`setThemeOverrides()`. Overrides are stored as inline custom
properties on `document.documentElement`, so they win against
both `:root` and `:root.light` regardless of which mode is
active.

```ts
import { setThemeOverrides } from "@ingcreators/annot-editor";

// Brand the accent purple:
setThemeOverrides({
  accent: "#7a4dff",
  "accent-bg": "rgba(122, 77, 255, 0.18)",
  "accent-hover": "rgba(122, 77, 255, 0.26)",
  "active-bg": "rgba(122, 77, 255, 0.18)",
  "active-border": "#7a4dff",
  "chip-bg": "rgba(122, 77, 255, 0.14)",
});
```

### API surface

```ts
import {
  applyPersistedTheme,
  clearThemeOverrides,
  getThemeOverrides,
  persistThemeChoice,
  setThemeOverrides,
  THEME_OVERRIDES_STORAGE_KEY,
  THEME_STORAGE_KEY,
  THEME_TOKEN_NAMES,
  THEME_TOKEN_SECTIONS,
  type ThemeMode,
  type ThemeOverrides,
  type ThemeTokenName,
  type ThemeTokenSection,
} from "@ingcreators/annot-editor";
```

| Symbol | Purpose |
|--------|---------|
| `applyPersistedTheme()` | Restore mode + overrides from `localStorage`. Call at boot, BEFORE the first paint that depends on tokens. Idempotent. No-op when storage is unavailable. |
| `setThemeOverrides(overrides)` | Merge the given overrides into the active set, persist, and apply to `<html>` immediately. Returns the merged set. Pass `undefined` or `""` for a token to clear that single override. Unknown token names are silently ignored. |
| `clearThemeOverrides()` | Remove every override and clear the persisted entry. Theme mode is unaffected. |
| `getThemeOverrides()` | Read the currently-applied overrides. Returns a fresh shallow copy each call. |
| `persistThemeChoice()` | Persist the current `<html class="light">` state. Called from `createThemeToggle`'s click handler — usually you don't call it directly. |
| `THEME_TOKEN_NAMES` | The full list of overridable token names, as a `readonly` tuple. Use for iteration in a Settings UI. |
| `THEME_TOKEN_SECTIONS` | Map from section name (`"surface" \| "content" \| "accent" \| "interaction" \| "canvas"`) to its tokens. Same partition as the section tables above. |
| `THEME_STORAGE_KEY` / `THEME_OVERRIDES_STORAGE_KEY` | The two `localStorage` keys, exported so tests and external integrations can scrub them. |

### Persistence contract

Two `localStorage` keys:

- `annot.theme` — `"light"` or `"dark"`.
- `annot.themeOverrides` — JSON object whose keys are
  `ThemeTokenName` and whose values are CSS values (any string
  the browser accepts for that property).

Both are best-effort: if storage is unavailable (file:// pages,
sandboxed iframes) or full (quota exceeded), the API silently
no-ops on writes. Reads return defaults. This matches the rest
of Annot's storage philosophy — UI state is a nicety, not data.

## Adding a token

To add a new design-system token:

1. Decide which section it belongs to (Surface / Content /
   Accent / Interaction / Canvas).
2. Add it to BOTH `:root` and `:root.light` blocks in
   [`packages/core/styles/editor.css`](../packages/core/styles/editor.css),
   at the bottom of the matching `/* === <Section> === */`
   group, with the `--annot-` prefix.
3. Add the SHORT name (without `--annot-` prefix) to the
   corresponding section constant in
   [`packages/editor/src/theme-overrides.ts`](../packages/editor/src/theme-overrides.ts)
   (`SURFACE_TOKENS` / `CONTENT_TOKENS` / `ACCENT_TOKENS` /
   `INTERACTION_TOKENS` / `CANVAS_TOKENS`).
4. Update the table in this file (use the prefixed name).
5. Run `pnpm test` — the symmetry test fails the build if you
   missed step 3 (it parses `:root` for `--annot-<name>`
   declarations and asserts the suffix set equals
   `THEME_TOKEN_NAMES`).

Renaming a token is a breaking change for any plugin that
overrides it. Bump the major version of `@ingcreators/annot-editor`
and document the rename in `CHANGELOG.md`.

## What NOT to override

The override API does not enforce contrast guarantees. Setting
`text-primary: "#888888"` against `bg-primary: "#999999"` makes
text legally unreadable; the browser will paint it anyway.

Specific cautions:

- **`text-primary` / `text-secondary` / `text-muted` and
  `bg-primary`.** These are tuned to AA/AAA contrast pairs.
  Always use a contrast checker (e.g. WebAIM
  <https://webaim.org/resources/contrastchecker/>) when
  changing either side of a pair.
- **`focus-ring`.** Must be ≥3:1 against `--annot-bg-primary` AND
  visually distinct from `--annot-accent`. The default uses
  `--annot-accent-2` (green) precisely to guarantee separation from
  the blue `--annot-accent`. If you change `accent` to something
  greenish, also change `focus-ring`.
- **`canvas-bg` / `canvas-check`.** These define the
  transparency checkerboard the user sees behind their image.
  Setting them too close to mid-grey can make the
  checkerboard invisible (defeating its purpose) or too
  high-contrast (visually noisy under a transparent PNG).

A future Settings UI (Phase 3) will enforce contrast guards on
the Surface and Content sections; until then, the override API
is "load-bearing for the user" and treats them as adults.
