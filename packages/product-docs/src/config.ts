// Project config + Zod schemas for `@ingcreators/annot-product-docs`.
//
// Phase 1 PR 2 of `docs/plans/living-product-docs.md`. The schema
// here is the single source of truth for what an `annot:`
// frontmatter block and an `annot-docs.config.ts` may contain.
// MDX parsing (`./mdx.ts`) feeds the frontmatter through
// `annotFrontmatterSchema.safeParse(...)`; the CLI loader (PR 4)
// feeds `annot-docs.config.ts` through `annotDocsConfigSchema`.

import { z } from "zod";

import type { AnnotDocsConfig, AnnotFrontmatter } from "./types-config.js";

const annotFrontmatterRoleSchema = z.enum(["cover", "history", "list", "screen", "reference"]);

const annotXlsxConfigSchema = z
  .object({
    book: z.string().optional(),
    sheet: z.string().optional(),
    sheets: z.record(z.string(), z.string()).optional(),
    role: annotFrontmatterRoleSchema.optional(),
    order: z.number().optional(),
  })
  .strict()
  .refine(
    (v) => !(v.sheet && v.sheets),
    "Specify either `xlsx.sheet` (single sheet) or `xlsx.sheets` (multi-sheet), not both.",
  );

const annotMetaSchema = z.record(z.string(), z.unknown());

export const annotFrontmatterSchema = z
  .object({
    id: z.string().min(1, "`annot.id` is required."),
    title: z.string().optional(),
    purpose: z.string().optional(),
    meta: annotMetaSchema.optional(),
    xlsx: annotXlsxConfigSchema.optional(),
  })
  .strict();

const bookConfigSchema = z
  .object({
    template: z.string().optional(),
    templateSheets: z
      .object({
        cover: z.string().optional(),
        history: z.string().optional(),
        list: z.string().optional(),
        screen: z.string().optional(),
        reference: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const annotDocsConfigSchema = z
  .object({
    meta: z.record(z.string(), z.unknown()).optional(),
    xlsx: z
      .object({
        defaultBook: z.string().optional(),
        books: z.record(z.string(), bookConfigSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Identity-with-validation helper.
 *
 * Project config files (`annot-docs.config.ts`) call this so
 * editor tooling (TypeScript) sees the precise type. The runtime
 * call also runs the Zod schema, so typos in the config object
 * fail loudly at module load time rather than silently being
 * dropped by `tsc`'s structural matching.
 */
export function defineConfig(config: AnnotDocsConfig): AnnotDocsConfig {
  const result = annotDocsConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`)
      .join("\n");
    throw new Error(`Invalid \`annot-docs.config.ts\`:\n${issues}`);
  }
  return result.data as AnnotDocsConfig;
}

// Re-export the runtime types so consumers only need to import
// from `./index.ts`.
export type {
  AnnotDocsConfig,
  AnnotFrontmatter,
  BookConfig,
} from "./types-config.js";

/**
 * Convenience guard: does this AnnotFrontmatter declare a
 * `screen` role? Useful for filtering MDXs that have `<Screen>`
 * blocks (and therefore drift-checkable) from cover / history /
 * list MDXs.
 *
 * Defaults to `true` when `xlsx.role` is unset because plain MDXs
 * with `<Screen>` blocks default to the `screen` role.
 */
export function isScreenRole(fm: AnnotFrontmatter): boolean {
  const role = fm.xlsx?.role ?? "screen";
  return role === "screen";
}
