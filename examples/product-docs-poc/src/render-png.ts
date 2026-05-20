// Stage 4: Build the annot DSL annotation list from resolved
// overlays and render via annot-annotator.

import { writeFile } from "node:fs/promises";

import {
  type AnnotatorInput,
  type BboxAnnotation,
  type Intent,
  bboxAnnotationsToSvg,
  createAnnotator,
} from "@ingcreators/annot-annotator";

import type { ResolvedOverlay } from "./resolve.ts";

const INTENT_MAP: Record<string, Intent> = {
  required: "error",
  action: "success",
  info: "info",
  warning: "warning",
  error: "error",
  success: "success",
  neutral: "neutral",
};

export async function renderAnnotatedPng(opts: {
  screenshotPng: Uint8Array;
  pageWidth: number;
  pageHeight: number;
  resolved: ResolvedOverlay[];
  outPath: string;
}): Promise<void> {
  const annotations: BboxAnnotation[] = [];

  for (const r of opts.resolved) {
    if (r.status !== "resolved") continue;
    const intent = mapIntent(r.overlay.intent);
    const number = r.overlay.number;
    const bbox = r.bbox;

    // Numbered callout style: rect + small number marker at the
    // top-left corner. The rect uses the overlay intent for
    // colour; the marker is a circle with the number text.
    annotations.push({
      type: "rect",
      bbox,
      intent,
      strokeWidth: 3,
    });

    if (number !== undefined) {
      annotations.push({
        type: "circle",
        center: { x: bbox.x - 4, y: bbox.y - 4 },
        radius: 14,
        intent,
        fill: "#fff",
        strokeWidth: 2,
      });
      annotations.push({
        type: "text",
        at: { x: bbox.x - 4, y: bbox.y },
        content: String(number),
        intent,
        fontSize: 16,
      });
    }
  }

  // Wrap the fragment in an SVG with explicit dimensions so the
  // rasteriser knows the canvas size. The fragment from
  // `bboxAnnotationsToSvg` is bare child elements.
  const fragment = bboxAnnotationsToSvg(annotations);
  const annotationsSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${opts.pageWidth}" height="${opts.pageHeight}" ` +
    `viewBox="0 0 ${opts.pageWidth} ${opts.pageHeight}">` +
    fragment +
    `</svg>`;

  const base64 = Buffer.from(opts.screenshotPng).toString("base64");
  const originalDataUrl = `data:image/png;base64,${base64}`;

  const input: AnnotatorInput = {
    width: opts.pageWidth,
    height: opts.pageHeight,
    originalDataUrl,
    annotationsSvg,
  };

  const annotator = createAnnotator({});
  const pngBytes = annotator.toPng(input);
  await writeFile(opts.outPath, pngBytes);
}

function mapIntent(intent: string | undefined): Intent {
  if (!intent) return "error";
  return INTENT_MAP[intent] ?? "error";
}
