/**
 * Tier-A ZIP builder — pure-bytes output, no DOM types.
 *
 * Originally lived in `zip-builder.ts` next to a `Blob`-returning
 * companion. Phase 4 of `desktop-electron-migration.md` introduces
 * a Node-side caller (`packages/desktop/src-electron/ipc/clipboard.ts`)
 * whose `tsconfig.json` deliberately omits the DOM lib. Splitting
 * out this module lets the Node-side import stay DOM-free; the
 * browser-side `buildZip` continues to wrap `buildZipBytes` in a
 * `Blob` for callers that want the browser-native shape.
 *
 * The output is a Stored-method (uncompressed) ZIP. Images are
 * already JPEG/PNG-compressed so re-deflating is wasted CPU; the
 * Office clipboard accepts both Stored and Deflated entries.
 */

export interface ZipEntry {
  /** Filename inside the ZIP (e.g. `"clipboard/drawings/drawing1.xml"`). */
  name: string;
  data: Uint8Array;
}

const textEncoder = new TextEncoder();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    // Loop bound matches array length; index is always valid.
    crc ^= data[i]!;
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

/** Build the ZIP and return raw bytes. */
export function buildZipBytes(entries: ZipEntry[]): Uint8Array {
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

  let total = eocd.length;
  for (const p of parts) total += p.length;
  for (const c of centralDir) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  for (const c of centralDir) {
    out.set(c, off);
    off += c.length;
  }
  out.set(eocd, off);
  return out;
}
