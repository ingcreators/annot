// `annot_annotate_url` — capture a URL in headless Chromium and
// overlay annotations whose positions are expressed as Playwright
// locator strings or bboxes. Phase 3b of
// `docs/plans/agent-mcp-integration.md`.
//
// One-MCP-call replacement for the multi-step
// `playwright-mcp.browser_navigate` →
// `playwright-mcp.browser_screenshot` →
// `playwright-mcp.browser_locator` × N →
// `annot_annotate_screenshot` agent flow. The orchestration:
//
//   1. `capturePage()` opens a context + page, navigates, takes
//      a screenshot.
//   2. `resolveLocatorAnnotations()` walks the agent's
//      `LocatorAnnotation[]` and turns each into a concrete
//      `BboxAnnotation` against the live page.
//   3. `bboxAnnotationsToSvg()` produces the SVG fragment.
//   4. `annotator.toPng()` rasterises.
//   5. Page + context close; the pool's idle timer keeps the
//      browser warm for the next call.

import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { Annotator, EncodeOptions } from "@ingcreators/annot-annotator";
import { bboxAnnotationsToSvg } from "@ingcreators/annot-annotator";
import { capturePage, type ViewportOptions } from "../browser/capture.js";
import type { BrowserPool } from "../browser/pool.js";
import { resolveLocatorAnnotations } from "../browser/resolve-locator.js";
import { ENCODE_OPTIONS_SCHEMA, LOCATOR_ANNOTATION_SCHEMA, SHARED_DEFS } from "../dsl/schema.js";
import type { BboxAnnotation, LocatorAnnotation } from "../dsl/types.js";
import { applyEncodeOptions } from "../io/encode-output.js";
import { readPngDimensions } from "../io/png-dimensions.js";
import type { AnnotateToolResult } from "./annotate-screenshot.js";

export const ANNOTATE_URL_TOOL_NAME = "annot_annotate_url";

export const annotateUrlTool = {
  name: ANNOTATE_URL_TOOL_NAME,
  description:
    "Open a URL in a headless browser, capture a screenshot, and overlay " +
    "annotations whose positions are specified as Playwright locator " +
    'strings (`button:has-text("Submit")`, `[data-testid="email"]`, ' +
    '`role=button[name="Sign in"]`) or bounding boxes. Returns the ' +
    "annotated PNG inline unless `output` is specified.",
  inputSchema: {
    type: "object",
    required: ["url", "annotations"],
    additionalProperties: false,
    properties: {
      url: {
        type: "string",
        format: "uri",
        description: "Page URL to capture.",
      },
      annotations: {
        type: "array",
        items: { $ref: "#/$defs/LocatorAnnotation" },
        description:
          "Ordered list of annotations to overlay. Each annotation " +
          "declares its shape and position via `bbox` / `from` / `to` / " +
          "`at` (coordinate path) or `locator` / `fromLocator` / `toLocator` / " +
          "`atLocator` (Playwright locator string).",
      },
      viewport: {
        type: "object",
        additionalProperties: false,
        properties: {
          width: { type: "integer", minimum: 1, default: 1280 },
          height: { type: "integer", minimum: 1, default: 800 },
          deviceScaleFactor: { type: "number", minimum: 0.1, default: 1 },
        },
        description: "Viewport size. Default 1280×800 at 1× device pixel ratio.",
      },
      fullPage: {
        type: "boolean",
        default: false,
        description:
          "Capture the full scrollable page rather than just the visible " +
          "viewport. Locator resolution still depends on the actual DOM " +
          "layout — off-viewport locators only resolve when `fullPage` is true.",
      },
      waitFor: {
        type: "string",
        enum: ["load", "domcontentloaded", "networkidle"],
        default: "load",
      },
      output: {
        type: "string",
        description:
          "Optional absolute filesystem path. When set, the annotated PNG " +
          "is written here and the tool returns a text confirmation.",
      },
      encode: {
        $ref: "#/$defs/EncodeOptions",
        description:
          "Optional encoder settings (`format` / `saveSizePreset` / " +
          "`jpegPercent`). Set to shrink the output for ingestion into " +
          "issue trackers / docs.",
      },
    },
    $defs: {
      ...SHARED_DEFS,
      LocatorAnnotation: LOCATOR_ANNOTATION_SCHEMA,
      EncodeOptions: ENCODE_OPTIONS_SCHEMA,
    },
  },
} as const;

export interface AnnotateUrlDeps {
  annotator: Annotator;
  pool: BrowserPool;
}

interface AnnotateUrlInput {
  url?: unknown;
  annotations?: unknown;
  viewport?: unknown;
  fullPage?: unknown;
  waitFor?: unknown;
  output?: unknown;
  encode?: unknown;
}

interface ParsedInput {
  url: string;
  annotations: readonly LocatorAnnotation[];
  viewport: ViewportOptions | undefined;
  fullPage: boolean;
  waitFor: "load" | "domcontentloaded" | "networkidle";
  output: string | undefined;
  encode: Partial<EncodeOptions> | undefined;
}

class InvalidAnnotateUrlInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAnnotateUrlInputError";
  }
}

export async function handleAnnotateUrl(
  input: AnnotateUrlInput,
  deps: AnnotateUrlDeps,
): Promise<AnnotateToolResult> {
  try {
    const params = parseInput(input);
    const capture = await capturePage(deps.pool, {
      url: params.url,
      viewport: params.viewport,
      fullPage: params.fullPage,
      waitFor: params.waitFor,
    });
    let resolvedAnnotations: BboxAnnotation[];
    try {
      resolvedAnnotations = await resolveLocatorAnnotations(
        capture.handle.page,
        params.annotations,
      );
    } finally {
      await capture.handle.close();
    }
    const dimensions = readPngDimensions(capture.pngBytes);
    const annotationsSvg = bboxAnnotationsToSvg(resolvedAnnotations);
    const rasterised = deps.annotator.toPng({
      originalDataUrl: `data:image/png;base64,${bytesToBase64(capture.pngBytes)}`,
      annotationsSvg,
      width: dimensions.width,
      height: dimensions.height,
    });
    const encoded = await applyEncodeOptions(rasterised, dimensions, params.encode);
    if (params.output) {
      await writeFile(params.output, encoded.bytes);
      const reasonSuffix = encoded.reason ? `, reason: ${encoded.reason}` : "";
      return {
        content: [
          {
            type: "text",
            text:
              `Wrote ${encoded.bytes.byteLength}-byte ${encoded.chosen.toUpperCase()} to ${params.output} ` +
              `(${encoded.width}×${encoded.height}, ` +
              `${params.annotations.length} annotation${
                params.annotations.length === 1 ? "" : "s"
              }, captured from ${params.url}${reasonSuffix}).`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "image",
          data: bytesToBase64(encoded.bytes),
          mimeType: encoded.mimeType,
        },
      ],
    };
  } catch (err) {
    return errorResult(err);
  }
}

// ─── helpers ────────────────────────────────────────────────────

function parseInput(input: AnnotateUrlInput): ParsedInput {
  if (typeof input.url !== "string" || input.url.length === 0) {
    throw new InvalidAnnotateUrlInputError("`url` is required and must be a non-empty string.");
  }
  if (!Array.isArray(input.annotations)) {
    throw new InvalidAnnotateUrlInputError("`annotations` is required and must be an array.");
  }
  const annotations = input.annotations as readonly LocatorAnnotation[];

  let viewport: ViewportOptions | undefined;
  if (input.viewport !== undefined) {
    if (typeof input.viewport !== "object" || input.viewport === null) {
      throw new InvalidAnnotateUrlInputError("`viewport` must be an object when provided.");
    }
    const vp = input.viewport as Record<string, unknown>;
    const width = typeof vp.width === "number" ? vp.width : 1280;
    const height = typeof vp.height === "number" ? vp.height : 800;
    const deviceScaleFactor = typeof vp.deviceScaleFactor === "number" ? vp.deviceScaleFactor : 1;
    viewport = { width, height, deviceScaleFactor };
  }

  const fullPage = input.fullPage === true;
  const waitFor =
    input.waitFor === "domcontentloaded" || input.waitFor === "networkidle"
      ? input.waitFor
      : "load";

  let output: string | undefined;
  if (input.output !== undefined) {
    if (typeof input.output !== "string") {
      throw new InvalidAnnotateUrlInputError("`output` must be a string when provided.");
    }
    if (!isAbsolute(input.output)) {
      throw new InvalidAnnotateUrlInputError(`\`output\` path "${input.output}" must be absolute.`);
    }
    output = input.output;
  }

  let encode: Partial<EncodeOptions> | undefined;
  if (input.encode !== undefined) {
    if (typeof input.encode !== "object" || input.encode === null) {
      throw new InvalidAnnotateUrlInputError("`encode` must be an object when provided.");
    }
    encode = input.encode as Partial<EncodeOptions>;
  }

  return {
    url: input.url,
    annotations,
    viewport,
    fullPage,
    waitFor,
    output,
    encode,
  };
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
