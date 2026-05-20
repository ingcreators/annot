// Remark-based MDX parser for `.mdx` files with `annot:`
// frontmatter. Phase 1 PR 2 of `docs/plans/living-product-docs.md`.
//
// The parser walks the mdast/mdx tree (NOT regex over the source
// text) so:
//   - JSX prop expressions like `match={{ role: "...", under: { ... } }}`
//     are parsed via @mdx-js's estree-jsx grammar, not a hand-rolled
//     regex. Nested object literals and multi-line props work.
//   - Comment blocks like `{/* annot:snapshot ... */}` are visited
//     as `mdxFlowExpression` nodes, so their exact byte range is
//     known and the fixture can rewrite them in-place via
//     `updateCommentBlocks`.
//   - Adding new components later (e.g. `<TransitionTable>`) is
//     one switch-case branch, not a new regex.

import { readFile } from "node:fs/promises";

import yaml from "js-yaml";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import { annotFrontmatterSchema } from "./config.js";
import type {
  AnnotCommentBlocks,
  AnnotFrontmatter,
  HistoryEntrySpec,
  MatchKey,
  OverlaySpec,
  ParsedMdx,
  ScreenListSpec,
  ScreenSpec,
  TransitionSpec,
} from "./types.js";

const SNAPSHOT_OPEN = "annot:snapshot";
const SNAPSHOT_CLOSE = "/annot:snapshot";
const ATTRIBUTES_OPEN = "annot:attributes";
const ATTRIBUTES_CLOSE = "/annot:attributes";

const COMMENT_OPEN_RE = /^\s*\/\*\s*([^\s*]+)\s*([\s\S]*?)\*\/\s*$/;

/**
 * Parse one MDX file from disk. Returns `null` if the file lacks
 * an `annot:` frontmatter block (regular MDX files in customer
 * docs sites pass through untouched).
 */
export async function parseMdxFile(filePath: string): Promise<ParsedMdx | null> {
  const source = await readFile(filePath, "utf8");
  return parseMdx(source, { filePath });
}

export interface ParseMdxOptions {
  /** Used only for error messages; defaults to `<inline>`. */
  filePath?: string;
}

/**
 * Parse an MDX source string. Returns `null` for sources without
 * an `annot:` frontmatter block.
 *
 * Throws if the `annot:` block exists but fails Zod validation —
 * typos in `id` / `xlsx.role` etc. should fail loudly rather than
 * silently dropping content from the output.
 */
export function parseMdx(source: string, options: ParseMdxOptions = {}): ParsedMdx | null {
  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkMdx)
    .parse(source);

  const frontmatter = extractFrontmatter(tree, options.filePath);
  if (!frontmatter) return null;

  const screens: ScreenSpec[] = [];
  const transitions: TransitionSpec[] = [];
  const history: HistoryEntrySpec[] = [];
  const screenLists: ScreenListSpec[] = [];
  const commentBlocks: AnnotCommentBlocks = {};

  // mdast visit doesn't narrow union types well; we accept the
  // any-cast at the boundary and re-narrow per-node-type below.
  visit(tree, (node: unknown) => {
    const n = node as { type?: string };
    switch (n.type) {
      case "mdxJsxFlowElement":
      case "mdxJsxTextElement":
        visitJsxElement(node, source, { screens, transitions, history, screenLists });
        return;
      case "mdxFlowExpression":
      case "mdxTextExpression":
        visitMdxExpression(node, commentBlocks);
        return;
    }
  });

  return {
    frontmatter,
    screens,
    transitions,
    history,
    screenLists,
    commentBlocks,
    source,
  };
}

// ─── frontmatter ───────────────────────────────────────────────

function extractFrontmatter(
  tree: { children: Array<{ type: string; value?: string }> },
  filePath: string | undefined,
): AnnotFrontmatter | null {
  const fmNode = tree.children.find((c) => c.type === "yaml");
  if (!fmNode || !fmNode.value) return null;

  const parsed = yaml.load(fmNode.value) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") return null;
  const annotBlock = parsed["annot"];
  if (!annotBlock || typeof annotBlock !== "object") return null;

  // Zod validation surfaces typos like `xlsx.roll` vs `xlsx.role`
  // at parse time — the caller (CLI / fixture) can format the
  // ZodError into an actionable diagnostic.
  const result = annotFrontmatterSchema.safeParse(annotBlock);
  if (!result.success) {
    const where = filePath ? ` in ${filePath}` : "";
    throw new Error(`Invalid \`annot:\` frontmatter${where}:\n${formatZodError(result.error)}`);
  }
  return result.data;
}

function formatZodError(error: {
  issues: Array<{ path: Array<string | number>; message: string }>;
}): string {
  return error.issues
    .map((i) => `  - ${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`)
    .join("\n");
}

// ─── JSX elements ──────────────────────────────────────────────

interface JsxAccumulators {
  screens: ScreenSpec[];
  transitions: TransitionSpec[];
  history: HistoryEntrySpec[];
  screenLists: ScreenListSpec[];
}

function visitJsxElement(node: unknown, source: string, acc: JsxAccumulators): void {
  const el = node as {
    type: string;
    name?: string | null;
    attributes?: unknown[];
    children?: unknown[];
    position?: NodePosition;
  };
  switch (el.name) {
    case "Screen":
      acc.screens.push(buildScreen(el, source));
      return;
    case "Transition":
      acc.transitions.push(buildTransition(el, source));
      return;
    case "HistoryEntry":
      acc.history.push(buildHistoryEntry(el, source));
      return;
    case "ScreenList":
      acc.screenLists.push(buildScreenList(el));
      return;
  }
}

function buildScreen(el: JsxNode, source: string): ScreenSpec {
  const props = readJsxAttributes(el);
  const overlays: OverlaySpec[] = [];
  for (const child of el.children ?? []) {
    const c = child as JsxNode;
    if (c.name === "Overlay") overlays.push(buildOverlay(c, source));
  }
  const id = asString(props["id"]);
  if (!id) {
    throw new Error("<Screen> requires an `id` prop.");
  }
  return {
    id,
    src: asString(props["src"]),
    overlays,
  };
}

function buildOverlay(el: JsxNode, source: string): OverlaySpec {
  const props = readJsxAttributes(el);
  const match = props["match"];
  if (!isMatchKey(match)) {
    throw new Error("<Overlay> requires a `match` prop with at least `{ role, name }`.");
  }
  return {
    match,
    intent: asString(props["intent"]) as OverlaySpec["intent"],
    number: asNumber(props["number"]),
    body: sliceInnerBody(el, source),
  };
}

function buildTransition(el: JsxNode, source: string): TransitionSpec {
  const props = readJsxAttributes(el);
  const trigger = props["trigger"];
  if (!isMatchKey(trigger)) {
    throw new Error("<Transition> requires a `trigger` prop with at least `{ role, name }`.");
  }
  return {
    trigger,
    on: asString(props["on"]),
    to: asString(props["to"]),
    body: sliceInnerBody(el, source),
  };
}

function buildHistoryEntry(el: JsxNode, source: string): HistoryEntrySpec {
  const props = readJsxAttributes(el);
  const version = asString(props["version"]) ?? "";
  const date = asString(props["date"]) ?? "";
  const author = asString(props["author"]) ?? "";
  if (!version || !date) {
    throw new Error("<HistoryEntry> requires `version` and `date` props.");
  }
  return {
    version,
    date,
    author,
    body: sliceInnerBody(el, source),
  };
}

function buildScreenList(el: JsxNode): ScreenListSpec {
  const props = readJsxAttributes(el);
  return {
    book: asString(props["book"]),
    sort: asString(props["sort"]) as ScreenListSpec["sort"],
  };
}

// ─── MDX expression nodes (comment blocks) ─────────────────────

function visitMdxExpression(node: unknown, blocks: AnnotCommentBlocks): void {
  const expr = node as { value?: string };
  const value = expr.value;
  if (typeof value !== "string") return;

  // MDX expression nodes carry the source between `{` and `}`.
  // We treat any `/* annot:foo ... */` comment expression as a
  // structured block. Both single-comment and paired-comment
  // forms work:
  //   {/* annot:snapshot ... */}            ← single expression
  //   {/* annot:snapshot */}                ← open marker
  //   {/* yaml-content-line */}
  //   {/* /annot:snapshot */}               ← close marker
  // For PR 2 we accept the single-comment form (matches the
  // example in the plan); the paired form is detected via a
  // pass over the full tree before this visitor in a later PR
  // if we need multi-line block-comment ergonomics.

  const match = value.match(COMMENT_OPEN_RE);
  if (!match) return;
  const tag = (match[1] ?? "").trim();
  const body = (match[2] ?? "").trim();

  switch (tag) {
    case SNAPSHOT_OPEN:
      blocks.snapshot = body;
      return;
    case ATTRIBUTES_OPEN:
      blocks.attributes = body;
      return;
    case SNAPSHOT_CLOSE:
    case ATTRIBUTES_CLOSE:
      // Close markers are no-ops in the single-expression form.
      return;
  }
}

// ─── helpers ───────────────────────────────────────────────────

interface NodePosition {
  start: { offset: number };
  end: { offset: number };
}

interface JsxAttribute {
  type: string;
  name?: string | null;
  value?: unknown;
}

interface JsxNode {
  type: string;
  name?: string | null;
  attributes?: unknown[];
  children?: unknown[];
  position?: NodePosition;
}

/**
 * Extract attributes from an `mdxJsxFlowElement` /
 * `mdxJsxTextElement` node into a plain `{ name: value }` map.
 *
 * Handles three attribute shapes:
 *   1. `key="literal"` — string literal in attribute position.
 *      The mdast node carries `value: "literal"` as a plain string.
 *   2. `key={123}` / `key={"x"}` / `key={{ a: 1 }}` — expression
 *      in attribute position. The mdast node carries
 *      `value: { type: "mdxJsxAttributeValueExpression", value: "..." }`
 *      where the `value` field is the verbatim expression source
 *      (e.g. `"{ role: 'button', name: 'OK' }"`). We evaluate the
 *      expression via `safeEvalJsValue` which handles JSON-ish
 *      object literals + numbers + strings.
 *   3. `key` (boolean shorthand). Value is `null`. We map to `true`.
 */
function readJsxAttributes(el: JsxNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of el.attributes ?? []) {
    const attr = raw as JsxAttribute;
    if (attr.type !== "mdxJsxAttribute") continue;
    if (!attr.name) continue;
    if (attr.value === null || attr.value === undefined) {
      out[attr.name] = true;
      continue;
    }
    if (typeof attr.value === "string") {
      out[attr.name] = attr.value;
      continue;
    }
    const valueExpr = attr.value as { type?: string; value?: string };
    if (
      valueExpr.type === "mdxJsxAttributeValueExpression" &&
      typeof valueExpr.value === "string"
    ) {
      out[attr.name] = safeEvalJsValue(valueExpr.value);
    }
  }
  return out;
}

/**
 * Best-effort evaluation of a JSX prop value expression as JSON.
 *
 * Handles: number literals, string literals (single + double
 * quoted), boolean / null literals, object literals with bare
 * identifier keys (`{ role: "button" }`), nested object literals
 * (`{ ..., under: { role: "dialog", name: "Confirm" } }`).
 *
 * Anything else falls back to the verbatim expression source —
 * the Zod validator on the consumer side surfaces the failure
 * as a typed diagnostic rather than a JS exception.
 *
 * No `eval` / `new Function` — only `JSON.parse` after a small
 * deterministic rewrite, so no script execution risk if MDX
 * authoring is delegated to less-trusted contributors.
 */
function safeEvalJsValue(expr: string): unknown {
  const trimmed = expr.trim();
  if (!trimmed) return undefined;

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number.parseFloat(trimmed);

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return JSON.parse(`"${trimmed.slice(1, -1).replace(/"/g, '\\"')}"`);
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    const jsonish = trimmed
      // Quote bare identifier keys: `{ role: ... }` → `{ "role": ... }`.
      .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3')
      // Single-quoted string values → double-quoted.
      .replace(/'([^'\\]*)'/g, '"$1"')
      // Trailing commas inside objects / arrays.
      .replace(/,(\s*[}\]])/g, "$1");
    try {
      return JSON.parse(jsonish);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function isMatchKey(v: unknown): v is MatchKey {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o["role"] !== "string" || typeof o["name"] !== "string") return false;
  if (o["under"] !== undefined && !isMatchKey(o["under"])) return false;
  return true;
}

/**
 * Slice the inner body of a JSX element from the source string
 * using its mdast position offsets.
 *
 * For `<Tag attr={...}>body</Tag>` we want just `body` —
 * trimmed of the opening / closing tag spans. The mdast position
 * gives us the outer span; we re-skip past `>` for the open tag
 * and back past `</Tag>` for the close.
 *
 * For self-closing `<Tag />` we return empty string.
 */
function sliceInnerBody(el: JsxNode, source: string): string {
  const pos = el.position;
  if (!pos) return "";
  const outer = source.slice(pos.start.offset, pos.end.offset);
  // Self-closing form has no body.
  if (/\/>\s*$/.test(outer)) return "";
  const firstClose = outer.indexOf(">");
  const lastOpen = outer.lastIndexOf("</");
  if (firstClose < 0 || lastOpen < 0 || lastOpen <= firstClose) return "";
  return outer.slice(firstClose + 1, lastOpen).trim();
}

// ─── snapshot/attributes block rewriting ───────────────────────

/**
 * Rewrite the `annot:snapshot` / `annot:attributes` MDX comment
 * blocks in a source string in-place, returning a new source
 * string with the updates applied.
 *
 * Used by the Playwright `screen` fixture (PR 3) to keep each
 * MDX file's snapshot/attribute documentation in sync with what
 * the live page actually exposes. Pure string transform — does
 * NOT re-parse / re-stringify the full MDX tree, so authored
 * Markdown / JSX / whitespace is byte-stable for the unchanged
 * regions.
 *
 * If a block is absent and an update value is provided, the
 * block is appended at end of file. If a block exists and the
 * update value is `undefined`, the block is left untouched —
 * pass an empty string to clear an existing block.
 */
export function updateCommentBlocks(
  source: string,
  updates: { snapshot?: string; attributes?: string },
): string {
  let out = source;
  if (updates.snapshot !== undefined) {
    out = replaceOrAppend(out, SNAPSHOT_OPEN, updates.snapshot);
  }
  if (updates.attributes !== undefined) {
    out = replaceOrAppend(out, ATTRIBUTES_OPEN, updates.attributes);
  }
  return out;
}

function replaceOrAppend(source: string, tag: string, body: string): string {
  // Match the single-expression `{/* annot:foo ... */}` form
  // emitted by `serialiseCommentBlock` below. We anchor on the
  // exact tag name so `annot:snapshot` and `annot:attributes`
  // can't collide.
  const re = new RegExp(
    String.raw`\{\s*/\*\s*` + escapeRegExp(tag) + String.raw`\s*[\s\S]*?\*/\s*\}`,
    "m",
  );
  const replacement = serialiseCommentBlock(tag, body);
  if (re.test(source)) {
    return source.replace(re, replacement);
  }
  // Append on a new line, with a leading blank line so the block
  // doesn't run into existing content. Strip trailing whitespace
  // from `source` first so we don't accumulate blank lines on
  // every re-write.
  const trimmed = source.replace(/\s+$/, "");
  return `${trimmed}\n\n${replacement}\n`;
}

function serialiseCommentBlock(tag: string, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return `{/* ${tag} */}`;
  return `{/* ${tag}\n${trimmed}\n*/}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
