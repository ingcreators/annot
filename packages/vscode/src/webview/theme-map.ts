/**
 * Annot ↔ VSCode theme token mapping.
 *
 * Annot's editor styles target the host-neutral `--annot-*`
 * design-system tokens defined in
 * `packages/core/styles/editor.css`. Inside a VSCode webview
 * we want those tokens to resolve to the equivalent VSCode
 * workbench colors (`--vscode-*`) so the editor follows
 * whichever theme the user has installed (Light, Dark, High
 * Contrast, Tokyo Night, Solarized, anything from the
 * marketplace).
 *
 * The mapping is the standard VSCode-extension pattern: every
 * `--annot-*` token maps to a semantically-matching
 * `--vscode-*` variable. VSCode keeps its own variables in
 * sync with the active theme automatically — the
 * `themeOverrides` we install on the shell container apply on
 * mount, and from then on theme changes propagate via the
 * existing CSS variable cascade with no further
 * postMessage round-trips.
 *
 * `var()` chains include sensible fallbacks for VSCode
 * variables that don't always exist (HC theme often defines
 * fewer of them). The fallbacks themselves stay in the
 * `--vscode-*` family so the user's theme still drives the
 * resolved value.
 *
 * Reference: https://code.visualstudio.com/api/references/theme-color
 */

/**
 * Complete `--annot-*` → `var(--vscode-*)` table covering
 * every token defined in `packages/core/styles/editor.css`.
 * Order matches the file's section structure (Surface →
 * Content → Accent → Interaction → Canvas) so a side-by-side
 * diff with editor.css stays readable.
 */
export const VSCODE_THEME_MAP: Record<string, string> = {
  // === Surface — page / panel backdrops + chromeless decoration ===
  "--annot-bg-primary":
    "var(--vscode-sideBar-background, var(--vscode-editor-background))",
  "--annot-bg-secondary": "var(--vscode-editor-background)",
  "--annot-bg-panel":
    "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
  "--annot-bg-panel-deep":
    "var(--vscode-input-background, var(--vscode-editor-background))",
  "--annot-border-color":
    "var(--vscode-panel-border, var(--vscode-contrastBorder, transparent))",
  "--annot-border-subtle":
    "var(--vscode-widget-border, var(--vscode-panel-border, transparent))",
  "--annot-shadow":
    "var(--vscode-widget-shadow, 0 2px 8px rgba(0, 0, 0, 0.16))",

  // === Content — foreground text + reading primitives ===
  "--annot-text-primary": "var(--vscode-foreground)",
  "--annot-text-secondary":
    "var(--vscode-descriptionForeground, var(--vscode-foreground))",
  "--annot-text-muted":
    "var(--vscode-disabledForeground, var(--vscode-descriptionForeground, var(--vscode-foreground)))",
  "--annot-preview-line": "var(--vscode-foreground)",

  // === Accent — brand colour, active highlight, focus indicator ===
  "--annot-accent":
    "var(--vscode-button-background, var(--vscode-focusBorder))",
  "--annot-accent-2":
    "var(--vscode-charts-green, var(--vscode-button-background))",
  "--annot-accent-bg":
    "var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground))",
  "--annot-accent-hover":
    "var(--vscode-list-hoverBackground, var(--vscode-list-activeSelectionBackground))",
  "--annot-active-bg":
    "var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground))",
  "--annot-active-border":
    "var(--vscode-focusBorder, var(--vscode-button-background))",
  "--annot-chip-bg":
    "var(--vscode-badge-background, var(--vscode-list-activeSelectionBackground))",
  "--annot-focus-ring":
    "var(--vscode-focusBorder, var(--vscode-button-background))",

  // === Interaction — pointer + form states ===
  // Prefer `--vscode-toolbar-hoverBackground` over
  // `--vscode-list-hoverBackground`. Workbench themes use the
  // former for "hover state on interactive toolbar / button
  // surfaces" — it's a translucent overlay (e.g.
  // `rgba(90,93,94,0.31)` in Dark+) that paints brighter on dark
  // panels and darker on light ones, so it always reads as a
  // highlight. The list-* token is calibrated for tree row hover
  // and is a SOLID colour that's frequently darker than the
  // surrounding panel in dark themes (e.g. `#2A2D2E` over the
  // `#3C3C3C` `input-background` flyout panel) — the hover
  // surface ends up recessed instead of highlighted, which the
  // variant-flyout dark-mode screenshot exposed.
  "--annot-hover-bg":
    "var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground, transparent))",
  "--annot-hover-border":
    "var(--vscode-contrastActiveBorder, var(--vscode-panel-border, transparent))",
  // Annot's `choice-bg` is intentionally transparent in both
  // light and dark themes (the surrounding panel shows
  // through). Preserved literally — no VSCode variable adds
  // value here.
  "--annot-choice-bg": "transparent",
  "--annot-choice-hover": "var(--vscode-list-hoverBackground, transparent)",
  "--annot-choice-active":
    "var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground))",
  "--annot-input-bg":
    "var(--vscode-input-background, var(--vscode-editor-background))",
  "--annot-input-border":
    "var(--vscode-input-border, var(--vscode-panel-border, transparent))",

  // === Canvas — editor backdrop + transparency-grid checkerboard ===
  "--annot-canvas-bg": "var(--vscode-editor-background)",
  "--annot-canvas-check":
    "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
};
