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

export interface AnnotDocsConfig {
  meta?: Record<string, unknown>;
  xlsx?: {
    defaultBook?: string;
    books?: Record<string, BookConfig>;
  };
}
