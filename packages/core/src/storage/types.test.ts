// Pure-Node tests for the StorageProvider capability predicates.
// They're trivial type-narrowers, but pinning their behaviour catches
// the regression where a refactor accidentally drops a method
// (and thus the predicate flips from "supported" to "not supported"
// silently for callers).

import { describe, expect, it } from "vitest";
import type {
  StorageProvider,
  StorageWithForceRefresh,
  StorageWithInit,
  StorageWithRateLimit,
  StorageWithResync,
  StorageWithTokenRefresher,
} from "./types.js";
import {
  supportsForceRefresh,
  supportsInit,
  supportsRateLimit,
  supportsResync,
  supportsTokenRefresher,
} from "./types.js";

/** Bare-minimum stub that satisfies `StorageProvider` for predicate
 *  purposes. The methods are stubs — the predicates only sniff for
 *  presence + `typeof === "function"`. */
function bareStorage(): StorageProvider {
  const stub = (() => {
    throw new Error("not implemented");
  }) as never;
  return {
    saveImage: stub,
    getImage: stub,
    listImages: stub,
    updateImage: stub,
    moveImage: stub,
    renameImage: stub,
    deleteImage: stub,
    createFolder: stub,
    listFolders: stub,
    getFolder: stub,
    renameFolder: stub,
    moveFolder: stub,
    deleteFolder: stub,
    getBreadcrumb: stub,
  };
}

describe("supportsResync", () => {
  it("returns false for a bare StorageProvider", () => {
    expect(supportsResync(bareStorage())).toBe(false);
  });

  it("returns true when the store implements resync()", () => {
    const store: StorageProvider & StorageWithResync = {
      ...bareStorage(),
      resync: async () => {},
    };
    expect(supportsResync(store)).toBe(true);
  });

  it("returns false when resync is not a function (e.g. accidentally a property)", () => {
    const store = bareStorage() as unknown as Record<string, unknown>;
    store.resync = "not a function";
    expect(supportsResync(store as unknown as StorageProvider)).toBe(false);
  });
});

describe("supportsForceRefresh", () => {
  it("returns false for a bare StorageProvider", () => {
    expect(supportsForceRefresh(bareStorage())).toBe(false);
  });

  it("returns true when forceRefresh is a function", () => {
    const store: StorageProvider & StorageWithForceRefresh = {
      ...bareStorage(),
      forceRefresh: async () => {},
    };
    expect(supportsForceRefresh(store)).toBe(true);
  });
});

describe("supportsTokenRefresher", () => {
  it("returns false for a bare StorageProvider", () => {
    expect(supportsTokenRefresher(bareStorage())).toBe(false);
  });

  it("returns false when only setTokenRefresher is present (setToken missing)", () => {
    // Capability requires BOTH methods now — this guards against
    // a partial implementation that only wires up one half.
    const store = bareStorage() as unknown as Record<string, unknown>;
    store.setTokenRefresher = () => {};
    expect(supportsTokenRefresher(store as unknown as StorageProvider)).toBe(false);
  });

  it("returns false when only setToken is present (setTokenRefresher missing)", () => {
    const store = bareStorage() as unknown as Record<string, unknown>;
    store.setToken = () => {};
    expect(supportsTokenRefresher(store as unknown as StorageProvider)).toBe(false);
  });

  it("returns true when both setToken and setTokenRefresher are functions", () => {
    const store: StorageProvider & StorageWithTokenRefresher = {
      ...bareStorage(),
      setToken: () => {},
      setTokenRefresher: () => {},
    };
    expect(supportsTokenRefresher(store)).toBe(true);
  });
});

describe("supportsInit", () => {
  it("returns false for a bare StorageProvider", () => {
    expect(supportsInit(bareStorage())).toBe(false);
  });

  it("returns true when init is a function", () => {
    const store: StorageProvider & StorageWithInit = {
      ...bareStorage(),
      init: async () => {},
    };
    expect(supportsInit(store)).toBe(true);
  });
});

describe("supportsRateLimit", () => {
  it("returns false for a bare StorageProvider", () => {
    expect(supportsRateLimit(bareStorage())).toBe(false);
  });

  it("returns false when only one of the two methods is present", () => {
    const partialA = bareStorage() as unknown as Record<string, unknown>;
    partialA.getRateLimit = () => ({ remaining: null, resetAt: null });
    expect(supportsRateLimit(partialA as unknown as StorageProvider)).toBe(false);

    const partialB = bareStorage() as unknown as Record<string, unknown>;
    partialB.setRateLimitListener = () => {};
    expect(supportsRateLimit(partialB as unknown as StorageProvider)).toBe(false);
  });

  it("returns true when both getRateLimit and setRateLimitListener are functions", () => {
    const store: StorageProvider & StorageWithRateLimit = {
      ...bareStorage(),
      getRateLimit: () => ({ remaining: null, resetAt: null }),
      setRateLimitListener: () => {},
    };
    expect(supportsRateLimit(store)).toBe(true);
  });
});
