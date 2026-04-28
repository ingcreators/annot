export { assertNonNull } from "./assert.js";
export {
  DEFAULT_FILL_COLOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_STROKE_COLOR,
  DEFAULT_STROKE_WIDTH,
  JPEG_QUALITY,
  MOSAIC_BLOCK_SIZE,
  REDACT_BLUR_RADIUS,
  REDACT_SOLID_COLOR,
} from "./constants.js";
export { computeDasharray, detectDashKey } from "./dash-utils.js";
export {
  ANNOT_FILENAME_PREFIX,
  defaultAnnotFilenameStem,
  defaultAnnotImageFilename,
  formatLocalTimestamp,
} from "./filename.js";
export { newIdB58 } from "./id.js";
// `tauri-bridge` symbols moved to the dedicated
// `@ingcreators/annot-core/tauri-bridge` subpath in Stage 4-3 of
// the pre-release cleanup. They do `typeof window` detection at
// load time, which means they're browser-side; keeping them in
// the generic `utils` barrel made the subpath ambiguous about its
// DOM-dependency status.
