/**
 * `cloneTemplate` — produce a fresh editable document from a
 * template-marked source document.
 *
 * Phase 8a of `docs/plans/annot-html-document.md` ships the
 * Tier A foundation for the templates feature: the parser /
 * serializer already round-trip the three template markers
 * (Phase 1), and this helper inverts the marker side — given a
 * template, it returns a clone with:
 *
 *   1. The three template markers stripped (`meta.template`
 *      removed; serialiser then drops `data-annot-doc-template`
 *      from `<html>` and `<meta name="annot-template">` from
 *      `<head>` automatically).
 *   2. Every `ImageBlock.id` reminted via the supplied ID
 *      generator (defaults to `img-` + `newIdB58()`).
 *   3. Every key in `meta.imageMeta` remapped to match the new
 *      image IDs so the per-image alt / caption / sourceUrl
 *      survives the clone.
 *
 * Every other byte of the document is preserved — title, lang,
 * version, styleBlock, all non-image block content, and all
 * non-template / non-imageMeta meta fields.
 *
 * Tier A: no DOM, no host dependency. Test-deterministic via
 * the optional `makeId` knob.
 */

import { newIdB58 } from "@ingcreators/annot-core/headless";
import type {
  AnnotDocument,
  Block,
  CardLayoutMeta,
  DocMeta,
  ImageBlock,
  ImageMeta,
  StepBlock,
} from "./types.js";

export interface CloneTemplateOptions {
  /** ID factory for fresh image-block IDs. Defaults to
   *  `img-` + `newIdB58()`. Override in tests for determinism
   *  or to plug in a different uniqueness strategy. */
  readonly makeId?: () => string;
}

/**
 * Clone a template document into a fresh editable document.
 *
 * The template markers (`meta.template`) are stripped and every
 * image-block ID is reminted. Safe to call on non-template
 * documents — the marker strip is a no-op and only the image
 * IDs are remapped.
 */
export function cloneTemplate(
  template: AnnotDocument,
  options: CloneTemplateOptions = {},
): AnnotDocument {
  const makeId = options.makeId ?? defaultMakeId;

  // 1. Build an id-remap table for every image-bearing block —
  //    `image` and `step` both carry `data-annot-image-id` from
  //    the same namespace (Phase 0 of card-procedure-template).
  //    We mint eagerly (rather than lazily during the block walk)
  //    so `imageMeta` keys can be remapped in one pass without
  //    needing a second walk over the block tree.
  const idRemap = new Map<string, string>();
  for (const block of template.blocks) {
    if (block.kind === "image" || block.kind === "step") {
      idRemap.set(block.id, makeId());
    }
  }

  // 2. Walk blocks; substitute IDs on image / step blocks, leave
  //    everything else untouched.
  const blocks: readonly Block[] = template.blocks.map((block) => {
    if (block.kind === "image") return remapImageBlock(block, idRemap);
    if (block.kind === "step") return remapStepBlock(block, idRemap);
    return block;
  });

  // 3. Build new meta: drop `template`, remap `imageMeta` keys.
  const meta = remapMeta(template.meta, idRemap);

  return {
    version: template.version,
    lang: template.lang,
    title: template.title,
    meta,
    styleBlock: template.styleBlock,
    blocks,
  };
}

function defaultMakeId(): string {
  return `img-${newIdB58()}`;
}

function remapImageBlock(block: ImageBlock, idRemap: Map<string, string>): ImageBlock {
  const newId = idRemap.get(block.id);
  if (newId === undefined || newId === block.id) return block;
  return block.caption !== undefined
    ? { kind: "image", id: newId, svg: block.svg, caption: block.caption }
    : { kind: "image", id: newId, svg: block.svg };
}

function remapStepBlock(block: StepBlock, idRemap: Map<string, string>): StepBlock {
  const newId = idRemap.get(block.id);
  if (newId === undefined || newId === block.id) return block;
  return {
    kind: "step",
    id: newId,
    svg: block.svg,
    title: block.title,
    body: block.body,
    layout: block.layout,
  };
}

function remapMeta(meta: DocMeta, idRemap: Map<string, string>): DocMeta {
  // Strip the `template` field unconditionally — that's the
  // whole point of the clone. Every other field passes through.
  // Then remap `imageMeta` keys to follow the new IDs.
  const out: DocMeta = { title: meta.title };
  if (meta.author !== undefined) (out as { author?: string }).author = meta.author;
  if (meta.theme !== undefined) (out as { theme?: typeof meta.theme }).theme = meta.theme;
  if (meta.maxWidth !== undefined) {
    (out as { maxWidth?: typeof meta.maxWidth }).maxWidth = meta.maxWidth;
  }
  // `meta.template` intentionally elided.
  if (meta.imageMeta !== undefined) {
    const remapped = remapImageMeta(meta.imageMeta, idRemap);
    if (remapped !== undefined) {
      (out as { imageMeta?: Readonly<Record<string, ImageMeta>> }).imageMeta = remapped;
    }
  }
  if (meta.cardLayout !== undefined) {
    // cardLayout is doc-wide chrome, not tied to any specific
    // image / step block — passes through verbatim.
    (out as { cardLayout?: CardLayoutMeta }).cardLayout = meta.cardLayout;
  }
  return out;
}

function remapImageMeta(
  imageMeta: Readonly<Record<string, ImageMeta>>,
  idRemap: Map<string, string>,
): Readonly<Record<string, ImageMeta>> | undefined {
  const next: Record<string, ImageMeta> = {};
  for (const [oldKey, value] of Object.entries(imageMeta)) {
    // Use the remapped key when we have one. Keys not present in
    // the remap table (e.g. orphaned imageMeta entries that don't
    // match any current image block) pass through unchanged so
    // we don't silently drop user data.
    const newKey = idRemap.get(oldKey) ?? oldKey;
    next[newKey] = value;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}
