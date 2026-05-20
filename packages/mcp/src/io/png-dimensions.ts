// Read width / height from a PNG buffer by parsing the IHDR chunk.
//
// PNG layout (per the spec):
//   bytes  0..7   ── 8-byte signature: 89 50 4E 47 0D 0A 1A 0A
//   bytes  8..11  ── IHDR chunk length (always 13)
//   bytes 12..15  ── IHDR chunk type   ("IHDR" = 0x49 0x48 0x44 0x52)
//   bytes 16..19  ── width  (big-endian uint32)
//   bytes 20..23  ── height (big-endian uint32)
//   bytes 24..32  ── bit depth / colour type / … / CRC
//
// We only need width + height, so the parser stops at byte 24.
// Inputs that don't match the signature throw a structured error so
// the calling MCP tool can surface a useful message to the agent
// (data URLs labelled `image/png` that contain JPEG bytes are a
// surprisingly common agent mistake).

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR_OFFSET = 8;
const IHDR_TYPE_OFFSET = 12;
const IHDR_TYPE = "IHDR";
const WIDTH_OFFSET = 16;
const HEIGHT_OFFSET = 20;
const MIN_PNG_HEADER_SIZE = 24;

export interface PngDimensions {
  width: number;
  height: number;
}

export class InvalidPngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPngError";
  }
}

/**
 * Parse the width / height fields from a PNG IHDR chunk. Throws
 * `InvalidPngError` if the input doesn't start with a valid PNG
 * signature or the IHDR chunk type is missing.
 *
 * Accepts any byte source with a `BufferSource`-compatible shape
 * (`Uint8Array`, `ArrayBuffer`, Node `Buffer`).
 */
export function readPngDimensions(bytes: Uint8Array): PngDimensions {
  if (bytes.byteLength < MIN_PNG_HEADER_SIZE) {
    throw new InvalidPngError(
      `Expected at least ${MIN_PNG_HEADER_SIZE} bytes for a PNG header, got ${bytes.byteLength}.`,
    );
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new InvalidPngError(
        "Input does not start with the PNG signature (89 50 4E 47 0D 0A 1A 0A). " +
          "Confirm the input is a PNG — JPEG / WebP / other formats are not supported in v1.",
      );
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Skip the chunk length field at bytes 8..11; jump to the type.
  const chunkType = String.fromCharCode(
    bytes[IHDR_TYPE_OFFSET]!,
    bytes[IHDR_TYPE_OFFSET + 1]!,
    bytes[IHDR_TYPE_OFFSET + 2]!,
    bytes[IHDR_TYPE_OFFSET + 3]!,
  );
  if (chunkType !== IHDR_TYPE) {
    throw new InvalidPngError(
      `Expected IHDR chunk after PNG signature, found "${chunkType}". ` +
        "The file may be a corrupt or non-standard PNG.",
    );
  }
  // `void IHDR_OFFSET` — the variable is documentation, not used at
  // runtime. Stripping the binding would lose the layout reference.
  void IHDR_OFFSET;
  const width = view.getUint32(WIDTH_OFFSET, false);
  const height = view.getUint32(HEIGHT_OFFSET, false);
  if (width === 0 || height === 0) {
    throw new InvalidPngError(`PNG dimensions ${width}×${height} include a zero axis.`);
  }
  return { width, height };
}
