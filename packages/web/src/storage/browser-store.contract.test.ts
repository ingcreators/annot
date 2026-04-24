import { IDBFactory } from "fake-indexeddb";
import { beforeEach } from "vitest";
import { BrowserStore } from "./browser-store.js";
import { runStorageContract } from "./contract.test-helpers.js";

/**
 * BrowserStore against the shared StorageProvider contract.
 *
 * The store writes to a single well-known IndexedDB database
 * (`DB_NAME = "annot"`), so we reset the global `indexedDB` factory
 * before each test to get a clean slate. `fake-indexeddb` is a pure
 * in-memory polyfill — no disk state leaks between runs or workers.
 */

// Install fake-indexeddb globally. Doing it here (rather than in a
// shared setup file) keeps test ownership close to the test itself
// and avoids pulling the polyfill into tests that don't need it.
beforeEach(() => {
  // Fresh factory per test → every test starts with an empty DB,
  // regardless of test order. Cheaper than deleting the DB explicitly.
  globalThis.indexedDB = new IDBFactory();
});

runStorageContract("BrowserStore", () => new BrowserStore());
