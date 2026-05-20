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
// Phase 1 ships the scaffold — package boundary, DSL types,
// DSL → SVG converter, and a do-nothing server. Tools start
// landing in Phase 2.
//
// See `docs/plans/agent-mcp-integration.md` for the full design.

// JSON Schemas — for MCP `inputSchema` references in tool
// registrations.
export {
  BBOX_ANNOTATION_SCHEMA,
  BBOX_REDACT_REGION_SCHEMA,
  LOCATOR_ANNOTATION_SCHEMA,
  LOCATOR_REDACT_REGION_SCHEMA,
  SHARED_DEFS,
} from "./dsl/schema.js";
// DSL → SVG conversion — used by `_screenshot` tool implementations
// in Phase 2+.
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
// Server factory + transport — embedding callers can construct
// the server in-process instead of going through the bin.
export { type CreateServerOptions, createServer } from "./server.js";
export { runStdioServer } from "./transport.js";
