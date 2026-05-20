// `annot_redact_screenshot` — destructively burn redactions into a
// pre-captured PNG. Phase 4 of
// `docs/plans/agent-mcp-integration.md`.

import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { EncodeOptions } from "@ingcreators/annot-annotator";

import { BBOX_REDACT_REGION_SCHEMA, ENCODE_OPTIONS_SCHEMA, SHARED_DEFS } from "../dsl/schema.js";
import type { BboxRedactRegion } from "../dsl/types.js";
import { applyEncodeOptions } from "../io/encode-output.js";
import { resolveImageInput } from "../io/read-image.js";
import { burnRedactions } from "../redact/burn.js";
import type { AnnotateToolResult } from "./annotate-screenshot.js";

export const REDACT_SCREENSHOT_TOOL_NAME = "annot_redact_screenshot";

export const redactScreenshotTool = {
  name: REDACT_SCREENSHOT_TOOL_NAME,
  description:
    "Destructively burn redactions (solid / mosaic / blur) into a PNG " +
    "screenshot. The original pixels under each region are " +
    "irrecoverably replaced. Returns the redacted PNG inline unless " +
    "`output` is specified.",
  inputSchema: {
    type: "object",
    required: ["image", "regions"],
    additionalProperties: false,
    properties: {
      image: {
        type: "string",
        description: "`data:image/png;base64,...` URL or absolute filesystem path.",
      },
      regions: {
        type: "array",
        items: { $ref: "#/$defs/BboxRedactRegion" },
      },
      output: { type: "string" },
      encode: {
        $ref: "#/$defs/EncodeOptions",
        description:
          "Optional encoder settings applied after the redactions are " +
          "burned in. Useful when the redacted screenshot is destined for " +
          "an issue tracker / docs and size matters.",
      },
    },
    $defs: {
      ...SHARED_DEFS,
      BboxRedactRegion: BBOX_REDACT_REGION_SCHEMA,
      EncodeOptions: ENCODE_OPTIONS_SCHEMA,
    },
  },
} as const;

interface RedactScreenshotInput {
  image?: unknown;
  regions?: unknown;
  output?: unknown;
  encode?: unknown;
}

class InvalidRedactInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRedactInputError";
  }
}

export async function handleRedactScreenshot(
  input: RedactScreenshotInput,
): Promise<AnnotateToolResult> {
  try {
    if (typeof input.image !== "string") {
      throw new InvalidRedactInputError("`image` is required and must be a string.");
    }
    if (!Array.isArray(input.regions)) {
      throw new InvalidRedactInputError("`regions` is required and must be an array.");
    }
    const regions = input.regions as readonly BboxRedactRegion[];

    let output: string | undefined;
    if (input.output !== undefined) {
      if (typeof input.output !== "string") {
        throw new InvalidRedactInputError("`output` must be a string when provided.");
      }
      if (!isAbsolute(input.output)) {
        throw new InvalidRedactInputError(`\`output\` path "${input.output}" must be absolute.`);
      }
      output = input.output;
    }

    let encode: Partial<EncodeOptions> | undefined;
    if (input.encode !== undefined) {
      if (typeof input.encode !== "object" || input.encode === null) {
        throw new InvalidRedactInputError("`encode` must be an object when provided.");
      }
      encode = input.encode as Partial<EncodeOptions>;
    }

    const resolved = await resolveImageInput(input.image);
    const redactedBytes = await burnRedactions(resolved.bytes, regions);
    const encoded = await applyEncodeOptions(redactedBytes, resolved.dimensions, encode);

    if (output) {
      await writeFile(output, encoded.bytes);
      const reasonSuffix = encoded.reason ? `, reason: ${encoded.reason}` : "";
      return {
        content: [
          {
            type: "text",
            text:
              `Wrote ${encoded.bytes.byteLength}-byte redacted ${encoded.chosen.toUpperCase()} to ${output} ` +
              `(${encoded.width}×${encoded.height}, ` +
              `${regions.length} region${regions.length === 1 ? "" : "s"}${reasonSuffix}).`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "image",
          data: Buffer.from(
            encoded.bytes.buffer,
            encoded.bytes.byteOffset,
            encoded.bytes.byteLength,
          ).toString("base64"),
          mimeType: encoded.mimeType,
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
