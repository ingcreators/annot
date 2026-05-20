// Read an image input from one of the two accepted forms:
//
//   - `data:image/png;base64,...` URL string
//   - absolute filesystem path string
//
// Returns the bytes + a normalised `data:` URL the underlying
// annotator can consume directly, along with the PNG dimensions
// parsed from the IHDR chunk.
//
// Only PNG inputs are supported at v1 (per
// `docs/plans/agent-mcp-integration.md` — JPEG output is deferred,
// and the `_url` tools' upstream Playwright capture produces PNG
// by default, so the input shape stays narrow).

import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { InvalidPngError, type PngDimensions, readPngDimensions } from "./png-dimensions.js";

export interface ResolvedImage {
  /** Raw PNG bytes. */
  bytes: Uint8Array;
  /** `data:image/png;base64,...` form. Suitable for the annotator. */
  dataUrl: string;
  /** Width / height parsed from the IHDR chunk. */
  dimensions: PngDimensions;
}

export class InvalidImageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidImageInputError";
  }
}

const DATA_URL_PREFIX = "data:";
const PNG_DATA_URL_PATTERN = /^data:image\/png;base64,/i;

/**
 * Resolve an `image` field from a tool call. Accepts either:
 *
 *   - a `data:image/png;base64,...` URL
 *   - an absolute filesystem path to a PNG file
 *
 * Relative paths are rejected — agents are required to pass
 * absolute paths so the resolution doesn't depend on the MCP
 * server's current working directory (which the agent has no
 * control over).
 */
export async function resolveImageInput(input: string): Promise<ResolvedImage> {
  if (typeof input !== "string" || input.length === 0) {
    throw new InvalidImageInputError(
      "`image` must be a non-empty string (data URL or absolute filesystem path).",
    );
  }
  if (input.startsWith(DATA_URL_PREFIX)) {
    return resolveFromDataUrl(input);
  }
  if (!isAbsolute(input)) {
    throw new InvalidImageInputError(
      `Filesystem path "${input}" is not absolute. Pass an absolute path so resolution doesn't depend on the MCP server's working directory.`,
    );
  }
  return resolveFromFilesystem(input);
}

function resolveFromDataUrl(dataUrl: string): ResolvedImage {
  if (!PNG_DATA_URL_PATTERN.test(dataUrl)) {
    throw new InvalidImageInputError(
      "Only `data:image/png;base64,...` URLs are supported. JPEG / WebP / SVG data URLs are not accepted in v1.",
    );
  }
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bytes = bytesFromBase64(base64);
  const dimensions = parsePngOrRethrow(bytes);
  return { bytes, dataUrl, dimensions };
}

async function resolveFromFilesystem(path: string): Promise<ResolvedImage> {
  let bytes: Uint8Array;
  try {
    const buffer = await readFile(path);
    bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new InvalidImageInputError(`Failed to read image at "${path}": ${reason}`);
  }
  const dimensions = parsePngOrRethrow(bytes);
  const dataUrl = `data:image/png;base64,${base64FromBytes(bytes)}`;
  return { bytes, dataUrl, dimensions };
}

function parsePngOrRethrow(bytes: Uint8Array): PngDimensions {
  try {
    return readPngDimensions(bytes);
  } catch (err) {
    if (err instanceof InvalidPngError) {
      throw new InvalidImageInputError(err.message);
    }
    throw err;
  }
}

function bytesFromBase64(base64: string): Uint8Array {
  const buffer = Buffer.from(base64, "base64");
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function base64FromBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}
