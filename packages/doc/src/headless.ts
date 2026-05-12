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

export type { BuiltinTemplateId, BuiltinTemplateSummary } from "./builtin-templates.js";
export {
  BUILTIN_TEMPLATES,
  cloneBuiltinTemplate,
  getBuiltinTemplate,
} from "./builtin-templates.js";
export type { CloneTemplateOptions } from "./clone-template.js";
export { cloneTemplate } from "./clone-template.js";
export type { CreateEmptyOptions } from "./create-empty.js";
export { createEmptyDocument } from "./create-empty.js";
export type { CreateImageBlockOptions } from "./create-image-block.js";
export { createImageBlockFromDataUrl } from "./create-image-block.js";
export { extractDocumentThumbnailDataUrl } from "./extract-thumbnail.js";
export { buildStyleBlock, injectDocumentStyles } from "./inject-styles.js";
export { isTemplateFromHead } from "./is-template-head.js";
export type { ParseOptions } from "./parse.js";
export { AnnotDocParseError, parseDocument } from "./parse.js";
export type { ResolveFigureRefsOptions } from "./resolve-figure-refs.js";
export { AnnotDocResolveError, resolveFigureRefs } from "./resolve-figure-refs.js";

export { escapeAttr, escapeText, serializeDocument, serializeMetaJson } from "./serialize.js";
export type { BuiltinThemeId, Theme, VarTuples } from "./themes/index.js";
export { BUILTIN_THEME_IDS, getTheme, THEMES } from "./themes/index.js";
export type { SanitiseResult } from "./themes/sanitise-custom-css.js";
export {
  CUSTOM_CSS_MAX_BYTES,
  CUSTOM_CSS_TRUNCATION_MARKER,
  sanitiseCustomCss,
  sanitiseCustomCssText,
} from "./themes/sanitise-custom-css.js";
export type {
  AnnotDocument,
  AnnotDocVersion,
  AppearanceFontFamily,
  AppearanceMeta,
  Block,
  CalloutBlock,
  CardLayoutMeta,
  CodeBlock,
  DividerBlock,
  DocHeaderMeta,
  DocMeta,
  HeadingBlock,
  ImageBlock,
  ImageMeta,
  ListBlock,
  NumberingMeta,
  ParagraphBlock,
  QuoteBlock,
  StepBlock,
  StepLayout,
  StepLink,
  StepViewport,
  TemplateMeta,
  UnknownBlock,
} from "./types.js";
export { ANNOT_DOC_VERSION } from "./types.js";
