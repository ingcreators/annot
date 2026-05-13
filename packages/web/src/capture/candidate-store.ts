/**
 * `CandidateStore` — list of capture candidates produced during the
 * current /capture session. The candidates themselves are already
 * persisted via `StorageProvider.saveImage()` (the `path` field on
 * each `CaptureCandidate` is the storage key); this store is just
 * the in-memory list the workspace panel renders.
 *
 * The original Phase 3 design buffered un-accepted Blobs here
 * pending an Accept gate. Real usage showed the gate was friction +
 * the buffer leaked tens-of-MB per candidate at 4K — so the model
 * flipped to "save immediately, Delete in the panel actually deletes
 * from storage". The store API shrank accordingly:
 *
 * - `add(candidate)` — append + fire `change`.
 * - `remove(id)` — drop by id (== path) + fire `change`. The
 *   workspace's delete-handler additionally calls
 *   `storage.deleteImage(path)` so the storage stays consistent.
 * - `clear()` — drop everything + fire `change`.
 *
 * Object-URL tracking + the `accept()` method are gone (no more
 * orphan Blobs to revoke; no review gate to flip).
 */

import type { CaptureCandidate } from "./types.js";

export type CandidateStoreEvent = "change";

export class CandidateStore extends EventTarget {
  #candidates: CaptureCandidate[] = [];

  /** Append a candidate. Fires `change`. */
  add(candidate: CaptureCandidate): void {
    this.#candidates.push(candidate);
    this.#emitChange();
  }

  /** Drop a candidate by id (== path). Idempotent — silent no-op
   *  when the id is unknown. Fires `change` only when something
   *  was actually removed. */
  remove(id: string): void {
    const idx = this.#candidates.findIndex((c) => c.id === id);
    if (idx === -1) return;
    this.#candidates.splice(idx, 1);
    this.#emitChange();
  }

  /** Drop all candidates. Fires `change` only if the list was
   *  non-empty (so back-to-back `clear()` calls don't spam). */
  clear(): void {
    if (this.#candidates.length === 0) return;
    this.#candidates = [];
    this.#emitChange();
  }

  /** Snapshot of the current candidates. Returns a fresh array so
   *  consumers can iterate without seeing in-place mutation from
   *  subsequent `add` / `remove` calls. */
  list(): readonly CaptureCandidate[] {
    return [...this.#candidates];
  }

  /** Read by id without mutating. */
  get(id: string): CaptureCandidate | undefined {
    return this.#candidates.find((c) => c.id === id);
  }

  get size(): number {
    return this.#candidates.length;
  }

  #emitChange(): void {
    this.dispatchEvent(new CustomEvent("change"));
  }
}
