import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES_VALUE, validatePath, validateUploadSize } from "./path-utils.js";

describe("validatePath — valid paths", () => {
  it.each([
    "file.png",
    "Folder/file.png",
    "Deep/Nested/Folders/file.png",
    "with spaces.png",
    "with-dashes.png",
    "with_underscores.png",
    "日本語/ファイル.png",
    "a".repeat(1024),
  ])("accepts %j", (path) => {
    expect(validatePath(path)).toBeNull();
  });
});

describe("validatePath — rejected paths", () => {
  it("rejects empty string", () => {
    expect(validatePath("")).toMatch(/required/i);
  });

  it("rejects leading slash", () => {
    expect(validatePath("/file.png")).toMatch(/start with a slash/i);
  });

  it("rejects trailing slash", () => {
    expect(validatePath("Folder/")).toMatch(/end with a slash/i);
  });

  it("rejects too-long path", () => {
    expect(validatePath("a".repeat(1025))).toMatch(/too long/i);
  });

  it("rejects '..' segments", () => {
    expect(validatePath("../escape")).toMatch(/invalid segment/i);
    expect(validatePath("Folder/../escape")).toMatch(/invalid segment/i);
  });

  it("rejects '.' segments", () => {
    expect(validatePath("./file.png")).toMatch(/invalid segment/i);
    expect(validatePath("Folder/./file.png")).toMatch(/invalid segment/i);
  });

  it("rejects empty segments (consecutive slashes)", () => {
    expect(validatePath("Folder//file.png")).toMatch(/invalid segment/i);
  });

  it("rejects control characters", () => {
    expect(validatePath("file\x00.png")).toMatch(/control characters/i);
    expect(validatePath("file\x07.png")).toMatch(/control characters/i);
    expect(validatePath("file\x1f.png")).toMatch(/control characters/i);
    expect(validatePath("file\x7f.png")).toMatch(/control characters/i);
  });
});

describe("validateUploadSize", () => {
  it("returns null for missing header (no client hint)", () => {
    expect(validateUploadSize(null)).toBeNull();
  });

  it("returns null for sizes at or below the cap", () => {
    expect(validateUploadSize("0")).toBeNull();
    expect(validateUploadSize("1000000")).toBeNull();
    expect(validateUploadSize(String(MAX_UPLOAD_BYTES_VALUE))).toBeNull();
  });

  it("returns an error for sizes above the cap", () => {
    expect(validateUploadSize(String(MAX_UPLOAD_BYTES_VALUE + 1))).toMatch(/too large/i);
  });

  it("returns an error for invalid header values", () => {
    expect(validateUploadSize("not a number")).toMatch(/invalid/i);
    expect(validateUploadSize("-1")).toMatch(/invalid/i);
  });

  it("cap is exactly 25 MB", () => {
    expect(MAX_UPLOAD_BYTES_VALUE).toBe(25 * 1024 * 1024);
  });
});
