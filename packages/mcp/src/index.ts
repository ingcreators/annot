// `@ingcreators/annot-mcp` — Model Context Protocol server
// exposing the Annot headless annotator as agent-callable tools.
//
// Drop into Claude Desktop / Claude Code / Cursor by adding to
// the MCP config:
//
//   {
//     "mcpServers": {
//       "annot": { "command": "npx", "args": ["@ingcreators/annot-mcp"] }
//     }
//   }
//
// See `docs/plans/agent-mcp-integration.md` for the full design.

export {
  type CapturePageOptions,
  type CapturePageResult,
  capturePage,
  type PageHandle,
  type ViewportOptions,
} from "./browser/capture.js";
// Browser pool + locator resolution (Phase 3a infrastructure).
// Used internally by `annot_annotate_url` and `annot_redact_url`
// (Phases 3b + 4). Re-exported so embedders can drive the same
// infrastructure for custom MCP surfaces.
export {
  type BrowserLauncher,
  type BrowserLike,
  BrowserPool,
  type BrowserPoolOptions,
  ChromiumUnavailableError,
  createChromiumPool,
} from "./browser/pool.js";
export {
  type LocatorLike,
  LocatorResolutionError,
  type PageLike,
  resolveLocator,
  resolveLocatorAnnotation,
  resolveLocatorAnnotations,
} from "./browser/resolve-locator.js";
// JSON Schemas — for downstream tooling that wants to validate
// agent payloads outside the MCP request handler (e.g. tests).
export {
  BBOX_ANNOTATION_SCHEMA,
  BBOX_REDACT_REGION_SCHEMA,
  LOCATOR_ANNOTATION_SCHEMA,
  LOCATOR_REDACT_REGION_SCHEMA,
  SHARED_DEFS,
} from "./dsl/schema.js";
// DSL → SVG conversion — used by `_screenshot` tool implementations.
export { bboxAnnotationsToSvg } from "./dsl/to-svg.js";
// DSL types — agent-facing wire format.
export type {
  AnnotationStyle,
  BBox,
  BboxAnnotation,
  BboxArrowAnnotation,
  BboxCalloutAnnotation,
  BboxCircleAnnotation,
  BboxRectAnnotation,
  BboxRedactRegion,
  BboxTextAnnotation,
  Intent,
  Locator,
  LocatorAnnotation,
  LocatorArrowAnnotation,
  LocatorCalloutAnnotation,
  LocatorCircleAnnotation,
  LocatorRectAnnotation,
  LocatorRedactRegion,
  LocatorTextAnnotation,
  Point,
  RawAnnotation,
  RedactStyle,
} from "./dsl/types.js";
export {
  InvalidPngError,
  type PngDimensions,
  readPngDimensions,
} from "./io/png-dimensions.js";
// Image input helpers — also reusable from tests.
export {
  InvalidImageInputError,
  type ResolvedImage,
  resolveImageInput,
} from "./io/read-image.js";
export { burnRedactions, type RedactRegion } from "./redact/burn.js";
// Server factory + transport — embedding callers can construct
// the server in-process instead of going through the bin.
export { type CreateServerOptions, createServer } from "./server.js";
// Per-tool descriptors. Currently a single tool; new entries
// land as their phases ship.
export {
  ANNOTATE_SCREENSHOT_TOOL_NAME,
  type AnnotateToolResult,
  annotateScreenshotTool,
  handleAnnotateScreenshot,
} from "./tools/annotate-screenshot.js";
export {
  ANNOTATE_URL_TOOL_NAME,
  annotateUrlTool,
  handleAnnotateUrl,
} from "./tools/annotate-url.js";
export {
  handleRedactScreenshot,
  REDACT_SCREENSHOT_TOOL_NAME,
  redactScreenshotTool,
} from "./tools/redact-screenshot.js";
export {
  handleRedactUrl,
  REDACT_URL_TOOL_NAME,
  redactUrlTool,
} from "./tools/redact-url.js";
export { runStdioServer } from "./transport.js";
