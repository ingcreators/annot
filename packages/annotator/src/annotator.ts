// `@ingcreators/annot-annotator` public API.
//
// Phase 1 of the headless-annotator track. See
// `docs/plans/annot-annotator-package.md`.
//
// This module composes the Phase 0 rasterisation primitive
// (`render.ts`) with the new Tier-A SVG sanitiser
// (`sanitise-svg.ts`) to produce a developer-facing API over
// an `ImageRecord`-shaped input.

import {
  ANNOT_SVG_VERSION,
  ANNOT_SVG_VERSION_ATTR,
} from "@ingcreators/annot-core/editor/svg-format";
import { Resvg, type ResvgRenderOptions } from "@resvg/resvg-js";
import { sanitiseAnnotationsSvg } from "./sanitise-svg.js";

/**
 * Structural shape the annotator accepts. A real `ImageRecord`
 * from `@ingcreators/annot-core/storage` satisfies this — the
 * extra storage fields (path, tags, timestamps, …) are ignored.
 */
export interface AnnotatorInput {
  /** Base image as a `data:` URL. PNG or JPEG accepted; output is PNG. */
  originalDataUrl: string;
  /**
   * Editor's saved annotations SVG. Full `<svg>` wrapper expected.
   * Editor-internal artefacts (`<style data-annot-fonts>`, legacy
   * base-image, `#ui-overlay`, `#annotations` wrapper) are stripped
   * before rasterisation.
   */
  annotationsSvg: string;
  /** Output PNG width in pixels — should match the source bitmap. */
  width: number;
  /** Output PNG height in pixels — should match the source bitmap. */
  height: number;
}

/** Annotator construction options. All optional. */
export interface AnnotatorOptions {
  /**
   * Absolute paths to font files (TTF / OTF) that should be loaded
   * into the rasteriser's font set. Forwarded to resvg-js's
   * `font.fontFiles`.
   */
  fontFiles?: string[];
  /**
   * Absolute paths to directories whose font files should be loaded
   * into the rasteriser's font set. Forwarded to resvg-js's
   * `font.fontDirs`.
   */
  fontDirs?: string[];
  /**
   * Whether to load fonts from the OS. **Default: `false`** (one
   * behaviour change vs resvg-js's `true` default — CI determinism
   * matters more than "looks right on the dev's mac"). Opt in
   * explicitly when you want system-resolved fonts.
   */
  loadSystemFonts?: boolean;
  /**
   * Fallback font family name used when an annotation references a
   * font that isn't in the loaded set. Forwarded to resvg-js's
   * `font.defaultFontFamily`.
   */
  defaultFontFamily?: string;
}

/**
 * Annotator instance returned by {@link createAnnotator}. Use
 * `toPng` to rasterise; use `toSvg` to get the merged SVG without
 * rasterisation (useful for piping into another tool, or for
 * inspecting what the annotator would render).
 */
export interface Annotator {
  /**
   * Rasterise the input to a PNG byte array. JPEG output is not
   * yet supported — Phase 1.5 brings `sharp` as an optional peer
   * dep.
   */
  toPng(input: AnnotatorInput): Uint8Array;
  /**
   * Build the rasterise-ready SVG string (base image + sanitised
   * annotations). No rasterisation; returns the SVG as a string
   * the caller can feed to any other SVG tool.
   */
  toSvg(input: AnnotatorInput): string;
}

/**
 * Construct a headless annotator. Options are forwarded to the
 * underlying resvg-js rasteriser (font registration, default
 * family, etc.).
 *
 * The annotator is stateless — calling `toPng` / `toSvg` multiple
 * times with different inputs is safe and concurrent-friendly.
 * Construct one annotator per font set and reuse it.
 */
export function createAnnotator(options: AnnotatorOptions = {}): Annotator {
  const resvgFontOptions: ResvgRenderOptions["font"] = {
    loadSystemFonts: options.loadSystemFonts ?? false,
    ...(options.fontFiles ? { fontFiles: options.fontFiles } : {}),
    ...(options.fontDirs ? { fontDirs: options.fontDirs } : {}),
    ...(options.defaultFontFamily ? { defaultFontFamily: options.defaultFontFamily } : {}),
  };

  return {
    toSvg(input: AnnotatorInput): string {
      return buildRasterReadySvg(input);
    },
    toPng(input: AnnotatorInput): Uint8Array {
      const svgString = buildRasterReadySvg(input);
      const resvg = new Resvg(svgString, {
        fitTo: { mode: "width", value: input.width },
        background: "rgba(0, 0, 0, 0)",
        font: resvgFontOptions,
      });
      return resvg.render().asPng();
    },
  };
}

function buildRasterReadySvg(input: AnnotatorInput): string {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const XLINK = "http://www.w3.org/1999/xlink";

  const sanitisedInner = sanitiseAnnotationsSvg(input.annotationsSvg);

  return (
    `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK}" ` +
    `${ANNOT_SVG_VERSION_ATTR}="${ANNOT_SVG_VERSION}" ` +
    `width="${input.width}" height="${input.height}" ` +
    `viewBox="0 0 ${input.width} ${input.height}">` +
    `<image href="${input.originalDataUrl}" ` +
    `width="${input.width}" height="${input.height}"/>` +
    sanitisedInner +
    "</svg>"
  );
}
