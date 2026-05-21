// `annot_draft_screen_spec` — given a URL, propose an MDX
// skeleton with one `<Overlay>` per interactive element from
// the live aria-snapshot.
//
// Phase 5 PR 1 of `docs/plans/living-product-docs.md`. The
// tool itself doesn't author the prose — that's the agent's
// job. We hand back a well-formed MDX with `match` keys
// derived from the live snapshot so the agent only has to
// fill in the `body` text per `<Overlay>`.

import { parseSnapshot } from "@ingcreators/annot-product-docs";

import { captureAriaSnapshot } from "../browser/aria-snapshot.js";
import type { BrowserPool } from "../browser/pool.js";
import type { AnnotateToolResult } from "./annotate-screenshot.js";

export const DRAFT_SCREEN_SPEC_TOOL_NAME = "annot_draft_screen_spec";

export const draftScreenSpecTool = {
  name: DRAFT_SCREEN_SPEC_TOOL_NAME,
  description:
    "Given a URL, propose an `.mdx` skeleton for an annot product-docs " +
    "screen spec. The tool opens the page in a headless browser, takes a " +
    "Playwright `aria-snapshot`, and emits an MDX with frontmatter + a " +
    "`<Screen>` block containing one `<Overlay match={{ role, name }}>` " +
    "per interactive element. The agent fills in the prose body of each " +
    "overlay; the structural skeleton is mechanical.",
  inputSchema: {
    type: "object",
    required: ["url", "id"],
    additionalProperties: false,
    properties: {
      url: {
        type: "string",
        format: "uri",
        description: "Page URL to draft from.",
      },
      id: {
        type: "string",
        description:
          "Screen ID — used as the MDX frontmatter `annot.id` and as the `<Screen id>` prop.",
      },
      title: {
        type: "string",
        description: "Optional screen title (frontmatter `annot.title`).",
      },
      book: {
        type: "string",
        description: "Optional book name (frontmatter `xlsx.book`).",
      },
      screenImageSrc: {
        type: "string",
        default: "./shots/{id}.png",
        description:
          "Optional `<Screen src>` value. `{id}` is replaced with the screen id. " +
          "Defaults to `./shots/<id>.png`.",
      },
      viewport: {
        type: "object",
        additionalProperties: false,
        properties: {
          width: { type: "integer", minimum: 1, default: 1280 },
          height: { type: "integer", minimum: 1, default: 800 },
          deviceScaleFactor: { type: "number", minimum: 0.1, default: 1 },
        },
      },
      waitFor: {
        type: "string",
        enum: ["load", "domcontentloaded", "networkidle"],
        default: "load",
      },
    },
  },
} as const;

export interface DraftScreenSpecToolDeps {
  pool: BrowserPool;
}

export interface DraftScreenSpecToolInput {
  url?: unknown;
  id?: unknown;
  title?: unknown;
  book?: unknown;
  screenImageSrc?: unknown;
  viewport?: unknown;
  waitFor?: unknown;
}

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

export async function handleDraftScreenSpec(
  args: DraftScreenSpecToolInput,
  deps: DraftScreenSpecToolDeps,
): Promise<AnnotateToolResult> {
  if (typeof args.url !== "string" || args.url.length === 0) {
    return errorResult("`url` is required (string).");
  }
  if (typeof args.id !== "string" || args.id.length === 0) {
    return errorResult("`id` is required (string).");
  }
  const id = args.id;
  const title = typeof args.title === "string" ? args.title : undefined;
  const book = typeof args.book === "string" ? args.book : undefined;
  const srcTemplate =
    typeof args.screenImageSrc === "string" ? args.screenImageSrc : "./shots/{id}.png";
  const src = srcTemplate.replace(/\{id\}/g, id);

  let snapshot: { yaml: string };
  try {
    snapshot = await captureAriaSnapshot(deps.pool, {
      url: args.url,
      viewport: parseViewport(args.viewport),
      waitFor: parseWaitFor(args.waitFor),
    });
  } catch (err) {
    return errorResult(
      `Failed to capture aria-snapshot: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const entries = parseSnapshot(snapshot.yaml).filter((e) => INTERACTIVE_ROLES.has(e.role));
  const overlays = entries.map((entry, index) => {
    return `<Overlay match={{ role: ${JSON.stringify(entry.role)}, name: ${JSON.stringify(entry.name)} }} number={${index + 1}}>
TODO: describe ${entry.role} "${entry.name}".
</Overlay>`;
  });

  const frontmatter = [
    "---",
    "annot:",
    `  id: ${id}`,
    title ? `  title: ${title}` : null,
    book ? "  xlsx:" : null,
    book ? `    book: ${book}` : null,
    book ? "    role: screen" : null,
    "---",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const body = [
    'import Screen from "@ingcreators/annot-product-docs-astro/components/Screen.astro";',
    'import Overlay from "@ingcreators/annot-product-docs-astro/components/Overlay.astro";',
    "",
    `# ${title ?? id}`,
    "",
    `<Screen id="${id}" src="${src}">`,
    "",
    ...overlays.flatMap((o) => [o, ""]),
    "</Screen>",
    "",
    "{/* annot:snapshot",
    snapshot.yaml.trim(),
    "*/}",
  ].join("\n");

  const mdx = `${frontmatter}\n\n${body}\n`;

  return {
    content: [{ type: "text", text: mdx }],
  };
}

function parseViewport(
  raw: unknown,
): { width: number; height: number; deviceScaleFactor?: number } | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const width = typeof obj.width === "number" ? obj.width : 1280;
  const height = typeof obj.height === "number" ? obj.height : 800;
  const dsf = typeof obj.deviceScaleFactor === "number" ? obj.deviceScaleFactor : undefined;
  return { width, height, ...(dsf !== undefined ? { deviceScaleFactor: dsf } : {}) };
}

function parseWaitFor(raw: unknown): "load" | "domcontentloaded" | "networkidle" | undefined {
  if (raw === "load" || raw === "domcontentloaded" || raw === "networkidle") {
    return raw;
  }
  return undefined;
}

function errorResult(message: string): AnnotateToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
