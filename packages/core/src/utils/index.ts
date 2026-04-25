export { assertNonNull } from "./assert.js";
export {
  DEFAULT_FILL_COLOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_STROKE_COLOR,
  DEFAULT_STROKE_WIDTH,
  JPEG_QUALITY,
  MOSAIC_BLOCK_SIZE,
} from "./constants.js";
export { computeDasharray, detectDashKey } from "./dash-utils.js";
export { newIdB58 } from "./id.js";
export type {
  AnnotationShape,
  ToolPreset,
  ToolPresets,
} from "./tauri-bridge.js";
export {
  copyAsOffice,
  isTauri,
  loadToolPresets,
  readXmp,
  saveToolPresets,
  saveWithXmp,
} from "./tauri-bridge.js";
