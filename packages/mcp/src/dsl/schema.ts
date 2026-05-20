// JSON Schema literals for the annotation DSL. These plug into MCP
// `inputSchema` on every tool that accepts annotations / regions
// so MCP clients can validate agent-produced input before it
// reaches our handler.
//
// Authored as plain JSON-shaped objects (no `as const` gymnastics)
// because the MCP SDK accepts an untyped JSON Schema literal and
// runs Ajv on it internally. The companion TypeScript types in
// `types.ts` are the source of truth for our own code; this file
// mirrors them for the agent-facing wire format.
//
// Phase 1 of `docs/plans/agent-mcp-integration.md`. Schemas land
// before tools so future phases (Phase 2 = `annot_annotate_screenshot`,
// Phase 3b = `annot_annotate_url`, Phase 4 = redact) can plug
// these references in without re-authoring the validation surface.

/** Common shared subschemas — referenced from `$defs` in each tool's
 *  inputSchema. Spread these into the tool's `$defs` object at
 *  registration time. */
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
  Locator: { type: "string", minLength: 1 },
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

// ─── LocatorAnnotation schema ────────────────────────────────────
//
// JSON Schema can't express "exactly one of A | B is required"
// cleanly without `oneOf` over near-duplicates. We use `anyOf` for
// the locator-or-coordinate constraint to keep the schema readable;
// runtime validation in `to-svg.ts` (Phase 3b) enforces the
// stricter "exactly one" rule and emits a structured error.

const LOCATOR_RECT = {
  type: "object",
  required: ["type"],
  additionalProperties: false,
  properties: {
    type: { const: "rect" },
    bbox: { $ref: "#/$defs/BBox" },
    locator: { $ref: "#/$defs/Locator" },
    intent: { $ref: "#/$defs/Intent" },
    stroke: { type: "string" },
    strokeWidth: { type: "number", minimum: 0 },
    fill: { type: "string" },
    color: { type: "string" },
  },
  anyOf: [{ required: ["bbox"] }, { required: ["locator"] }],
};

const LOCATOR_CIRCLE = {
  type: "object",
  required: ["type"],
  additionalProperties: false,
  properties: {
    type: { const: "circle" },
    center: { $ref: "#/$defs/Point" },
    radius: { type: "number", minimum: 0 },
    locator: { $ref: "#/$defs/Locator" },
    intent: { $ref: "#/$defs/Intent" },
    stroke: { type: "string" },
    strokeWidth: { type: "number", minimum: 0 },
    fill: { type: "string" },
    color: { type: "string" },
  },
  anyOf: [{ required: ["center", "radius"] }, { required: ["locator"] }],
};

const LOCATOR_ARROW = {
  type: "object",
  required: ["type"],
  additionalProperties: false,
  properties: {
    type: { const: "arrow" },
    from: { $ref: "#/$defs/Point" },
    fromLocator: { $ref: "#/$defs/Locator" },
    to: { $ref: "#/$defs/Point" },
    toLocator: { $ref: "#/$defs/Locator" },
    intent: { $ref: "#/$defs/Intent" },
    stroke: { type: "string" },
    strokeWidth: { type: "number", minimum: 0 },
    color: { type: "string" },
  },
  allOf: [
    { anyOf: [{ required: ["from"] }, { required: ["fromLocator"] }] },
    { anyOf: [{ required: ["to"] }, { required: ["toLocator"] }] },
  ],
};

const LOCATOR_TEXT = {
  type: "object",
  required: ["type", "content"],
  additionalProperties: false,
  properties: {
    type: { const: "text" },
    at: { $ref: "#/$defs/Point" },
    locator: { $ref: "#/$defs/Locator" },
    content: { type: "string" },
    fontSize: { type: "number", minimum: 0 },
    anchor: { type: "string", enum: ["start", "middle", "end"] },
    intent: { $ref: "#/$defs/Intent" },
    color: { type: "string" },
  },
  anyOf: [{ required: ["at"] }, { required: ["locator"] }],
};

const LOCATOR_CALLOUT = {
  type: "object",
  required: ["type", "content"],
  additionalProperties: false,
  properties: {
    type: { const: "callout" },
    at: { $ref: "#/$defs/Point" },
    atLocator: { $ref: "#/$defs/Locator" },
    targetBbox: { $ref: "#/$defs/BBox" },
    targetLocator: { $ref: "#/$defs/Locator" },
    content: { type: "string" },
    intent: { $ref: "#/$defs/Intent" },
    stroke: { type: "string" },
    color: { type: "string" },
  },
  allOf: [
    { anyOf: [{ required: ["at"] }, { required: ["atLocator"] }] },
    { anyOf: [{ required: ["targetBbox"] }, { required: ["targetLocator"] }] },
  ],
};

export const LOCATOR_ANNOTATION_SCHEMA = {
  oneOf: [LOCATOR_RECT, LOCATOR_CIRCLE, LOCATOR_ARROW, LOCATOR_TEXT, LOCATOR_CALLOUT, RAW],
};

// ─── Redact region schemas ───────────────────────────────────────

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

export const LOCATOR_REDACT_REGION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bbox: { $ref: "#/$defs/BBox" },
    locator: { $ref: "#/$defs/Locator" },
    style: { type: "string", enum: ["solid", "mosaic", "blur"] },
    color: { type: "string" },
  },
  anyOf: [{ required: ["bbox"] }, { required: ["locator"] }],
};
