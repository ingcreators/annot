/**
 * `CandidateStore` — in-memory buffer for capture candidates the
 * Auto Capture engine produces. Phase 3 of
 * `docs/plans/web-capture-redesign.md` ships the scaffold + the
 * Accept / Delete / Edit wiring through the workspace; Phase 4
 * starts pushing real diff-detected frames into it.
 *
 * IDB / OPFS persistence is the deferred spec Phase 5 work — for
 * Phases 3–4 the store keeps everything in memory and the
 * workspace's `disconnectedCallback` clears it (so navigating
 * away discards unsaved candidates, behaviour the workspace
 * surfaces with a confirm dialog in Phase 4).
 *
 * Surface design:
 *
 * - `add(candidate)` — pushes; fires `change`.
 * - `remove(id)` — drops by id, revokes any tracked object URL, fires `change`.
 * - `accept(id)` — marks the candidate `accepted` so the workspace's
 *   accept handler can route it through `storage.saveImage` and then
 *   `remove()` it from the buffer.
 * - `clear()` — drops everything, revokes all URLs, fires `change`.
 *
 * Object URLs: callers may attach a `URL.createObjectURL`-derived
 * value via `trackObjectUrl()` so the store can revoke it on
 * `remove` / `clear` / explicit `revokeAll`. Phase 3 doesn't
 * exercise this (the Phase 3 dev-only debug button uses data URLs
 * for thumbnails) but Phase 4's blob-based pipeline will.
 */

import type { CaptureCandidate } from "./types.js";

export type CandidateStoreEvent = "change";

export class CandidateStore extends EventTarget {
  #candidates: CaptureCandidate[] = [];
  #objectUrls = new Set<string>();

  /** Append a candidate. Fires `change`. */
  add(candidate: CaptureCandidate): void {
    this.#candidates.push(candidate);
    this.#emitChange();
  }

  /** Drop a candidate by id. Idempotent — silent no-op when the
   *  id is unknown. Revokes any object URLs the caller registered
   *  for it. Fires `change` when something was actually removed. */
  remove(id: string): void {
    const idx = this.#candidates.findIndex((c) => c.id === id);
    if (idx === -1) return;
    this.#candidates.splice(idx, 1);
    this.#emitChange();
  }

  /** Mark a candidate as accepted. The workspace's accept handler
   *  then persists it via `storage.saveImage` + calls `remove()`.
   *  Idempotent; silent no-op for unknown id. */
  accept(id: string): void {
    const c = this.#candidates.find((cand) => cand.id === id);
    if (!c || c.status === "accepted") return;
    c.status = "accepted";
    this.#emitChange();
  }

  /** Drop all candidates + revoke every tracked object URL. */
  clear(): void {
    if (this.#candidates.length === 0 && this.#objectUrls.size === 0) return;
    this.#candidates = [];
    this.revokeAll();
    this.#emitChange();
  }

  /** Track a URL.createObjectURL-derived value for later revoke
   *  on `remove(id)` / `clear()` / `revokeAll()`. */
  trackObjectUrl(url: string): void {
    this.#objectUrls.add(url);
  }

  /** Revoke every tracked object URL. Called automatically by
   *  `clear()`; the workspace's `disconnectedCallback` calls it
   *  before forgetting the store. */
  revokeAll(): void {
    for (const url of this.#objectUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore — URL was never created or already revoked */
      }
    }
    this.#objectUrls.clear();
  }

  /** Snapshot of the current candidates. Returns a fresh array so
   *  consumers can iterate without seeing in-place mutation from
   *  subsequent `add` / `remove` calls. */
  list(): readonly CaptureCandidate[] {
    return [...this.#candidates];
  }

  /** Read by id without mutating. Useful for the workspace's
   *  Accept handler that needs the blob to hand to storage. */
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
