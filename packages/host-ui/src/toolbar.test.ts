/**
 * Structural guard for the Toolbar render paths.
 *
 * Phase 5 of `docs/plans/toolbar-highlight-flyout-kind.md`:
 * after the schema-driven migration, the toolbar's render paths
 * shouldn't carry per-tool-id literals like `toolId === "highlight"`
 * — every per-tool variation flows through `TOOL_REGISTRY` metadata
 * (`flyoutKind`, `chipColorForVariant`, `tooltipLabelForVariant`,
 * `ensurePresetForVariantChange`) plus the existing per-tool
 * callbacks (`extractStyleFromElement`, `applyStyleToElement`,
 * `variantKeyForElement`).
 *
 * This test is the regression net: greps `toolbar.ts` and
 * `toolbar-canvas-menu.ts` for any `toolId === "<id>"` literal and
 * fails the build if one shows up. A new tool with swatch-style
 * presentation should land entirely in the registry — if you're
 * tempted to write `if (toolId === "stamp")` in the toolbar, that's
 * a sign the registry needs another optional field instead.
 *
 * Out of scope:
 *   - `tool-property-renderer.ts`'s Highlight branch — covered by
 *     `_done/tool-property-renderer-schema.md`'s eventual follow-up.
 *   - `case "highlight":` inside the aggregate `tool-name`
 *     formatter switch — different shape (a switch dispatch on the
 *     tool's id, not an if/else escape hatch). The plan deliberately
 *     leaves switch cascades alone; only `if (toolId === "...")`
 *     is in scope.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function readSource(rel: string): string {
  return readFileSync(resolve(here, rel), "utf8");
}

/** Strip line + block comments so a comment that mentions
 *  `toolId === "highlight"` (e.g. a "we used to write this" note in
 *  a doc-comment) doesn't trip the assertion. The toolbar's history
 *  comments deliberately reference the prior literal as the thing
 *  being lifted out. */
function stripComments(src: string): string {
  // Normalise CRLF → LF first so the per-line `.*` regex matches a
  // line's full content. JavaScript's `.` excludes line terminators
  // including `\r`, so without this step a CRLF file leaves a
  // dangling `\r` between `//` and the line's tail, defeating the
  // strip.
  const normalised = src.replace(/\r\n/g, "\n");
  // Remove block comments first (greedy across lines is fine here —
  // we're in TypeScript with no nesting).
  const noBlock = normalised.replace(/\/\*[\s\S]*?\*\//g, "");
  // Then line comments.
  return noBlock
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("Toolbar render paths — no `toolId === \"<id>\"` literals", () => {
  it("toolbar.ts has no `toolId === \"<id>\"` literal in non-comment code", () => {
    const src = stripComments(readSource("toolbar.ts"));
    const matches = src.match(/toolId\s*===\s*"[^"]+"/g);
    expect(
      matches,
      `toolbar.ts contains forbidden tool-id literal(s): ${matches?.join(", ")}.\n` +
        "Lift the per-tool variation onto a TOOL_REGISTRY field instead — see " +
        "docs/plans/_done/toolbar-highlight-flyout-kind.md for the pattern.",
    ).toBeNull();
  });

  it("toolbar-canvas-menu.ts has no `toolId === \"<id>\"` literal in non-comment code", () => {
    const src = stripComments(readSource("toolbar-canvas-menu.ts"));
    const matches = src.match(/toolId\s*===\s*"[^"]+"/g);
    expect(
      matches,
      `toolbar-canvas-menu.ts contains forbidden tool-id literal(s): ${matches?.join(", ")}.\n` +
        "Lift the per-tool variation onto a TOOL_REGISTRY field instead — see " +
        "docs/plans/_done/toolbar-highlight-flyout-kind.md for the pattern.",
    ).toBeNull();
  });
});
