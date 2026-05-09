/**
 * Structural + drift-detection invariants on `VSCODE_THEME_MAP`.
 *
 * The map is the bridge between Annot's `--annot-*` design-system
 * tokens (defined in `packages/core/styles/editor.css`) and the
 * VSCode workbench `--vscode-*` color variables. The webview's
 * `applyThemeMap()` writes one inline custom property per entry
 * onto the shell container so the editor follows whichever theme
 * the user has installed.
 *
 * Three properties keep the bridge honest:
 *
 *   1. **Schema integrity** — every key is an Annot token name,
 *      every value is a non-empty string.
 *   2. **Semantics** — every `var(...)` reference points at a
 *      `--vscode-*` variable (the whole point of the map).
 *      Literal values like `transparent` are allowed.
 *   3. **Drift detection** — the set of mapped tokens covers
 *      every `--annot-*` token declared in `editor.css` exactly
 *      once. Adding a new token to the design system without
 *      adding the matching VSCode mapping breaks this test.
 *
 * The drift test fails informatively: it lists tokens missing
 * from the map AND tokens in the map that no longer exist in
 * `editor.css`, so a regression points at the exact rows to
 * fix.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VSCODE_THEME_MAP } from "./theme-map.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EDITOR_CSS_PATH = resolve(HERE, "..", "..", "..", "core", "styles", "editor.css");

/**
 * Pull every `--annot-*` token *declared* in editor.css. We match
 * declarations only (`--annot-name: value;`) — references like
 * `var(--annot-name)` would inflate the set with consumers we
 * don't care about for drift detection.
 *
 * Returns a Set so duplicate declarations across the dark / light
 * theme blocks (which is normal) collapse to one entry.
 */
async function collectAnnotTokenDeclarations(): Promise<Set<string>> {
  const css = await readFile(EDITOR_CSS_PATH, "utf8");
  const tokens = new Set<string>();
  // `--annot-foo:` at start of a (whitespace-prefixed) line. The
  // value side can be anything; we only need the token name.
  const re = /^\s*(--annot-[a-z0-9-]+)\s*:/gim;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    const name = match[1];
    if (name) tokens.add(name);
  }
  return tokens;
}

describe("VSCODE_THEME_MAP schema integrity", () => {
  it("every key is an --annot-* token name", () => {
    const offenders = Object.keys(VSCODE_THEME_MAP).filter((k) => !k.startsWith("--annot-"));
    expect(offenders).toEqual([]);
  });

  it("every value is a non-empty string", () => {
    const offenders = Object.entries(VSCODE_THEME_MAP).filter(
      ([, v]) => typeof v !== "string" || v.trim() === "",
    );
    expect(offenders).toEqual([]);
  });
});

describe("VSCODE_THEME_MAP semantics", () => {
  it("every var(...) reference targets a --vscode-* variable", () => {
    // `var(--vscode-foo)` / `var(--vscode-foo, fallback)` — extract the
    // first argument of every var() and assert it starts with
    // `--vscode-`. Nested var() calls in fallbacks are walked too.
    const varRe = /var\(\s*(--[a-z0-9-]+)/gi;
    const offenders: { token: string; bad: string }[] = [];
    for (const [token, value] of Object.entries(VSCODE_THEME_MAP)) {
      let match: RegExpExecArray | null;
      while ((match = varRe.exec(value)) !== null) {
        const ref = match[1];
        if (ref && !ref.startsWith("--vscode-")) {
          offenders.push({ token, bad: ref });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("VSCODE_THEME_MAP drift detection vs editor.css", () => {
  it("covers every --annot-* token declared in editor.css", async () => {
    const cssTokens = await collectAnnotTokenDeclarations();
    const mapTokens = new Set(Object.keys(VSCODE_THEME_MAP));

    const missingFromMap = [...cssTokens].filter((t) => !mapTokens.has(t));
    const extraInMap = [...mapTokens].filter((t) => !cssTokens.has(t));

    // Single combined assertion so the failure message lists both
    // sides at once — easier to read than two separate failures.
    expect(
      { missingFromMap, extraInMap },
      "VSCODE_THEME_MAP is out of sync with packages/core/styles/editor.css",
    ).toEqual({ missingFromMap: [], extraInMap: [] });
  });
});
