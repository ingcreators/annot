// Content collections — two books pulled from the sibling
// `../docs/books/<book>/` directory so the MDX source is the
// SAME file the future `annot-docs sync` / `annot-docs lint`
// CLIs (and the `annot-docs-xlsx render --book` exporter)
// will mutate. Keeping a single source of truth means a
// docs-tour run that refreshes `annot:snapshot` blocks
// updates both the published site and the rendered XLSX.

import { z } from "astro:content";
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

const annotFrontmatterSchema = z.object({
  annot: z.object({
    id: z.string(),
    title: z.string().optional(),
    purpose: z.string().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    xlsx: z
      .object({
        book: z.string().optional(),
        sheet: z.string().optional(),
        role: z
          .enum(["cover", "history", "list", "screen", "reference"])
          .optional(),
        order: z.number().optional(),
      })
      .optional(),
  }),
});

const operationManual = defineCollection({
  loader: glob({
    pattern: "**/*.mdx",
    base: "../docs/books/operation-manual",
  }),
  schema: annotFrontmatterSchema,
});

const screenDesign = defineCollection({
  loader: glob({
    pattern: "**/*.mdx",
    base: "../docs/books/screen-design",
  }),
  schema: annotFrontmatterSchema,
});

export const collections = {
  "operation-manual": operationManual,
  "screen-design": screenDesign,
};
