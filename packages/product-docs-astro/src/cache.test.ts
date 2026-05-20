import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cacheKey, createFileCache, createMemoryCache, RENDER_PIPELINE_VERSION } from "./cache.js";

describe("cacheKey", () => {
  it("returns the same hex for identical inputs", () => {
    const a = cacheKey({ mdxSource: "hello", screenId: "login" });
    const b = cacheKey({ mdxSource: "hello", screenId: "login" });
    expect(a).toBe(b);
  });

  it("changes when the MDX source changes", () => {
    const a = cacheKey({ mdxSource: "hello", screenId: "login" });
    const b = cacheKey({ mdxSource: "hello world", screenId: "login" });
    expect(a).not.toBe(b);
  });

  it("changes when the screen id changes", () => {
    const a = cacheKey({ mdxSource: "hello", screenId: "login" });
    const b = cacheKey({ mdxSource: "hello", screenId: "signup" });
    expect(a).not.toBe(b);
  });

  it("produces a 64-character hex digest", () => {
    expect(cacheKey({ mdxSource: "x", screenId: "y" })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("RENDER_PIPELINE_VERSION is a small integer", () => {
    expect(RENDER_PIPELINE_VERSION).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(RENDER_PIPELINE_VERSION)).toBe(true);
  });
});

describe("createMemoryCache", () => {
  it("round-trips bytes", async () => {
    const cache = createMemoryCache();
    expect(await cache.get("k")).toBeNull();
    await cache.set("k", new Uint8Array([1, 2, 3]));
    const out = await cache.get("k");
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual([1, 2, 3]);
  });

  it("dir reports the in-memory marker", () => {
    expect(createMemoryCache().dir).toBe(":memory:");
  });
});

describe("createFileCache", () => {
  it("round-trips bytes through disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "annot-cache-test-"));
    const cache = createFileCache(dir);
    expect(await cache.get("k")).toBeNull();
    await cache.set("k", new Uint8Array([10, 20, 30, 40]));
    const out = await cache.get("k");
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual([10, 20, 30, 40]);
  });

  it("get returns null on miss without throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "annot-cache-test-"));
    const cache = createFileCache(dir);
    expect(await cache.get("never-set")).toBeNull();
  });
});
