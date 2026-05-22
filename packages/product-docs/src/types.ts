// Shared types for the product-docs MDX surface.
//
// Phase 1 of `docs/plans/living-product-docs.md`. The types here
// describe the structural data extracted from `.mdx` files with
// `annot:` frontmatter: the frontmatter itself, plus the JSX
// components (`<Screen>` / `<Overlay>` / `<Transition>` /
// `<HistoryEntry>` / `<ScreenList>`) the parser walks for.

/**
 * Persistent match key — `role + name` pair, optionally
 * constrained by a parent `under` key to disambiguate
 * non-unique role+name combinations.
 *
 * Critical: `match` keys NEVER persist Playwright `ref=eN` ids —
 * those are session-local and change between snapshots. The
 * resolver walks the live snapshot to find the matching element
 * each run.
 */
export interface MatchKey {
  role: string;
  name: string;
  under?: MatchKey;
}

export type OverlayIntent =
  | "info"
  | "warning"
  | "error"
  | "success"
  | "neutral"
  | "required"
  | "action";

export interface OverlaySpec {
  match: MatchKey;
  intent?: OverlayIntent;
  number?: number;
  /** Markdown body between the `<Overlay>` opening and closing tags. */
  body: string;
}

/**
 * Phase 2b of `docs/plans/living-spec-authoring-roadmap.md`.
 * A `<AnnotCallout for="id">body</AnnotCallout>` child of a
 * `<Screen annotations="...">` block. The visible / numbered /
 * intent-colored callout is composed onto the annotated PNG by the
 * Image Service using the matching entry in the annotation yaml;
 * this spec carries only what the MDX side contributes: the
 * `for=` reference and the inner markdown body.
 */
export interface AnnotCalloutSpec {
  /** References `overlays[].id` in the screen's annotation yaml. */
  for: string;
  /** Markdown body between the opening and closing tags. */
  body: string;
}

export interface TransitionSpec {
  trigger: MatchKey;
  on?: string;
  to?: string;
  body: string;
}

export interface ScreenSpec {
  id: string;
  src?: string;
  /**
   * Legacy inline overlays — `<Overlay>` JSX children of the
   * `<Screen>` block. Carries match / intent / number / body
   * inline; deprecated in favour of the Phase 2b annotation yaml
   * path. Empty when the author has migrated to the yaml form.
   */
  overlays: OverlaySpec[];
  /**
   * Phase 2b of `docs/plans/living-spec-authoring-roadmap.md`.
   * Optional path (relative to the MDX file) to an
   * `.annotations.yaml` that describes the screen's overlays —
   * see `@ingcreators/annot-product-docs/annotations-yaml`. When
   * set, the Image Service prefers yaml-driven badge composition
   * over the inline `overlays[]`.
   */
  annotations?: string;
  /**
   * Phase 2b. `<AnnotCallout for="id">body</AnnotCallout>` JSX
   * children of the screen, paired with yaml overlay entries by
   * `id`. Empty when the screen still uses the legacy
   * `<Overlay>` form.
   */
  callouts: AnnotCalloutSpec[];
}

export interface HistoryEntrySpec {
  version: string;
  date: string;
  author: string;
  body: string;
}

export interface ScreenListSpec {
  book?: string;
  sort?: "byId" | "byOrder" | "byFilePath";
}

export type AnnotFrontmatterRole = "cover" | "history" | "list" | "screen" | "reference";

export interface AnnotXlsxConfig {
  book?: string;
  /** Single sheet name — used when the MDX contributes one sheet. */
  sheet?: string;
  /** Per-`<Screen>` sheet names — used when the MDX contributes multiple sheets. */
  sheets?: Record<string, string>;
  role?: AnnotFrontmatterRole;
  order?: number;
}

export interface AnnotMeta {
  author?: string;
  createdDate?: string;
  revisedDate?: string;
  revision?: string;
  reviewedBy?: string;
  [key: string]: unknown;
}

export interface AnnotFrontmatter {
  id: string;
  title?: string;
  purpose?: string;
  meta?: AnnotMeta;
  xlsx?: AnnotXlsxConfig;
}

/**
 * Aria-snapshot and HTML-attribute blocks that live as MDX
 * comments in the body. The Playwright `screen` fixture (PR 3)
 * writes these in-place after each run so the file's "what the
 * page looks like" stays accurate alongside the human-authored
 * `<Overlay>` prose.
 *
 * Stored verbatim as the inner text between the open / close
 * markers — the resolver parses snapshot YAML separately via
 * `parseSnapshot` in `./resolver.ts`.
 */
export interface AnnotCommentBlocks {
  /** Raw YAML between `{/* annot:snapshot *‌/}` markers. */
  snapshot?: string;
  /** Raw text between `{/* annot:attributes *‌/}` markers. */
  attributes?: string;
}

/**
 * The full extraction result for one MDX file. `frontmatter`
 * is the `annot:` block; `screens` / `transitions` / `history`
 * are the JSX components found in the body; `commentBlocks`
 * captures the MDX comment blocks the fixture rewrites.
 *
 * Files without an `annot:` frontmatter block are not parsed —
 * `parseMdx` returns `null` for them so the CLI can `glob` for
 * every `*.mdx` and ignore non-annot files cheaply.
 */
export interface ParsedMdx {
  frontmatter: AnnotFrontmatter;
  screens: ScreenSpec[];
  transitions: TransitionSpec[];
  history: HistoryEntrySpec[];
  screenLists: ScreenListSpec[];
  commentBlocks: AnnotCommentBlocks;
  /** Original source text — needed by `serialiseUpdate` for byte-stable rewrites. */
  source: string;
}
