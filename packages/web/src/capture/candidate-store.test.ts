// @vitest-environment happy-dom

/**
 * `CandidateStore` round-trip tests. happy-dom for `URL.revokeObjectURL`
 * + `EventTarget` (also available in node, but happy-dom is the
 * environment Phase 4's engine drives the store under).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CandidateStore } from "./candidate-store.js";
import type { CaptureCandidate } from "./types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeCandidate(
  id: string,
  status: CaptureCandidate["status"] = "candidate",
): CaptureCandidate {
  return {
    id,
    status,
    createdAt: new Date().toISOString(),
    sourceWidth: 1280,
    sourceHeight: 720,
    imageBlob: new Blob([id], { type: "image/jpeg" }),
    thumbnailDataUrl: `data:image/png;base64,${id}`,
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

  it("fires `change` on add / accept / remove / clear (each operation that mutates)", () => {
    const store = new CandidateStore();
    const onChange = vi.fn();
    store.addEventListener("change", onChange);

    store.add(makeCandidate("a")); // 1
    store.add(makeCandidate("b")); // 2
    store.accept("a"); // 3
    store.remove("b"); // 4
    store.clear(); // 5 — "a" is still in the store, so this mutates
    expect(onChange).toHaveBeenCalledTimes(5);

    // Subsequent clear() on the empty store is a silent no-op.
    store.clear();
    expect(onChange).toHaveBeenCalledTimes(5);
  });

  it("remove() of unknown id is a silent no-op (no event)", () => {
    const store = new CandidateStore();
    const onChange = vi.fn();
    store.addEventListener("change", onChange);
    store.remove("missing");
    expect(onChange).toHaveBeenCalledTimes(0);
  });

  it("accept() flips status; second call is no-op", () => {
    const store = new CandidateStore();
    const onChange = vi.fn();
    store.add(makeCandidate("a"));
    store.addEventListener("change", onChange);
    store.accept("a");
    store.accept("a");
    expect(store.get("a")?.status).toBe("accepted");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("revokeAll() drops every tracked object URL", () => {
    const store = new CandidateStore();
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    store.trackObjectUrl("blob:fake-1");
    store.trackObjectUrl("blob:fake-2");
    store.revokeAll();
    expect(revokeSpy).toHaveBeenCalledWith("blob:fake-1");
    expect(revokeSpy).toHaveBeenCalledWith("blob:fake-2");
    expect(revokeSpy).toHaveBeenCalledTimes(2);
    // Calling again should be a no-op.
    store.revokeAll();
    expect(revokeSpy).toHaveBeenCalledTimes(2);
  });

  it("clear() drops candidates AND revokes URLs in one shot", () => {
    const store = new CandidateStore();
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    store.add(makeCandidate("a"));
    store.trackObjectUrl("blob:fake-1");
    store.clear();
    expect(store.size).toBe(0);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });
});
