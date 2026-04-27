/**
 * Symmetry test enforcing CLAUDE.md's "stories required for ALL
 * built-in Lit components" rule:
 *
 *   For every `*.ts` file under `packages/web/src/` that
 *   contains an `extends LitElement` declaration, a sibling
 *   `*.stories.ts` must exist.
 *
 * Lands as part of `_done/litelement-stories-coverage.md`'s
 * follow-up tidy. Replaces the prior "audit by `wc -l`"
 * convention with an automated check that fails the suite if a
 * future PR adds a `LitElement` subclass without the matching
 * story.
 *
 * Stories alongside non-Lit elements (e.g. `<annot-toolbar>`,
 * which extends `HTMLElement`) are still allowed but not
 * required by this test — only files declaring
 * `extends LitElement` participate in the symmetry assertion.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)));

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    const full = join(root, e.name);
    if (e.isDirectory()) {
      // Skip any nested `node_modules` / build output that could
      // sneak in; tests are pure-source territory.
      if (e.name === "node_modules" || e.name === "dist") continue;
      out.push(...(await walk(full)));
    } else if (e.isFile() && e.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

async function findLitElementSources(files: string[]): Promise<string[]> {
  const matches: string[] = [];
  for (const f of files) {
    // Skip test + story + declaration files — they may reference
    // `LitElement` only as a type / import.
    if (f.endsWith(".test.ts") || f.endsWith(".stories.ts") || f.endsWith(".d.ts")) continue;
    const text = await readFile(f, "utf8");
    if (/extends\s+LitElement\b/.test(text)) matches.push(f);
  }
  return matches;
}

describe("Storybook coverage symmetry — every LitElement ships a story", () => {
  it("each `extends LitElement` source has a sibling `*.stories.ts`", async () => {
    const files = await walk(SRC_DIR);
    const litFiles = await findLitElementSources(files);
    const storyFiles = new Set(files.filter((f) => f.endsWith(".stories.ts")));
    const missing: string[] = [];
    for (const lit of litFiles) {
      const expected = lit.replace(/\.ts$/, ".stories.ts");
      if (!storyFiles.has(expected)) missing.push(lit);
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });
});
