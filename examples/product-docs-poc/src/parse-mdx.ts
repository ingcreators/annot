// Stage 3a: Extract <Overlay match> / <Transition> / frontmatter
// from a `*.screen.mdx` file.
//
// Uses @mdx-js/mdx's underlying remark / mdast pipeline. The PoC
// keeps the extractor in ~150 LOC by walking the mdast tree
// directly rather than going through MDX compilation — we don't
// need rendered HTML here, just the structural information.

import { readFile } from "node:fs/promises";

import { compile } from "@mdx-js/mdx";

export interface MatchKey {
  role: string;
  name: string;
  under?: MatchKey;
}

export interface OverlaySpec {
  match: MatchKey;
  intent?: "info" | "warning" | "error" | "success" | "neutral" | "required" | "action";
  number?: number;
  /** Markdown body of the <Overlay>. */
  body: string;
}

export interface TransitionSpec {
  trigger: MatchKey;
  on?: string;
  to?: string;
  body: string;
}

export interface ScreenSpec {
  id: string;
  src?: string;
  overlays: OverlaySpec[];
}

export interface MdxFrontmatter {
  id: string;
  title?: string;
  purpose?: string;
  meta?: Record<string, unknown>;
  xlsx?: {
    book?: string;
    sheet?: string;
    sheets?: Record<string, string>;
    role?: "cover" | "history" | "list" | "screen" | "reference";
    order?: number;
  };
}

export interface ParsedMdx {
  frontmatter: MdxFrontmatter;
  screens: ScreenSpec[];
  transitions: TransitionSpec[];
}

/**
 * Parse a `*.screen.mdx` file and return its structured data.
 *
 * Implementation note: rather than running the MDX through a full
 * remark + mdx pipeline (which would render JSX to JavaScript),
 * we extract the YAML-style frontmatter with a regex and parse
 * the JSX components with a hand-rolled walker. This is enough
 * for the PoC; Phase 1's `mdx.ts` will use the proper mdast AST.
 */
export async function parseMdx(filePath: string): Promise<ParsedMdx> {
  const source = await readFile(filePath, "utf8");

  const frontmatter = parseFrontmatter(source);
  if (!frontmatter.id) {
    throw new Error(`MDX ${filePath} is missing required \`annot.id\` frontmatter.`);
  }

  const body = stripFrontmatter(source);
  const screens = extractScreens(body);
  const transitions = extractTransitions(body);

  return { frontmatter, screens, transitions };
}

// ─── frontmatter ───────────────────────────────────────────────

function parseFrontmatter(source: string): MdxFrontmatter {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return { id: "" };
  }
  const parsed = parseYamlBlock(match[1] ?? "");
  const annot = (parsed["annot"] as MdxFrontmatter | undefined) ?? { id: "" };
  return annot;
}

function stripFrontmatter(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/**
 * Minimal YAML subset: handles nested objects, scalars, quoted
 * strings. The PoC's MDX frontmatter is intentionally simple.
 * Phase 1's parser uses a real YAML lib.
 */
function parseYamlBlock(yaml: string): Record<string, unknown> {
  const lines = yaml.split(/\r?\n/);
  const root: Record<string, unknown> = {};
  const stack: { indent: number; obj: Record<string, unknown> }[] = [{ indent: -1, obj: root }];

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const indent = rawLine.length - rawLine.replace(/^\s+/, "").length;
    const line = rawLine.trim();

    while (stack.length > 1 && (stack[stack.length - 1]?.indent ?? 0) >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]!.obj;

    const kv = line.match(/^([^:]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!.trim();
    const valueRaw = kv[2]!.trim();
    if (valueRaw === "") {
      const childObj: Record<string, unknown> = {};
      parent[key] = childObj;
      stack.push({ indent, obj: childObj });
    } else {
      parent[key] = coerceScalar(valueRaw);
    }
  }

  return root;
}

function coerceScalar(value: string): unknown {
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value);
  return value;
}

// ─── JSX extraction ────────────────────────────────────────────

const SCREEN_RE = /<Screen\s+([^>]*?)>([\s\S]*?)<\/Screen>/g;
const OVERLAY_RE = /<Overlay\s+([^>]*?)>([\s\S]*?)<\/Overlay>/g;
const TRANSITION_RE_BLOCK = /<Transition\s+([^>]*?)>([\s\S]*?)<\/Transition>/g;
const TRANSITION_RE_SELF = /<Transition\s+([^>]*?)\s*\/>/g;

function extractScreens(body: string): ScreenSpec[] {
  const screens: ScreenSpec[] = [];
  let match;
  SCREEN_RE.lastIndex = 0;
  while ((match = SCREEN_RE.exec(body)) !== null) {
    const props = parseJsxProps(match[1] ?? "");
    const inner = match[2] ?? "";
    const id = (props["id"] as string | undefined) ?? "";
    const src = props["src"] as string | undefined;
    const overlays = extractOverlays(inner);
    screens.push({ id, src, overlays });
  }
  return screens;
}

function extractOverlays(body: string): OverlaySpec[] {
  const overlays: OverlaySpec[] = [];
  let match;
  OVERLAY_RE.lastIndex = 0;
  while ((match = OVERLAY_RE.exec(body)) !== null) {
    const props = parseJsxProps(match[1] ?? "");
    const matchKey = props["match"] as MatchKey | undefined;
    if (!matchKey) continue;
    overlays.push({
      match: matchKey,
      intent: props["intent"] as OverlaySpec["intent"],
      number: props["number"] as number | undefined,
      body: (match[2] ?? "").trim(),
    });
  }
  return overlays;
}

function extractTransitions(body: string): TransitionSpec[] {
  const transitions: TransitionSpec[] = [];
  let match;
  TRANSITION_RE_BLOCK.lastIndex = 0;
  while ((match = TRANSITION_RE_BLOCK.exec(body)) !== null) {
    const props = parseJsxProps(match[1] ?? "");
    transitions.push({
      trigger: props["trigger"] as MatchKey,
      on: props["on"] as string | undefined,
      to: props["to"] as string | undefined,
      body: (match[2] ?? "").trim(),
    });
  }
  TRANSITION_RE_SELF.lastIndex = 0;
  while ((match = TRANSITION_RE_SELF.exec(body)) !== null) {
    const props = parseJsxProps(match[1] ?? "");
    transitions.push({
      trigger: props["trigger"] as MatchKey,
      on: props["on"] as string | undefined,
      to: props["to"] as string | undefined,
      body: "",
    });
  }
  return transitions;
}

/**
 * Parse a JSX-style attribute list:
 *   - `key="value"`
 *   - `key={123}`
 *   - `key={{ a: "b", c: 1 }}`
 *
 * Returns a plain object.
 */
function parseJsxProps(input: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i] ?? "")) i++;
    if (i >= input.length) break;

    const keyStart = i;
    while (i < input.length && /[A-Za-z0-9_-]/.test(input[i] ?? "")) i++;
    const key = input.slice(keyStart, i);
    if (!key) break;

    if (input[i] !== "=") {
      result[key] = true;
      continue;
    }
    i++;

    if (input[i] === '"') {
      i++;
      const start = i;
      while (i < input.length && input[i] !== '"') i++;
      result[key] = input.slice(start, i);
      i++;
    } else if (input[i] === "{") {
      i++;
      let depth = 1;
      const start = i;
      while (i < input.length && depth > 0) {
        if (input[i] === "{") depth++;
        else if (input[i] === "}") depth--;
        if (depth > 0) i++;
      }
      const expr = input.slice(start, i);
      i++;
      result[key] = parseJsExpression(expr);
    } else {
      break;
    }
  }
  return result;
}

function parseJsExpression(expr: string): unknown {
  const trimmed = expr.trim();
  if (!trimmed) return undefined;

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number.parseFloat(trimmed);

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const jsonish = trimmed
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
      .replace(/'([^']*)'/g, '"$1"');
    try {
      return JSON.parse(jsonish);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

// Reserved for Phase 1 — use the real @mdx-js/mdx pipeline.
export { compile as _mdxCompile };
