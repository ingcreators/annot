// `annot_translate_screen_spec` — given an MDX in one locale,
// produce a locale-specific sibling stub the agent fills in.
//
// Phase 5 PR 3 of `docs/plans/living-product-docs.md`. The tool
// itself doesn't call any translation API — it walks the MDX,
// pulls out every translatable string (frontmatter `title` /
// `purpose`, `<Overlay>` body Markdown), and returns a
// structured "translation manifest" the agent uses to author
// the new MDX. The agent translates the strings via its own
// LLM call and the host writes the result.

import { parseMdxFile } from "@ingcreators/annot-product-docs";

import type { AnnotateToolResult } from "./annotate-screenshot.js";

export const TRANSLATE_SCREEN_SPEC_TOOL_NAME = "annot_translate_screen_spec";

export const translateScreenSpecTool = {
  name: TRANSLATE_SCREEN_SPEC_TOOL_NAME,
  description:
    "Given an MDX with `annot:` frontmatter and a target locale (e.g. " +
    "`en-US` / `ja-JP` / `ko-KR`), emit a structured translation manifest " +
    "listing every translatable string the agent should localise: " +
    "frontmatter title / purpose, per-overlay Markdown bodies, " +
    "per-transition prose. The agent translates the strings via its own " +
    "LLM call and the host writes the localised MDX.",
  inputSchema: {
    type: "object",
    required: ["mdxPath", "targetLocale"],
    additionalProperties: false,
    properties: {
      mdxPath: {
        type: "string",
        description: "Absolute or cwd-relative path to the source `.mdx`.",
      },
      sourceLocale: {
        type: "string",
        description:
          "BCP-47 locale tag of the source MDX (e.g. `ja-JP`). " +
          "Informational only — the tool doesn't enforce it.",
      },
      targetLocale: {
        type: "string",
        description: "BCP-47 locale tag of the locale to produce (e.g. `en-US`).",
      },
    },
  },
} as const;

export interface TranslateScreenSpecToolInput {
  mdxPath?: unknown;
  sourceLocale?: unknown;
  targetLocale?: unknown;
}

interface TranslationItem {
  /** Where in the MDX this string came from. */
  location:
    | { kind: "frontmatter.title" }
    | { kind: "frontmatter.purpose" }
    | {
        kind: "overlay.body";
        screenId: string;
        overlayNumber: number;
        matchRole: string;
        matchName: string;
      }
    | { kind: "transition.body"; triggerRole: string; triggerName: string }
    | { kind: "history.body"; version: string };
  /** Source text the agent translates. */
  source: string;
}

interface TranslationManifest {
  mdxPath: string;
  sourceLocale: string | undefined;
  targetLocale: string;
  id: string;
  items: TranslationItem[];
}

export async function handleTranslateScreenSpec(
  args: TranslateScreenSpecToolInput,
): Promise<AnnotateToolResult> {
  if (typeof args.mdxPath !== "string" || args.mdxPath.length === 0) {
    return errorResult("`mdxPath` is required (string).");
  }
  if (typeof args.targetLocale !== "string" || args.targetLocale.length === 0) {
    return errorResult("`targetLocale` is required (string).");
  }

  const parsed = await parseMdxFile(args.mdxPath);
  if (!parsed) {
    return errorResult(`${args.mdxPath} has no \`annot:\` frontmatter.`);
  }

  const items: TranslationItem[] = [];
  if (parsed.frontmatter.title) {
    items.push({ location: { kind: "frontmatter.title" }, source: parsed.frontmatter.title });
  }
  if (parsed.frontmatter.purpose) {
    items.push({ location: { kind: "frontmatter.purpose" }, source: parsed.frontmatter.purpose });
  }
  for (const screen of parsed.screens) {
    let auto = 1;
    for (const overlay of screen.overlays) {
      const overlayNumber = overlay.number ?? auto++;
      items.push({
        location: {
          kind: "overlay.body",
          screenId: screen.id,
          overlayNumber,
          matchRole: overlay.match.role,
          matchName: overlay.match.name,
        },
        source: overlay.body,
      });
    }
  }
  for (const transition of parsed.transitions) {
    items.push({
      location: {
        kind: "transition.body",
        triggerRole: transition.trigger.role,
        triggerName: transition.trigger.name,
      },
      source: transition.body,
    });
  }
  for (const entry of parsed.history) {
    items.push({
      location: { kind: "history.body", version: entry.version },
      source: entry.body,
    });
  }

  const manifest: TranslationManifest = {
    mdxPath: args.mdxPath,
    sourceLocale: typeof args.sourceLocale === "string" ? args.sourceLocale : undefined,
    targetLocale: args.targetLocale,
    id: parsed.frontmatter.id,
    items,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(manifest, null, 2) }],
  };
}

function errorResult(message: string): AnnotateToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
