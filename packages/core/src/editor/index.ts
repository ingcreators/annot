// Public surface of the editor subpath. Mixes DOM-dependent UI
// (CanvasManager, Toolbar, …) with DOM-free pure helpers
// (SVG format versioning). Callers wanting only the headless-safe
// subset should import from `@ingcreators/annot-core/headless` instead
// of reaching into this barrel.
//
// See PRODUCT_DIRECTION.md principle P2 — headless independence is
// a first-class concern for the future `@ingcreators/annot-annotator`.

// ╭─ Headless-safe ─────────────────────────────────────────────────╮
// │ Pure strings / constants / Element-taking helpers with no       │
// │ reliance on browser globals. Also listed in `src/headless.ts`.  │
// ╰─────────────────────────────────────────────────────────────────╯
export {
  ANNOT_SVG_VERSION,
  ANNOT_SVG_VERSION_ATTR,
  ANNOT_SVG_VERSION_UNSTAMPED,
  getAnnotVersionFromString,
  readAnnotVersion,
  stampAnnotVersion,
} from "./svg-format.js";

// ╭─ Editor UI (browser / DOM required) ────────────────────────────╮
// │ These hit `document` / `window`, subscribe to pointer events,   │
// │ manage live SVG nodes, etc. Safe only in a real browser (or     │
// │ jsdom-with-layout) environment.                                 │
// ╰─────────────────────────────────────────────────────────────────╯

// --- Canvas + core lifecycle ---
export { CanvasManager } from "./canvas-manager.js";
export { createColorPalette } from "./color-palette.js";
// --- Serializers / file IO / clipboard ---
// Use DOMParser / XMLSerializer / Blob / URL.createObjectURL /
// navigator.clipboard internally.
export {
  copyAnnotationsAsImage,
  copyAsImage,
  downloadAsImage,
  exportAnnotationsSvgForIdb,
  exportExcelSVG,
  exportSVGString,
  getPngDataUrl,
  renderImageRecord,
  saveAsEditableImage,
  saveToFile,
} from "./export.js";
export { History } from "./history.js";
export { PropertyPanel } from "./property-panel.js";
export { SelectionManager } from "./selection.js";
export { createThemeToggle } from "./theme-toggle.js";
export type { ToolbarOptions } from "./toolbar.js";
// --- Toolbar + property panel (+ shared UI helpers) ---
export {
  ARROW_ICON_SVG,
  COUNTER_ICON_SVG,
  HIGHLIGHT_COLORS,
  highlightColorLabel,
  openAnchoredPopover,
  SHAPE_ICON_SVG,
  Toolbar,
} from "./toolbar.js";
export type { ToolOptions } from "./tools/tool-base.js";
// --- Tool base class + options type ---
// Tools create live SVG nodes via `document.createElementNS` on
// pointer events; their shape-building logic is slated for extraction
// into DOM-free builders (tracked under the "headless annotator
// prototype" in docs/plans/).
export { ToolBase } from "./tools/tool-base.js";
