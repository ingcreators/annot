/**
 * Logical font-family registry — Phase 1 of
 * `docs/plans/multilingual-fonts-os-stack.md`.
 *
 * Annot exposes three logical family tokens to the editor and to
 * stored SVG. The host (PWA / extension / desktop / future
 * `annot-annotator`) resolves each token to:
 *
 *   - A long, OS-aware CSS font stack that interleaves Latin /
 *     CJK / Arabic / Indic / Thai families so the browser's
 *     per-codepoint font selection lands on the OS native script
 *     font without any web-font download.
 *   - A 3-typeface OOXML triple (`<a:latin>` + `<a:ea>` + `<a:cs>`)
 *     so PowerPoint / Office paste consumers apply the same
 *     per-script logic on the receive side.
 *
 * Pure (Tier A): strings + lookup tables, no DOM, no runtime
 * dependency on a browser. Importable from headless tests, the
 * pptx exporter (`@ingcreators/annot-render`), and the editor
 * UI alike.
 */

/** The three logical family tokens. The editor stores exactly one
 *  of these in `data-font-family`; raw CSS family strings are
 *  coerced to `Annot Sans` via `coerceToLogicalFamily`. */
export const LOGICAL_FAMILIES = ["Annot Sans", "Annot Serif", "Annot Mono"] as const;

export type LogicalFamily = (typeof LOGICAL_FAMILIES)[number];

/** Per-token CSS font stack. Latin / Cyrillic / Greek families
 *  come first so English / European text in mixed content uses
 *  native Latin glyphs (Helvetica Neue, Segoe UI). CJK comes
 *  next so Japanese / Chinese / Korean fall through to the OS
 *  native CJK font without dragging the Latin glyphs into a CJK
 *  Latin variant. Arabic / Indic / Thai sit before the generic
 *  fallback so the browser finds them on Windows / macOS / Linux
 *  without further configuration. The terminal generic family
 *  is the always-correct safety net. */
const CSS_STACK_TABLE: Record<LogicalFamily, string> = {
  "Annot Sans": [
    // Latin / Cyrillic / Greek — OS UI sans
    "-apple-system",
    "BlinkMacSystemFont",
    '"Segoe UI"',
    '"Helvetica Neue"',
    "Arial",
    // CJK — OS native sans
    '"Hiragino Sans"',
    '"Yu Gothic UI"',
    '"Yu Gothic"',
    "Meiryo",
    '"MS PGothic"',
    '"PingFang SC"',
    '"Microsoft YaHei"',
    '"Apple SD Gothic Neo"',
    '"Malgun Gothic"',
    // Arabic / Indic / Thai (per-OS)
    '"Nirmala UI"',
    "Tahoma",
    // Generic + emoji
    "sans-serif",
    '"Apple Color Emoji"',
    '"Segoe UI Emoji"',
  ].join(", "),
  "Annot Serif": [
    "Cambria",
    "Georgia",
    '"Yu Mincho"',
    '"Hiragino Mincho ProN"',
    '"SimSun"',
    '"Noto Serif CJK SC"',
    "serif",
  ].join(", "),
  "Annot Mono": [
    '"SF Mono"',
    "Menlo",
    "Consolas",
    '"Cascadia Mono"',
    '"Yu Gothic Mono"',
    '"Noto Sans Mono CJK JP"',
    "monospace",
  ].join(", "),
};

/** Per-token OOXML typeface triple. PowerPoint applies these
 *  per-codepoint at render time:
 *    - `<a:latin>` for Latin / Cyrillic / Greek
 *    - `<a:ea>` for East Asian (CJK)
 *    - `<a:cs>` for complex script (Arabic / Hebrew / Indic / Thai)
 *  Picks land on Office-bundled standards (Calibri / Yu Gothic UI
 *  etc.) so cross-environment sharing without embedded fonts is
 *  "good enough" — the receiver sees Office's default substitute
 *  when a typeface is missing. */
interface OoxmlTypefaces {
  latin: string;
  ea: string;
  cs: string;
}

const OOXML_TYPEFACES_TABLE: Record<LogicalFamily, OoxmlTypefaces> = {
  "Annot Sans": { latin: "Calibri", ea: "Yu Gothic UI", cs: "Arial" },
  "Annot Serif": { latin: "Cambria", ea: "Yu Mincho", cs: "Times New Roman" },
  "Annot Mono": { latin: "Consolas", ea: "MS Gothic", cs: "Courier New" },
};

/** Resolve a logical token to its CSS font stack string. */
export function cssStackFor(family: LogicalFamily): string {
  return CSS_STACK_TABLE[family];
}

/** Resolve a logical token to its OOXML typeface triple. */
export function ooxmlTypefacesFor(family: LogicalFamily): OoxmlTypefaces {
  return OOXML_TYPEFACES_TABLE[family];
}

/** Type guard — true when `s` is one of the three logical
 *  family tokens. Useful for validating user-typed input or
 *  storage payloads before passing to the resolvers. */
export function isLogicalFamily(s: string | null | undefined): s is LogicalFamily {
  if (s == null) return false;
  return (LOGICAL_FAMILIES as readonly string[]).includes(s);
}

/** Coerce any string (legacy raw CSS family, plugin-author input,
 *  unknown storage payload) to one of the three logical tokens.
 *  Unknown / empty / null → `Annot Sans` so callers downstream
 *  (PPTX export, CSS resolver) always get a valid token.
 *
 *  Pre-release decision: legacy `data-font-family` values like
 *  `sans-serif` or `"Hiragino Kaku Gothic"` get coerced silently
 *  on next save. Per the plan, no migration shim is required. */
export function coerceToLogicalFamily(s: string | null | undefined): LogicalFamily {
  if (isLogicalFamily(s)) return s;
  return "Annot Sans";
}
