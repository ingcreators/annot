// `annot_compare_screenshots` — diff two PNGs, highlight the
// changed regions on the second one with `warning`-intent rects.
// Phase 5 of `docs/plans/agent-mcp-integration.md`.

import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { Annotator, EncodeOptions } from "@ingcreators/annot-annotator";
import { bboxAnnotationsToSvg } from "@ingcreators/annot-annotator";
import { diffScreenshots } from "../compare/diff.js";
import { ENCODE_OPTIONS_SCHEMA } from "../dsl/schema.js";
import type { BboxAnnotation } from "../dsl/types.js";
import { applyEncodeOptions } from "../io/encode-output.js";
import { resolveImageInput } from "../io/read-image.js";
import type { AnnotateToolResult } from "./annotate-screenshot.js";

export const COMPARE_SCREENSHOTS_TOOL_NAME = "annot_compare_screenshots";

export const compareScreenshotsTool = {
  name: COMPARE_SCREENSHOTS_TOOL_NAME,
  description:
    "Compare two screenshots (must have identical dimensions) and return " +
    "a PNG of the `after` image with changed regions highlighted as red " +
    "rectangles. Useful for visual-diff PR review.",
  inputSchema: {
    type: "object",
    required: ["before", "after"],
    additionalProperties: false,
    properties: {
      before: {
        type: "string",
        description: "`data:image/png;base64,...` URL or absolute filesystem path.",
      },
      after: {
        type: "string",
        description: "`data:image/png;base64,...` URL or absolute filesystem path.",
      },
      threshold: {
        type: "number",
        minimum: 0,
        maximum: 1,
        default: 0.1,
        description: "Pixelmatch sensitivity (0 = strict, 1 = permissive).",
      },
      includeChangeList: {
        type: "boolean",
        default: false,
        description:
          "When true, append a text content block listing the changed-region " +
          "bboxes alongside the annotated PNG.",
      },
      output: { type: "string" },
      encode: { $ref: "#/$defs/EncodeOptions" },
    },
    $defs: {
      EncodeOptions: ENCODE_OPTIONS_SCHEMA,
    },
  },
} as const;

export interface CompareScreenshotsDeps {
  annotator: Annotator;
}

interface CompareScreenshotsInput {
  before?: unknown;
  after?: unknown;
  threshold?: unknown;
  includeChangeList?: unknown;
  output?: unknown;
  encode?: unknown;
}

class InvalidCompareInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCompareInputError";
  }
}

export async function handleCompareScreenshots(
  input: CompareScreenshotsInput,
  deps: CompareScreenshotsDeps,
): Promise<AnnotateToolResult> {
  try {
    if (typeof input.before !== "string") {
      throw new InvalidCompareInputError("`before` is required and must be a string.");
    }
    if (typeof input.after !== "string") {
      throw new InvalidCompareInputError("`after` is required and must be a string.");
    }
    const threshold = typeof input.threshold === "number" ? input.threshold : 0.1;
    const includeChangeList = input.includeChangeList === true;
    let output: string | undefined;
    if (input.output !== undefined) {
      if (typeof input.output !== "string") {
        throw new InvalidCompareInputError("`output` must be a string when provided.");
      }
      if (!isAbsolute(input.output)) {
        throw new InvalidCompareInputError(`\`output\` path "${input.output}" must be absolute.`);
      }
      output = input.output;
    }

    let encode: Partial<EncodeOptions> | undefined;
    if (input.encode !== undefined) {
      if (typeof input.encode !== "object" || input.encode === null) {
        throw new InvalidCompareInputError("`encode` must be an object when provided.");
      }
      encode = input.encode as Partial<EncodeOptions>;
    }

    const [beforeImage, afterImage] = await Promise.all([
      resolveImageInput(input.before),
      resolveImageInput(input.after),
    ]);
    const diff = await diffScreenshots(beforeImage.bytes, afterImage.bytes, { threshold });
    const annotations: BboxAnnotation[] = diff.regions.map((bbox) => ({
      type: "rect",
      bbox,
      intent: "warning",
    }));
    const annotationsSvg = bboxAnnotationsToSvg(annotations);
    const rasterised = deps.annotator.toPng({
      originalDataUrl: afterImage.dataUrl,
      annotationsSvg,
      width: diff.width,
      height: diff.height,
    });
    const encoded = await applyEncodeOptions(
      rasterised,
      { width: diff.width, height: diff.height },
      encode,
    );

    if (output) {
      await writeFile(output, encoded.bytes);
      const reasonSuffix = encoded.reason ? `, reason: ${encoded.reason}` : "";
      const text =
        `Wrote ${encoded.bytes.byteLength}-byte diff-annotated ${encoded.chosen.toUpperCase()} to ${output} ` +
        `(${encoded.width}×${encoded.height}, ${diff.regions.length} changed region${
          diff.regions.length === 1 ? "" : "s"
        }, ${diff.mismatchedPixels} mismatched pixel${diff.mismatchedPixels === 1 ? "" : "s"}${reasonSuffix}).`;
      return { content: [{ type: "text", text }] };
    }

    const imageContent = {
      type: "image" as const,
      data: Buffer.from(
        encoded.bytes.buffer,
        encoded.bytes.byteOffset,
        encoded.bytes.byteLength,
      ).toString("base64"),
      mimeType: encoded.mimeType,
    };
    if (!includeChangeList) {
      return { content: [imageContent] };
    }
    const summary =
      `${diff.regions.length} changed region${diff.regions.length === 1 ? "" : "s"}, ` +
      `${diff.mismatchedPixels} mismatched pixel${diff.mismatchedPixels === 1 ? "" : "s"}:\n` +
      diff.regions
        .map((r, i) => `  [${i + 1}] x=${r.x} y=${r.y} w=${r.width} h=${r.height}`)
        .join("\n");
    return {
      content: [imageContent, { type: "text", text: summary }],
    };
  } catch (err) {
    const message =
      err instanceof Error ? `${err.name}: ${err.message}` : `Unknown error: ${String(err)}`;
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }
}
