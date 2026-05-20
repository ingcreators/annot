/**
 * Micro-benchmark for `quantizeMedianCut` — the FS-dither inner loop is
 * the hottest path in the client-capture encode pipeline, and the
 * Phase 1 fix in
 * `docs/plans/_done/quantizer-nearest-palette-acceleration.md` wraps it
 * with a per-encode `Map<rgb24, paletteIdx>` cache. Run this to see the
 * wall-clock impact across three representative sizes × three
 * representative input shapes.
 *
 *   pnpm --filter @ingcreators/annot-core bench:quantize
 *
 * Output is one row per (size × shape) reporting median ms over
 * `MEASURED_ITERATIONS` runs after `WARMUP_ITERATIONS` warm-up runs.
 * Pure Node, no DOM, no browser. Not part of the CI test suite — runs
 * on demand only.
 */
import { quantizeMedianCut } from "../src/encode/quantize-median-cut.ts";

const WARMUP_ITERATIONS = 3;
const MEASURED_ITERATIONS = 7;

/** Pixel counts roughly matching real-world capture sizes. */
const SIZES: Array<{ label: string; w: number; h: number }> = [
  { label: "1 MP  (1280× 800)", w: 1280, h: 800 },
  { label: "4 MP  (2048×2048)", w: 2048, h: 2048 },
  { label: "8 MP  (3840×2160)", w: 3840, h: 2160 },
];

/** Input fixture generators. UI-like = limited unique colours; "code"
 *  = high-frequency thin gradients (text antialiasing-ish); "photo"
 *  = noisy gradient (worst case for the cache, kept as a control). */
const FIXTURES: Array<{ label: string; fill: (w: number, h: number) => Uint8Array }> = [
  {
    label: "ui     ",
    fill: makeUiFixture,
  },
  {
    label: "code   ",
    fill: makeCodeFixture,
  },
  {
    label: "photo  ",
    fill: makePhotoFixture,
  },
];

function makeUiFixture(w: number, h: number): Uint8Array {
  // 12 distinct colours over a checker pattern. Mimics a typical UI
  // capture: large flat regions, occasional 1 px transitions.
  const palette: Array<[number, number, number]> = [
    [255, 255, 255],
    [240, 240, 240],
    [220, 220, 220],
    [40, 40, 40],
    [20, 100, 200],
    [200, 50, 50],
    [40, 160, 60],
    [180, 130, 30],
    [120, 80, 200],
    [255, 200, 80],
    [100, 100, 100],
    [60, 60, 60],
  ];
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = ((x / 80) | 0) + ((y / 80) | 0);
      const [r, g, b] = palette[cell % palette.length]!;
      const i = (y * w + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

function makeCodeFixture(w: number, h: number): Uint8Array {
  // White background, narrow horizontal text-row bands with mid-grey
  // antialiased "glyphs". Higher unique-colour count than `ui` but
  // still UI-ish in distribution.
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const rowKind = (y / 18) | 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const glyph = (x + rowKind * 7) % 11 < 4;
      const aa = glyph ? 40 + ((x * 13) % 80) : 240 + ((x * 17) % 16);
      const v = Math.min(255, Math.max(0, aa));
      buf[i] = v;
      buf[i + 1] = v;
      buf[i + 2] = v;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

function makePhotoFixture(w: number, h: number): Uint8Array {
  // Photo-like noisy gradient — high unique-colour count, low cache
  // hit rate. Kept as a worst-case control. Production photo-like
  // captures route through JPEG fallback, never reaching this code.
  const buf = new Uint8Array(w * h * 4);
  let n = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      n = (n * 1103515245 + 12345) & 0x7fffffff;
      const noise = (n >>> 16) & 0x1f;
      buf[i] = Math.min(255, ((x / w) * 200 + noise) | 0);
      buf[i + 1] = Math.min(255, ((y / h) * 200 + noise) | 0);
      buf[i + 2] = Math.min(255, ((x / w + y / h) * 100 + noise) | 0);
      buf[i + 3] = 255;
    }
  }
  return buf;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >>> 1;
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}

function bench(label: string, fn: () => unknown): number {
  for (let i = 0; i < WARMUP_ITERATIONS; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < MEASURED_ITERATIONS; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  const med = median(samples);
  console.log(
    `  ${label}  median=${med.toFixed(1).padStart(7)} ms   samples=${samples.map((s) => s.toFixed(0)).join(",")}`,
  );
  return med;
}

function main(): void {
  console.log(
    `quantizeMedianCut bench — warmup=${WARMUP_ITERATIONS}  measured=${MEASURED_ITERATIONS}\n`,
  );
  for (const sz of SIZES) {
    console.log(`size = ${sz.label}`);
    for (const fix of FIXTURES) {
      const buf = fix.fill(sz.w, sz.h);
      bench(`${fix.label}`, () => quantizeMedianCut(buf, sz.w, sz.h, 256));
    }
    console.log();
  }
}

main();
