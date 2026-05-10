/**
 * Phase 9a of `docs/plans/annot-html-document.md` — three
 * package-resident starter templates (`manual`, `feature-guide`,
 * `procedure`) that fill the picker's "Built-in" section once
 * the host wires them through (Phase 9b).
 *
 * Each template is constructed as an `AnnotDocument` literal in
 * TypeScript and serialised to canonical `.annot.html` bytes at
 * module load via `serializeDocument`. This avoids:
 *
 *   - The need for hand-tuned canonical-form HTML strings
 *     (attribute ordering, indentation, sidecar key sorting are
 *     all serialiser concerns we don't want to duplicate here).
 *   - A separate codegen step that reads `.annot.html` files at
 *     build time. Vite's `?raw` import would work for the web
 *     build but not the Node `vitest` environment, and adding a
 *     plugin that reconciles both is more moving parts than
 *     this approach needs.
 *
 * The TypeScript literals ARE the source of truth. Storybook /
 * Phase 8c picker integration consume `BUILTIN_TEMPLATES[i].source`
 * directly. Round-trip equivalence (parse → serialize → bytes
 * unchanged) is asserted by `builtin-templates.test.ts`, so
 * regressions in either the structures or the serialiser will
 * flag immediately.
 *
 * Structural conventions all three starters share:
 *
 *   - English bracketed-placeholder copy (`[Title]`,
 *     `[Add an overview here]`, `[Step name]`, …) so users
 *     immediately see what to fill in.
 *   - One generic placeholder `ImageBlock` with the dashed-
 *     border "Drop screenshot here" SVG. Same SVG bytes reused
 *     across all three templates.
 *   - `meta.template = { name, description, tags? }` — the
 *     three template markers the parser / serialiser
 *     round-trip (Phase 1 + Phase 8a). The `description` shows
 *     in the picker card; tags drive the future filter chips.
 *   - Optional `meta.imageMeta[<id>] = { alt }` so per-image
 *     accessibility metadata is preserved across the
 *     `cloneTemplate` round-trip.
 */

import { serializeDocument } from "./serialize.js";
import type { AnnotDocument } from "./types.js";
import { ANNOT_DOC_VERSION } from "./types.js";

/** Stable ID for the "Drop screenshot here" image block. Same
 *  value across all three starters because they're separate
 *  documents — the IDs only need to be unique inside one
 *  `AnnotDocument`. After `cloneTemplate` runs they're reminted
 *  anyway. */
const PLACEHOLDER_IMAGE_ID = "img-placeholder";

/** Generic dashed-border placeholder SVG. Authored as a
 *  single line (no internal `\n`) so the parser's canonicaliser
 *  doesn't reformat it across the round-trip — a `<text>` child
 *  triggers the parser's "mixed content" branch that
 *  serialises through `innerHTML`, and innerHTML eats any
 *  whitespace we'd inject for readability. The same SVG bytes
 *  ride along in all three starters' image blocks. */
const PLACEHOLDER_SVG =
  '<svg data-annot-version="1" viewBox="0 0 800 450" width="800" height="450" xmlns="http://www.w3.org/2000/svg">' +
  '<rect fill="none" height="410" stroke="#9ca3af" stroke-dasharray="8 6" stroke-width="2" width="760" x="20" y="20"></rect>' +
  '<text fill="#6b7280" font-family="Annot Sans" font-size="20" text-anchor="middle" x="400" y="225">Drop screenshot here</text>' +
  '<g id="annotations"></g>' +
  "</svg>";

const PLACEHOLDER_ALT = "Placeholder for a screenshot. Replace by clicking and uploading.";

/** Identifier for one bundled starter. The format spec sets no
 *  constraints; we use lowercase kebab-case so they read as
 *  proper identifiers in URLs / `data-*` attributes. */
export type BuiltinTemplateId = "manual" | "feature-guide" | "procedure";

/** One bundled starter ready to feed into the picker. */
export interface BuiltinTemplateSummary {
  /** Stable id; matches the picker's `BuiltinTemplateEntry.id`
   *  field so the recently-used + selection event payloads
   *  resolve cleanly. */
  readonly id: BuiltinTemplateId;
  /** Display name shown in the picker card title. Mirrors
   *  `meta.template.name` for the resulting cloned document. */
  readonly title: string;
  /** Short hover-blurb shown under the title. */
  readonly description: string;
  /** Canonical `.annot.html` source bytes. Used directly as
   *  the `kind: "builtin"` selection's clone source — no
   *  storage round-trip needed. */
  readonly source: string;
}

// ───────────────────────────────────────────────────────────────
// Manual — step-by-step end-user manual.
// ───────────────────────────────────────────────────────────────

const MANUAL_DOC: AnnotDocument = {
  version: ANNOT_DOC_VERSION,
  lang: "en",
  title: "Manual",
  meta: {
    title: "Manual",
    template: {
      name: "Manual",
      description: "Step-by-step starter for end-user manuals.",
      tags: ["manual", "starter"],
    },
    imageMeta: {
      [PLACEHOLDER_IMAGE_ID]: { alt: PLACEHOLDER_ALT },
    },
  },
  styleBlock: null,
  blocks: [
    { kind: "heading", level: 1, inlineHtml: "[Manual title]" },
    {
      kind: "paragraph",
      inlineHtml: "[One-line summary of what this manual covers and who it's for.]",
    },
    { kind: "heading", level: 2, inlineHtml: "Overview" },
    {
      kind: "paragraph",
      inlineHtml:
        "[Describe the manual's purpose, the audience, and what they'll be able to do after reading.]",
    },
    { kind: "heading", level: 2, inlineHtml: "Step 1 — [Step name]" },
    {
      kind: "paragraph",
      inlineHtml: "[What to do, in plain language. Replace the screenshot below.]",
    },
    {
      kind: "image",
      id: PLACEHOLDER_IMAGE_ID,
      svg: PLACEHOLDER_SVG,
      caption: "[Optional caption for this step.]",
    },
    { kind: "heading", level: 2, inlineHtml: "Step 2 — [Step name]" },
    {
      kind: "paragraph",
      inlineHtml: "[What to do.]",
    },
    { kind: "heading", level: 2, inlineHtml: "Next steps" },
    {
      kind: "paragraph",
      inlineHtml:
        "[Where to go from here — links to related guides, escalation paths, or follow-up tasks.]",
    },
  ],
};

// ───────────────────────────────────────────────────────────────
// Feature guide — marketing-shaped walkthrough.
// ───────────────────────────────────────────────────────────────

const FEATURE_GUIDE_DOC: AnnotDocument = {
  version: ANNOT_DOC_VERSION,
  lang: "en",
  title: "Feature guide",
  meta: {
    title: "Feature guide",
    template: {
      name: "Feature guide",
      description: "Marketing-shaped walkthrough for a single feature.",
      tags: ["feature", "starter"],
    },
    imageMeta: {
      [PLACEHOLDER_IMAGE_ID]: { alt: PLACEHOLDER_ALT },
    },
  },
  styleBlock: null,
  blocks: [
    { kind: "heading", level: 1, inlineHtml: "[Feature name]" },
    {
      kind: "paragraph",
      inlineHtml:
        "[One-paragraph elevator pitch — what the feature does, who it's for, why it matters.]",
    },
    { kind: "heading", level: 2, inlineHtml: "How it works" },
    {
      kind: "paragraph",
      inlineHtml:
        "[Walk through the feature's mechanism in plain English. Annotate the screenshot below to highlight the key UI elements.]",
    },
    {
      kind: "image",
      id: PLACEHOLDER_IMAGE_ID,
      svg: PLACEHOLDER_SVG,
    },
    { kind: "heading", level: 2, inlineHtml: "Try it yourself" },
    {
      kind: "list",
      ordered: false,
      listStyle: "disc",
      items: ["[First thing to try.]", "[Second thing to try.]", "[Third thing to try.]"],
    },
    { kind: "heading", level: 2, inlineHtml: "Where to learn more" },
    {
      kind: "paragraph",
      inlineHtml: "[Add links to deeper documentation or related features.]",
    },
  ],
};

// ───────────────────────────────────────────────────────────────
// Procedure — numbered runbook for an operational task.
// ───────────────────────────────────────────────────────────────

const PROCEDURE_DOC: AnnotDocument = {
  version: ANNOT_DOC_VERSION,
  lang: "en",
  title: "Procedure",
  meta: {
    title: "Procedure",
    template: {
      name: "Procedure",
      description: "Numbered runbook for an operational task.",
      tags: ["procedure", "runbook", "starter"],
    },
    imageMeta: {
      [PLACEHOLDER_IMAGE_ID]: { alt: PLACEHOLDER_ALT },
    },
  },
  styleBlock: null,
  blocks: [
    { kind: "heading", level: 1, inlineHtml: "[Procedure name]" },
    {
      kind: "callout",
      tone: "info",
      paragraphs: [
        "<strong>Run when:</strong> [Trigger condition or schedule.]",
        "<strong>Run as:</strong> [Role or service account.]",
      ],
    },
    { kind: "heading", level: 2, inlineHtml: "Prerequisites" },
    {
      kind: "list",
      ordered: false,
      listStyle: "disc",
      items: ["[First prerequisite.]", "[Second prerequisite.]"],
    },
    { kind: "heading", level: 2, inlineHtml: "Procedure" },
    {
      kind: "list",
      ordered: true,
      listStyle: "decimal",
      items: ["[First step.]", "[Second step.]", "[Third step.]"],
    },
    { kind: "heading", level: 2, inlineHtml: "Verification" },
    {
      kind: "paragraph",
      inlineHtml:
        "[How to confirm the procedure succeeded. Annotate the screenshot below to point at the success indicator.]",
    },
    {
      kind: "image",
      id: PLACEHOLDER_IMAGE_ID,
      svg: PLACEHOLDER_SVG,
    },
    { kind: "heading", level: 2, inlineHtml: "Rollback" },
    {
      kind: "paragraph",
      inlineHtml: "[If something goes wrong, do this. Include the smallest viable rollback first.]",
    },
  ],
};

// ───────────────────────────────────────────────────────────────
// Public exports.
// ───────────────────────────────────────────────────────────────

/**
 * Three package-resident starter templates. Order matches the
 * order they should appear in the picker's built-in section
 * (most-general first).
 *
 * Each entry's `source` is canonical `.annot.html` bytes
 * produced by `serializeDocument` — round-trip equivalent to
 * the document literal above. The picker's `kind: "builtin"`
 * selection branch hands the source string to `parseDocument`
 * + `cloneTemplate` exactly like a user-template path would,
 * just skipping the storage fetch since the source is already
 * in memory.
 */
export const BUILTIN_TEMPLATES: readonly BuiltinTemplateSummary[] = [
  {
    id: "manual",
    title: MANUAL_DOC.meta.template?.name ?? "Manual",
    description: MANUAL_DOC.meta.template?.description ?? "",
    source: serializeDocument(MANUAL_DOC),
  },
  {
    id: "feature-guide",
    title: FEATURE_GUIDE_DOC.meta.template?.name ?? "Feature guide",
    description: FEATURE_GUIDE_DOC.meta.template?.description ?? "",
    source: serializeDocument(FEATURE_GUIDE_DOC),
  },
  {
    id: "procedure",
    title: PROCEDURE_DOC.meta.template?.name ?? "Procedure",
    description: PROCEDURE_DOC.meta.template?.description ?? "",
    source: serializeDocument(PROCEDURE_DOC),
  },
];

/** Look up a built-in starter by id. Returns `undefined` for
 *  unknown ids; callers (the picker selection branch) treat
 *  this as a "template not found" error path. */
export function getBuiltinTemplate(id: string): BuiltinTemplateSummary | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}
