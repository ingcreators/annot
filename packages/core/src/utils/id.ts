/**
 * UUIDv7 (RFC 9562) encoded in Base58 (Bitcoin alphabet).
 *
 * UUIDv7 layout (128 bits):
 *   - 48 bits: Unix timestamp in milliseconds (big-endian)
 *   - 4 bits : version = 0111
 *   - 12 bits: random (rand_a)
 *   - 2 bits : variant = 10
 *   - 62 bits: random (rand_b)
 *
 * Base58 uses the Bitcoin alphabet (omits 0, O, I, l) so the resulting
 * 22-character string is URL-safe and free of visually ambiguous chars.
 *
 * The result is time-ordered: IDs minted later compare lexicographically
 * greater, which is useful for stable filmstrip ordering.
 */

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Generate a 16-byte UUIDv7. */
function uuid7Bytes(now: number = Date.now()): Uint8Array {
  const bytes = new Uint8Array(16);

  // 48-bit timestamp (ms) — big-endian, bytes 0..5
  // Use arithmetic to avoid 32-bit overflow on the high bits.
  const tsHigh = Math.floor(now / 0x1_0000_0000); // upper 16 bits
  const tsLow = now >>> 0; // lower 32 bits
  bytes[0] = (tsHigh >>> 8) & 0xff;
  bytes[1] = tsHigh & 0xff;
  bytes[2] = (tsLow >>> 24) & 0xff;
  bytes[3] = (tsLow >>> 16) & 0xff;
  bytes[4] = (tsLow >>> 8) & 0xff;
  bytes[5] = tsLow & 0xff;

  // Fill bytes 6..15 with cryptographic randomness
  crypto.getRandomValues(bytes.subarray(6));

  // Set version (0111) in the high nibble of byte 6
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Set variant (10) in the high 2 bits of byte 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytes;
}

/** Encode a byte array as Base58 (Bitcoin alphabet). */
function toBase58(bytes: Uint8Array): string {
  // Count leading zero bytes — they become leading "1"s in base58.
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  // Convert the remainder via repeated division.
  const input = Array.from(bytes);
  const out: number[] = [];
  let start = zeros;
  while (start < input.length) {
    let carry = 0;
    for (let i = start; i < input.length; i++) {
      const acc = (input[i]! & 0xff) + carry * 256;
      input[i] = Math.floor(acc / 58);
      carry = acc % 58;
    }
    // Advance past bytes that have become zero
    while (start < input.length && input[start] === 0) start++;
    out.push(carry);
  }

  let str = "";
  for (let i = 0; i < zeros; i++) str += B58_ALPHABET[0];
  for (let i = out.length - 1; i >= 0; i--) str += B58_ALPHABET[out[i]!];
  return str;
}

/**
 * Generate a new time-ordered unique ID as a ~22-character Base58 string.
 * Uses UUIDv7 underneath.
 */
export function newIdB58(): string {
  return toBase58(uuid7Bytes());
}
