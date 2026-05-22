/**
 * IndexedDB storage for Chrome Extension — path-based identification.
 * Stores captured images and folders with filesystem-style paths.
 */
import type { FolderRecord, ImageRecord, ImageRecordUpdate } from "@ingcreators/annot-core/storage";
import {
  ancestorPaths,
  drawToThumbCanvas,
  getFilename,
  getParentPath,
  joinPath,
  rewritePathPrefix,
  uniquifyFilenameAsync,
  validateName,
} from "@ingcreators/annot-core/storage";
import { defaultAnnotFilenameStem } from "@ingcreators/annot-core/utils";

export type { FolderRecord, ImageRecord, ImageRecordUpdate };

const DB_NAME = "annot";
const DB_VERSION = 4; // v4: path-based keys
const IMG_STORE = "images";
const FOLDER_STORE = "folders";

// ---- DB connection ----

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Hard cutover to path-based schema. Drop old stores and recreate.
      if (db.objectStoreNames.contains(IMG_STORE)) db.deleteObjectStore(IMG_STORE);
      if (db.objectStoreNames.contains(FOLDER_STORE)) db.deleteObjectStore(FOLDER_STORE);

      const imgs = db.createObjectStore(IMG_STORE, { keyPath: "path" });
      imgs.createIndex("folderPath", "folderPath", { unique: false });
      imgs.createIndex("createdAt", "createdAt", { unique: false });

      const folders = db.createObjectStore(FOLDER_STORE, { keyPath: "path" });
      folders.createIndex("parentPath", "parentPath", { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function imgStoreT(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(IMG_STORE, mode).objectStore(IMG_STORE);
}
function folderStoreT(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(FOLDER_STORE, mode).objectStore(FOLDER_STORE);
}

function defaultFilename(data: { originalDataUrl: string }): string {
  const ext = data.originalDataUrl.startsWith("data:image/png") ? "png" : "jpg";
  return `${defaultAnnotFilenameStem()}.${ext}`;
}

// ---- Image CRUD ----

export async function saveImage(
  data: Omit<ImageRecord, "path">,
  opts?: { filename?: string },
): Promise<string> {
  const filename = opts?.filename || defaultFilename(data);
  validateName(filename);
  const folderPath = data.folderPath || "";

  const uniqueName = await uniquifyFilenameAsync(filename, async (candidate) => {
    const p = joinPath(folderPath, candidate);
    const existing = await getImage(p);
    return existing !== undefined;
  });

  const path = joinPath(folderPath, uniqueName);
  const record: ImageRecord = {
    path,
    folderPath,
    originalDataUrl: data.originalDataUrl,
    thumbnailDataUrl: data.thumbnailDataUrl,
    annotationsSvg: data.annotationsSvg,
    width: data.width,
    height: data.height,
    sourceUrl: data.sourceUrl,
    tags: data.tags,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    // Persist the canonical screen-capture tree when the capture path
    // supplied it (browser extension captures only). Editor uses this
    // for smart annotations; it's safe to omit for non-browser sources.
    ...(data.elementTree ? { elementTree: data.elementTree } : {}),
  };
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const req = imgStoreT(db, "readwrite").add(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  return path;
}

export async function getImage(path: string): Promise<ImageRecord | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = imgStoreT(db, "readonly").get(path);
    req.onsuccess = () => resolve(req.result as ImageRecord | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function listImages(folderPath: string): Promise<ImageRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    // IndexedDB rejects "" as an only() key in some implementations; walk + filter.
    const idx = imgStoreT(db, "readonly").index("folderPath");
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

export async function updateImage(path: string, updates: ImageRecordUpdate): Promise<void> {
  const record = await getImage(path);
  if (!record) return;
  Object.assign(record, updates, { updatedAt: updates.updatedAt || new Date().toISOString() });
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const req = imgStoreT(db, "readwrite").put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function moveImage(path: string, newFolderPath: string): Promise<string> {
  const record = await getImage(path);
  if (!record) return path;
  if (newFolderPath === record.folderPath) return path;

  const filename = getFilename(record.path);
  const uniqueName = await uniquifyFilenameAsync(filename, async (candidate) => {
    const p = joinPath(newFolderPath, candidate);
    if (p === path) return false;
    const existing = await getImage(p);
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

export async function renameImage(path: string, newName: string): Promise<string> {
  validateName(newName);
  const record = await getImage(path);
  if (!record) return path;
  const newPath = joinPath(record.folderPath, newName);
  if (newPath === path) return path;
  if (await getImage(newPath)) throw new Error(`Image already exists: ${newPath}`);

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

export async function deleteImage(path: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = imgStoreT(db, "readwrite").delete(path);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---- Folder CRUD ----

export async function createFolder(parentPath: string, name: string): Promise<string> {
  validateName(name);
  const path = joinPath(parentPath, name);
  const existing = await getFolder(path);
  if (existing) throw new Error(`Folder already exists: ${path}`);
  const record: FolderRecord = {
    path,
    parentPath,
    name,
    createdAt: new Date().toISOString(),
  };
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const req = folderStoreT(db, "readwrite").add(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  return path;
}

export async function listFolders(parentPath: string): Promise<FolderRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const idx = folderStoreT(db, "readonly").index("parentPath");
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

export async function getFolder(path: string): Promise<FolderRecord | undefined> {
  if (!path) return undefined;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = folderStoreT(db, "readonly").get(path);
    req.onsuccess = () => resolve(req.result as FolderRecord | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function renameFolder(path: string, newName: string): Promise<string> {
  validateName(newName);
  const folder = await getFolder(path);
  if (!folder) return path;
  const newPath = joinPath(folder.parentPath, newName);
  if (newPath === path) return path;
  const collision = await getFolder(newPath);
  if (collision) throw new Error(`Folder already exists: ${newPath}`);
  return moveFolderImpl(path, newPath, folder.parentPath, newName);
}

export async function moveFolder(path: string, newParentPath: string): Promise<string> {
  const folder = await getFolder(path);
  if (!folder) return path;
  const newPath = joinPath(newParentPath, folder.name);
  if (newPath === path) return path;
  const collision = await getFolder(newPath);
  if (collision) throw new Error(`Folder already exists: ${newPath}`);
  return moveFolderImpl(path, newPath, newParentPath, folder.name);
}

async function moveFolderImpl(
  oldPath: string,
  newPath: string,
  newParentPath: string,
  newName: string,
): Promise<string> {
  const db = await openDB();
  const foldersToMove: FolderRecord[] = [];
  const imagesToMove: ImageRecord[] = [];

  await new Promise<void>((resolve, reject) => {
    const req = folderStoreT(db, "readonly").openCursor();
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
    const req = imgStoreT(db, "readonly").openCursor();
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

export async function deleteFolder(path: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([IMG_STORE, FOLDER_STORE], "readwrite");
  const imgs = tx.objectStore(IMG_STORE);
  const folders = tx.objectStore(FOLDER_STORE);

  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);

    const imgReq = imgs.openCursor();
    imgReq.onsuccess = () => {
      const cursor = imgReq.result;
      if (cursor) {
        const img = cursor.value as ImageRecord;
        if (img.path === path || img.path.startsWith(`${path}/`)) cursor.delete();
        cursor.continue();
      }
    };

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

export async function getBreadcrumb(path: string): Promise<FolderRecord[]> {
  if (!path) return [];
  const paths = [...ancestorPaths(path), path];
  const result: FolderRecord[] = [];
  for (const p of paths) {
    const f = await getFolder(p);
    if (f) result.push(f);
  }
  return result;
}

// ---- Thumbnail ----

export async function generateThumbnail(dataUrl: string, maxWidth = 480): Promise<string> {
  try {
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    drawToThumbCanvas(ctx, canvas, bmp, bmp.width, bmp.height, maxWidth);
    bmp.close();

    const outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(outBlob);
    });
  } catch {
    return "";
  }
}
