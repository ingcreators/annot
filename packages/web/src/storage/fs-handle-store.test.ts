/**
 * `fs-handle-store` persists the `FileSystemDirectoryHandle` the
 * user picks via the File System Access API so the device-storage
 * mode can resume that folder across page reloads. The store is a
 * thin IDB wrapper over a single key (`rootDir`) in a single store
 * (`handles`) inside its own DB (`annot-fs-handles`).
 *
 * Tests use `fake-indexeddb` (already in devDependencies) to
 * exercise the full open / put / get / delete pipeline. The actual
 * `FileSystemDirectoryHandle` is browser-only, so the round-trip
 * tests use a plain marker object — the store is shape-agnostic
 * and just round-trips whatever structured-cloneable value the
 * caller hands it.
 */

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearHandle, loadHandle, saveHandle } from "./fs-handle-store.js";

beforeEach(() => {
  // Fresh in-memory IDB per test — keeps the stored handle isolated
  // across tests so the order doesn't matter.
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  // Defensive: clear any global side-effects so an unrelated suite
  // running after this file doesn't see stale state.
  globalThis.indexedDB = new IDBFactory();
});

/** Build a stand-in for `FileSystemDirectoryHandle`. The store doesn't
 *  inspect the shape — it just round-trips a structured-cloneable
 *  value. happy-dom doesn't ship the real FSAH constructor anyway. */
function makeFakeHandle(name = "TestDir"): FileSystemDirectoryHandle {
  return { kind: "directory", name } as unknown as FileSystemDirectoryHandle;
}

describe("fs-handle-store — saveHandle + loadHandle round-trip", () => {
  it("loadHandle returns null when the DB has never been written to", async () => {
    expect(await loadHandle()).toBeNull();
  });

  it("saveHandle persists the handle so loadHandle returns the same value", async () => {
    const handle = makeFakeHandle("MyDocs");
    await saveHandle(handle);
    const loaded = await loadHandle();
    expect(loaded).not.toBeNull();
    expect((loaded as { kind: string }).kind).toBe("directory");
    expect((loaded as { name: string }).name).toBe("MyDocs");
  });

  it("saveHandle overwrites the previously-stored handle (single-slot semantics)", async () => {
    await saveHandle(makeFakeHandle("First"));
    await saveHandle(makeFakeHandle("Second"));
    const loaded = await loadHandle();
    expect((loaded as { name: string }).name).toBe("Second");
  });

  it("clearHandle removes the persisted handle so loadHandle returns null again", async () => {
    await saveHandle(makeFakeHandle("ToRemove"));
    expect(await loadHandle()).not.toBeNull();
    await clearHandle();
    expect(await loadHandle()).toBeNull();
  });

  it("clearHandle on an already-empty DB is a silent no-op", async () => {
    // No prior saveHandle. The delete-of-missing-key path must not
    // throw — IDB silently no-ops `delete` on missing keys.
    await expect(clearHandle()).resolves.toBeUndefined();
    expect(await loadHandle()).toBeNull();
  });

  it("save → clear → save round-trips cleanly (no stale-state leakage)", async () => {
    await saveHandle(makeFakeHandle("Phase1"));
    await clearHandle();
    await saveHandle(makeFakeHandle("Phase2"));
    const loaded = await loadHandle();
    expect((loaded as { name: string }).name).toBe("Phase2");
  });
});

describe("fs-handle-store — DB upgrade path", () => {
  it("first call opens DB at version 1 and creates the 'handles' store on the upgrade event", async () => {
    // The first saveHandle invocation triggers the IDB upgrade
    // callback that creates the object store. Verify by checking
    // the resulting stored value — if the upgrade hadn't run, the
    // put would fail.
    await saveHandle(makeFakeHandle("First"));
    expect(await loadHandle()).not.toBeNull();
  });

  it("subsequent calls reuse the existing DB without re-running the upgrade callback", async () => {
    await saveHandle(makeFakeHandle("First"));
    // Second open: no upgrade should fire (version 1 already exists).
    // The functional sign is that the second saveHandle still
    // succeeds AND the value lands.
    await saveHandle(makeFakeHandle("Second"));
    expect((await loadHandle() as { name: string }).name).toBe("Second");
  });
});
