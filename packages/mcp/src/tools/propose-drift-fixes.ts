// `annot_propose_drift_fixes` — given an MDX path + a live URL,
// run the drift detector and emit a structured fix proposal an
// agent can apply.
//
// Phase 5 PR 2 of `docs/plans/living-product-docs.md`. The tool
// itself doesn't write to disk — it returns a text payload (a
// simple Markdown summary + a unified-diff-flavoured suggestion
// block per finding). The agent applies the diff via its own
// editor / patch primitive.

import {
  type DriftFinding,
  detectDrift,
  lintableScreens,
  parseMdxFile,
  parseSnapshot,
} from "@ingcreators/annot-product-docs";

import { captureAriaSnapshot } from "../browser/aria-snapshot.js";
import type { BrowserPool } from "../browser/pool.js";
import type { AnnotateToolResult } from "./annotate-screenshot.js";

export const PROPOSE_DRIFT_FIXES_TOOL_NAME = "annot_propose_drift_fixes";

export const proposeDriftFixesTool = {
  name: PROPOSE_DRIFT_FIXES_TOOL_NAME,
  description:
    "Given an MDX path + the live URL the screen renders at, run drift " +
    "detection between the stored `<Overlay match>` keys and the current " +
    "`aria-snapshot`. Returns a structured Markdown report: one section " +
    "per finding with the kind / severity / message / suggested fix. The " +
    "agent reads the report and applies edits via its own patch primitive.",
  inputSchema: {
    type: "object",
    required: ["mdxPath", "url"],
    additionalProperties: false,
    properties: {
      mdxPath: {
        type: "string",
        description: "Absolute or cwd-relative path to the `.mdx` file with `annot:` frontmatter.",
      },
      url: {
        type: "string",
        format: "uri",
        description: "URL to navigate to for the live snapshot.",
      },
      screenId: {
        type: "string",
        description:
          "Optional `<Screen id>` filter. Default: run drift against every screen in the MDX.",
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

export interface ProposeDriftFixesToolDeps {
  pool: BrowserPool;
}

export interface ProposeDriftFixesToolInput {
  mdxPath?: unknown;
  url?: unknown;
  screenId?: unknown;
  viewport?: unknown;
  waitFor?: unknown;
}

export async function handleProposeDriftFixes(
  args: ProposeDriftFixesToolInput,
  deps: ProposeDriftFixesToolDeps,
): Promise<AnnotateToolResult> {
  if (typeof args.mdxPath !== "string" || args.mdxPath.length === 0) {
    return errorResult("`mdxPath` is required (string).");
  }
  if (typeof args.url !== "string" || args.url.length === 0) {
    return errorResult("`url` is required (string).");
  }
  const screenFilter = typeof args.screenId === "string" ? args.screenId : undefined;

  const parsed = await parseMdxFile(args.mdxPath);
  if (!parsed) {
    return errorResult(`${args.mdxPath} has no \`annot:\` frontmatter.`);
  }
  const screens = lintableScreens(parsed.screens).filter(
    (s) => !screenFilter || s.id === screenFilter,
  );
  if (screens.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No lintable screens in ${args.mdxPath}${
            screenFilter ? ` (screenId=${screenFilter})` : ""
          }.`,
        },
      ],
    };
  }

  const allFindings: Array<{ screenId: string; finding: DriftFinding }> = [];
  for (const screen of screens) {
    let snapshot: { yaml: string };
    try {
      snapshot = await captureAriaSnapshot(deps.pool, {
        url: args.url,
        viewport: parseViewport(args.viewport),
        waitFor: parseWaitFor(args.waitFor),
      });
    } catch (err) {
      return errorResult(
        `Failed to capture aria-snapshot for screen=${screen.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const findings = detectDrift({
      screen,
      liveSnapshot: parseSnapshot(snapshot.yaml),
    });
    for (const f of findings) {
      allFindings.push({ screenId: screen.id, finding: f });
    }
  }

  if (allFindings.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No drift detected in ${args.mdxPath} against ${args.url}.`,
        },
      ],
    };
  }

  const report = renderDriftReport(args.mdxPath, args.url, allFindings);
  return {
    content: [{ type: "text", text: report }],
  };
}

function renderDriftReport(
  mdxPath: string,
  url: string,
  findings: Array<{ screenId: string; finding: DriftFinding }>,
): string {
  const lines: string[] = [];
  lines.push(`# Drift report — ${mdxPath}`);
  lines.push("");
  lines.push(`Live URL: ${url}`);
  lines.push(`Findings: ${findings.length}`);
  lines.push("");

  for (const { screenId, finding } of findings) {
    lines.push(`## ${finding.severity.toUpperCase()} [${screenId}] ${finding.kind}`);
    lines.push("");
    lines.push(finding.message);
    if (finding.match) {
      lines.push("");
      lines.push("Current match key:");
      lines.push("```ts");
      lines.push(JSON.stringify(finding.match, null, 2));
      lines.push("```");
    }
    if (finding.suggestion) {
      lines.push("");
      lines.push("Suggested replacement:");
      lines.push("```ts");
      lines.push(JSON.stringify(finding.suggestion, null, 2));
      lines.push("```");
    }
    lines.push("");
  }
  return lines.join("\n");
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
