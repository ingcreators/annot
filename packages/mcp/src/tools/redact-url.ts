// `annot_redact_url` — capture a URL, resolve locator-based regions
// to bboxes, burn the redactions destructively. Phase 4 of
// `docs/plans/agent-mcp-integration.md`.

import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { capturePage, type ViewportOptions } from "../browser/capture.js";
import type { BrowserPool } from "../browser/pool.js";
import { resolveLocator } from "../browser/resolve-locator.js";
import { LOCATOR_REDACT_REGION_SCHEMA, SHARED_DEFS } from "../dsl/schema.js";
import type { BBox, LocatorRedactRegion, RedactStyle } from "../dsl/types.js";
import { burnRedactions, type RedactRegion } from "../redact/burn.js";
import type { AnnotateToolResult } from "./annotate-screenshot.js";

export const REDACT_URL_TOOL_NAME = "annot_redact_url";

export const redactUrlTool = {
  name: REDACT_URL_TOOL_NAME,
  description:
    "Open a URL in a headless browser, capture a screenshot, and " +
    "destructively burn redactions over regions identified by locator " +
    "strings or bboxes. Returns the redacted PNG inline unless " +
    "`output` is specified.",
  inputSchema: {
    type: "object",
    required: ["url", "regions"],
    additionalProperties: false,
    properties: {
      url: { type: "string", format: "uri" },
      regions: {
        type: "array",
        items: { $ref: "#/$defs/LocatorRedactRegion" },
      },
      viewport: {
        type: "object",
        additionalProperties: false,
        properties: {
          width: { type: "integer", minimum: 1, default: 1280 },
          height: { type: "integer", minimum: 1, default: 800 },
          deviceScaleFactor: { type: "number", minimum: 0.1, default: 1 },
        },
      },
      fullPage: { type: "boolean", default: false },
      waitFor: {
        type: "string",
        enum: ["load", "domcontentloaded", "networkidle"],
        default: "load",
      },
      output: { type: "string" },
    },
    $defs: {
      ...SHARED_DEFS,
      LocatorRedactRegion: LOCATOR_REDACT_REGION_SCHEMA,
    },
  },
} as const;

export interface RedactUrlDeps {
  pool: BrowserPool;
}

interface RedactUrlInput {
  url?: unknown;
  regions?: unknown;
  viewport?: unknown;
  fullPage?: unknown;
  waitFor?: unknown;
  output?: unknown;
}

class InvalidRedactUrlInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRedactUrlInputError";
  }
}

export async function handleRedactUrl(
  input: RedactUrlInput,
  deps: RedactUrlDeps,
): Promise<AnnotateToolResult> {
  try {
    const params = parseInput(input);
    const capture = await capturePage(deps.pool, {
      url: params.url,
      viewport: params.viewport,
      fullPage: params.fullPage,
      waitFor: params.waitFor,
    });
    let resolvedRegions: RedactRegion[];
    try {
      resolvedRegions = [];
      for (const region of params.regions) {
        const bbox = await resolveRegionBbox(capture.handle.page, region);
        const entry: RedactRegion = { bbox };
        if (region.style !== undefined) entry.style = region.style;
        if (region.color !== undefined) entry.color = region.color;
        resolvedRegions.push(entry);
      }
    } finally {
      await capture.handle.close();
    }
    const redactedBytes = await burnRedactions(capture.pngBytes, resolvedRegions);

    if (params.output) {
      await writeFile(params.output, redactedBytes);
      return {
        content: [
          {
            type: "text",
            text:
              `Wrote ${redactedBytes.byteLength}-byte redacted PNG to ${params.output} ` +
              `(${params.regions.length} region${
                params.regions.length === 1 ? "" : "s"
              }, captured from ${params.url}).`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "image",
          data: Buffer.from(
            redactedBytes.buffer,
            redactedBytes.byteOffset,
            redactedBytes.byteLength,
          ).toString("base64"),
          mimeType: "image/png",
        },
      ],
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

// ─── helpers ────────────────────────────────────────────────────

interface ParsedInput {
  url: string;
  regions: readonly LocatorRedactRegion[];
  viewport: ViewportOptions | undefined;
  fullPage: boolean;
  waitFor: "load" | "domcontentloaded" | "networkidle";
  output: string | undefined;
}

function parseInput(input: RedactUrlInput): ParsedInput {
  if (typeof input.url !== "string" || input.url.length === 0) {
    throw new InvalidRedactUrlInputError("`url` is required and must be a non-empty string.");
  }
  if (!Array.isArray(input.regions)) {
    throw new InvalidRedactUrlInputError("`regions` is required and must be an array.");
  }
  const regions = input.regions as readonly LocatorRedactRegion[];

  let viewport: ViewportOptions | undefined;
  if (input.viewport !== undefined) {
    if (typeof input.viewport !== "object" || input.viewport === null) {
      throw new InvalidRedactUrlInputError("`viewport` must be an object when provided.");
    }
    const vp = input.viewport as Record<string, unknown>;
    const width = typeof vp.width === "number" ? vp.width : 1280;
    const height = typeof vp.height === "number" ? vp.height : 800;
    const deviceScaleFactor = typeof vp.deviceScaleFactor === "number" ? vp.deviceScaleFactor : 1;
    viewport = { width, height, deviceScaleFactor };
  }
  const fullPage = input.fullPage === true;
  const waitFor: "load" | "domcontentloaded" | "networkidle" =
    input.waitFor === "domcontentloaded" || input.waitFor === "networkidle"
      ? input.waitFor
      : "load";

  let output: string | undefined;
  if (input.output !== undefined) {
    if (typeof input.output !== "string") {
      throw new InvalidRedactUrlInputError("`output` must be a string when provided.");
    }
    if (!isAbsolute(input.output)) {
      throw new InvalidRedactUrlInputError(`\`output\` path "${input.output}" must be absolute.`);
    }
    output = input.output;
  }
  return { url: input.url, regions, viewport, fullPage, waitFor, output };
}

async function resolveRegionBbox(
  page: { locator(s: string): { boundingBox(): Promise<BBox | null> } },
  region: LocatorRedactRegion,
): Promise<BBox> {
  if (region.bbox !== undefined) return region.bbox;
  if (region.locator !== undefined) return resolveLocator(page, region.locator);
  throw new InvalidRedactUrlInputError("redact region requires either `bbox` or `locator`.");
}

// Reference the RedactStyle import so the type is preserved in `.d.ts`
// emit for downstream callers that need the union literal.
export type RedactRegionStyle = RedactStyle;
