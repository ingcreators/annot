// @ingcreators/annot-core/headless — DOM-free public API surface.
//
// Entry point for callers that run OUTSIDE the browser: the future
// `@ingcreators/annot-annotator` headless library, the Playwright fixture,
// the GitHub Action, and any Node-based tooling.
//
// Contract: **every symbol exported from this file works with only a
// minimal DOM-ish Element shim (or none at all).** No reference to
// `document`, `window`, `navigator`, `HTMLElement`, clipboard,
// drag/drop, file system, or Tauri globals is pulled in by importing
// `@ingcreators/annot-core/headless`.
//
// The browser-wide public API still lives in `src/index.ts` and
// continues to re-export everything here plus the editor UI. This
// file is purely ADDITIVE — no consumer is forced to migrate.
//
// When adding a new symbol:
//   1. Decide whether it can run under Node (+ jsdom / resvg-js).
//   2. If yes, export from the matching source module and add it
//      here AND in `src/index.ts`.
//   3. If no, add it ONLY in `src/index.ts`.
// See PRODUCT_DIRECTION.md principle P2 for the underlying rule.

// ─── SVG format versioning ────────────────────────────────────────────
// Element-taking helpers work with any DOM-ish Element (jsdom, etc.);
// the constants and string helper are pure.
export {
  ANNOT_SVG_VERSION,
  ANNOT_SVG_VERSION_ATTR,
  ANNOT_SVG_VERSION_UNSTAMPED,
  getAnnotVersionFromString,
  readAnnotVersion,
  stampAnnotVersion,
} from "./editor/svg-format.js";

// ─── Viewport math (pure number-in/number-out) ────────────────────────
// Used by `CanvasManager` (live editor, in `@ingcreators/annot-editor`)
// and reusable by future headless viewport simulators.
export {
  applyInverseAffine,
  clampZoom,
  computeFitZoom,
  computeRenderedSize,
  DEFAULT_MAX_ZOOM,
  DEFAULT_MIN_ZOOM,
  FIT_VIEW_PADDING,
  type AffineMatrix,
} from "./editor/viewport-math.js";

// ─── Undo/redo stack management (pure string snapshots) ───────────────
// `History` (in `@ingcreators/annot-editor`) wraps this with the
// `innerHTML` adapter; headless callers can drive the same logic
// against any string-snapshot model.
export {
  createHistoryCore,
  DEFAULT_HISTORY_DEPTH,
  type HistoryCore,
  type HistoryHooks,
} from "./editor/history-core.js";

// ─── Property-panel category classifier + control-shape registry ──────
// Element-taking helpers (jsdom-friendly) used by the editor's
// PropertyPanel to decide which control set to render. No DOM
// globals touched at module load — safe to import in pure Node;
// calling the classifier requires an `Element` instance.
export {
  CATEGORY_CONTROL_SHAPE,
  classifyPropertyElement,
  classifyPropertySelection,
  PROPERTY_CONTROL_IDS,
  type PropertyCategory,
  type PropertyControlId,
} from "./editor/property-schema.js";

// ─── Selection geometry (pure math: snap, rotate, cursor lookup) ──────
// Used by SelectionManager + smart-guide overlay (Tier C) and reusable
// from any headless layout/snap simulator. Plain numbers + Rect-shaped
// inputs only — no DOM access.
export {
  computeSnap,
  cursorForAngle,
  rotateAround,
  type Rect,
  type SnapGuide,
  type SnapInput,
  type SnapResult,
} from "./editor/selection-geometry.js";

// ─── Tool lifecycle DOM surface ───────────────────────────────────────
// Three-method abstraction every editor tool depends on for canvas
// access. Live-canvas adapters live in
// `@ingcreators/annot-editor/tools/canvas-tool-surface`; the test
// helper `createMockToolSurface` is published here so plugin authors
// can drive their tools against an inert sink in unit tests.
export {
  createMockToolSurface,
  type MockToolSurface,
  type ToolDOMSurface,
} from "./editor/tool-lifecycle.js";

// ─── Path utilities (pure string manipulation) ────────────────────────
export {
  ancestorPaths,
  getFilename,
  getParentPath,
  isDescendantOrSame,
  joinPath,
  ROOT_PATH,
  rewritePathPrefix,
  splitExt,
  splitPath,
  uniquifyFilename,
  uniquifyFilenameAsync,
  validateName,
} from "./storage/path.js";
// ─── Storage types (pure types) ───────────────────────────────────────
export type {
  FolderRecord,
  ImageRecord,
  ImageRecordUpdate,
  PageElement,
  PageMetadata,
  StorageProvider,
  StorageWithForceRefresh,
  StorageWithInit,
  StorageWithRateLimit,
  StorageWithResync,
  StorageWithTokenRefresher,
} from "./storage/types.js";
export {
  supportsForceRefresh,
  supportsInit,
  supportsRateLimit,
  supportsResync,
  supportsTokenRefresher,
} from "./storage/types.js";

// ─── Style constants + dash utilities ─────────────────────────────────
// Shared defaults so headless and UI-driven annotations produce the
// same defaults unless explicitly overridden.
export {
  DEFAULT_FILL_COLOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_STROKE_COLOR,
  DEFAULT_STROKE_WIDTH,
  JPEG_QUALITY,
  MOSAIC_BLOCK_SIZE,
} from "./utils/constants.js";
export { computeDasharray, detectDashKey } from "./utils/dash-utils.js";

// ─── Assertions (pure runtime guard for non-null invariants) ──────────
export { assertNonNull } from "./utils/assert.js";

// ─── ID generation (Web Crypto, Node 19+ or `node:crypto` webcrypto) ──
export { newIdB58 } from "./utils/id.js";

// ─── ZIP builder (Uint8Array + Blob; no DOM) ──────────────────────────
export { buildZip, dataUrlExt, dataUrlToBytes } from "./zip/zip-builder.js";
