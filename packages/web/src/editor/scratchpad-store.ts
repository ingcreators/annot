/**
 * ScratchpadStore — IndexedDB-backed persistence for scratchpad items.
 *
 * Items are reusable annotation shapes (or compositions) the user has
 * saved for quick reuse across sessions: "I always annotate with this
 * red arrow + 'Click here' combo — save it once, drop it later."
 *
 * The store is intentionally separate from the image storage (no
 * relationship to ImageRecord). Scratchpad items are per-user-per-
 * browser and survive across images.
 *
 * Schema (IndexedDB object store "items"):
 *   id           string   primary key (uuid)
 *   name         string?  optional user-visible label
 *   svgMarkup    string   serialized SVG fragment to re-create
 *                          the annotation(s) on insert
 *   thumbnail    string   data URL of a small PNG preview
 *   width        number   natural bounding-box width
 *   height       number   natural bounding-box height
 *   createdAt    string   ISO timestamp (also used for stable sort)
 */

import { newIdB58 } from "@ingcreators/annot-core/utils";
// `ScratchpadItem` moved to `@ingcreators/annot-host-ui/scratchpad-types`
// in Phase 2e of `docs/plans/_done/vscode-extension-host.md`. Re-export
// keeps existing `import { ScratchpadItem } from "./scratchpad-store.js"`
// sites compiling untouched. The `ScratchpadStore` class below
// implements `ScratchpadStoreLike` structurally — TypeScript's
// structural typing means no `implements` clause is needed.
export type { ScratchpadItem } from "@ingcreators/annot-host-ui/scratchpad-types";
import type { ScratchpadItem } from "@ingcreators/annot-host-ui/scratchpad-types";

const DB_NAME = "annot-scratchpad";
const DB_VERSION = 1;
const STORE_NAME = "items";

export class ScratchpadStore {
  #dbPromise: Promise<IDBDatabase> | null = null;

  #open(): Promise<IDBDatabase> {
    if (this.#dbPromise) return this.#dbPromise;
    this.#dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          // Secondary index for chronological listing.
          store.createIndex("createdAt", "createdAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.#dbPromise;
  }

  async save(data: Omit<ScratchpadItem, "id" | "createdAt">): Promise<ScratchpadItem> {
    const item: ScratchpadItem = {
      id: newIdB58(),
      createdAt: new Date().toISOString(),
      ...data,
    };
    const db = await this.#open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).add(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return item;
  }

  /** Return items ordered by creation time, newest first. */
  async list(): Promise<ScratchpadItem[]> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const all = (req.result as ScratchpadItem[]) ?? [];
        all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        resolve(all);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.#open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async rename(id: string, name: string): Promise<void> {
    const db = await this.#open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result as ScratchpadItem | undefined;
        if (!item) {
          resolve();
          return;
        }
        item.name = name;
        store.put(item);
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
