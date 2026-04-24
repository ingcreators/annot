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

// ─── ID generation (Web Crypto, Node 19+ or `node:crypto` webcrypto) ──
export { newIdB58 } from "./utils/id.js";

// ─── ZIP builder (Uint8Array + Blob; no DOM) ──────────────────────────
export { buildZip, dataUrlExt, dataUrlToBytes } from "./zip/zip-builder.js";
