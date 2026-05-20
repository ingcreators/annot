// JSON Schema literals for the bbox-flavour DSL. Plain JSON-shaped
// objects (not `as const` types) because consumers typically
// inline them into a tool's `inputSchema` block and let Ajv
// validate at the boundary.
//
// `LocatorAnnotation` / `LocatorRedactRegion` schemas live in
// `@ingcreators/annot-mcp` — they reference `$defs` from
// `SHARED_DEFS` here, which the MCP server spreads into its tool
// inputSchemas at registration time.

/** Common subschemas to spread into a tool's `$defs` block. */
export const SHARED_DEFS = {
  BBox: {
    type: "object",
    required: ["x", "y", "width", "height"],
    additionalProperties: false,
    properties: {
      x: { type: "number" },
      y: { type: "number" },
      width: { type: "number", minimum: 0 },
      height: { type: "number", minimum: 0 },
    },
  },
  Point: {
    type: "object",
    required: ["x", "y"],
    additionalProperties: false,
    properties: {
      x: { type: "number" },
      y: { type: "number" },
    },
  },
  Intent: {
    type: "string",
    enum: ["info", "warning", "error", "success", "neutral"],
  },
  AnnotationStyle: {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: { $ref: "#/$defs/Intent" },
      stroke: { type: "string" },
      strokeWidth: { type: "number", minimum: 0 },
      fill: { type: "string" },
      color: { type: "string" },
    },
  },
};

// ─── BboxAnnotation schema ───────────────────────────────────────

const BBOX_RECT = {
  type: "object",
  required: ["type", "bbox"],
  additionalProperties: false,
  properties: {
    type: { const: "rect" },
    bbox: { $ref: "#/$defs/BBox" },
    intent: { $ref: "#/$defs/Intent" },
    stroke: { type: "string" },
    strokeWidth: { type: "number", minimum: 0 },
    fill: { type: "string" },
    color: { type: "string" },
  },
};

const BBOX_CIRCLE = {
  type: "object",
  required: ["type", "center", "radius"],
  additionalProperties: false,
  properties: {
    type: { const: "circle" },
    center: { $ref: "#/$defs/Point" },
    radius: { type: "number", minimum: 0 },
    intent: { $ref: "#/$defs/Intent" },
    stroke: { type: "string" },
    strokeWidth: { type: "number", minimum: 0 },
    fill: { type: "string" },
    color: { type: "string" },
  },
};

const BBOX_ARROW = {
  type: "object",
  required: ["type", "from", "to"],
  additionalProperties: false,
  properties: {
    type: { const: "arrow" },
    from: { $ref: "#/$defs/Point" },
    to: { $ref: "#/$defs/Point" },
    intent: { $ref: "#/$defs/Intent" },
    stroke: { type: "string" },
    strokeWidth: { type: "number", minimum: 0 },
    color: { type: "string" },
  },
};

const BBOX_TEXT = {
  type: "object",
  required: ["type", "at", "content"],
  additionalProperties: false,
  properties: {
    type: { const: "text" },
    at: { $ref: "#/$defs/Point" },
    content: { type: "string" },
    fontSize: { type: "number", minimum: 0 },
    anchor: { type: "string", enum: ["start", "middle", "end"] },
    intent: { $ref: "#/$defs/Intent" },
    color: { type: "string" },
  },
};

const BBOX_CALLOUT = {
  type: "object",
  required: ["type", "at", "targetBbox", "content"],
  additionalProperties: false,
  properties: {
    type: { const: "callout" },
    at: { $ref: "#/$defs/Point" },
    targetBbox: { $ref: "#/$defs/BBox" },
    content: { type: "string" },
    intent: { $ref: "#/$defs/Intent" },
    stroke: { type: "string" },
    color: { type: "string" },
  },
};

const RAW = {
  type: "object",
  required: ["type", "svgFragment"],
  additionalProperties: false,
  properties: {
    type: { const: "raw" },
    svgFragment: { type: "string" },
  },
};

export const BBOX_ANNOTATION_SCHEMA = {
  oneOf: [BBOX_RECT, BBOX_CIRCLE, BBOX_ARROW, BBOX_TEXT, BBOX_CALLOUT, RAW],
};

// ─── Bbox redact region schema ───────────────────────────────────

export const BBOX_REDACT_REGION_SCHEMA = {
  type: "object",
  required: ["bbox"],
  additionalProperties: false,
  properties: {
    bbox: { $ref: "#/$defs/BBox" },
    style: { type: "string", enum: ["solid", "mosaic", "blur"] },
    color: { type: "string" },
  },
};
