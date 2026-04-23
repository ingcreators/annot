export { computeDasharray, detectDashKey } from "./dash-utils.js";
export {
  DEFAULT_STROKE_COLOR,
  DEFAULT_FILL_COLOR,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_FONT_SIZE,
  MOSAIC_BLOCK_SIZE,
  JPEG_QUALITY,
} from "./constants.js";
export {
  isTauri,
  copyAsOffice,
  loadToolPresets,
  saveToolPresets,
  saveWithXmp,
  readXmp,
} from "./tauri-bridge.js";
export type {
  AnnotationShape,
  ToolPreset,
  ToolPresets,
} from "./tauri-bridge.js";
export { newIdB58 } from "./id.js";
export { setTooltip, getTooltip } from "./tooltip.js";
