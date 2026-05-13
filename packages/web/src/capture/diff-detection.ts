/**
 * Pixel-delta + cursor-only-ignore heuristics for Auto Capture.
 * Pure functions over `ImageData` — testable under happy-dom and
 * usable from a worker if Phase 5 (deferred) decides to move the
 * engine off the main thread.
 *
 * Phase 4 of `docs/plans/web-capture-redesign.md`. The thresholds
 * are spec §10.4 / §10.6 starting points; every magic number is
 * a named constant so an ops change is one line.
 */

/** Per-channel delta sum above which a pixel is considered changed. */
export const PIXEL_DELTA_THRESHOLD = 30;

/** Bounding-box dimensions a localized change must stay below to be
 *  treated as a cursor movement. Apply on the downscaled comparison
 *  canvas (e.g. 320 × N px). */
export const CURSOR_ONLY_MAX_BOUNDS_WIDTH = 48;
export const CURSOR_ONLY_MAX_BOUNDS_HEIGHT = 48;

/** Maximum changed-pixel ratio for a cursor-only classification. */
export const CURSOR_ONLY_MAX_CHANGED_RATIO = 0.01;

/** Default ratio under which a frame is "no meaningful change". */
export const DEFAULT_CHANGE_RATIO_THRESHOLD = 0.03;

export interface DiffResult {
  changedPixels: number;
  changedRatio: number;
  averageDelta: number;
  /** Bounding box of all changed pixels in the comparison canvas's
   *  coordinate system. `null` when no pixels changed. */
  boundingBox: BoundingBox | null;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compare two same-size `ImageData` buffers and return aggregate
 * change metrics + the bounding box of all changed pixels.
 *
 * The two inputs MUST have identical width / height; the caller
 * downsamples both to the comparison canvas (`comparisonWidth ×
 * proportional height`) before calling.
 */
export function computeDiffScore(a: ImageData, b: ImageData): DiffResult {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `computeDiffScore: dimension mismatch (${a.width}×${a.height} vs ${b.width}×${b.height})`,
    );
  }
  const w = a.width;
  const h = a.height;
  const total = w * h;
  let changedPixels = 0;
  let totalDelta = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  // Walk RGBA quads. Alpha intentionally NOT counted — `getDisplayMedia`
  // streams are opaque so the alpha channel is constant 255 and adding
  // it to the delta only inflates `averageDelta` without informational
  // gain.
  for (let i = 0; i < a.data.length; i += 4) {
    const dr = Math.abs(a.data[i]! - b.data[i]!);
    const dg = Math.abs(a.data[i + 1]! - b.data[i + 1]!);
    const db = Math.abs(a.data[i + 2]! - b.data[i + 2]!);
    const delta = dr + dg + db;
    totalDelta += delta;
    if (delta > PIXEL_DELTA_THRESHOLD) {
      changedPixels++;
      const px = (i / 4) % w;
      const py = Math.floor(i / 4 / w);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }

  const boundingBox: BoundingBox | null =
    maxX >= 0
      ? {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        }
      : null;

  return {
    changedPixels,
    changedRatio: changedPixels / total,
    averageDelta: totalDelta / total,
    boundingBox,
  };
}

export interface CursorOnlyOptions {
  maxBoundsWidth?: number;
  maxBoundsHeight?: number;
  maxChangedRatio?: number;
}

/**
 * Classify a `DiffResult` as a cursor-only movement.
 *
 * Heuristic (spec §10.6):
 *   - changed-pixel ratio is below the cursor cap
 *   - the changed bounding box fits inside a cursor-sized rect
 *
 * Returns `false` when there's no change at all so the caller can
 * still treat genuinely identical frames separately.
 */
export function isCursorOnly(diff: DiffResult, opts: CursorOnlyOptions = {}): boolean {
  if (!diff.boundingBox || diff.changedPixels === 0) return false;
  const maxW = opts.maxBoundsWidth ?? CURSOR_ONLY_MAX_BOUNDS_WIDTH;
  const maxH = opts.maxBoundsHeight ?? CURSOR_ONLY_MAX_BOUNDS_HEIGHT;
  const maxRatio = opts.maxChangedRatio ?? CURSOR_ONLY_MAX_CHANGED_RATIO;
  if (diff.changedRatio > maxRatio) return false;
  if (diff.boundingBox.width > maxW) return false;
  if (diff.boundingBox.height > maxH) return false;
  return true;
}

/**
 * "Meaningful change" gate — true when the diff exceeds the
 * configured ratio threshold. Sits one rung above
 * `computeDiffScore` so callers don't have to remember the
 * threshold value.
 */
export function isMeaningfulChange(
  diff: DiffResult,
  threshold: number = DEFAULT_CHANGE_RATIO_THRESHOLD,
): boolean {
  return diff.changedRatio >= threshold;
}
