# Multilingual fonts via OS stack — no embedding

> **Status:** Draft
> **Compatibility:** **Pre-release; no backward-compat shims.**
>   `data-font-family` semantics change from "raw CSS family" to
>   "logical family token" (`Annot Sans` / `Annot Serif` /
>   `Annot Mono`). Existing saves with raw `sans-serif` / etc.
>   resolve identically because the new tokens map to the same
>   underlying generic, but custom family strings (e.g.
>   `"Hiragino Kaku Gothic"`) won't survive a re-edit — they get
>   coerced to `Annot Sans` on next save. Pre-release: acceptable.
> **Risk:** Phased; each phase is independently revertable. The
>   logical-family registry in phase 1 is dead code until phase 3
>   wires the editor's font picker to it; the OOXML 3-typeface
>   split in phase 4 is a pure addition (the existing `<a:latin>`
>   stays correct for Latin-only documents).

## Context

Annot stores text as `<g data-type="shape">` wrappers containing
inner `<text>` / `<tspan>` elements. The `data-font-family`
attribute on the wrapper currently carries a raw CSS family
string — usually `sans-serif`, sometimes a user-typed value. This
works for Latin scripts on every host OS, but breaks down for
multilingual content:

1. **CJK / Arabic / Indic / Thai** rendered with a Latin-only
   family fall back to the browser's default which is rarely the
   OS-native script font. The user sees Times-style serifs in a
   document otherwise styled `sans-serif`, or worse, tofu (□)
   when the chosen family doesn't cover the script at all.

2. **PPTX export / Office paste** writes `<a:latin typeface="...">`
   only. PowerPoint's `wedgeRoundRectCallout` etc. then renders
   CJK via Office's font fallback rather than a deliberate choice
   — visually fine on Windows + Yu Gothic, ugly on a stripped Mac
   without Hiragino, broken on Linux without Noto CJK.

3. **PNG export** (`getPngDataUrl` → `<canvas>` rasterise) uses
   whatever the host browser resolves; if the Annot user is on
   Linux and the screenshot reader is on Windows, they see
   different glyphs. The user has no way to control this.

The user has chosen the **"OS fonts only, no embedded fonts,
each user makes content for their own viewing scope"** policy.
This plan implements that scope cleanly, leaving room for a
future "embed fonts in PPTX" toggle if cross-environment sharing
becomes a real need.

## Design

### Logical family tokens

Editor + storage use a fixed set of three tokens:

| Token | Intent | OS sans-equivalent |
|---|---|---|
| `Annot Sans` | UI / labels / body (default) | Segoe UI / SF Pro / Roboto / DejaVu |
| `Annot Serif` | quotes, formal text | Cambria / Georgia / Yu Mincho / 宋体 |
| `Annot Mono` | code / IDs | Consolas / Menlo / Cascadia Mono |

`data-font-family` stores exactly one of these tokens. The
editor's font picker exposes only these three; raw family entry
is removed (plugin authors get an extension API in a follow-up
plan, not this one).

### CSS resolution: OS-aware stacks per token

The host PWA / extension / desktop ships one CSS stylesheet that
maps each logical token to a long, OS-aware family stack. The
stack interleaves Latin and CJK / Arabic / Indic fallbacks so the
browser's per-codepoint font resolution lands on the right OS
script font without any web font download:

```css
/* packages/web/src/styles/fonts.css */
text[font-family="Annot Sans"] {
  font-family:
    -apple-system, BlinkMacSystemFont,
    "Segoe UI", "Helvetica Neue", "Arial",
    "Hiragino Sans", "Yu Gothic UI", "Yu Gothic",
    "Meiryo", "MS PGothic",
    "PingFang SC", "Microsoft YaHei",
    "Apple SD Gothic Neo", "Malgun Gothic",
    "Nirmala UI", "Tahoma",
    sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
}
text[font-family="Annot Serif"] {
  font-family:
    Cambria, Georgia,
    "Yu Mincho", "Hiragino Mincho ProN",
    "SimSun", "Noto Serif CJK SC",
    serif;
}
text[font-family="Annot Mono"] {
  font-family:
    "SF Mono", Menlo, Consolas, "Cascadia Mono",
    "Yu Gothic Mono", "Noto Sans Mono CJK JP",
    monospace;
}
```

Stack order matters: Latin families come first so English text in
mixed content uses native Latin glyphs (Helvetica Neue,
Segoe UI), and CJK families come second so Japanese / Chinese /
Korean fall through to the OS native CJK font without dragging
the Latin glyphs into a CJK Latin variant.

### Storage / SVG export

`<text>` elements get `font-family="Annot Sans"` (or the chosen
token) directly on the element — that's what the CSS rule above
matches against. Stored SVG is identical to the in-editor SVG;
no transformation needed. Annot's own renderers (the PWA
gallery thumbnail, the editor canvas, the headless `annot-render`
package) all pull the same `fonts.css` stylesheet so the same
stack applies everywhere.

For external consumers reading saved Annot SVGs (which won't have
the `fonts.css` injection), the logical family token degrades to
the browser's default sans-serif — visually similar to what the
author saw, just not OS-stack-resolved. Acceptable degradation.

### PNG export

`getPngDataUrl` builds the SVG, embeds the `fonts.css` rules
inline in a `<defs><style>` block (so the rasterised `<svg>` is
self-contained), then awaits `document.fonts.ready` before
`canvas.drawImage`. OS fonts have no async load, so
`document.fonts.ready` resolves immediately — the await is just a
guard against future web font additions.

### PPTX export / Office paste

OOXML's `<a:rPr>` accepts three typeface attributes:

```xml
<a:rPr lang="ja-JP">
  <a:latin typeface="Calibri"/>      <!-- Latin / Cyrillic / Greek -->
  <a:ea typeface="Yu Gothic UI"/>    <!-- East Asian (CJK) -->
  <a:cs typeface="Arial"/>           <!-- Complex Script (Arabic/Hebrew/Indic/Thai) -->
</a:rPr>
```

PowerPoint picks per-codepoint at render time, equivalent to the
browser's per-codepoint font selection. Annot's emit table:

| Logical | `<a:latin>` | `<a:ea>` | `<a:cs>` |
|---|---|---|---|
| Annot Sans | Calibri | Yu Gothic UI | Arial |
| Annot Serif | Cambria | Yu Mincho | Times New Roman |
| Annot Mono | Consolas | MS Gothic | Courier New |

These are all standard fonts shipped with Office (Win/Mac) and
covered by Office's own font substitution table on Linux /
LibreOffice / Google Slides import. Cross-environment sharing
without embedded fonts is "good enough" — the receiver sees
Office's default substitute when a typeface is missing.

### Editor UI

PropertyPanel's font picker drops to a 3-item dropdown:

```
[Sans (Multilingual)]
 Serif
 Mono
```

With a tooltip: "Renders with your OS's native fonts. CJK,
Arabic, Indic, Thai etc. use your OS's per-script default."

No raw family entry. The plugin API (out of scope here) will
later let organisations register branded families.

## Phases

Each phase is one PR. Phase boundaries chosen so a phase-N revert
never forces a phase-(N+1) revert.

### Phase 1 — Logical family registry (Tier A) + tests

Land `packages/core/src/editor/font-registry.ts` exporting:

- `LOGICAL_FAMILIES` — readonly tuple of the three tokens
- `cssStackFor(logical)` — returns the full CSS family stack
  string for the given logical family
- `ooxmlTypefacesFor(logical)` — returns
  `{ latin: string; ea: string; cs: string }` for OOXML emit
- Type guards: `isLogicalFamily(s)`, `coerceToLogicalFamily(s)`
  (the coercer maps unknown strings to `Annot Sans` so legacy
  saves don't crash readers)

Re-export from `@ingcreators/annot-core/headless` since the
registry is pure strings + lookups (Tier A). Unit-tested in
isolation; dead code until phase 3 wires the editor.

### Phase 2 — Inject `fonts.css` into the PWA / extension / desktop

Add `packages/web/src/styles/fonts.css` with the three
`text[font-family="Annot ..."]` rules and import it from the
editor + gallery host stylesheets. Verify in dev that the editor
canvas renders Latin / CJK / Arabic in OS-native fonts when the
attribute is set manually via DevTools.

No code change in editor logic yet — this is just the CSS
backing that phase 3 starts depending on.

### Phase 3 — Editor font picker + storage migration

- Replace the PropertyPanel font field with a 3-item dropdown
  whose values are the logical tokens
- `data-font-family` writes use `coerceToLogicalFamily` so any
  legacy value normalises to one of the three on next save
- The Tool-side property panel (Plain text / Sticky / Callout)
  picker uses the same 3 options
- Storybook stories for the picker showing the 3 states

### Phase 4 — PPTX export 3-typeface split

Modify `packages/render/src/drawingml/text-run.ts` (or the
matching shape builders that emit `<a:rPr>`) to consult
`ooxmlTypefacesFor(logical)` and emit `<a:latin>`, `<a:ea>`,
`<a:cs>` together. Office paste path picks this up automatically
since both surfaces share the builder.

Update PPTX golden snapshots to include the three typefaces.
Verify the rendered PPTX in PowerPoint and LibreOffice with a
mixed-script document.

### Phase 5 — PNG export font-ready guard

Modify `packages/editor/src/save.ts` (or wherever `getPngDataUrl`
lives) to:

1. Inline the `fonts.css` rules into the SVG's `<defs><style>`
   so the rasterised SVG is self-contained
2. `await document.fonts.ready` before `canvas.drawImage`

OS-only fonts make the await an immediate resolve, but the guard
defends against future web font additions and against
intermittent OS font pre-load delays on cold profiles.

### Phase 6 — Cleanup + docs + plan archival

- Update CLAUDE.md guardrail: a new section explaining the
  logical-family contract, the three tokens, and the per-OS
  stack resolution
- Document expected fallback behaviour in a brief
  `docs/font-policy.md` so contributors and future plugin authors
  share the same vocabulary
- Move this plan to `docs/plans/_done/` with a one-line summary
  in the README index

## Test plan

- Unit tests:
  - `cssStackFor` / `ooxmlTypefacesFor` — exhaustive coverage of
    the three tokens
  - `coerceToLogicalFamily` — known token → identity, unknown
    string → `Annot Sans`, empty → `Annot Sans`
  - PPTX text-run builder — golden snapshot with all three
    typefaces present per run
- Integration / manual:
  - Mixed-script editor session: type "Hello 日本語 العربية ไทย"
    in a Sticky note; verify each script renders in the OS
    native font on Windows / macOS / (one Linux distro with Noto
    preinstalled if available)
  - PNG export of the same: confirm rasterised glyphs match the
    on-screen rendering
  - PPTX export of the same: open in PowerPoint (Win), confirm
    each script displays with the appropriate typeface (Calibri /
    Yu Gothic UI / Arial); open in PowerPoint (Mac); open in
    LibreOffice; observe substitution behaviour
  - Office paste: paste the same composite into a fresh
    PowerPoint slide on Windows + Mac
- `pnpm -r typecheck`, `pnpm test`, `pnpm lint`, `pnpm
  --filter @ingcreators/annot-web build` after each phase

## Out of scope

- Web font bundling (Noto subsets etc.) — explicitly chosen
  against per the "no embedding, OS-only" policy. A future plan
  can add web fonts as an opt-in tier without breaking this one.
- PPTX `<p:embeddedFontLst>` font embedding — deferred. Same
  reasoning: opt-in tier for cross-environment sharing.
- Plugin API for registering branded families — separate plan
  once the core 3-token contract is stable.
- Bidirectional text (RTL) layout improvements beyond what the
  browser / PowerPoint do automatically — out of scope; the
  font registry only provides typeface resolution, not BiDi
  reordering.
- Font-size or line-height changes — the existing
  `data-font-size` / line-height handling is unaffected by this
  plan.
