// @ingcreators/annot-core — full public API.
//
// This is the browser-wide entry. Callers running in the browser
// (PWA, extension, Tauri desktop) import from here and get the
// complete surface: storage types, path utilities, SVG format
// helpers, plus the editor UI (CanvasManager, Toolbar, etc.).
//
// For headless / Node callers (the future `@ingcreators/annot-annotator`,
// Playwright fixture, GitHub Action) import from
// `@ingcreators/annot-core/headless` instead — that entry is guaranteed
// to not pull in any DOM-dependent code.
//
// See PRODUCT_DIRECTION.md principles P2 (DOM independence in core)
// and P6 (public API surface is explicit).

// ╭─────────────────────────────────────────────────────────────────╮
// │ HEADLESS-SAFE                                                    │
// │ Also exported from `@ingcreators/annot-core/headless`. Safe to use     │
// │ from Node (+ jsdom / resvg-js). Adding a symbol here should be   │
// │ mirrored in `src/headless.ts`.                                   │
// ╰─────────────────────────────────────────────────────────────────╯

// --- Editor SVG format versioning + misc pure helpers ---
// The editor/index.ts barrel mixes headless-safe (svg-format) with
// DOM-dependent exports (Toolbar, CanvasManager, …). The re-export
// below carries both; the `headless.ts` entry opts out of the
// DOM-dependent ones.
export * from "./editor/index.js";

// --- Path utilities (pure string manipulation) ---
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
// --- Storage types (pure) ---
export type {
  FolderRecord,
  ImageRecord,
  ImageRecordUpdate,
  PageElement,
  PageMetadata,
  StorageProvider,
} from "./storage/types.js";
// --- Misc utilities (dash, constants, id, Tauri bridge) ---
// `./utils/index.js` includes a few DOM-dependent helpers (tooltip)
// and Tauri bridge calls. The headless entry reaches past this
// barrel directly to the pure submodules.
export * from "./utils/index.js";
// --- ZIP builder (Uint8Array + Blob; web standard) ---
export { buildZip, dataUrlExt, dataUrlToBytes } from "./zip/zip-builder.js";

// ╭─────────────────────────────────────────────────────────────────╮
// │ BROWSER-ONLY                                                     │
// │ These depend on `document` / `window` / Web APIs unavailable in  │
// │ plain Node. They power the PWA, extension, and desktop hosts —   │
// │ but must not be imported by code that may run headless.          │
// ╰─────────────────────────────────────────────────────────────────╯

export type { EditableImageOptions, SvgshotMetadata } from "./xmp/xmp-browser.js";
// --- Editable image (XMP) round-trip ---
export { createEditableImage, readEditableImage } from "./xmp/xmp-browser.js";

// Note: `CanvasManager`, `Toolbar`, `PropertyPanel`, `SelectionManager`,
// `History`, the `ToolBase` hierarchy, and every `export*Svg*` /
// `copy*` / `save*` function live in `./editor/index.js` above.
// They're re-exported as part of the editor barrel for legacy
// compatibility; downstream code that specifically wants the editor
// UI surface should prefer importing from `@ingcreators/annot-core/editor`
// for clarity.
