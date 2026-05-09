/**
 * Tier A barrel — pure-Node-importable surface.
 *
 * Mirror of `@ingcreators/annot-core/headless.ts`. Importing this
 * file under `node` MUST NOT reach for `document` / `window` /
 * `navigator`. The sole DOM dependency lives inside
 * `parseDocument`, which lazily resolves `globalThis.DOMParser` at
 * call time.
 *
 * Enforced by `headless.test.ts`.
 */

export type { CreateEmptyOptions } from "./create-empty.js";
export { createEmptyDocument } from "./create-empty.js";
export type { ParseOptions } from "./parse.js";
export { AnnotDocParseError, parseDocument } from "./parse.js";

export { escapeAttr, escapeText, serializeDocument, serializeMetaJson } from "./serialize.js";
export type {
  AnnotDocument,
  AnnotDocVersion,
  Block,
  CalloutBlock,
  CodeBlock,
  DividerBlock,
  DocMeta,
  HeadingBlock,
  ImageBlock,
  ImageMeta,
  ListBlock,
  ParagraphBlock,
  QuoteBlock,
  TemplateMeta,
  UnknownBlock,
} from "./types.js";
export { ANNOT_DOC_VERSION } from "./types.js";
