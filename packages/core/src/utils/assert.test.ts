/**
 * `assertNonNull` — happy path + both nullish branches throw with
 * the supplied label so callers can find the assertion in stack
 * traces.
 */

import { describe, expect, it } from "vitest";

import { assertNonNull } from "./assert";

describe("assertNonNull", () => {
  it("returns the value when it's defined", () => {
    expect(assertNonNull("hello", "string")).toBe("hello");
    expect(assertNonNull(0, "number")).toBe(0);
    expect(assertNonNull(false, "bool")).toBe(false);
    const obj = { a: 1 };
    expect(assertNonNull(obj, "obj")).toBe(obj);
  });

  it("throws when the value is null", () => {
    expect(() => assertNonNull(null, "missing root")).toThrow(
      "Assertion failed: missing root",
    );
  });

  it("throws when the value is undefined", () => {
    expect(() => assertNonNull(undefined, "missing prop")).toThrow(
      "Assertion failed: missing prop",
    );
  });
});
