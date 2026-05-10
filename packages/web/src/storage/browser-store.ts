/**
 * Browser-local IndexedDB storage — path-based identification.
 * Used as default when extension is not installed. The "Browser"
 * name mirrors the sidebar label so identifiers line up across
 * UI / URL (`/edit/browser/...`) / code.
 * Implements StorageProvider interface.
 */
import type {
  DocumentRecord,
  DocumentRecordUpdate,
  FolderRecord,
  ImageRecord,
  ImageRecordUpdate,
  StorageProvider,
  StorageWithDocuments,
  StorageWithThumbnailCache,
} from "@ingcreators/annot-core/storage";
import {
  ancestorPaths,
  getFilename,
  getParentPath,
  joinPath,
  rewritePathPrefix,
  StorageConflictError,
  StorageNotFoundError,
  uniquifyFilenameAsync,
  validateName,
} from "@ingcreators/annot-core/storage";
import { defaultAnnotImageFilename } from "@ingcreators/annot-core/utils";

const DB_NAME = "annot";
// v3: add the `documents` store while preserving the v2
// path-keyed images / folders. See Phase 6a of
// `docs/plans/annot-html-document.md`.
const DB_VERSION = 3;
const IMG_STORE = "images";
const FOLDER_STORE = "folders";
const DOC_STORE = "documents";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion;

      // v0/v1 → v2: hard cutover for the path-based schema. The
      // pre-path-keyed stores are unrecoverable here so we drop
      // them; users on v0/v1 lose any local captures (acceptable
      // pre-release behaviour the v2 cutover already established).
      if (oldVersion < 2) {
        if (db.objectStoreNames.contains(IMG_STORE)) db.deleteObjectStore(IMG_STORE);
        if (db.objectStoreNames.contains(FOLDER_STORE)) db.deleteObjectStore(FOLDER_STORE);

        const imgs = db.createObjectStore(IMG_STORE, { keyPath: "path" });
        imgs.createIndex("folderPath", "folderPath", { unique: false });
        imgs.createIndex("createdAt", "createdAt", { unique: false });

        const folders = db.createObjectStore(FOLDER_STORE, { keyPath: "path" });
        folders.createIndex("parentPath", "parentPath", { unique: false });
      }

      // v2 → v3: add the documents store without touching the
      // existing v2 stores. Users on v2 keep their captures.
      if (oldVersion < 3 && !db.objectStoreNames.contains(DOC_STORE)) {
        const docs = db.createObjectStore(DOC_STORE, { keyPath: "path" });
        docs.createIndex("folderPath", "folderPath", { unique: false });
        docs.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function imgStore(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(IMG_STORE, mode).objectStore(IMG_STORE);
}
function folderStore(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(FOLDER_STORE, mode).objectStore(FOLDER_STORE);
}
function docStore(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(DOC_STORE, mode).objectStore(DOC_STORE);
}

export class BrowserStore
  implements StorageProvider, StorageWithThumbnailCache, StorageWithDocuments
{
  // ---- Images ----

  async saveImage(data: Omit<ImageRecord, "path">, opts?: { filename?: string }): Promise<string> {
    // No explicit filename from the caller → treat as an annot-native
    // capture and use the shared `annot-<ts>.annot.<ext>` shape (see
    // `defaultAnnotImageFilename` in `@ingcreators/annot-core/utils`).
    // Callers that already have a filename (drag-and-drop, extension
    // transfer preserving the user's capture name, etc.) pass it
    // through and their original name wins.
    const filename = opts?.filename || defaultAnnotImageFilename(data.originalDataUrl);
    validateName(filename);
    const folderPath = data.folderPath || "";

    const uniqueName = await uniquifyFilenameAsync(filename, async (candidate) => {
      const path = joinPath(folderPath, candidate);
      const existing = await this.getImage(path);
      return existing !== undefined;
    });

    const path = joinPath(folderPath, uniqueName);
    const record: ImageRecord = {
      path,
      folderPath,
      originalDataUrl: data.originalDataUrl,
      // Thumbnail bytes are owned by the unified `ThumbnailManager`
      // — the host's `tm.write(provider, path, dataUrl, dims)` call
      // in the capture / save flow seeds it. We store `""` in IDB
      // so the gallery's hydration path goes through the manager.
      thumbnailDataUrl: "",
      annotationsSvg: data.annotationsSvg,
      width: data.width,
      height: data.height,
      sourceUrl: data.sourceUrl,
      tags: data.tags,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      // DOM metadata passed through by browser-extension captures.
      // Optional — screenshots from paste / desktop capture omit it.
      ...(data.pageMetadata ? { pageMetadata: data.pageMetadata } : {}),
    };
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const req = imgStore(db, "readwrite").add(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return path;
  }

  async getImage(path: string): Promise<ImageRecord | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = imgStore(db, "readonly").get(path);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async listImages(folderPath: string): Promise<ImageRecord[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      // Note: IndexedDB rejects "" as an `only()` key in some implementations,
      // so we always walk the full index and filter manually.
      const idx = imgStore(db, "readonly").index("folderPath");
      const req = idx.openCursor();
      const results: ImageRecord[] = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const rec = cursor.value as ImageRecord;
          if (rec.folderPath === folderPath) results.push(rec);
          cursor.continue();
        } else {
          results.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async updateImage(path: string, updates: ImageRecordUpdate): Promise<void> {
    const record = await this.getImage(path);
    if (!record) return;
    Object.assign(record, updates, { updatedAt: updates.updatedAt || new Date().toISOString() });
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const req = imgStore(db, "readwrite").put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async moveImage(path: string, newFolderPath: string): Promise<string> {
    const record = await this.getImage(path);
    if (!record) throw new StorageNotFoundError(path, `Image not found: ${path}`);
    if (newFolderPath === record.folderPath) return path;

    const filename = getFilename(record.path);
    const uniqueName = await uniquifyFilenameAsync(filename, async (candidate) => {
      const p = joinPath(newFolderPath, candidate);
      if (p === path) return false;
      const existing = await this.getImage(p);
      return existing !== undefined;
    });
    const newPath = joinPath(newFolderPath, uniqueName);
    const newRecord: ImageRecord = {
      ...record,
      folderPath: newFolderPath,
      path: newPath,
      updatedAt: new Date().toISOString(),
    };
    const db = await openDB();
    const tx = db.transaction(IMG_STORE, "readwrite");
    const store = tx.objectStore(IMG_STORE);
    await new Promise<void>((resolve, reject) => {
      store.delete(path).onsuccess = () => {
        const addReq = store.add(newRecord);
        addReq.onsuccess = () => resolve();
        addReq.onerror = () => reject(addReq.error);
      };
      tx.onerror = () => reject(tx.error);
    });
    return newPath;
  }

  async renameImage(path: string, newName: string): Promise<string> {
    validateName(newName);
    const record = await this.getImage(path);
    if (!record) throw new StorageNotFoundError(path, `Image not found: ${path}`);
    const newPath = joinPath(record.folderPath, newName);
    if (newPath === path) return path;
    if (await this.getImage(newPath)) {
      throw new StorageConflictError(newPath, `Image already exists: ${newPath}`);
    }

    const db = await openDB();
    const tx = db.transaction(IMG_STORE, "readwrite");
    const store = tx.objectStore(IMG_STORE);
    await new Promise<void>((resolve, reject) => {
      store.delete(path).onsuccess = () => {
        const req = store.add({
          ...record,
          path: newPath,
          updatedAt: new Date().toISOString(),
        });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      };
      tx.onerror = () => reject(tx.error);
    });
    return newPath;
  }

  async deleteImage(path: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = imgStore(db, "readwrite").delete(path);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ---- Folders ----

  async createFolder(parentPath: string, name: string): Promise<string> {
    validateName(name);
    const path = joinPath(parentPath, name);
    const existing = await this.getFolder(path);
    if (existing) throw new StorageConflictError(path, `Folder already exists: ${path}`);

    const record: FolderRecord = {
      path,
      parentPath,
      name,
      createdAt: new Date().toISOString(),
    };
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const req = folderStore(db, "readwrite").add(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return path;
  }

  async listFolders(parentPath: string): Promise<FolderRecord[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const idx = folderStore(db, "readonly").index("parentPath");
      const req = idx.openCursor();
      const results: FolderRecord[] = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const rec = cursor.value as FolderRecord;
          if (rec.parentPath === parentPath) results.push(rec);
          cursor.continue();
        } else {
          results.sort((a, b) => a.name.localeCompare(b.name));
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getFolder(path: string): Promise<FolderRecord | undefined> {
    if (!path) return undefined;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = folderStore(db, "readonly").get(path);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async renameFolder(path: string, newName: string): Promise<string> {
    validateName(newName);
    const folder = await this.getFolder(path);
    if (!folder) throw new StorageNotFoundError(path, `Folder not found: ${path}`);
    const newPath = joinPath(folder.parentPath, newName);
    if (newPath === path) return path;
    const collision = await this.getFolder(newPath);
    if (collision) {
      throw new StorageConflictError(newPath, `Folder already exists: ${newPath}`);
    }
    return this.#moveFolderImpl(path, newPath, folder.parentPath, newName);
  }

  async moveFolder(path: string, newParentPath: string): Promise<string> {
    const folder = await this.getFolder(path);
    if (!folder) throw new StorageNotFoundError(path, `Folder not found: ${path}`);
    const newPath = joinPath(newParentPath, folder.name);
    if (newPath === path) return path;
    const collision = await this.getFolder(newPath);
    if (collision) {
      throw new StorageConflictError(newPath, `Folder already exists: ${newPath}`);
    }
    return this.#moveFolderImpl(path, newPath, newParentPath, folder.name);
  }

  /** Rewrite all descendant paths (folders + images) when a folder is moved/renamed. */
  async #moveFolderImpl(
    oldPath: string,
    newPath: string,
    newParentPath: string,
    newName: string,
  ): Promise<string> {
    const db = await openDB();
    // Collect descendant folders and images
    const foldersToMove: FolderRecord[] = [];
    const imagesToMove: ImageRecord[] = [];

    await new Promise<void>((resolve, reject) => {
      const req = folderStore(db, "readonly").openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const f = cursor.value as FolderRecord;
          if (f.path === oldPath || f.path.startsWith(`${oldPath}/`)) foldersToMove.push(f);
          cursor.continue();
        } else resolve();
      };
      req.onerror = () => reject(req.error);
    });

    await new Promise<void>((resolve, reject) => {
      const req = imgStore(db, "readonly").openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const img = cursor.value as ImageRecord;
          if (img.path === oldPath || img.path.startsWith(`${oldPath}/`)) imagesToMove.push(img);
          cursor.continue();
        } else resolve();
      };
      req.onerror = () => reject(req.error);
    });

    // Apply moves in a single transaction
    const tx = db.transaction([IMG_STORE, FOLDER_STORE], "readwrite");
    const imgs = tx.objectStore(IMG_STORE);
    const folders = tx.objectStore(FOLDER_STORE);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);

      for (const f of foldersToMove) {
        folders.delete(f.path);
        const np = rewritePathPrefix(f.path, oldPath, newPath);
        folders.add({
          ...f,
          path: np,
          parentPath: np === newPath ? newParentPath : getParentPath(np),
          name: np === newPath ? newName : f.name,
        });
      }
      for (const img of imagesToMove) {
        imgs.delete(img.path);
        const np = rewritePathPrefix(img.path, oldPath, newPath);
        imgs.add({
          ...img,
          path: np,
          folderPath: getParentPath(np),
        });
      }
    });

    return newPath;
  }

  async deleteFolder(path: string): Promise<void> {
    const db = await openDB();
    const tx = db.transaction([IMG_STORE, FOLDER_STORE], "readwrite");
    const imgs = tx.objectStore(IMG_STORE);
    const folders = tx.objectStore(FOLDER_STORE);

    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);

      // Delete all images under the folder
      const imgReq = imgs.openCursor();
      imgReq.onsuccess = () => {
        const cursor = imgReq.result;
        if (cursor) {
          const img = cursor.value as ImageRecord;
          if (img.path === path || img.path.startsWith(`${path}/`)) cursor.delete();
          cursor.continue();
        }
      };

      // Delete the folder and all nested folders
      const fReq = folders.openCursor();
      fReq.onsuccess = () => {
        const cursor = fReq.result;
        if (cursor) {
          const f = cursor.value as FolderRecord;
          if (f.path === path || f.path.startsWith(`${path}/`)) cursor.delete();
          cursor.continue();
        }
      };
    });
  }

  async getBreadcrumb(path: string): Promise<FolderRecord[]> {
    if (!path) return [];
    const paths = [...ancestorPaths(path), path];
    const result: FolderRecord[] = [];
    for (const p of paths) {
      const f = await this.getFolder(p);
      if (f) result.push(f);
    }
    return result;
  }

  // ── StorageWithThumbnailCache ────────────────────────────────

  /**
   * Stable per-image identifier for the unified thumbnail cache.
   * Browser store is the only writer for its IndexedDB, so the
   * path itself (which includes the folder + uniquified filename)
   * uniquely identifies a record across a single install.
   */
  thumbnailKey(path: string): string | undefined {
    return `browser:${path}`;
  }

  /**
   * `updatedAt` advances on every `updateImage` call (set in
   * `updateImage`'s `Object.assign`), so cache hits stay fresh
   * across edits. No external mutation possible — the only writer
   * is this same `BrowserStore` instance.
   */
  thumbnailVersion(_path: string): string {
    // Read-time deferred to keep this synchronous; the manager
    // calls `thumbnailVersion` per record during `attach`, so an
    // async lookup would balloon to N parallel IDB reads. Empty
    // string means "no version mismatch detection" — fine here
    // because no external writer exists. The cache key itself
    // (path) changes when the file is renamed / moved (cache
    // becomes orphan and the LRU sweep reclaims it).
    return "";
  }

  /**
   * Source bytes for thumbnail regeneration come from the IDB
   * record's `originalDataUrl`. The manager runs the result
   * through `generateThumbnailFromBlob` when the cache misses.
   */
  async fetchThumbnailSource(path: string): Promise<Blob | undefined> {
    const record = await this.getImage(path);
    if (!record?.originalDataUrl) return undefined;
    try {
      const resp = await fetch(record.originalDataUrl);
      return await resp.blob();
    } catch {
      return undefined;
    }
  }

  // ── StorageWithDocuments ────────────────────────────────────────
  // Phase 6a of `docs/plans/annot-html-document.md`. Documents are
  // stored in their own IDB object store keyed by path; folders are
  // shared with the image side because the path-keyed model doesn't
  // discriminate by file kind.

  async saveDocument(
    data: Omit<DocumentRecord, "path">,
    opts?: { filename?: string },
  ): Promise<string> {
    // No explicit filename → fall back to a timestamped name. The
    // `.annot.html` extension is the format-spec contract; callers
    // typically pass a user-chosen leaf name through the editor's
    // Save-As dialog instead.
    const filename = opts?.filename || `document-${Date.now()}.annot.html`;
    validateName(filename);
    const folderPath = data.folderPath || "";

    const uniqueName = await uniquifyFilenameAsync(filename, async (candidate) => {
      const path = joinPath(folderPath, candidate);
      const existing = await this.getDocument(path);
      return existing !== undefined;
    });

    const path = joinPath(folderPath, uniqueName);
    const record: DocumentRecord = {
      path,
      folderPath,
      bytes: data.bytes,
      thumbnailDataUrl: data.thumbnailDataUrl,
      title: data.title,
      imageCount: data.imageCount,
      blockCount: data.blockCount,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const req = docStore(db, "readwrite").add(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return path;
  }

  async getDocument(path: string): Promise<DocumentRecord | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = docStore(db, "readonly").get(path);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async listDocuments(folderPath: string): Promise<DocumentRecord[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const idx = docStore(db, "readonly").index("folderPath");
      const req = idx.getAll(folderPath);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async updateDocument(path: string, updates: DocumentRecordUpdate): Promise<void> {
    // Idempotent on missing source — matches `updateImage` semantics
    // (the StorageProvider error-contract baseline applies uniformly
    // across all sibling methods).
    const existing = await this.getDocument(path);
    if (!existing) return;
    const updated: DocumentRecord = { ...existing, ...updates };
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const req = docStore(db, "readwrite").put(updated);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
