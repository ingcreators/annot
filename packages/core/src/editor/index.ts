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
export {
  applyInverseAffine,
  clampZoom,
  computeFitZoom,
  computeRenderedSize,
  DEFAULT_MAX_ZOOM,
  DEFAULT_MIN_ZOOM,
  FIT_VIEW_PADDING,
  type AffineMatrix,
} from "./viewport-math.js";
export {
  createHistoryCore,
  DEFAULT_HISTORY_DEPTH,
  type HistoryCore,
  type HistoryHooks,
} from "./history-core.js";
export {
  CATEGORY_CONTROL_SHAPE,
  classifyPropertyElement,
  classifyPropertySelection,
  PROPERTY_CONTROL_IDS,
  type PropertyCategory,
  type PropertyControlId,
} from "./property-schema.js";
export {
  computeSnap,
  cursorForAngle,
  rotateAround,
  type Rect,
  type SnapGuide,
  type SnapInput,
  type SnapResult,
} from "./selection-geometry.js";
export {
  createMockToolSurface,
  type MockToolSurface,
  type ToolDOMSurface,
} from "./tool-lifecycle.js";

// ╭─ Editor UI (browser / DOM required) ────────────────────────────╮
// │ These hit `document` / `window`, subscribe to pointer events,   │
// │ manage live SVG nodes, etc. Safe only in a real browser (or     │
// │ jsdom-with-layout) environment.                                 │
// ╰─────────────────────────────────────────────────────────────────╯

// --- Canvas + core lifecycle ---
// `CanvasManager` and `createColorPalette` moved to
// `@ingcreators/annot-editor` in Phases 6 / 8 of
// `docs/plans/three-package-split.md`.
// --- Serializers / file IO / clipboard ---
// `export.ts` (CanvasManager-coupled portion) moved to
// `@ingcreators/annot-editor` in Phase 8. `renderImageRecord`
// (data-driven counterpart) moved to `@ingcreators/annot-render`.
// `History` moved to `@ingcreators/annot-editor` in Phase 7 of
// `docs/plans/three-package-split.md`.
// `PropertyPanel` and `SelectionManager` moved to `@ingcreators/annot-editor`
// in Phases 2 / 5 of `docs/plans/three-package-split.md`. Consumers
// should `import { PropertyPanel, SelectionManager } from "@ingcreators/annot-editor"`.
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
// `openAnchoredPopover` moved to `@ingcreators/annot-editor` in
// Phase 6 of `docs/plans/three-package-split.md`.
// `ToolBase` + `ToolOptions` moved to `@ingcreators/annot-editor/tools/tool-base`
// in Phase 2 of `docs/plans/three-package-split.md`. Consumers
// should `import { ToolBase, type ToolOptions } from "@ingcreators/annot-editor"`.
