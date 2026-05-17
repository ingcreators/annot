/**
 * Pure helpers for synthesising an `ImageBlock` from raw bitmap
 * bytes (data URL) — used by Phase 5b's capture-insertion paths
 * (paste, drop, file picker) in the doc shell.
 *
 * Tier A: no DOM dependency. The shell discovers width / height
 * via the browser's `Image()` constructor and passes them in;
 * this module just synthesises the canonical `<svg>` payload
 * that goes into the block. The mirroring inverse happens in
 * the modal's `synthesiseRecord` — extracts width / height /
 * `originalDataUrl` back out of the `<svg>` for `EditorShell.
 * mountFromRecord`.
 */

import { newIdB58 } from "@ingcreators/annot-core/headless";
import type { ImageBlock } from "./types.js";

export interface CreateImageBlockOptions {
  /** Stable id to use; defaults to `img-` + a fresh
   *  `newIdB58()` value. */
  readonly id?: string;
  /** Optional figcaption inline HTML. */
  readonly caption?: string;
  /** Optional back-reference to the gallery `ImageRecord` this
   *  block was sourced from. Carried through serialize / parse via
   *  `data-annot-source-path`; enables doc ↔ gallery sync in the
   *  editing host. Drag-drop / paste / file-picker callers leave
   *  this undefined (doc-only). */
  readonly sourceImagePath?: string;
}

/** Synthesise an `ImageBlock` from a bitmap data URL + dimensions.
 *
 *  The embedded SVG carries the same canonical shape `.annot.svg`
 *  files use: `<svg data-annot-version="1" viewBox="0 0 W H">`
 *  with a `<image href>` base bitmap and an empty
 *  `<g id="annotations">` ready for the editor to populate.
 *
 *  Width / height MUST be positive integers — callers responsible
 *  for converting from `naturalWidth` / `naturalHeight` (or other
 *  source) before invoking. */
export function createImageBlockFromDataUrl(
  dataUrl: string,
  width: number,
  height: number,
  options: CreateImageBlockOptions = {},
): ImageBlock {
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(`createImageBlockFromDataUrl: invalid width ${width}`);
  }
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error(`createImageBlockFromDataUrl: invalid height ${height}`);
  }
  const id = options.id ?? `img-${newIdB58()}`;
  const w = Math.round(width);
  const h = Math.round(height);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><image href="${escapeAttrValue(dataUrl)}" width="${w}" height="${h}"/><g id="annotations"></g></svg>`;
  const base: ImageBlock = { kind: "image", id, svg };
  return {
    ...base,
    ...(options.caption !== undefined ? { caption: options.caption } : {}),
    ...(options.sourceImagePath !== undefined ? { sourceImagePath: options.sourceImagePath } : {}),
  };
}

/** Escape a value for an HTML / SVG attribute. Mirror of the
 *  serializer's `escapeAttr` but kept local to avoid pulling
 *  the serializer into this Tier A module's import graph. */
function escapeAttrValue(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
