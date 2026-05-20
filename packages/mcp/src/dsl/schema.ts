// JSON Schema literals for the Locator-flavour DSL. References
// `$defs/BBox` / `$defs/Point` / `$defs/Intent` /
// `$defs/AnnotationStyle` from `SHARED_DEFS` in
// `@ingcreators/annot-annotator` — tools spread both sets into
// their own `$defs` block at registration time.
//
// Bbox-flavour schemas (`SHARED_DEFS`, `BBOX_ANNOTATION_SCHEMA`,
// `BBOX_REDACT_REGION_SCHEMA`) live in
// `@ingcreators/annot-annotator` since v0.2.0; re-exported here
// so consumers that only depend on `@ingcreators/annot-mcp`
// still see the full schema surface via one import.

import { SHARED_DEFS as ANNOTATOR_SHARED_DEFS } from "@ingcreators/annot-annotator";

export {
  BBOX_ANNOTATION_SCHEMA,
  BBOX_REDACT_REGION_SCHEMA,
} from "@ingcreators/annot-annotator";

/**
 * `$defs` to spread into every MCP tool inputSchema. Combines the
 * annotator's bbox-flavour `SHARED_DEFS` (`BBox`, `Point`,
 * `Intent`, `AnnotationStyle`) with the mcp-only `Locator` shape
 * referenced by every `LOCATOR_*` schema in this file.
 */
export const SHARED_DEFS = {
  ...ANNOTATOR_SHARED_DEFS,
  Locator: { type: "string", minLength: 1 },
};

// ─── LocatorAnnotation schema ────────────────────────────────────
//
// JSON Schema can't express "exactly one of A | B is required"
// cleanly without `oneOf` over near-duplicates. We use `anyOf` for
// the locator-or-coordinate constraint to keep the schema readable;
// runtime validation in the resolver enforces the stricter
// "exactly one" rule.

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

const RAW = {
  type: "object",
  required: ["type", "svgFragment"],
  additionalProperties: false,
  properties: {
    type: { const: "raw" },
    svgFragment: { type: "string" },
  },
};

export const LOCATOR_ANNOTATION_SCHEMA = {
  oneOf: [LOCATOR_RECT, LOCATOR_CIRCLE, LOCATOR_ARROW, LOCATOR_TEXT, LOCATOR_CALLOUT, RAW],
};

// ─── Locator redact region schema ────────────────────────────────

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
