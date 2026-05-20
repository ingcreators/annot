// `annot_aria_snapshot` — open a URL in a headless browser and
// return Playwright's AI-mode aria-snapshot. Phase 0 Stage 1 of
// `docs/plans/living-product-docs.md`.
//
// The YAML output uses the same format `playwright-mcp` and
// `playwright-cli` use:
//
//   - textbox "Email" [ref=e3]
//   - textbox "Password" [ref=e5]
//   - button "Sign in" [ref=e9]
//
// Refs (`eN`) are session-local — they identify elements within
// THIS snapshot only. They are NOT persistent identifiers. Tools
// that store cross-session references should use `role + name`
// (with tree-path disambiguation for duplicates) as the
// persistent key, as the `living-product-docs.md` plan documents.

import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { captureAriaSnapshot } from "../browser/aria-snapshot.js";
import type { BrowserPool } from "../browser/pool.js";
import type { AnnotateToolResult } from "./annotate-screenshot.js";

export const ARIA_SNAPSHOT_TOOL_NAME = "annot_aria_snapshot";

export const ariaSnapshotTool = {
  name: ARIA_SNAPSHOT_TOOL_NAME,
  description:
    "Open a URL in a headless browser and return Playwright's AI-mode " +
    "aria-snapshot (YAML format with `[ref=eN]` markers). The same " +
    "primitive `playwright-mcp` and `playwright-cli` use. " +
    "Refs are session-local — store `role + name` (not refs) as " +
    "persistent identifiers across snapshots.",
  inputSchema: {
    type: "object",
    required: ["url"],
    additionalProperties: false,
    properties: {
      url: {
        type: "string",
        format: "uri",
        description: "Page URL to snapshot.",
      },
      viewport: {
        type: "object",
        additionalProperties: false,
        properties: {
          width: { type: "integer", minimum: 1, default: 1280 },
          height: { type: "integer", minimum: 1, default: 800 },
          deviceScaleFactor: { type: "number", minimum: 0.1, default: 1 },
        },
        description: "Viewport size. Default 1280×800 at 1× device pixel ratio.",
      },
      waitFor: {
        type: "string",
        enum: ["load", "domcontentloaded", "networkidle"],
        default: "load",
        description: "Page event to await before snapshotting.",
      },
      rootSelector: {
        type: "string",
        default: "body",
        description:
          "Selector for the locator whose subtree is snapshotted. " +
          'Defaults to `"body"` (whole page). Narrow to a specific ' +
          'region (e.g. `"main"` or `\'[data-testid="login-form"]\'`) ' +
          "when only part of the page is relevant.",
      },
      timeout: {
        type: "integer",
        minimum: 0,
        description:
          "Timeout in milliseconds for the underlying " +
          "`locator.ariaSnapshot()` call. Defaults to Playwright's own " +
          "default (30 s).",
      },
      output: {
        type: "string",
        description:
          "Optional absolute filesystem path. When set, the YAML is " +
          "written here and the tool returns a text confirmation; " +
          "otherwise the YAML is returned inline.",
      },
    },
  },
} as const;

export interface AriaSnapshotToolDeps {
  pool: BrowserPool;
}

export interface AriaSnapshotToolInput {
  url?: unknown;
  viewport?: unknown;
  waitFor?: unknown;
  rootSelector?: unknown;
  timeout?: unknown;
  output?: unknown;
}

export async function handleAriaSnapshot(
  args: AriaSnapshotToolInput,
  deps: AriaSnapshotToolDeps,
): Promise<AnnotateToolResult> {
  if (typeof args.url !== "string" || args.url.length === 0) {
    return errorResult("`url` is required (string).");
  }

  const viewport = parseViewport(args.viewport);
  const waitFor = parseWaitFor(args.waitFor);
  const rootSelector = typeof args.rootSelector === "string" ? args.rootSelector : undefined;
  const timeout = typeof args.timeout === "number" ? args.timeout : undefined;
  const output = parseOutput(args.output);
  if (output && !output.ok) {
    return errorResult(output.error);
  }

  let snapshot: { yaml: string };
  try {
    snapshot = await captureAriaSnapshot(deps.pool, {
      url: args.url,
      viewport,
      waitFor,
      rootSelector,
      timeout,
    });
  } catch (err) {
    return errorResult(
      `Failed to capture aria-snapshot: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (output) {
    try {
      await writeFile(output.path, snapshot.yaml, "utf8");
    } catch (err) {
      return errorResult(
        `Failed to write snapshot to ${output.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      content: [
        {
          type: "text",
          text: `Wrote aria-snapshot (${snapshot.yaml.length} bytes) to ${output.path}.`,
        },
      ],
    };
  }

  return {
    content: [{ type: "text", text: snapshot.yaml }],
  };
}

// ─── helpers ─────────────────────────────────────────────────

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

function parseOutput(
  raw: unknown,
): { ok: true; path: string } | { ok: false; error: string } | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, error: "`output` must be a non-empty string when set." };
  }
  if (!isAbsolute(raw)) {
    return { ok: false, error: `\`output\` must be an absolute path; got ${JSON.stringify(raw)}.` };
  }
  return { ok: true, path: raw };
}

function errorResult(message: string): AnnotateToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
