// `annot_annotate_screenshot` — overlay annotations on a captured
// PNG. Phase 2 of `docs/plans/agent-mcp-integration.md`. The
// bbox-only baseline; the locator-flavour counterpart
// (`annot_annotate_url`) lands in Phase 3b and delegates here
// after resolving locators to bboxes.
//
// Flow:
//   1. Resolve the `image` field (data URL or absolute path) to
//      bytes + a normalised data URL + PNG IHDR dimensions.
//   2. Convert the `annotations` DSL list to an SVG fragment.
//   3. Call `annotator.toPng()` to rasterise.
//   4. If `output` is set, write the PNG to disk and return a
//      text confirmation. Otherwise return the bytes as an MCP
//      `image` content block (base64-encoded PNG).

import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { Annotator } from "@ingcreators/annot-annotator";

import { BBOX_ANNOTATION_SCHEMA, SHARED_DEFS } from "../dsl/schema.js";
import { bboxAnnotationsToSvg } from "../dsl/to-svg.js";
import type { BboxAnnotation } from "../dsl/types.js";
import { InvalidImageInputError, resolveImageInput } from "../io/read-image.js";

export const ANNOTATE_SCREENSHOT_TOOL_NAME = "annot_annotate_screenshot";

/**
 * Tool descriptor for the MCP `tools/list` response. The
 * `inputSchema` is shipped as a plain JSON Schema literal; the
 * MCP SDK runs Ajv on the agent's payload before our handler sees
 * it.
 */
export const annotateScreenshotTool = {
  name: ANNOTATE_SCREENSHOT_TOOL_NAME,
  description:
    "Overlay annotations (rectangles, circles, arrows, callouts, text) on " +
    "a PNG screenshot. Annotation positions are specified as bounding boxes " +
    "or points; pair with `annot_annotate_url` if you want locator-driven " +
    "positioning. Returns the annotated PNG inline unless `output` is " +
    "specified, in which case the PNG is written to that absolute path.",
  inputSchema: {
    type: "object",
    required: ["image", "annotations"],
    additionalProperties: false,
    properties: {
      image: {
        type: "string",
        description:
          "Source image. Either a `data:image/png;base64,...` URL or an " +
          "absolute filesystem path to a PNG file.",
      },
      annotations: {
        type: "array",
        items: { $ref: "#/$defs/BboxAnnotation" },
        description:
          "Ordered list of annotations to overlay. Each annotation declares " +
          "its shape, position, and (optionally) an `intent` shorthand for " +
          "the colour theme (`info` | `warning` | `error` | `success` | " +
          "`neutral`).",
      },
      output: {
        type: "string",
        description:
          "Optional absolute filesystem path. When set, the annotated PNG " +
          "is written here and the tool returns a text confirmation; " +
          "otherwise the PNG bytes are returned inline.",
      },
    },
    $defs: {
      ...SHARED_DEFS,
      BboxAnnotation: BBOX_ANNOTATION_SCHEMA,
    },
  },
} as const;

/** Tool dependencies — injected at server construction time. */
export interface AnnotateScreenshotDeps {
  annotator: Annotator;
}

/** Raw, pre-validation tool input. The MCP SDK has already run the
 *  JSON schema check by the time we see this, but we still
 *  defensively narrow before reaching into fields. */
interface AnnotateScreenshotInput {
  image?: unknown;
  annotations?: unknown;
  output?: unknown;
}

/** MCP `tools/call` result content block. */
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/**
 * Subset of the MCP SDK's `CallToolResult` we actually emit. The
 * SDK's full type also covers async-task responses (added in MCP
 * v2025-06-19); our handler always returns the synchronous content
 * shape, so we narrow here for clarity. Dispatch in `server.ts`
 * casts back up to the SDK union at the boundary.
 */
export interface AnnotateToolResult {
  content: ContentBlock[];
  isError?: boolean;
}

export async function handleAnnotateScreenshot(
  input: AnnotateScreenshotInput,
  deps: AnnotateScreenshotDeps,
): Promise<AnnotateToolResult> {
  try {
    const params = parseInput(input);
    const resolved = await resolveImageInput(params.image);
    const annotationsSvg = bboxAnnotationsToSvg(params.annotations);
    const pngBytes = deps.annotator.toPng({
      originalDataUrl: resolved.dataUrl,
      annotationsSvg,
      width: resolved.dimensions.width,
      height: resolved.dimensions.height,
    });
    if (params.output) {
      await writeFile(params.output, pngBytes);
      return {
        content: [
          {
            type: "text",
            text:
              `Wrote ${pngBytes.byteLength}-byte annotated PNG to ${params.output} ` +
              `(${resolved.dimensions.width}×${resolved.dimensions.height}, ` +
              `${params.annotations.length} annotation${
                params.annotations.length === 1 ? "" : "s"
              }).`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "image",
          data: bytesToBase64(pngBytes),
          mimeType: "image/png",
        },
      ],
    };
  } catch (err) {
    return errorResult(err);
  }
}

// ─── helpers ────────────────────────────────────────────────────

interface ParsedInput {
  image: string;
  annotations: readonly BboxAnnotation[];
  output: string | undefined;
}

function parseInput(input: AnnotateScreenshotInput): ParsedInput {
  if (typeof input.image !== "string") {
    throw new InvalidImageInputError("`image` is required and must be a string.");
  }
  if (!Array.isArray(input.annotations)) {
    throw new InvalidToolInputError("`annotations` is required and must be an array.");
  }
  // Trust the SDK's JSON-schema validator for per-item shape; we
  // already filtered at the schema layer. Cast through `unknown` so
  // we don't accidentally rely on full structural narrowing here.
  const annotations = input.annotations as readonly BboxAnnotation[];

  let output: string | undefined;
  if (input.output !== undefined) {
    if (typeof input.output !== "string") {
      throw new InvalidToolInputError("`output` must be a string when provided.");
    }
    if (!isAbsolute(input.output)) {
      throw new InvalidToolInputError(
        `\`output\` path "${input.output}" must be absolute so the file lands at a predictable location.`,
      );
    }
    output = input.output;
  }
  return { image: input.image, annotations, output };
}

class InvalidToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidToolInputError";
  }
}

function errorResult(err: unknown): AnnotateToolResult {
  const message =
    err instanceof Error ? `${err.name}: ${err.message}` : `Unknown error: ${String(err)}`;
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}
