/**
 * Minimal ZIP file builder (Store method, no compression).
 * Images are already JPEG/PNG compressed, so re-compression is unnecessary.
 */

interface ZipEntry {
  name: string; // filename inside ZIP (e.g. "folder/image.jpg")
  data: Uint8Array;
}

const textEncoder = new TextEncoder();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
}

function u32(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
}

export function buildZip(entries: ZipEntry[]): Blob {
  const parts: Uint8Array[] = [];
  const centralDir: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // Local file header (30 + name + data)
    const localHeader = new Uint8Array([
      0x50,
      0x4b,
      0x03,
      0x04, // signature
      ...u16(20), // version needed (2.0)
      ...u16(0), // flags
      ...u16(0), // compression: store
      ...u16(0), // mod time
      ...u16(0), // mod date
      ...u32(crc), // crc32
      ...u32(size), // compressed size
      ...u32(size), // uncompressed size
      ...u16(nameBytes.length), // filename length
      ...u16(0), // extra length
    ]);

    parts.push(localHeader, nameBytes, entry.data);

    // Central directory entry
    const cdEntry = new Uint8Array([
      0x50,
      0x4b,
      0x01,
      0x02, // signature
      ...u16(20), // version made by
      ...u16(20), // version needed
      ...u16(0), // flags
      ...u16(0), // compression: store
      ...u16(0), // mod time
      ...u16(0), // mod date
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      ...u16(0), // extra length
      ...u16(0), // comment length
      ...u16(0), // disk number
      ...u16(0), // internal attributes
      ...u32(0), // external attributes
      ...u32(offset), // local header offset
    ]);
    centralDir.push(cdEntry, nameBytes);

    offset += localHeader.length + nameBytes.length + entry.data.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const cd of centralDir) cdSize += cd.length;

  // End of central directory
  const eocd = new Uint8Array([
    0x50,
    0x4b,
    0x05,
    0x06, // signature
    ...u16(0), // disk number
    ...u16(0), // cd start disk
    ...u16(entries.length), // entries on disk
    ...u16(entries.length), // total entries
    ...u32(cdSize), // cd size
    ...u32(cdOffset), // cd offset
    ...u16(0), // comment length
  ]);

  return new Blob([...parts, ...centralDir, eocd] as BlobPart[], { type: "application/zip" });
}

/** Convert a data URL to Uint8Array binary. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(",")[1] || "";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/** Detect file extension from data URL mime type. */
export function dataUrlExt(dataUrl: string): string {
  if (dataUrl.startsWith("data:image/png")) return "png";
  return "jpg";
}
