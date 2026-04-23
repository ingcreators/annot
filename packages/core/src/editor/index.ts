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
  ANNOT_SVG_VERSION_UNSTAMPED,
  ANNOT_SVG_VERSION_ATTR,
  stampAnnotVersion,
  readAnnotVersion,
  getAnnotVersionFromString,
} from "./svg-format.js";

// ╭─ Editor UI (browser / DOM required) ────────────────────────────╮
// │ These hit `document` / `window`, subscribe to pointer events,   │
// │ manage live SVG nodes, etc. Safe only in a real browser (or     │
// │ jsdom-with-layout) environment.                                 │
// ╰─────────────────────────────────────────────────────────────────╯

// --- Canvas + core lifecycle ---
export { CanvasManager } from "./canvas-manager.js";
export { History } from "./history.js";
export { SelectionManager } from "./selection.js";

// --- Toolbar + property panel (+ shared UI helpers) ---
export {
  Toolbar,
  openAnchoredPopover,
  HIGHLIGHT_COLORS,
  highlightColorLabel,
  COUNTER_ICON_SVG,
  SHAPE_ICON_SVG,
  ARROW_ICON_SVG,
} from "./toolbar.js";
export type { ToolbarOptions } from "./toolbar.js";
export { PropertyPanel } from "./property-panel.js";
export { createColorPalette } from "./color-palette.js";
export { createThemeToggle } from "./theme-toggle.js";

// --- Serializers / file IO / clipboard ---
// Use DOMParser / XMLSerializer / Blob / URL.createObjectURL /
// navigator.clipboard internally.
export {
  exportSVGString,
  exportExcelSVG,
  saveToFile,
  saveAsEditableImage,
  downloadAsImage,
  copyAsImage,
  copyAnnotationsAsImage,
  getPngDataUrl,
  exportAnnotationsSvgForIdb,
  renderImageRecord,
} from "./export.js";

// --- Tool base class + options type ---
// Tools create live SVG nodes via `document.createElementNS` on
// pointer events; their shape-building logic is slated for extraction
// into DOM-free builders (tracked under the "headless annotator
// prototype" in docs/plans/).
export { ToolBase } from "./tools/tool-base.js";
export type { ToolOptions } from "./tools/tool-base.js";
