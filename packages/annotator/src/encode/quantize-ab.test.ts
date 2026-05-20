// A/B comparison between the GPL-3.0 libimagequant WASM and the
// pure-TS Median Cut quantizer that supersedes it (Phase 1 of
// `docs/plans/replace-libimagequant-with-median-cut.md`).
//
// The test runs both quantizers over a small synthetic fixture
// corpus, encodes the result as PNG-8 via the shared encoder,
// and logs per-fixture metrics (palette size, reconstruction
// MSE, output byte size). The metrics surface in the Phase 1 PR
// description so reviewers can compare the two backends without
// having to run a Storybook visual diff.
//
// Why a `.test.ts` and not a one-off script: the metrics are
// load-bearing for Phase 2's "flip the default" decision, so
// running them on every PR catches regressions in the TS
// quantizer.
//
// The WASM side gracefully skips when imagequant isn't
// installed (same gate as `encode.test.ts`).

import { encodePng8 } from "@ingcreators/annot-core/encode/png8";
import { quantizeMedianCut } from "@ingcreators/annot-core/encode/quantize-median-cut";
import { describe, expect, test } from "vitest";
import { isImagequantAvailable, quantizeRgbaToPng8 } from "./quantize.js";

interface Fixture {
  name: string;
  width: number;
  height: number;
  rgba: Uint8Array;
}

function solidFixture(
  name: string,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
): Fixture {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return { name, width: w, height: h, rgba };
}

/**
 * Horizontal RGB gradient — a smooth-color stress test for the
 * dither (continuous tones quantized to <256 colours).
 */
function gradientFixture(name: string, w: number, h: number): Fixture {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = Math.round((x / (w - 1)) * 255);
      rgba[i + 1] = Math.round((y / (h - 1)) * 255);
      rgba[i + 2] = Math.round(((w - x) / (w - 1)) * 255);
      rgba[i + 3] = 255;
    }
  }
  return { name, width: w, height: h, rgba };
}

/**
 * UI-like fixture: a card with a coloured header, a body of
 * near-white, and a discrete palette of accent colours. Mimics
 * the dominant Annot workload (limited-palette screenshots).
 */
function uiLikeFixture(name: string, w: number, h: number): Fixture {
  const rgba = new Uint8Array(w * h * 4);
  const headerH = Math.round(h * 0.18);
  const accent: [number, number, number] = [37, 99, 235]; // tailwind blue-600
  const body: [number, number, number] = [248, 250, 252]; // slate-50
  const text: [number, number, number] = [15, 23, 42]; // slate-900
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r: number;
      let g: number;
      let b: number;
      if (y < headerH) {
        // Header — solid accent with a horizontal "title bar" simulation.
        [r, g, b] = accent;
      } else {
        // Body — alternating "text blocks" every 8th row of darker pixels.
        const isTextRow = y % 24 < 6 && x % 5 < 3;
        [r, g, b] = isTextRow ? text : body;
      }
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return { name, width: w, height: h, rgba };
}

/**
 * Code-editor-like fixture: dark background, syntax-coloured
 * "tokens" sprinkled in a deterministic pattern. Tests the
 * quantizer on the limited-but-saturated palette typical of
 * dark-theme dev tools.
 */
function codeEditorFixture(name: string, w: number, h: number): Fixture {
  const rgba = new Uint8Array(w * h * 4);
  const bg: [number, number, number] = [30, 30, 30];
  const tokens: [number, number, number][] = [
    [197, 134, 192], // keyword (purple)
    [86, 156, 214], // type (blue)
    [206, 145, 120], // string (orange)
    [220, 220, 170], // function (yellow)
    [212, 212, 212], // plain text (light grey)
    [106, 153, 85], // comment (green)
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const tokenIdx = ((x >> 2) + (y >> 1) * 3) % 13;
      const useToken = tokenIdx < tokens.length && (x + y) % 7 !== 0;
      const [r, g, b] = useToken ? tokens[tokenIdx]! : bg;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return { name, width: w, height: h, rgba };
}

const FIXTURES: Fixture[] = [
  solidFixture("solid", 64, 48, 200, 100, 50),
  uiLikeFixture("ui-card", 128, 96),
  codeEditorFixture("code-editor", 128, 96),
  gradientFixture("rgb-gradient", 96, 64),
];

/**
 * Mean Squared Error between the source RGBA and the
 * reconstructed RGBA built from `palette[indices[i]]`. Lower is
 * better. Pure RGB (alpha skipped) so the transparent-entry
 * convention doesn't pollute the metric.
 */
function reconstructionMse(source: Uint8Array, palette: Uint8Array, indices: Uint8Array): number {
  let sumSq = 0;
  let count = 0;
  for (let p = 0; p < indices.length; p++) {
    const palBase = indices[p]! * 4;
    const srcBase = p * 4;
    if (source[srcBase + 3]! < 16 && palette[palBase + 3]! < 16) continue; // both transparent
    const dr = source[srcBase]! - palette[palBase]!;
    const dg = source[srcBase + 1]! - palette[palBase + 1]!;
    const db = source[srcBase + 2]! - palette[palBase + 2]!;
    sumSq += dr * dr + dg * dg + db * db;
    count += 3;
  }
  return count === 0 ? 0 : sumSq / count;
}

interface Metric {
  fixture: string;
  backend: "wasm" | "median-cut";
  paletteEntries: number;
  png8Bytes: number;
  reconstructionMse: number;
}

describe("quantizer A/B comparison (Phase 1)", () => {
  test("reports per-fixture metrics for both backends", async () => {
    const wasmAvailable = await isImagequantAvailable();
    console.log(`[ab] wasm available: ${wasmAvailable}`);

    const metrics: Metric[] = [];

    for (const fx of FIXTURES) {
      // TS Median Cut.
      const ts = quantizeMedianCut(fx.rgba, fx.width, fx.height, 256);
      const tsPng8 = encodePng8(ts.palette, ts.indices, fx.width, fx.height, 9);
      metrics.push({
        fixture: fx.name,
        backend: "median-cut",
        paletteEntries: ts.palette.length / 4,
        png8Bytes: tsPng8.length,
        reconstructionMse: reconstructionMse(fx.rgba, ts.palette, ts.indices),
      });

      // WASM libimagequant (skipped if not installed).
      if (wasmAvailable) {
        const wasmPng8 = await quantizeRgbaToPng8(fx.rgba, fx.width, fx.height);
        expect(wasmPng8).not.toBeNull();
        // We can't recover the raw palette + indices from the
        // wasm path (it's bundled into the PNG already), so only
        // the encoded size is comparable here.
        metrics.push({
          fixture: fx.name,
          backend: "wasm",
          paletteEntries: Number.NaN, // unknown — emit-only path
          png8Bytes: wasmPng8!.length,
          reconstructionMse: Number.NaN, // ditto
        });
      }
    }

    // Pretty-print the metrics table so the Phase 1 PR
    // description can quote the run output verbatim.
    const header = "fixture          | backend     | palette | bytes  | mse";
    const sep = "-".repeat(header.length);
    const rows = metrics.map((m) => {
      const palette = Number.isNaN(m.paletteEntries)
        ? "  ?  "
        : String(m.paletteEntries).padStart(5);
      const mse = Number.isNaN(m.reconstructionMse) ? "  ?  " : m.reconstructionMse.toFixed(2);
      return `${m.fixture.padEnd(16)} | ${m.backend.padEnd(11)} | ${palette}   | ${String(m.png8Bytes).padStart(6)} | ${mse}`;
    });
    console.log(["", header, sep, ...rows, ""].join("\n"));

    // Sanity assertions on the TS side only — the WASM
    // side is exercised by `encode.test.ts` already.
    for (const m of metrics) {
      if (m.backend !== "median-cut") continue;
      expect(m.paletteEntries).toBeGreaterThan(0);
      expect(m.paletteEntries).toBeLessThanOrEqual(256);
      expect(m.png8Bytes).toBeGreaterThan(0);
      expect(m.reconstructionMse).toBeLessThan(50 * 50); // ≤ 50 px-channel RMS
    }
  });
});
