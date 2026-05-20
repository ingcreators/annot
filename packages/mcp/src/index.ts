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
export { runStdioServer } from "./transport.js";
