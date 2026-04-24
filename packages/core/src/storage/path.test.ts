import { describe, expect, it } from "vitest";
import {
  ROOT_PATH,
  ancestorPaths,
  getFilename,
  getParentPath,
  isDescendantOrSame,
  joinPath,
  rewritePathPrefix,
  splitExt,
  splitPath,
  uniquifyFilename,
  uniquifyFilenameAsync,
  validateName,
} from "./path.js";

describe("ROOT_PATH", () => {
  it("is the empty string", () => {
    expect(ROOT_PATH).toBe("");
  });
});

describe("validateName", () => {
  it.each([
    ["normal name", "image-01.png"],
    ["unicode letters", "スクリーンショット.png"],
    ["spaces and dashes", "a b-c d.png"],
    ["dotfiles", ".gitkeep"],
    ["exactly 255 chars", "x".repeat(255)],
  ])("accepts %s", (_label, name) => {
    expect(() => validateName(name)).not.toThrow();
  });

  it("rejects the empty string", () => {
    expect(() => validateName("")).toThrow(/must not be empty/);
  });

  it.each([".", ".."])("rejects reserved name %s", (name) => {
    expect(() => validateName(name)).toThrow(/reserved/);
  });

  it.each([
    ["slash", "a/b"],
    ["backslash", "a\\b"],
    ["colon", "a:b"],
    ["asterisk", "a*b"],
    ["question mark", "a?b"],
    ["pipe", "a|b"],
    ["less-than", "a<b"],
    ["greater-than", "a>b"],
    ["double-quote", 'a"b'],
    ["null byte", "a\x00b"],
    ["unit separator", "a\x1fb"],
  ])("rejects names containing %s", (_label, name) => {
    expect(() => validateName(name)).toThrow(/invalid characters/);
  });

  it("rejects names longer than 255 chars", () => {
    expect(() => validateName("x".repeat(256))).toThrow(/too long/);
  });
});

describe("joinPath", () => {
  it("joins a parent and a name with a separator", () => {
    expect(joinPath("A", "B")).toBe("A/B");
    expect(joinPath("A/B", "C")).toBe("A/B/C");
  });

  it("returns the name when parent is the root", () => {
    expect(joinPath("", "foo.png")).toBe("foo.png");
  });

  it("throws when name is empty", () => {
    expect(() => joinPath("A", "")).toThrow(/name is required/);
  });

  it("throws when name contains a slash — callers must pass a single segment", () => {
    expect(() => joinPath("A", "B/C")).toThrow(/must not contain/);
  });
});

describe("getParentPath", () => {
  it("returns root for the root itself", () => {
    expect(getParentPath("")).toBe("");
  });

  it("returns root for a top-level file", () => {
    expect(getParentPath("foo.png")).toBe("");
  });

  it("returns the directory for nested paths", () => {
    expect(getParentPath("A/B/C.png")).toBe("A/B");
  });
});

describe("getFilename", () => {
  it("returns empty string for the root", () => {
    expect(getFilename("")).toBe("");
  });

  it("returns the name itself for a top-level path", () => {
    expect(getFilename("foo.png")).toBe("foo.png");
  });

  it("returns the last segment for nested paths", () => {
    expect(getFilename("A/B/C.png")).toBe("C.png");
  });
});

describe("splitPath", () => {
  it("returns an empty array for the root", () => {
    expect(splitPath("")).toEqual([]);
  });

  it("splits paths on /", () => {
    expect(splitPath("A/B/C")).toEqual(["A", "B", "C"]);
  });
});

describe("ancestorPaths", () => {
  it("returns an empty array for the root", () => {
    expect(ancestorPaths("")).toEqual([]);
  });

  it("returns an empty array for a top-level path (no ancestors)", () => {
    expect(ancestorPaths("foo.png")).toEqual([]);
  });

  it("returns all ancestors up to but not including the path", () => {
    expect(ancestorPaths("A/B/C/D.png")).toEqual(["A", "A/B", "A/B/C"]);
  });
});

describe("isDescendantOrSame", () => {
  it("treats the root as an ancestor of everything", () => {
    expect(isDescendantOrSame("anything", "")).toBe(true);
    expect(isDescendantOrSame("", "")).toBe(true);
  });

  it("is true for equal paths", () => {
    expect(isDescendantOrSame("A/B", "A/B")).toBe(true);
  });

  it("is true for proper descendants", () => {
    expect(isDescendantOrSame("A/B/C", "A")).toBe(true);
    expect(isDescendantOrSame("A/B/C", "A/B")).toBe(true);
  });

  it("is false for unrelated siblings", () => {
    expect(isDescendantOrSame("A/C", "A/B")).toBe(false);
  });

  it("is not fooled by shared prefixes — checks boundaries", () => {
    // "A/BC" starts with "A/B" as string but isn't nested under "A/B".
    expect(isDescendantOrSame("A/BC", "A/B")).toBe(false);
  });
});

describe("splitExt", () => {
  it("splits at the last dot", () => {
    expect(splitExt("image.tar.gz")).toEqual(["image.tar", ".gz"]);
  });

  it("handles single-extension filenames", () => {
    expect(splitExt("foo.png")).toEqual(["foo", ".png"]);
  });

  it("returns the whole name + empty ext when there's no extension", () => {
    expect(splitExt("README")).toEqual(["README", ""]);
  });

  it("treats dotfiles as extensionless (leading dot doesn't count)", () => {
    expect(splitExt(".gitkeep")).toEqual([".gitkeep", ""]);
    expect(splitExt(".env.local")).toEqual([".env", ".local"]);
  });
});

describe("uniquifyFilename", () => {
  it("returns the desired name unchanged when available", () => {
    expect(uniquifyFilename("foo.png", () => false)).toBe("foo.png");
  });

  it('appends " (2)" before the extension on first collision', () => {
    const taken = new Set(["foo.png"]);
    expect(uniquifyFilename("foo.png", (c) => taken.has(c))).toBe("foo (2).png");
  });

  it("keeps incrementing until an open slot is found", () => {
    const taken = new Set(["foo.png", "foo (2).png", "foo (3).png"]);
    expect(uniquifyFilename("foo.png", (c) => taken.has(c))).toBe("foo (4).png");
  });

  it("places the suffix before a multi-dot extension", () => {
    const taken = new Set(["archive.tar.gz"]);
    expect(uniquifyFilename("archive.tar.gz", (c) => taken.has(c))).toBe("archive.tar (2).gz");
  });

  it("handles names without extensions by appending at the end", () => {
    const taken = new Set(["README"]);
    expect(uniquifyFilename("README", (c) => taken.has(c))).toBe("README (2)");
  });
});

describe("uniquifyFilenameAsync", () => {
  it("matches the synchronous version semantically", async () => {
    const taken = new Set(["foo.png", "foo (2).png"]);
    const result = await uniquifyFilenameAsync("foo.png", async (c) => taken.has(c));
    expect(result).toBe("foo (3).png");
  });
});

describe("rewritePathPrefix", () => {
  it("rewrites the prefix itself when the full path equals it", () => {
    expect(rewritePathPrefix("A", "A", "B")).toBe("B");
  });

  it("rewrites the prefix on nested descendants", () => {
    expect(rewritePathPrefix("A/x.png", "A", "B")).toBe("B/x.png");
    expect(rewritePathPrefix("A/B/x.png", "A/B", "C/D")).toBe("C/D/x.png");
  });

  it("moves paths out of the root when oldPrefix is empty", () => {
    expect(rewritePathPrefix("x.png", "", "B")).toBe("B/x.png");
  });

  it("moves paths into the root when newPrefix is empty", () => {
    expect(rewritePathPrefix("A/x.png", "A", "")).toBe("x.png");
    expect(rewritePathPrefix("A/B/x.png", "A", "")).toBe("B/x.png");
  });

  it("leaves unrelated paths untouched", () => {
    expect(rewritePathPrefix("Other/x.png", "A", "B")).toBe("Other/x.png");
  });

  it("is not fooled by shared-prefix names", () => {
    // "AB/x.png" starts with "A" as a string but isn't under "A".
    expect(rewritePathPrefix("AB/x.png", "A", "Z")).toBe("AB/x.png");
  });
});
