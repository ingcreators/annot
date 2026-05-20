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
import type { EncodeOptions } from "@ingcreators/annot-core/encode/options";
import { Resvg, type ResvgRenderOptions } from "@resvg/resvg-js";
import { encodeRgba } from "./encode/encode.js";
import type { EncodeResult } from "./encode/options.js";
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
 * Annotator instance returned by {@link createAnnotator}.
 *
 * - {@link toPng}     synchronous rasterise → PNG-32 bytes.
 * - {@link toSvg}     build the rasterise-ready SVG string (no
 *                     rasterisation).
 * - {@link toEncoded} (since 0.3.0) async rasterise + smart
 *                     encode pipeline — `saveSizePreset` resize,
 *                     `format: "smart" | "png" | "jpeg"` decision
 *                     tree, PNG-8 quantization via the in-tree
 *                     pure-TS Median Cut + Floyd–Steinberg dither
 *                     (post-Phase 3 of
 *                     `docs/plans/_done/replace-libimagequant-with-median-cut.md`;
 *                     prior versions used the GPL-3.0
 *                     `@ingcreators/annot-imagequant` WASM).
 */
export interface Annotator {
  /**
   * Rasterise the input to a PNG-32 byte array. Synchronous, no
   * resize, no smart format selection — the most direct path.
   * Use {@link toEncoded} when you need `saveSize` / format
   * decisions.
   */
  toPng(input: AnnotatorInput): Uint8Array;
  /**
   * Build the rasterise-ready SVG string (base image + sanitised
   * annotations). No rasterisation; returns the SVG as a string
   * the caller can feed to any other SVG tool.
   */
  toSvg(input: AnnotatorInput): string;
  /**
   * Rasterise + encode in one step. Honours `saveSizePreset`
   * (max-width resize), `format` (`"smart"` / `"png"` /
   * `"jpeg"`), and `jpegPercent`. Returns the encoded bytes plus
   * a metadata record so the caller can log which format was
   * actually picked.
   *
   * Smart mode emits PNG-8 (via the in-tree Median Cut +
   * Floyd–Steinberg dither at
   * `@ingcreators/annot-core/encode/quantize-median-cut`) for
   * UI-heavy content, falling back to PNG-32 / JPEG for
   * photo-heavy content per `smartFallback`. PNG-8 is
   * unconditionally available since Phase 3 of
   * `docs/plans/_done/replace-libimagequant-with-median-cut.md`
   * retired the optional GPL-3.0 imagequant WASM dependency.
   */
  toEncoded(input: AnnotatorInput, encodeOptions?: EncodeOptions): Promise<EncodeResult>;
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

  function rasterise(input: AnnotatorInput): {
    pixels: Uint8Array;
    width: number;
    height: number;
  } {
    const svgString = buildRasterReadySvg(input);
    const resvg = new Resvg(svgString, {
      fitTo: { mode: "width", value: input.width },
      background: "rgba(0, 0, 0, 0)",
      font: resvgFontOptions,
    });
    const rendered = resvg.render();
    return {
      pixels: rendered.pixels,
      width: rendered.width,
      height: rendered.height,
    };
  }

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
    async toEncoded(input: AnnotatorInput, encodeOptions?: EncodeOptions): Promise<EncodeResult> {
      const { pixels, width, height } = rasterise(input);
      return encodeRgba(pixels, width, height, encodeOptions);
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
