import type { AnnotDocument, DocMeta } from "./types.js";
import { ANNOT_DOC_VERSION } from "./types.js";

export interface CreateEmptyOptions {
  /** Document title; mirrors the JSON sidecar `title`. */
  readonly title?: string;
  /** BCP-47 language tag. Defaults to `"en"`. */
  readonly lang?: string;
  /** Override default meta fields. `title` here loses to top-level
   *  `title` if both supplied. */
  readonly meta?: Partial<Omit<DocMeta, "title">>;
}

/** Build a minimum-viable v1 document with one empty paragraph. */
export function createEmptyDocument(opts: CreateEmptyOptions = {}): AnnotDocument {
  const title = opts.title ?? "Untitled";
  const lang = opts.lang ?? "en";
  const meta: DocMeta = { title, ...opts.meta };
  return {
    version: ANNOT_DOC_VERSION,
    lang,
    title,
    meta,
    styleBlock: null,
    blocks: [
      {
        kind: "paragraph",
        inlineHtml: "[Add your content here.]",
      },
    ],
  };
}
