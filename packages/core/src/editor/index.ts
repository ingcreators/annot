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
// `createThemeToggle` moved to `@ingcreators/annot-editor` in
// Phase 1 of `docs/plans/three-package-split.md`. Consumers
// should `import { createThemeToggle } from "@ingcreators/annot-editor"`.
// --- Shared UI helpers used by PropertyPanel + the relocated Toolbar ---
// Phase 5a moved the Toolbar class to `@ingcreators/annot-web`; the
// icon catalogues + popover helper stayed here because PropertyPanel
// (which lives in core) consumes them.
export {
  ARROW_ICON_SVG,
  COUNTER_ICON_SVG,
  HIGHLIGHT_COLORS,
  highlightColorLabel,
  SHAPE_ICON_SVG,
} from "./toolbar-icons.js";
export { openAnchoredPopover } from "./anchored-popover.js";
export type { ToolOptions } from "./tools/tool-base.js";
// --- Tool base class + options type ---
// Tools create live SVG nodes via `document.createElementNS` on
// pointer events; their shape-building logic is slated for extraction
// into DOM-free builders (tracked under the "headless annotator
// prototype" in docs/plans/).
export { ToolBase } from "./tools/tool-base.js";
