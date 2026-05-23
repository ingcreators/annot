// Strip the editor's editable-layer metadata from a PNG. The
// visible bytes were already the annotated bitmap (`toEditablePng`
// rasterises first, then injects the editable layer as PNG
// ancillary chunks), so flattening is metadata removal only — no
// re-rasterization, no decode/re-encode round-trip.
//
// Phase 3j of `docs/plans/living-spec-authoring-roadmap.md`
// (Phase 3 follow-up #2). Re-exports the underlying chunk-stripping
// helper from `@ingcreators/annot-core/xmp-bytes` (which has
// owned the PNG chunk format since the original editable-PNG
// design landed) under a top-level, user-facing name.

import { stripPngEditableLayer } from "@ingcreators/annot-core/xmp-bytes";

/**
 * "Burn" an editable PNG into a flat one — drop the editor's
 * editable layer (Adobe XMP iTXt + custom `svGo` chunk) while
 * keeping the visible bitmap byte-identical.
 *
 * The editable PNG format embeds:
 *
 *   - **visible bytes** — the annotated raster the user sees.
 *   - **Adobe XMP iTXt chunk** — `<annot:annotations>` (the SVG
 *     layer) + `<annot:tags>` (provenance) for re-edit.
 *   - **custom `svGo` chunk** — the original un-annotated capture
 *     for re-edit.
 *
 * Flattening strips the iTXt + svGo chunks. The result is a
 * regular PNG with the same visible pixels but no recoverable
 * original / no SVG layer. Re-opening in the editor shows the
 * annotated capture as a non-editable bitmap;
 * `readEditablePngBytes` returns `null`.
 *
 * Use cases:
 *
 *   - **Publish-flat** — editor session → distribution-ready
 *     PNG; the editable layer is dead weight for downstream
 *     consumers (Slack drop, third-party viewers).
 *   - **File size** — editable PNG roughly doubles in bytes
 *     (original + SVG); flattening drops the overhead.
 *   - **Privacy hardening** — `burnRedactions` is the strong
 *     version for *redact* regions; flattening drops the
 *     recoverable original entirely for *all* annotations,
 *     including non-redact ones whose annotated visual the
 *     publisher wants to keep but whose original capture
 *     they don't want shippable.
 *
 * Pure data — no DOM, no canvas. Returns input bytes unchanged
 * when no editable-layer chunks are present (idempotent).
 */
export function flattenEditablePng(pngBytes: Uint8Array): Uint8Array {
  return stripPngEditableLayer(pngBytes);
}
