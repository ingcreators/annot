import { describe, expect, it } from "vitest";
import { newIdB58 } from "./id.js";

/**
 * UUIDv7-in-Base58 sanity checks. We don't assert the exact byte
 * layout from the public helper (there's no decoder export), but the
 * properties below are enough to catch format regressions.
 */
describe("newIdB58", () => {
  it("returns a non-empty string", () => {
    const id = newIdB58();
    expect(id).toMatch(/^\S+$/);
  });

  it("produces IDs in the Bitcoin Base58 alphabet (no 0, O, I, l)", () => {
    // Generate a bunch so we sample across random payloads.
    const alphabet = /^[1-9A-HJ-NP-Za-km-z]+$/;
    for (let i = 0; i < 64; i++) {
      expect(newIdB58()).toMatch(alphabet);
    }
  });

  it("is typically 21 or 22 characters wide (16-byte payload in base58)", () => {
    // Base58-encoding 16 bytes is mathematically ~21.89 chars; real
    // outputs land at 21 or 22. Accept both so the test doesn't
    // flake on fresh entropy.
    for (let i = 0; i < 32; i++) {
      const id = newIdB58();
      expect(id.length === 21 || id.length === 22).toBe(true);
    }
  });

  it("produces a new ID on every call", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(newIdB58());
    // 200 calls at ~122 bits of randomness → collision odds negligible.
    expect(seen.size).toBe(200);
  });

  it("is time-ordered: IDs minted later compare lexicographically >=", async () => {
    // UUIDv7's time prefix gives monotonic ordering at millisecond
    // granularity. Two IDs minted in the same ms only differ in the
    // random tail, so we need a real time gap between them.
    const a = newIdB58();
    await new Promise((r) => setTimeout(r, 5));
    const b = newIdB58();
    expect(b >= a).toBe(true);
  });
});
