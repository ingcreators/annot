# Themes for `.annot.html` documents

> **Audience:** plugin authors who want to ship a custom theme
> alongside their plugin (e.g. corporate-branded onboarding
> docs, sector-specific aesthetics, accessibility-focused
> high-contrast palettes).
> **Status:** Phase 6 documentation enabler. The runtime
> `PluginHost.addTheme(theme)` API doesn't ship yet — themes
> are currently a Tier A type contract only. Built-in themes
> consume the same `Theme` shape, so this doc is the public
> surface either way.

## Concept

A `.annot.html` document picks its visual treatment via
`meta.appearance.template`. The matching theme — a small
TypeScript object — supplies:

- **CSS custom-property values** for the document's `:root`
  block (colors, card chrome, badge styling).
- **Optional dark-mode overrides** that land behind a
  `@media (prefers-color-scheme: dark)` block.
- **Optional `extraCss`** with theme-specific selectors
  (pull-quote treatment, chat-bubble badge shape, etc.).
- **Optional `badgeLabelTemplate`** for the step counter
  badge's content template.

The structural rules (grid template, `[data-annot-block]`
selectors, print rules) are NOT themable — they're load-bearing
for the editor.

## The `Theme` type

Imported from `@ingcreators/annot-doc/headless`:

```ts
import type { Theme, VarTuples } from "@ingcreators/annot-doc";

export interface Theme {
  readonly id: string;        // matches meta.appearance.template
  readonly name: string;      // shown in the Appearance picker
  readonly description?: string;
  readonly vars: VarTuples;   // [name, value] tuples emitted on :root
  readonly darkVars?: VarTuples;  // optional dark-mode override
  readonly extraCss?: string; // optional theme-specific selectors
  readonly badgeLabelTemplate?: string;  // step badge content template
}

export type VarTuples = ReadonlyArray<readonly [string, string]>;
```

## Themable CSS variables

The structural layer expects these custom properties to be set
on `:root`. A theme MUST define every name in `vars`; `darkVars`
can override any subset.

### Document chrome

```
--annot-doc-bg              page background
--annot-doc-fg              body text colour
--annot-doc-muted           secondary text (figcaption, footer, etc.)
--annot-doc-accent          accent colour (links, badge, divider)
--annot-doc-code-bg         code-block background
```

### Callout tones

```
--annot-doc-callout-info-bg
--annot-doc-callout-info-border
--annot-doc-callout-warn-bg
--annot-doc-callout-warn-border
--annot-doc-callout-note-bg
--annot-doc-callout-note-border
```

### Card chrome (step blocks)

```
--annot-card-bg             card background
--annot-card-border         card border declaration (full shorthand, e.g. "1px solid #e5e7eb")
--annot-card-shadow         drop shadow (set "none" to remove)
```

### Step badge (only consumed when meta.numbering.steps is on)

```
--annot-step-badge-bg       badge fill (use var(--annot-doc-accent) to track the accent)
--annot-step-badge-fg       badge text colour
--annot-step-badge-shadow   badge drop shadow
```

The badge's **geometry** vars (radius / min-size / padding /
font-size) sit in the structural layer and ALWAYS default to a
pill. A theme can override them via `extraCss` (set
`--annot-step-badge-radius` etc. on `:root` inside the
`extraCss` string).

## Reference theme

```ts
// my-theme.ts
import type { Theme } from "@ingcreators/annot-doc";

export const myCorporateTheme: Theme = {
  id: "acme-corp",
  name: "Acme Corp",
  description: "Acme brand colours + serif headings.",
  vars: [
    ["--annot-doc-bg", "#ffffff"],
    ["--annot-doc-fg", "#1a1a2e"],
    ["--annot-doc-muted", "#6e6e80"],
    ["--annot-doc-accent", "#ff6b35"],            // Acme orange
    ["--annot-doc-code-bg", "#f3f3f7"],
    ["--annot-doc-callout-info-bg", "#fff4ed"],
    ["--annot-doc-callout-info-border", "#ff6b35"],
    ["--annot-doc-callout-warn-bg", "#fff8dc"],
    ["--annot-doc-callout-warn-border", "#c08800"],
    ["--annot-doc-callout-note-bg", "#f3f3f7"],
    ["--annot-doc-callout-note-border", "#6e6e80"],
    ["--annot-card-bg", "#ffffff"],
    ["--annot-card-border", "1px solid #e6e6ed"],
    ["--annot-card-shadow", "0 2px 8px rgba(26, 26, 46, 0.08)"],
    ["--annot-step-badge-bg", "var(--annot-doc-accent)"],
    ["--annot-step-badge-fg", "#ffffff"],
    ["--annot-step-badge-shadow", "0 4px 12px rgba(255, 107, 53, 0.30)"],
  ],
  darkVars: [
    ["--annot-doc-bg", "#10101a"],
    ["--annot-doc-fg", "#f4f4f8"],
    ["--annot-doc-muted", "#9090a0"],
    ["--annot-doc-accent", "#ff8456"],
    ["--annot-doc-code-bg", "#1f1f2e"],
    ["--annot-doc-callout-info-bg", "#2a1f1a"],
    ["--annot-doc-callout-info-border", "#ff8456"],
    ["--annot-doc-callout-warn-bg", "#2a2a1a"],
    ["--annot-doc-callout-warn-border", "#d9b440"],
    ["--annot-doc-callout-note-bg", "#1f1f2e"],
    ["--annot-doc-callout-note-border", "#9090a0"],
    ["--annot-card-bg", "#1f1f2e"],
    ["--annot-card-border", "1px solid #2a2a3a"],
    ["--annot-card-shadow", "0 2px 8px rgba(0, 0, 0, 0.30)"],
    ["--annot-step-badge-bg", "var(--annot-doc-accent)"],
    ["--annot-step-badge-fg", "#10101a"],
    ["--annot-step-badge-shadow", "0 4px 12px rgba(255, 132, 86, 0.40)"],
  ],
  extraCss: [
    "[data-annot-block=\"heading\"] { font-family: Georgia, serif; }",
    ":root { --annot-step-badge-radius: 4px; }",
  ].join("\n"),
};
```

## Validation rules

The CI invariant guarding the legacy themes (`themes.test.ts`)
checks two properties of every built-in theme:

1. **Full themable variable set** — every name in
   `modernLight.vars` MUST appear in your theme's `vars`. If
   you omit one, the structural defaults still apply but a
   future change to those defaults could ripple into your
   theme unexpectedly. Use the full set.
2. **Symmetric darkVars** — if you ship `darkVars`, the name
   set MUST match `vars`. Asymmetry produces a "half-dark" mode
   where some properties stay light. The test catches this.

When `addTheme` lands (future plan), plugin themes will be
walked through the same assertions at registration time.

## Pairing with the appearance picker

The Doc Settings dialog renders an Appearance section with the
built-in themes plus a Legacy radio (the legacy `meta.theme`
keyword's escape hatch). Plugin themes will appear alongside
the built-ins once `addTheme` ships.

Picking your theme writes `meta.appearance.template = "<your-id>"`
into the document's sidecar. Re-opening the document on a host
that doesn't have your plugin loaded renders the document with
`modern-light` (the safe fallback) — your branding doesn't show
through but the content stays readable.

## Custom CSS interaction

Per-document `meta.appearance.customCss` lands AFTER your theme's
output. Users who want to tweak your theme on a per-doc basis can
use the dialog's "Advanced: Custom CSS" expander; the sanitiser
strips `@import` / external `url()` / `behavior: url()` and
caps at 8 KB.

If your theme ships its own customCss recipes (e.g. as starter
templates), use `sanitiseCustomCss` from
`@ingcreators/annot-doc` to pre-clean the string before
emitting it.

## Forward-looking

- **`PluginHost.addTheme(theme)`** runtime API — TBD. Doesn't
  affect the `Theme` type's shape.
- **Theme thumbnail previews** in the picker — currently the
  picker shows name + description text only; thumbnails would
  improve discoverability.
- **PPTX template pairing** — see
  [`docs/plans/card-pptx-templates.md`](../plans/card-pptx-templates.md).
  Each built-in HTML theme will gain a sibling PPTX template
  with matching colours / typography. Plugin themes can ship
  their own paired template via the same plugin manifest once
  both plans complete.
