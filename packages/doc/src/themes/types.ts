/**
 * Theme definitions for `.annot.html` documents.
 *
 * Phase 1 of `docs/plans/card-document-themes.md`. Splits the
 * monolithic `injectDocumentStyles` into a fixed structural
 * layer (always emitted) plus a swappable theme layer (per-theme
 * CSS custom property values, optional theme-specific
 * selectors, badge label template).
 *
 * The `Theme` type is the public surface for plugin-supplied
 * themes (Phase 6's documentation enabler). Plugin authors
 * declare a `Theme` object and register it via a future
 * `PluginHost.addTheme(theme)` API; built-in themes use the
 * same shape so the registry treats both uniformly.
 */

/** A `(name, value)` tuple list for emitting CSS custom
 *  properties in deterministic order. Maps directly to the
 *  on-disk byte order of the `:root` block. */
export type VarTuples = ReadonlyArray<readonly [string, string]>;

/** Theme definition. Built-in themes pair `vars` (light) with
 *  an optional `darkVars` (dark-mode override). When `darkVars`
 *  is set AND the document opts into auto-mode (`meta.theme ===
 *  "auto"` or absent), the dark vars get emitted behind a
 *  `@media (prefers-color-scheme: dark)` block. */
export interface Theme {
  /** Stable identifier matching the on-disk
   *  `meta.appearance.template` value. */
  readonly id: string;
  /** Human-readable name shown in the Appearance picker
   *  (Phase 3). */
  readonly name: string;
  /** Short description shown beneath the picker thumbnail. */
  readonly description?: string;
  /** CSS custom property values emitted on `:root`. Order
   *  matters — the array is walked verbatim so changing the
   *  order here changes the saved bytes. */
  readonly vars: VarTuples;
  /** Optional dark-mode overrides. When the document's
   *  effective theme mode is `"auto"` AND this field is set,
   *  the overrides land in `@media (prefers-color-scheme: dark)
   *  { :root { ... } }`. Absent → no media query is emitted
   *  (the theme is light-only or dark-only). */
  readonly darkVars?: VarTuples;
  /** Optional theme-specific selectors appended after the
   *  `:root` + media-query blocks. Used for visual flourishes
   *  that can't be expressed as CSS variable values (e.g. an
   *  editorial theme's pull-quote treatment, a playful theme's
   *  chat-bubble badge shape). */
  readonly extraCss?: string;
  /** CSS `content` template for the step badge (Phase 2 of
   *  `docs/plans/_done/card-step-auto-numbering.md`). `%n`
   *  substitutes `counter(annot-step)`; everything else is
   *  literal CSS `content` text. Absent / empty defaults to
   *  `"%n"` (numeral only). Themes set this to give the badge
   *  a per-theme character (e.g. `"%n."` for editorial,
   *  `"0%n"` for playful). The document-level
   *  `meta.numbering.stepLabel` STILL wins when set — that's
   *  per-document opt-in customisation. */
  readonly badgeLabelTemplate?: string;
  /** Pragmatic-Phase-1 deliverable for
   *  `docs/plans/card-pptx-templates.md` — cross-surface theme
   *  pairing. Each themable colour the PPTX exporter cares
   *  about lives here so picking an Appearance template in
   *  Doc Settings carries through to the exported `.pptx`'s
   *  slide background, step badge, and text colours.
   *
   *  Absent → PPTX exporter uses the legacy hard-coded modern-
   *  light palette (white slide, blue badge). Existing
   *  documents that haven't opted into `meta.appearance.template`
   *  fall through this path so saved bytes stay byte-identical.
   *
   *  Values are 6-digit uppercase hex without the `#` prefix —
   *  matches the OOXML `<a:srgbClr val="..."/>` shape. */
  readonly pptxPalette?: PptxPalette;
}

/** OOXML colour palette mirrored from the theme's CSS variables.
 *  Each value is a 6-digit uppercase hex string (no leading `#`)
 *  ready to drop into `<a:srgbClr val="..."/>`. */
export interface PptxPalette {
  /** Slide background (the deck's `dk1` / `lt1` pair lands here
   *  via the slide master). Light backgrounds give a printable
   *  deck; dark backgrounds give an always-dark deck. */
  readonly slideBg: string;
  /** Default text colour (title + body). Pairs with `slideBg`
   *  for contrast. */
  readonly slideFg: string;
  /** Accent / brand colour. Drives the step badge fill, the
   *  hyperlink chip border, and any future accent surface. */
  readonly accent: string;
  /** Text colour rendered on top of `accent` (typically white
   *  on a bright accent, dark on a pastel accent). */
  readonly accentFg: string;
  /** Muted / secondary text colour — used for footer / metadata
   *  on the cover slide. Falls back to `slideFg` when absent. */
  readonly muted?: string;
}
