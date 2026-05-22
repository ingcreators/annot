/**
 * PNG XMP read/write for the canonical `annot:elementTree` payload.
 *
 * Phase 1d of `docs/plans/living-spec-authoring-roadmap.md`. Stores
 * an `ElementTree` (Phase 1a) as a deflate-compressed YAML string
 * in a PNG iTXt chunk keyed by `annot:elementTree`. Coexists with
 * the existing re-editable-image chunks (`iTXt` keyed by
 * `XML:com.adobe.xmp` for the SVG annotations; `svGo` for the
 * embedded original capture) — readers / writers operate on
 * independent chunk identities.
 *
 * Pure Tier A. Uses `pako` (already a dep of
 * `@ingcreators/annot-core`) for deflate. Documented wire format
 * lives in `docs/element-tree.md`.
 */

import { deflate, inflate } from "pako";

import type { ElementTree } from "../element-tree/index.js";
import { parseElementTreeFromYaml, serializeElementTreeToYaml } from "../element-tree/index.js";
import { buildPngChunk, concat, readU32be, startsWith } from "./xmp-bytes.js";

/**
 * iTXt chunk keyword identifying the ElementTree payload.
 * Differs from the editor's XMP keyword (`XML:com.adobe.xmp`) so
 * the two chunks can coexist on the same PNG.
 */
export const ELEMENT_TREE_ITXT_KEYWORD = "annot:elementTree";

const KEYWORD_BYTES = new TextEncoder().encode(ELEMENT_TREE_ITXT_KEYWORD);
const ITXT_TYPE = new TextEncoder().encode("iTXt");

/**
 * Write `tree` into a PNG's `annot:elementTree` iTXt chunk. The
 * chunk is deflate-compressed (compressionFlag=1) — ElementTree YAML
 * is verbose with high token repetition and compresses well.
 *
 * Any existing `annot:elementTree` chunk is replaced. Other chunks
 * (image data, editor XMP, embedded original via `svGo`) are
 * preserved verbatim.
 */
export function writeElementTreePng(pngData: Uint8Array, tree: ElementTree): Uint8Array {
  if (!isPng(pngData)) {
    throw new Error("writeElementTreePng: input is not a valid PNG (missing signature)");
  }
  const yaml = serializeElementTreeToYaml(tree);
  const yamlBytes = new TextEncoder().encode(yaml);
  // Pako returns Uint8Array. Cast explicitly to match our concat() input.
  const compressed = deflate(yamlBytes) as Uint8Array;

  const itxtData = concat(
    KEYWORD_BYTES,
    new Uint8Array([
      0, // null separator after keyword
      1, // compression flag: 1 = compressed
      0, // compression method: 0 = deflate (only valid value)
      0, // language tag (null-terminated, empty)
      0, // translated keyword (null-terminated, empty)
    ]),
    compressed,
  );
  const itxtChunk = buildPngChunk(ITXT_TYPE, itxtData);

  const cleaned = removeElementTreeChunk(pngData);
  // Insert before IEND (always the last 12 bytes — 4 length + 4 type + 0 data + 4 CRC).
  const insertPos = cleaned.length - 12;
  return concat(cleaned.slice(0, insertPos), itxtChunk, cleaned.slice(insertPos));
}

/**
 * Read the `annot:elementTree` payload from a PNG. Returns the
 * parsed `ElementTree`, or `null` when the input is not a PNG or
 * has no `annot:elementTree` chunk.
 *
 * Throws on schema-version mismatch (unknown major version) or
 * parse failure — silent ignore would mask data corruption. Callers
 * that need a tolerant read should wrap in try / catch.
 */
export function readElementTreePng(pngData: Uint8Array): ElementTree | null {
  if (!isPng(pngData)) return null;
  const yaml = extractElementTreeYaml(pngData);
  if (yaml === null) return null;
  const tree = parseElementTreeFromYaml(yaml);
  // Forward-compat: refuse unknown versions explicitly. Today the
  // schema is `version: 1`; a future v2 with shape-breaking changes
  // would land alongside a reader bump that handles both versions.
  if (tree.version !== 1) {
    throw new Error(
      `readElementTreePng: unsupported ElementTree schema version ${String(tree.version)} (this build understands 1)`,
    );
  }
  return tree;
}

/**
 * Light-weight predicate — does this PNG carry an
 * `annot:elementTree` chunk at all? Doesn't deflate or parse.
 */
export function hasElementTreePng(pngData: Uint8Array): boolean {
  if (!isPng(pngData)) return false;
  return findElementTreeChunk(pngData) !== null;
}

// ─── Internals ───────────────────────────────────────────────────────

function isPng(data: Uint8Array): boolean {
  return (
    data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
  );
}

interface ChunkLocation {
  /** Offset of the 4-byte length prefix. */
  start: number;
  /** Offset one past the trailing CRC. */
  end: number;
  /** Offset of the chunk's data payload (after length + type). */
  dataStart: number;
  /** Length of the chunk's data payload. */
  dataLength: number;
}

function findElementTreeChunk(data: Uint8Array): ChunkLocation | null {
  let pos = 8;
  while (pos + 12 <= data.length) {
    const chunkLen = readU32be(data, pos);
    const chunkType = String.fromCharCode(
      data[pos + 4]!,
      data[pos + 5]!,
      data[pos + 6]!,
      data[pos + 7]!,
    );
    const chunkDataStart = pos + 8;
    const chunkEnd = chunkDataStart + chunkLen + 4;
    if (chunkEnd > data.length) break;

    if (chunkType === "iTXt" && startsWith(data, chunkDataStart, KEYWORD_BYTES)) {
      // Confirm the keyword is the FULL keyword, not just a prefix
      // (no chunk-keyword in the PNG namespace would conflict, but
      // defensive checking is cheap).
      const afterKw = chunkDataStart + KEYWORD_BYTES.length;
      if (afterKw < chunkDataStart + chunkLen && data[afterKw] === 0) {
        return {
          start: pos,
          end: chunkEnd,
          dataStart: chunkDataStart,
          dataLength: chunkLen,
        };
      }
    }
    pos = chunkEnd;
  }
  return null;
}

function removeElementTreeChunk(data: Uint8Array): Uint8Array {
  const loc = findElementTreeChunk(data);
  if (loc === null) return data;
  return concat(data.slice(0, loc.start), data.slice(loc.end));
}

function extractElementTreeYaml(data: Uint8Array): string | null {
  const loc = findElementTreeChunk(data);
  if (loc === null) return null;

  // iTXt payload layout: keyword \0 compressionFlag compressionMethod languageTag \0 translatedKeyword \0 text
  const afterKw = loc.dataStart + KEYWORD_BYTES.length;
  // afterKw points at the null separator after the keyword.
  // +1 (null) +1 (compressionFlag) +1 (compressionMethod) = +3 to reach languageTag.
  if (afterKw + 3 > loc.dataStart + loc.dataLength) return null;
  const compressionFlag = data[afterKw + 1] ?? 0;
  const compressionMethod = data[afterKw + 2] ?? 0;
  if (compressionFlag === 1 && compressionMethod !== 0) {
    throw new Error(
      `extractElementTreeYaml: unsupported compression method ${compressionMethod} (only deflate is defined)`,
    );
  }

  // Skip the language tag (null-terminated, possibly empty) and the
  // translated keyword (null-terminated UTF-8, possibly empty).
  let cursor = afterKw + 3;
  const chunkEnd = loc.dataStart + loc.dataLength;
  // language tag: read until null
  while (cursor < chunkEnd && data[cursor] !== 0) cursor++;
  cursor++; // skip the null
  // translated keyword: read until null
  while (cursor < chunkEnd && data[cursor] !== 0) cursor++;
  cursor++; // skip the null

  if (cursor > chunkEnd) return null;
  const textBytes = data.slice(cursor, chunkEnd);

  if (compressionFlag === 1) {
    const inflated = inflate(textBytes) as Uint8Array;
    return new TextDecoder().decode(inflated);
  }
  return new TextDecoder().decode(textBytes);
}
