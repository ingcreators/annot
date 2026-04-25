/**
 * SVG annotation restoration — parses a saved Annot SVG and adopts its
 * annotation elements into the active canvas.
 *
 * Extracted from `app.ts` as part of the Phase 0 decomposition
 * (see `docs/plans/_done/app-decomposition.md`). Touches DOM (DOMParser,
 * document.importNode), but has no app-state dependencies.
 */

import { ANNOT_SVG_VERSION, readAnnotVersion } from "@ingcreators/annot-core/editor";
import type { CanvasManager } from "@ingcreators/annot-editor";

export function restoreAnnotations(canvas: CanvasManager, svgString: string): void {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svgRoot = doc.documentElement;

  // Inspect the Annot format version stamp. Today only version "1"
  // exists (and "0" = unstamped legacy); we read-through both
  // without branching. When a breaking schema change lands, this
  // is the hook point where migration runs before the element
  // adoption loop. Keep the lookup unconditional so the surface
  // stays visible in the code even in the "no migration needed"
  // era — it's the lever we committed to in docs/svg-format.md.
  const version = readAnnotVersion(svgRoot);
  if (version !== ANNOT_SVG_VERSION && version !== "0") {
    // Newer-than-known file (e.g. written by a future Annot).
    // Parse leniently — we still understand the container shape,
    // only unfamiliar annotation types might render degenerately.
    console.warn(
      `[annot] SVG stamped with version "${version}" (this build expects "${ANNOT_SVG_VERSION}"). Rendering with forward-compat fallback.`,
    );
  }

  for (const child of Array.from(svgRoot.children)) {
    const tag = child.tagName;
    if (tag === "defs" || (tag === "image" && !child.closest("g"))) continue;
    if (child.id === "ui-overlay") continue;
    if (child.id === "annotations") {
      for (const anno of Array.from(child.children)) {
        canvas.annotations.appendChild(document.importNode(anno, true));
      }
      continue;
    }
    canvas.annotations.appendChild(document.importNode(child, true));
  }
}
