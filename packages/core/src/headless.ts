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

// ─── Logical font-family registry (Tier A) ───────────────────────────
// Phase 1 of `docs/plans/multilingual-fonts-os-stack.md`. Three logical
// tokens (`Annot Sans` / `Annot Serif` / `Annot Mono`) the editor
// stores in `data-font-family`. Resolvers map each token to:
//   - a CSS font stack (per-OS Latin / CJK / complex script fallback)
//   - an OOXML typeface triple (`<a:latin>` + `<a:ea>` + `<a:cs>`)
// Pure strings + lookups, no DOM. Importable from the pptx exporter
// + the editor UI alike.
export {
  coerceToLogicalFamily,
  cssStackFor,
  isLogicalFamily,
  LOGICAL_FAMILIES,
  type LogicalFamily,
  ooxmlTypefacesFor,
} from "./editor/font-registry.js";
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
// ─── Builtin icon registry (Tier B pure data) ─────────────────────────
// Phase 2 of `docs/plans/svg-icons-and-plugin-icon-spec.md`. Single
// source of truth for the SVG strings backing every
// `IconSpec({ kind: "builtin", id })` look-up. Material Symbols glyphs
// (Apache-2.0, Copyright Google LLC) extracted via
// `scripts/extract-material-symbols.mjs`, plus the hand-rolled
// `shape.*` / `arrow.*` / `counter.*` groups previously in
// `toolbar-icons.ts`.
//
// Note: `BuiltinIconId` here is the NARROW `keyof typeof
// BUILTIN_ICONS` literal union — autocomplete + compile-time typo
// errors flow to every consumer that imports from this entry point
// (or from the `/icons` subpath, which re-exports it).
export {
  BUILTIN_ICON_IDS,
  BUILTIN_ICONS,
  type BuiltinIconId,
  resolveBuiltinIcon,
} from "./editor/icons/registry.js";
// ─── Icon renderer + sanitiser (Tier B Element-takers) ────────────────
// Phase 3 of `docs/plans/svg-icons-and-plugin-icon-spec.md`.
// `renderIconHtml(spec)` dispatches on `IconSpec.kind` and produces
// the markup string Lit `unsafeHTML` / `<annot-icon>` consume.
// `sanitizeIconSvg(input)` is the allow-list walker that gates plugin-
// supplied `kind: "svg"` markup. Both are Tier-B (jsdom-friendly
// DOMParser usage); loadable in pure Node + jsdom for tests.
export { renderIconElement, renderIconHtml } from "./editor/icons/render.js";
export { sanitizeIconSvg } from "./editor/icons/sanitize.js";
// ─── SVG path-data utilities (pure string-in/string-out) ─────────────
// Phase 1 of `docs/plans/move-bakes-coordinates.md`. Translates every
// absolute coordinate inside a `<path>` element's `d` attribute by a
// world-space (dx, dy) delta — used by the move-baker for Freehand /
// Redact-path / future Focus-mask shapes. No DOM dependency.
export { translatePathD } from "./editor/path-utils.js";
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
  PROPERTY_CONTROLS,
  PROPERTY_EFFECT_IDS,
  type PropertyCategory,
  type PropertyControlDef,
  type PropertyControlId,
  type PropertyControlOption,
  type PropertyControlType,
  type PropertyEffectId,
} from "./editor/property-schema.js";
// ─── Selection geometry (pure math: snap, rotate, cursor lookup) ──────
// Used by SelectionManager + smart-guide overlay (Tier C) and reusable
// from any headless layout/snap simulator. Plain numbers + Rect-shaped
// inputs only — no DOM access.
export {
  computeSnap,
  cursorForAngle,
  type Rect,
  rotateAround,
  type SnapGuide,
  type SnapInput,
  type SnapResult,
} from "./editor/selection-geometry.js";
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
// ─── Tool-side panel value adapters (pure data + closures) ────────────
// Companion to `panelControls` in `tool-registry`: maps each id used
// in those arrays onto a `(preset, value, toolId) => void` mutation
// against `ToolOptions`. Phase 1 of
// `docs/plans/tool-property-renderer-schema.md` ships the data only;
// Phase 2's renderer (Tier C) is the first reader.
export {
  selectionDefMetadata,
  TOOL_PANEL_ADAPTER_IDS,
  TOOL_PANEL_ADAPTERS,
  type ToolPanelAdapter,
  type ToolPanelAdapterId,
  type ToolPanelAdapterMetadata,
} from "./editor/tool-panel-adapter.js";
// ─── Toolbar preset (de)serializer (pure data conversion) ─────────────
// Companion to `tool-registry`: walks `presetFields` and converts a
// `ToolOptions` ↔ wire-record pair via the shared camelCase ↔
// snake_case table. Used by the Toolbar to drive both the Tauri YAML
// path and the localStorage / chrome.storage paths from one source
// of truth.
export {
  fieldForSnakeKey,
  type PresetWireFormat,
  presetFromWire,
  presetToWire,
} from "./editor/tool-preset-serde.js";
// ─── Toolbar tool registry (pure data + jsdom-friendly classifiers) ──
// Tier B metadata describing every toolbar tool: id / label / icon /
// variants / preset field set / element-to-key classifier. The
// classifier callbacks (`variantKeyForElement`) take an Element but
// don't touch `document` / `window`, so the module loads cleanly in
// pure Node. Sibling to `property-schema` — same pattern (declarative
// registry replacing imperative chains) applied to the toolbar.
export {
  normalizeVariantSideFields,
  TOOL_PANEL_EXTRA_CONTROL_IDS,
  TOOL_REGISTRY,
  TOOL_REGISTRY_IDS,
  type ToolPanelControlDef,
  type ToolPanelExtraControlId,
  type ToolPanelSection,
  type ToolRegistryEntry,
  type ToolRegistryId,
  type ToolRegistryVariant,
} from "./editor/tool-registry.js";
// ─── Toolbar universal-style attribute reader (pure Element-taker) ────
// Single source of truth for "read stroke / fill / dasharray / opacity
// / linecap / linejoin off an Element into a preset" — used by both
// `Toolbar.syncPresetFromElement` and `seedPresetFromElement`. The
// freehand-group → last-path-child fallback is encapsulated inside.
export {
  readUniversalStyleAttrs,
  resolveStyleReadSource,
} from "./editor/tool-style-reader.js";
// ─── Toolbar universal-style attribute writer (pure Element-taker) ────
// Inverse of `readUniversalStyleAttrs`: takes a preset and writes the
// stroke / fill / dasharray / opacity / linecap / linejoin attrs onto
// an Element. Phase 1 of `docs/plans/toolbar-apply-style-to-element.md`
// — used by per-tool `applyStyleToElement` callbacks (Phase 2) and the
// future generic dispatch in `applyPresetStyleAttrs` (Phase 3).
export { writeUniversalStyleAttrs } from "./editor/tool-style-writer.js";
// ─── Viewport math (pure number-in/number-out) ────────────────────────
// Used by `CanvasManager` (live editor, in `@ingcreators/annot-editor`)
// and reusable by future headless viewport simulators.
export {
  type AffineMatrix,
  applyInverseAffine,
  clampZoom,
  computeFitZoom,
  computeRenderedSize,
  DEFAULT_MAX_ZOOM,
  DEFAULT_MIN_ZOOM,
  FIT_VIEW_PADDING,
} from "./editor/viewport-math.js";
// ─── ElementTree canonical screen-capture model (Tier A) ─────────────
// Phase 1a of `docs/plans/living-spec-authoring-roadmap.md`.
// Single source-agnostic model for "what's on this page" — consumed
// by every capture source (browser extension, Playwright, future
// Figma / OCR adapters) and every downstream reader (editor, Astro
// Image Service, drift detector, MCP tools). Pure data types +
// serializers + traversal helpers; no DOM.
export {
  type BBox,
  type ElementMatch,
  type ElementNode,
  type ElementTree,
  type ElementTreeSource,
  type ElementTreeViewport,
  type ElementTreeVisitor,
  findByMatch,
  findByRef,
  flattenTree,
  isElementTreeShape,
  parseElementTreeFromJson,
  parseElementTreeFromYaml,
  serializeElementTreeToJson,
  serializeElementTreeToYaml,
  validateElementTree,
  walkTree,
} from "./element-tree/index.js";
// ─── Icon descriptor (Tier A pure types + value-level helpers) ────────
// Phase 1 of `docs/plans/svg-icons-and-plugin-icon-spec.md`. The
// `IconSpec` discriminated union is the public, plugin-facing handle
// for "render this icon here". Hosts and plugins both produce `IconSpec`
// values; the renderer (Phase 3, Tier B) consumes them. Pure types +
// constructor helpers + type guards — no DOM, no Element imports.
export {
  builtinIcon,
  type IconSpec,
  isBuiltinIcon,
  isSvgIcon,
  isUrlIcon,
  svgIcon,
  urlIcon,
} from "./icons/types.js";
// ─── Storage error hierarchy (pure ES2022 classes) ────────────────────
// Phase 2 of `docs/plans/storage-error-contract.md`. Backs the
// `@throws` clauses documented on each `StorageProvider` method.
// Tier A — no DOM, no Node-only APIs; safe under jsdom / pure Node.
export {
  StorageConflictError,
  StorageError,
  type StorageErrorCode,
  StorageNotFoundError,
  StoragePermissionError,
  StorageQuotaError,
} from "./storage/errors.js";
// ─── Metadata cache (Tier A interface + capability + predicate) ───────
// Phase 1 of `docs/plans/shared-metadata-cache.md`. Shared cache
// layer for `ImageRecord` / `DocumentRecord` / folder listings,
// pluggable via the `StorageWithMetadataCache` capability. The
// first-party `IndexedDBMetadataCache` in
// `@ingcreators/annot-host-ui` is the canonical browser-side impl;
// tests / Node hosts swap in an in-memory mock. Pure types + a
// runtime `supportsMetadataCache` predicate — no DOM.
export {
  type ListingEntry,
  type ListingEntryKind,
  type MetadataCache,
  MetadataCacheError,
  MetadataCacheQuotaError,
  type StorageWithMetadataCache,
  supportsMetadataCache,
} from "./storage/metadata-cache.js";
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
export {
  type CachedThumbnail,
  type ThumbnailCache,
  ThumbnailCacheError,
  type ThumbnailCacheGetRequest,
  ThumbnailCacheQuotaError,
} from "./storage/thumbnail-cache.js";
// ─── Storage types (pure types) ───────────────────────────────────────
export type {
  DocumentRecord,
  DocumentRecordUpdate,
  FolderRecord,
  ImageRecord,
  ImageRecordUpdate,
  StorageProvider,
  StorageWithDocuments,
  StorageWithForceRefresh,
  StorageWithInit,
  StorageWithRateLimit,
  StorageWithResync,
  StorageWithTokenRefresher,
} from "./storage/types.js";
export {
  supportsDocuments,
  supportsForceRefresh,
  supportsInit,
  supportsRateLimit,
  supportsResync,
  supportsTokenRefresher,
} from "./storage/types.js";
// ─── Assertions (pure runtime guard for non-null invariants) ──────────
export { assertNonNull } from "./utils/assert.js";
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
// ─── Default filename helpers (pure date math + string concat) ───────
// Single source of truth for the `annot-YYYYMMDD-HHMMSS-SSS` shape that
// every storage backend (browser, device, GitHub, Drive, extension IDB)
// uses when the caller doesn't supply a filename.
export {
  ANNOT_FILENAME_PREFIX,
  defaultAnnotFilenameStem,
  defaultAnnotImageFilename,
  formatLocalTimestamp,
} from "./utils/filename.js";
// ─── ID generation (Web Crypto, Node 19+ or `node:crypto` webcrypto) ──
export { newIdB58 } from "./utils/id.js";
// ─── ElementTree PNG XMP payload (Tier A) ────────────────────────────
// Phase 1d of `docs/plans/living-spec-authoring-roadmap.md`. PNG
// iTXt chunk read / write keyed by `annot:elementTree`,
// deflate-compressed YAML. See `docs/element-tree.md` for the wire
// format spec.
export {
  ELEMENT_TREE_ITXT_KEYWORD,
  hasElementTreePng,
  readElementTreePng,
  writeElementTreePng,
} from "./xmp/element-tree-payload.js";
// ─── ZIP builder (Uint8Array + Blob; no DOM) ──────────────────────────
export { buildZip, dataUrlExt, dataUrlToBytes } from "./zip/zip-builder.js";
