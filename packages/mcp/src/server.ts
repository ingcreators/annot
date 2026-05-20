// `createServer` — factory for the Annot MCP server. Phase 2
// wires the first tool (`annot_annotate_screenshot`) into the
// dispatch; subsequent phases add more entries to the
// `TOOL_REGISTRY` array and a matching case in the `tools/call`
// handler:
//
//   Phase 2  → `annot_annotate_screenshot`          ← LANDED
//   Phase 3b → `annot_annotate_url`
//   Phase 4  → `annot_redact_screenshot` + `annot_redact_url`
//   Phase 5  → `annot_compare_screenshots`
//   Phase 6  → `annot_export_pptx` (gated)
//
// The handler dispatch stays a one-line `switch` on tool name —
// new tools land as one registry entry + one switch case + a
// handler module under `tools/`.

import {
  type Annotator,
  type AnnotatorOptions,
  createAnnotator,
} from "@ingcreators/annot-annotator";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { type BrowserPool, createChromiumPool } from "./browser/pool.js";
import {
  ANNOTATE_SCREENSHOT_TOOL_NAME,
  type AnnotateToolResult,
  annotateScreenshotTool,
  handleAnnotateScreenshot,
} from "./tools/annotate-screenshot.js";
import {
  ANNOTATE_URL_TOOL_NAME,
  annotateUrlTool,
  handleAnnotateUrl,
} from "./tools/annotate-url.js";
import {
  COMPARE_SCREENSHOTS_TOOL_NAME,
  compareScreenshotsTool,
  handleCompareScreenshots,
} from "./tools/compare-screenshots.js";
import {
  handleRedactScreenshot,
  REDACT_SCREENSHOT_TOOL_NAME,
  redactScreenshotTool,
} from "./tools/redact-screenshot.js";
import { handleRedactUrl, REDACT_URL_TOOL_NAME, redactUrlTool } from "./tools/redact-url.js";

export interface CreateServerOptions {
  /**
   * Override the version reported in the MCP `initialize` response.
   * Defaults to the package version baked at build time. Mostly
   * useful for tests that want a deterministic version string.
   */
  version?: string;
  /**
   * Inject a pre-built annotator. Tests pass a stub here to avoid
   * loading resvg-js's native rasteriser; production callers omit
   * the field and let the server construct one with default
   * options.
   */
  annotator?: Annotator;
  /**
   * Forwarded to `createAnnotator()` when `annotator` is omitted.
   * Lets the host opt into system fonts or register a custom font
   * set without subclassing the server.
   */
  annotatorOptions?: AnnotatorOptions;
  /**
   * Inject a pre-built browser pool. Tests pass a stub to skip the
   * Chromium launch; production callers omit the field and let
   * the server construct a `createChromiumPool()` lazily.
   */
  pool?: BrowserPool;
}

const SERVER_NAME = "annot-mcp";
const DEFAULT_VERSION = "0.1.0";

const TOOL_REGISTRY = [
  annotateScreenshotTool,
  annotateUrlTool,
  redactScreenshotTool,
  redactUrlTool,
  compareScreenshotsTool,
] as const;

/**
 * Construct an MCP server instance with the Annot tool surface.
 */
export function createServer(options: CreateServerOptions = {}): Server {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: options.version ?? DEFAULT_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const annotator = options.annotator ?? createAnnotator(options.annotatorOptions ?? {});
  // The pool launches Chromium lazily on first `_url` tool call,
  // so constructing it here is cheap. Tests inject a stub to
  // sidestep the actual launch.
  const pool = options.pool ?? createChromiumPool();

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOL_REGISTRY as unknown as (typeof TOOL_REGISTRY)[number][] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    let result: AnnotateToolResult;
    switch (name) {
      case ANNOTATE_SCREENSHOT_TOOL_NAME:
        result = await handleAnnotateScreenshot(args ?? {}, { annotator });
        break;
      case ANNOTATE_URL_TOOL_NAME:
        result = await handleAnnotateUrl(args ?? {}, { annotator, pool });
        break;
      case REDACT_SCREENSHOT_TOOL_NAME:
        result = await handleRedactScreenshot(args ?? {});
        break;
      case REDACT_URL_TOOL_NAME:
        result = await handleRedactUrl(args ?? {}, { pool });
        break;
      case COMPARE_SCREENSHOTS_TOOL_NAME:
        result = await handleCompareScreenshots(args ?? {}, { annotator });
        break;
      default:
        result = {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
    // The SDK's `CallToolResult` union also covers async-task
    // responses we don't emit. Cast through `unknown` so TS
    // accepts our narrower synchronous shape against the wider
    // union. Runtime serialisation is identical.
    return result as unknown as Awaited<ReturnType<typeof handleAnnotateScreenshot>> & {
      [key: string]: unknown;
    };
  });

  return server;
}
