// @vitest-environment happy-dom

/**
 * `CandidateStore` round-trip tests. Post-refactor (direct-save
 * model), the store is just an in-memory list of already-persisted
 * captures. `accept()` + URL-revocation tracking are gone; only
 * add / remove / clear / list / get / size remain.
 */

import { describe, expect, it, vi } from "vitest";
import { CandidateStore } from "./candidate-store.js";
import type { CaptureCandidate } from "./types.js";

function makeCandidate(id: string): CaptureCandidate {
  return {
    id,
    path: id,
    createdAt: new Date().toISOString(),
    sourceWidth: 1280,
    sourceHeight: 720,
    thumbnailDataUrl: `data:image/jpeg;base64,${id}`,
  };
}

describe("CandidateStore", () => {
  it("starts empty", () => {
    const store = new CandidateStore();
    expect(store.size).toBe(0);
    expect(store.list()).toEqual([]);
  });

  it("add / list / size behave consistently", () => {
    const store = new CandidateStore();
    store.add(makeCandidate("a"));
    store.add(makeCandidate("b"));
    expect(store.size).toBe(2);
    expect(store.list().map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("fires `change` on every mutation (add / remove / clear)", () => {
    const store = new CandidateStore();
    const onChange = vi.fn();
    store.addEventListener("change", onChange);

    store.add(makeCandidate("a")); // 1
    store.add(makeCandidate("b")); // 2
    store.remove("a"); // 3
    store.clear(); // 4 (still has "b")
    expect(onChange).toHaveBeenCalledTimes(4);

    // Subsequent clear() on the empty store is silent.
    store.clear();
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("remove() of unknown id is a silent no-op (no event)", () => {
    const store = new CandidateStore();
    const onChange = vi.fn();
    store.addEventListener("change", onChange);
    store.remove("missing");
    expect(onChange).toHaveBeenCalledTimes(0);
  });

  it("get() returns the matching candidate, or undefined", () => {
    const store = new CandidateStore();
    store.add(makeCandidate("a"));
    expect(store.get("a")?.id).toBe("a");
    expect(store.get("nope")).toBeUndefined();
  });
});
