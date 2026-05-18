import { describe, expect, it } from "vitest";
import {
  base64UrlDecode,
  base64UrlEncode,
  buildClearedSessionCookie,
  buildSessionCookie,
  consumeOAuthState,
  createOAuthState,
  createSession,
  deleteSession,
  loadSession,
  randomToken,
  readSessionCookie,
  type SessionRecord,
} from "./session.js";
import { makeMockKv } from "./test-helpers.js";

const FAKE_RECORD: SessionRecord = {
  provider: "github",
  providerUserId: "12345",
  login: "octocat",
  name: "The Octocat",
  avatarUrl: "https://github.com/octocat.png",
  createdAt: "2026-05-18T00:00:00.000Z",
  lastSeenAt: "2026-05-18T00:00:00.000Z",
};

describe("randomToken / base64UrlEncode", () => {
  it("randomToken returns distinct values per call", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
  });

  it("randomToken is URL-safe (no +, /, =)", () => {
    const t = randomToken();
    expect(t).not.toContain("+");
    expect(t).not.toContain("/");
    expect(t).not.toContain("=");
  });

  it("base64UrlEncode / base64UrlDecode round-trip", () => {
    const original = new Uint8Array([0x00, 0x01, 0x7f, 0xff, 0xab, 0xcd]);
    const encoded = base64UrlEncode(original);
    const decoded = base64UrlDecode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it("encoded length is reasonable for 32-byte input", () => {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    const t = base64UrlEncode(buf);
    // 32 bytes -> 43 base64url chars (no padding)
    expect(t.length).toBe(43);
  });
});

describe("buildSessionCookie / buildClearedSessionCookie", () => {
  it("buildSessionCookie sets standard hardening flags", () => {
    const c = buildSessionCookie("abc.123");
    expect(c).toContain("annot_session=abc.123");
    expect(c).toContain("Path=/");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Lax");
    expect(c).toMatch(/Max-Age=\d+/);
  });

  it("buildClearedSessionCookie zeroes value and Max-Age", () => {
    const c = buildClearedSessionCookie();
    expect(c).toContain("annot_session=;");
    expect(c).toContain("Max-Age=0");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
  });
});

describe("readSessionCookie", () => {
  it("returns the token when present", () => {
    expect(readSessionCookie("annot_session=abc123")).toBe("abc123");
  });

  it("handles multi-cookie headers", () => {
    expect(readSessionCookie("other=val; annot_session=tok; another=val2")).toBe("tok");
  });

  it("returns null when absent", () => {
    expect(readSessionCookie("other=val; another=val2")).toBeNull();
  });

  it("returns null on null input", () => {
    expect(readSessionCookie(null)).toBeNull();
  });

  it("returns null when value is empty", () => {
    expect(readSessionCookie("annot_session=")).toBeNull();
  });

  it("ignores cookies that have the prefix but not the exact name", () => {
    expect(readSessionCookie("annot_session_alt=fake")).toBeNull();
  });
});

describe("createSession / loadSession / deleteSession", () => {
  it("create + load round-trips the record", async () => {
    const kv = makeMockKv();
    const token = await createSession(kv, FAKE_RECORD);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
    const loaded = await loadSession(kv, token);
    expect(loaded).toEqual(FAKE_RECORD);
  });

  it("load returns null for an unknown token", async () => {
    const kv = makeMockKv();
    expect(await loadSession(kv, "nonexistent")).toBeNull();
  });

  it("load returns null for a malformed payload", async () => {
    const kv = makeMockKv({ "session:bad": "{not json" });
    expect(await loadSession(kv, "bad")).toBeNull();
  });

  it("load returns null for a payload missing required fields", async () => {
    const kv = makeMockKv({
      "session:incomplete": JSON.stringify({ login: "x" }),
    });
    expect(await loadSession(kv, "incomplete")).toBeNull();
  });

  it("delete is idempotent and invalidates subsequent loads", async () => {
    const kv = makeMockKv();
    const token = await createSession(kv, FAKE_RECORD);
    await deleteSession(kv, token);
    expect(await loadSession(kv, token)).toBeNull();
    await deleteSession(kv, token); // no throw on already-gone
  });
});

describe("createOAuthState / consumeOAuthState", () => {
  it("create + consume round-trips and returns true", async () => {
    const kv = makeMockKv();
    const state = await createOAuthState(kv, "github");
    expect(typeof state).toBe("string");
    expect(state.length).toBeGreaterThan(20);
    expect(await consumeOAuthState(kv, "github", state)).toBe(true);
  });

  it("consume returns false for an unknown state", async () => {
    const kv = makeMockKv();
    expect(await consumeOAuthState(kv, "github", "fake")).toBe(false);
  });

  it("consume is single-use (replay returns false)", async () => {
    const kv = makeMockKv();
    const state = await createOAuthState(kv, "github");
    expect(await consumeOAuthState(kv, "github", state)).toBe(true);
    expect(await consumeOAuthState(kv, "github", state)).toBe(false);
  });

  it("provider scope isolates states (github state can't be consumed as google)", async () => {
    const kv = makeMockKv();
    const state = await createOAuthState(kv, "github");
    expect(await consumeOAuthState(kv, "google", state)).toBe(false);
    // The github-scoped state should still be valid:
    expect(await consumeOAuthState(kv, "github", state)).toBe(true);
  });
});
