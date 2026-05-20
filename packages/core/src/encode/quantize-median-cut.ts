/**
 * Pure-TS palette quantizer (Median Cut + Floyd–Steinberg dither).
 *
 * Drop-in replacement for the WASM `quantize_image` from the
 * (GPL-3.0) `@ingcreators/annot-imagequant` package. Lives at
 * Tier A — no DOM, no canvas, no WASM. Importable from Node and
 * the browser identically.
 *
 * The API mirrors the existing internal contract so callers can
 * swap one for the other without touching anything else:
 *
 * ```ts
 * const { palette, indices } = quantizeMedianCut(rgba, w, h, 256);
 * ```
 *
 * - `palette`: flat RGBA8 bytes, length `numColors * 4`.
 * - `indices`: one byte per pixel, length `w * h`.
 *
 * Deterministic: same input always produces the same output.
 * Priority-queue ties are broken by insertion order; splits use
 * a stable sort. Useful for snapshot tests.
 *
 * Algorithm summary:
 *
 * 1. Build a histogram (Map<rgba32, count>) over the input.
 * 2. Split samples below an alpha threshold into a dedicated
 *    "transparent" palette entry (index 0).
 * 3. Place the remaining samples into a single bounding box and
 *    repeatedly split the highest-priority box along its longest
 *    RGB edge at the population-weighted median, until the
 *    target palette size is reached.
 * 4. Each box contributes one palette entry — the population-
 *    weighted mean of its samples.
 * 5. Remap the source image to palette indices with
 *    Floyd–Steinberg error diffusion in scanline order.
 *
 * @see `quantize-median-cut.test.ts` for the property tests.
 */

export interface QuantizeResult {
  /** Flat RGBA8 palette bytes, length = numColors * 4 (1 ≤ N ≤ 256). */
  palette: Uint8Array;
  /** One byte per pixel, indexing into the palette. */
  indices: Uint8Array;
}

/**
 * Quantize an RGBA image to ≤ `maxColors` palette entries.
 *
 * @param rgba   Packed RGBA8 input, length must equal `width*height*4`.
 * @param width  Image width in pixels (≥ 1).
 * @param height Image height in pixels (≥ 1).
 * @param maxColors Target palette size, clamped to [1, 256].
 */
export function quantizeMedianCut(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  maxColors: number,
): QuantizeResult {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`quantizeMedianCut: invalid width ${width}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error(`quantizeMedianCut: invalid height ${height}`);
  }
  const expectedLen = width * height * 4;
  if (rgba.length !== expectedLen) {
    throw new Error(
      `quantizeMedianCut: rgba length ${rgba.length} != width*height*4 = ${expectedLen}`,
    );
  }
  const k = Math.max(1, Math.min(256, Math.floor(maxColors)));

  const { opaqueSamples, hasTransparent, transparentCount } = buildHistogram(rgba);

  // Reserve one palette slot for the transparent bucket when present.
  const opaqueBudget = hasTransparent ? Math.max(1, k - 1) : k;

  const boxes = runMedianCut(opaqueSamples, opaqueBudget);

  // Build the palette. Transparent entry (if any) at index 0 so the
  // downstream `encodePng8` can truncate the `tRNS` chunk at the
  // first opaque entry per PNG spec (entries listed before the
  // first 0xFF alpha get encoded; trailing 0xFF entries elided).
  const opaqueCount = boxes.length;
  const numColors = opaqueCount + (hasTransparent ? 1 : 0);
  const palette = new Uint8Array(numColors * 4);
  let entryIdx = 0;
  if (hasTransparent) {
    // RGB doesn't matter for fully-transparent entries; zero is fine.
    palette[0] = 0;
    palette[1] = 0;
    palette[2] = 0;
    palette[3] = 0;
    entryIdx = 1;
  }
  const opaquePaletteStart = entryIdx * 4;
  for (let i = 0; i < opaqueCount; i++) {
    const box = boxes[i]!;
    const base = (entryIdx + i) * 4;
    palette[base] = box.rMean;
    palette[base + 1] = box.gMean;
    palette[base + 2] = box.bMean;
    palette[base + 3] = 255;
  }

  const indices = remapWithFloydSteinberg(
    rgba,
    width,
    height,
    palette,
    opaquePaletteStart,
    hasTransparent,
    transparentCount > 0,
  );

  return { palette, indices };
}

// ---- Internals ----

/** Alpha values below this threshold are treated as fully transparent. */
const ALPHA_TRANSPARENT_THRESHOLD = 16;

interface Sample {
  r: number;
  g: number;
  b: number;
  count: number;
}

interface Box {
  /**
   * Indices into the shared `Sample[]` histogram. We keep this as a
   * `[start, end)` range over a single flat array so splits are
   * in-place sorts of the sub-range. Saves allocations vs.
   * carrying per-box `Sample[]` slices.
   */
  start: number;
  end: number;
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
  population: number;
  /** Population-weighted mean R / G / B — the box's palette entry. */
  rMean: number;
  gMean: number;
  bMean: number;
  /** Priority = population × longest-edge length. Higher = pop first. */
  priority: number;
  /** Insertion order — stable tie-break for the priority queue. */
  insertOrder: number;
}

/**
 * Build a colour-histogram over the RGBA input. Pixels with
 * alpha < `ALPHA_TRANSPARENT_THRESHOLD` are pooled into the
 * transparent count; everything else is keyed by its (R,G,B)
 * triple (alpha bits ignored — palette entries are emitted as
 * fully opaque, dither handles partial-alpha pixels by mapping
 * them to the transparent entry).
 */
function buildHistogram(rgba: Uint8Array | Uint8ClampedArray): {
  opaqueSamples: Sample[];
  hasTransparent: boolean;
  transparentCount: number;
} {
  // Pack R,G,B into a 24-bit key for the histogram map.
  const counts = new Map<number, number>();
  let transparentCount = 0;
  const len = rgba.length;
  for (let i = 0; i < len; i += 4) {
    const a = rgba[i + 3]!;
    if (a < ALPHA_TRANSPARENT_THRESHOLD) {
      transparentCount++;
      continue;
    }
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const key = (r << 16) | (g << 8) | b;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const opaqueSamples: Sample[] = new Array(counts.size);
  let idx = 0;
  // Iterate in insertion order — `Map` preserves it — for
  // determinism of downstream sorts that may tie on the
  // split key.
  for (const [key, count] of counts) {
    opaqueSamples[idx++] = {
      r: (key >>> 16) & 0xff,
      g: (key >>> 8) & 0xff,
      b: key & 0xff,
      count,
    };
  }
  return {
    opaqueSamples,
    hasTransparent: transparentCount > 0,
    transparentCount,
  };
}

/**
 * Median-cut driver. Returns up to `maxBoxes` boxes ordered by
 * descending priority at extraction time (the priority queue is
 * drained for splitting, then the survivors are returned).
 */
function runMedianCut(samples: Sample[], maxBoxes: number): Box[] {
  if (samples.length === 0) return [];
  if (maxBoxes <= 1) {
    return [makeBoxFromRange(samples, 0, samples.length, 0)];
  }

  const initialBox = makeBoxFromRange(samples, 0, samples.length, 0);

  // Active list of boxes; we don't need a heap because the box
  // count is bounded by 256 and a linear scan to find the highest-
  // priority splittable box is fast enough at that scale.
  const boxes: Box[] = [initialBox];
  let nextInsertOrder = 1;

  while (boxes.length < maxBoxes) {
    // Find the splittable box with the highest priority.
    let bestIdx = -1;
    let bestPriority = -1;
    let bestInsert = Number.POSITIVE_INFINITY;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!;
      if (b.end - b.start < 2) continue; // singleton — not splittable
      if (
        b.priority > bestPriority ||
        (b.priority === bestPriority && b.insertOrder < bestInsert)
      ) {
        bestPriority = b.priority;
        bestInsert = b.insertOrder;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const target = boxes[bestIdx]!;

    // Pick the longest edge.
    const rRange = target.rMax - target.rMin;
    const gRange = target.gMax - target.gMin;
    const bRange = target.bMax - target.bMin;
    let axis: 0 | 1 | 2;
    if (rRange >= gRange && rRange >= bRange) axis = 0;
    else if (gRange >= bRange) axis = 1;
    else axis = 2;

    // Sort the box's samples by the chosen axis. Stable sort keeps
    // ties in histogram-insertion order for deterministic splits.
    sortRangeByAxis(samples, target.start, target.end, axis);

    // Walk the (now-sorted) sub-range and find the split index
    // where cumulative population first reaches half of total.
    const half = target.population >>> 1;
    let cum = 0;
    let splitIdx = target.start + 1;
    for (let i = target.start; i < target.end; i++) {
      cum += samples[i]!.count;
      if (cum >= half) {
        splitIdx = i + 1;
        break;
      }
    }
    // Edge cases: the median fell on the first or last sample.
    // Force at least one sample on each side.
    if (splitIdx <= target.start) splitIdx = target.start + 1;
    if (splitIdx >= target.end) splitIdx = target.end - 1;

    const left = makeBoxFromRange(samples, target.start, splitIdx, nextInsertOrder++);
    const right = makeBoxFromRange(samples, splitIdx, target.end, nextInsertOrder++);
    // Replace target with `left`, push `right`.
    boxes[bestIdx] = left;
    boxes.push(right);
  }

  return boxes;
}

function makeBoxFromRange(samples: Sample[], start: number, end: number, insertOrder: number): Box {
  let rMin = 255;
  let rMax = 0;
  let gMin = 255;
  let gMax = 0;
  let bMin = 255;
  let bMax = 0;
  let pop = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  for (let i = start; i < end; i++) {
    const s = samples[i]!;
    if (s.r < rMin) rMin = s.r;
    if (s.r > rMax) rMax = s.r;
    if (s.g < gMin) gMin = s.g;
    if (s.g > gMax) gMax = s.g;
    if (s.b < bMin) bMin = s.b;
    if (s.b > bMax) bMax = s.b;
    pop += s.count;
    rSum += s.r * s.count;
    gSum += s.g * s.count;
    bSum += s.b * s.count;
  }
  const longest = Math.max(rMax - rMin, gMax - gMin, bMax - bMin);
  // Guard against empty / zero-population boxes — caller should
  // never produce one, but a singleton fall-through after
  // pathological splits could divide-by-zero otherwise.
  const safePop = pop > 0 ? pop : 1;
  return {
    start,
    end,
    rMin,
    rMax,
    gMin,
    gMax,
    bMin,
    bMax,
    population: pop,
    rMean: Math.round(rSum / safePop),
    gMean: Math.round(gSum / safePop),
    bMean: Math.round(bSum / safePop),
    priority: pop * longest,
    insertOrder,
  };
}

/**
 * In-place stable sort of `samples[start..end)` by the specified
 * axis. We rely on the fact that V8's `Array.prototype.sort` is
 * stable as of ES2019. Done as an out-of-place sort of the slice
 * + write-back because in-place stable partial-sort is awkward in
 * JS — slice cost is dwarfed by the comparison cost.
 */
function sortRangeByAxis(samples: Sample[], start: number, end: number, axis: 0 | 1 | 2): void {
  const slice = samples.slice(start, end);
  if (axis === 0) slice.sort((a, b) => a.r - b.r);
  else if (axis === 1) slice.sort((a, b) => a.g - b.g);
  else slice.sort((a, b) => a.b - b.b);
  for (let i = 0; i < slice.length; i++) samples[start + i] = slice[i]!;
}

/**
 * Floyd–Steinberg remap. Walks the source image in scanline order,
 * picks the nearest palette entry for each pixel (linear search
 * over ≤ 256 opaque entries; transparent pixels short-circuit to
 * index 0 when present), then diffuses the per-channel residual to
 * the right + bottom-left + bottom + bottom-right neighbours with
 * the standard 7/16, 3/16, 5/16, 1/16 weights.
 *
 * Error accumulation uses two row buffers (current + next) so we
 * don't mutate the input array.
 */
function remapWithFloydSteinberg(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  palette: Uint8Array,
  opaquePaletteStart: number,
  hasTransparent: boolean,
  _transparentInUse: boolean,
): Uint8Array {
  const pixels = width * height;
  const indices = new Uint8Array(pixels);

  // Per-channel float error buffers for the current and next row.
  // 3 channels (RGB) × width. Allocated once + swapped per row.
  let errCurR = new Float32Array(width);
  let errCurG = new Float32Array(width);
  let errCurB = new Float32Array(width);
  let errNextR = new Float32Array(width);
  let errNextG = new Float32Array(width);
  let errNextB = new Float32Array(width);

  // Convert opaque palette section to plain arrays for the inner
  // nearest-search loop — avoids repeated `Uint8Array` index bounds
  // checks. The opaque section starts at `opaquePaletteStart` (in
  // BYTES into the palette buffer).
  const opaqueCount = (palette.length - opaquePaletteStart) >>> 2;
  const palR = new Int32Array(opaqueCount);
  const palG = new Int32Array(opaqueCount);
  const palB = new Int32Array(opaqueCount);
  for (let i = 0; i < opaqueCount; i++) {
    const base = opaquePaletteStart + i * 4;
    palR[i] = palette[base]!;
    palG[i] = palette[base + 1]!;
    palB[i] = palette[base + 2]!;
  }
  const opaqueIndexBase = hasTransparent ? 1 : 0;

  for (let y = 0; y < height; y++) {
    // Clear next-row buffers.
    errNextR.fill(0);
    errNextG.fill(0);
    errNextB.fill(0);

    for (let x = 0; x < width; x++) {
      const pixelIdx = y * width + x;
      const byteIdx = pixelIdx * 4;
      const a = rgba[byteIdx + 3]!;

      if (hasTransparent && a < ALPHA_TRANSPARENT_THRESHOLD) {
        indices[pixelIdx] = 0;
        continue;
      }

      const rIn = rgba[byteIdx]! + errCurR[x]!;
      const gIn = rgba[byteIdx + 1]! + errCurG[x]!;
      const bIn = rgba[byteIdx + 2]! + errCurB[x]!;

      // Find nearest opaque palette entry by squared Euclidean
      // distance. Linear over up to 256 entries.
      let bestIdx = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < opaqueCount; i++) {
        const dr = rIn - palR[i]!;
        const dg = gIn - palG[i]!;
        const db = bIn - palB[i]!;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      indices[pixelIdx] = opaqueIndexBase + bestIdx;

      const errR = rIn - palR[bestIdx]!;
      const errG = gIn - palG[bestIdx]!;
      const errB = bIn - palB[bestIdx]!;

      // Diffuse with Floyd–Steinberg coefficients.
      // Right neighbour (x+1, y): 7/16
      if (x + 1 < width) {
        errCurR[x + 1] = (errCurR[x + 1] ?? 0) + (errR * 7) / 16;
        errCurG[x + 1] = (errCurG[x + 1] ?? 0) + (errG * 7) / 16;
        errCurB[x + 1] = (errCurB[x + 1] ?? 0) + (errB * 7) / 16;
      }
      // Below-left (x-1, y+1): 3/16
      if (x > 0) {
        errNextR[x - 1] = (errNextR[x - 1] ?? 0) + (errR * 3) / 16;
        errNextG[x - 1] = (errNextG[x - 1] ?? 0) + (errG * 3) / 16;
        errNextB[x - 1] = (errNextB[x - 1] ?? 0) + (errB * 3) / 16;
      }
      // Below (x, y+1): 5/16
      errNextR[x] = (errNextR[x] ?? 0) + (errR * 5) / 16;
      errNextG[x] = (errNextG[x] ?? 0) + (errG * 5) / 16;
      errNextB[x] = (errNextB[x] ?? 0) + (errB * 5) / 16;
      // Below-right (x+1, y+1): 1/16
      if (x + 1 < width) {
        errNextR[x + 1] = (errNextR[x + 1] ?? 0) + (errR * 1) / 16;
        errNextG[x + 1] = (errNextG[x + 1] ?? 0) + (errG * 1) / 16;
        errNextB[x + 1] = (errNextB[x + 1] ?? 0) + (errB * 1) / 16;
      }
    }

    // Swap current / next error buffers.
    [errCurR, errNextR] = [errNextR, errCurR];
    [errCurG, errNextG] = [errNextG, errCurG];
    [errCurB, errNextB] = [errNextB, errCurB];
  }

  return indices;
}
