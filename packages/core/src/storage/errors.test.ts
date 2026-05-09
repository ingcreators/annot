// Tests for the `StorageError` hierarchy. Phase 2 of
// `docs/plans/storage-error-contract.md`.
//
// Vitest's default `node` environment is fine — these classes are
// pure ES2022 with no DOM dependency.

import { describe, expect, it } from "vitest";
import {
  StorageConflictError,
  StorageError,
  type StorageErrorCode,
  StorageNotFoundError,
  StoragePermissionError,
  StorageQuotaError,
} from "./errors.js";

describe("StorageError hierarchy", () => {
  describe("StorageConflictError", () => {
    it("sets name / code / path / default message", () => {
      const e = new StorageConflictError("Screenshots/foo.png");
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(StorageError);
      expect(e).toBeInstanceOf(StorageConflictError);
      expect(e.name).toBe("StorageConflictError");
      expect(e.code).toBe("conflict");
      expect(e.path).toBe("Screenshots/foo.png");
      expect(e.message).toBe("Path already exists: Screenshots/foo.png");
    });

    it("accepts a custom message", () => {
      const e = new StorageConflictError("a/b", "Image already exists: a/b");
      expect(e.message).toBe("Image already exists: a/b");
      expect(e.code).toBe("conflict");
      expect(e.path).toBe("a/b");
    });
  });

  describe("StorageNotFoundError", () => {
    it("sets name / code / path / default message", () => {
      const e = new StorageNotFoundError("missing/path.png");
      expect(e).toBeInstanceOf(StorageError);
      expect(e).toBeInstanceOf(StorageNotFoundError);
      expect(e.name).toBe("StorageNotFoundError");
      expect(e.code).toBe("not-found");
      expect(e.path).toBe("missing/path.png");
      expect(e.message).toBe("Path not found: missing/path.png");
    });

    it("accepts a custom message", () => {
      const e = new StorageNotFoundError("x", "Source vanished mid-rename: x");
      expect(e.message).toBe("Source vanished mid-rename: x");
    });
  });

  describe("StoragePermissionError", () => {
    it("sets name / code / path / default message", () => {
      const e = new StoragePermissionError("repo/owner");
      expect(e).toBeInstanceOf(StorageError);
      expect(e).toBeInstanceOf(StoragePermissionError);
      expect(e.name).toBe("StoragePermissionError");
      expect(e.code).toBe("permission");
      expect(e.path).toBe("repo/owner");
      expect(e.message).toBe("Permission denied: repo/owner");
    });

    it("accepts a custom message", () => {
      const e = new StoragePermissionError("x", "Token expired");
      expect(e.message).toBe("Token expired");
    });
  });

  describe("StorageQuotaError", () => {
    it("sets name / code / path / default message", () => {
      const e = new StorageQuotaError("big.png");
      expect(e).toBeInstanceOf(StorageError);
      expect(e).toBeInstanceOf(StorageQuotaError);
      expect(e.name).toBe("StorageQuotaError");
      expect(e.code).toBe("quota");
      expect(e.path).toBe("big.png");
      expect(e.message).toBe("Quota exceeded: big.png");
    });
  });

  it("instanceof StorageError catches every subclass", () => {
    const errs: StorageError[] = [
      new StorageConflictError("a"),
      new StorageNotFoundError("b"),
      new StoragePermissionError("c"),
      new StorageQuotaError("d"),
    ];
    for (const e of errs) {
      expect(e instanceof StorageError).toBe(true);
      expect(e instanceof Error).toBe(true);
    }
  });

  it("subclass instanceof checks discriminate correctly", () => {
    const conflict = new StorageConflictError("x");
    expect(conflict instanceof StorageConflictError).toBe(true);
    expect(conflict instanceof StorageNotFoundError).toBe(false);
    expect(conflict instanceof StoragePermissionError).toBe(false);
    expect(conflict instanceof StorageQuotaError).toBe(false);
  });

  it("e.code narrows to the literal type", () => {
    // Compile-time test: assigning the union to each subclass's code
    // would fail tsc if the discriminator weren't typed correctly.
    const e: StorageError = new StorageConflictError("a");
    const code: StorageErrorCode = e.code;
    expect(code).toBe("conflict");

    // Exhaustive switch — if a new code is added without updating
    // this switch, the `assertNever` line below stops type-checking.
    function describeCode(c: StorageErrorCode): string {
      switch (c) {
        case "conflict":
          return "C";
        case "not-found":
          return "N";
        case "permission":
          return "P";
        case "quota":
          return "Q";
        default: {
          const _exhaustive: never = c;
          return _exhaustive;
        }
      }
    }
    expect(describeCode(e.code)).toBe("C");
  });

  it("preserves throw / catch ergonomics", () => {
    const fn = () => {
      throw new StorageConflictError("a/b");
    };
    try {
      fn();
      expect.fail("should have thrown");
    } catch (e) {
      if (e instanceof StorageConflictError) {
        expect(e.path).toBe("a/b");
        expect(e.code).toBe("conflict");
      } else {
        expect.fail("expected StorageConflictError");
      }
    }
  });
});
