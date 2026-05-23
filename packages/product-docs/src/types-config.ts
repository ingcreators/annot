// Project-config + frontmatter types.
//
// Split from `./config.ts` so `./mdx.ts` can import the
// frontmatter type without pulling in the Zod runtime (Zod is
// a non-trivial dep, and bundlers tree-shake imports per-file).
// The schemas in `./config.ts` use `z.infer<typeof ...>` to keep
// these types in lockstep.

export type {
  AnnotFrontmatter,
  AnnotFrontmatterRole,
  AnnotMeta,
  AnnotXlsxConfig,
} from "./types.js";

export interface BookConfig {
  template?: string;
  templateSheets?: {
    cover?: string;
    history?: string;
    list?: string;
    screen?: string;
    reference?: string;
  };
}

/**
 * Project-level defaults for `<AnnotEditButton>` embed mode +
 * cloud URL. Phase 5f of
 * `docs/plans/living-spec-authoring-roadmap.md`. Per-call props
 * on the component override these defaults.
 */
export interface AnnotEditorConfig {
  /**
   * Default embed mode for every `<AnnotEditButton>` in the
   * project. Per-call `mode` prop wins when set. Default
   * `"newTab"` (per OQ-09's analysis).
   */
  embedMode?: "newTab" | "inline" | "disabled";
  /**
   * Default cloud editor origin (e.g. `"https://annot.work"`
   * for the hosted instance, `"https://annot.internal.example.com"`
   * for an on-prem deployment). Per-call `cloudUrl` prop wins
   * when set. Default `"https://annot.work"`.
   */
  cloudUrl?: string;
}

export interface AnnotDocsConfig {
  meta?: Record<string, unknown>;
  xlsx?: {
    defaultBook?: string;
    books?: Record<string, BookConfig>;
  };
  editor?: AnnotEditorConfig;
}
