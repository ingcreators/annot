/**
 * Google Drive storage provider — path-based interface.
 * Reads/writes .anno.jpg/.anno.png files to a user-selected Drive folder.
 *
 * Internally maintains path↔Drive-ID maps because Drive is ID-native.
 * When two siblings share a name on Drive, the second is given a " (2)" suffix
 * in the exposed path (Drive-side name is unchanged).
 */
import type {
  ImageRecord,
  ImageRecordUpdate,
  FolderRecord,
  StorageProvider,
} from "@ingcreators/annot-core/storage";
import {
  joinPath,
  getParentPath,
  getFilename,
  validateName,
  ancestorPaths,
  rewritePathPrefix,
  uniquifyFilename,
  drawToThumbCanvas,
} from "@ingcreators/annot-core/storage";
import {
  createEditableImage,
  readEditableImage,
} from "@ingcreators/annot-core/xmp";
import { renderImageRecord } from "@ingcreators/annot-core/editor/export";
import { encodeCapture } from "@ingcreators/annot-core/encode";
import { loadEncodeOptions } from "../encode-options.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export class GoogleDriveStore implements StorageProvider {
  #token: string;
  #rootFolderId: string;

  // Path ↔ Drive ID maps
  #pathToFolderId = new Map<string, string>();  // "" -> rootFolderId
  #folderIdToPath = new Map<string, string>();
  #pathToFileId = new Map<string, string>();
  #fileIdToPath = new Map<string, string>();

  // Track children loaded per folder (for invalidation purposes)
  #loadedFolders = new Set<string>();

  constructor(token: string, rootFolderId: string) {
    this.#token = token;
    this.#rootFolderId = rootFolderId;
    this.#pathToFolderId.set("", rootFolderId);
    this.#folderIdToPath.set(rootFolderId, "");
  }

  setToken(token: string): void {
    this.#token = token;
  }

  async resync(): Promise<void> {
    this.#pathToFolderId.clear();
    this.#folderIdToPath.clear();
    this.#pathToFileId.clear();
    this.#fileIdToPath.clear();
    this.#loadedFolders.clear();
    this.#pathToFolderId.set("", this.#rootFolderId);
    this.#folderIdToPath.set(this.#rootFolderId, "");
  }

  // ---- Drive API helpers ----

  async #fetch(url: string, init?: RequestInit): Promise<Response> {
    const resp = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.#token}`,
        ...((init?.headers as Record<string, string>) || {}),
      },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const err = new Error(`Drive API ${resp.status}: ${text.slice(0, 200)}`) as any;
      err.status = resp.status;
      err.driveError = true;
      throw err;
    }
    return resp;
  }

  async #listDrive(query: string, fields = "files(id,name,mimeType,createdTime,thumbnailLink,parents)"): Promise<any[]> {
    const q = encodeURIComponent(query);
    const f = encodeURIComponent(fields);
    const resp = await this.#fetch(`${DRIVE_API}/files?q=${q}&fields=${f}&orderBy=createdTime desc&pageSize=200`);
    const data = await resp.json();
    return data.files || [];
  }

  // ---- Path resolution ----

  /** Ensure the path's Drive ID is cached. Walks from nearest cached ancestor. */
  async #resolveFolderId(path: string): Promise<string | undefined> {
    if (this.#pathToFolderId.has(path)) return this.#pathToFolderId.get(path);
    if (!path) return this.#rootFolderId;

    // Find nearest ancestor that's cached
    const parts = path.split("/");
    let acc = "";
    let startIdx = 0;
    for (let i = 0; i < parts.length; i++) {
      const candidate = acc ? `${acc}/${parts[i]}` : parts[i];
      if (this.#pathToFolderId.has(candidate)) {
        acc = candidate;
        startIdx = i + 1;
      } else {
        break;
      }
    }

    // Walk remaining segments
    for (let i = startIdx; i < parts.length; i++) {
      const parentId = this.#pathToFolderId.get(acc)!;
      const children = await this.#listDrive(
        `'${parentId}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`,
        "files(id,name)",
      );
      // Register all children with uniquified paths
      this.#registerFolderChildren(acc, children);
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      if (!this.#pathToFolderId.has(acc)) return undefined;
    }
    return this.#pathToFolderId.get(path);
  }

  /** Populate cache for all children of `parentPath` from API results. */
  #registerFolderChildren(parentPath: string, driveChildren: { id: string; name: string }[]): void {
    const used = new Set<string>();
    // First pass: collect existing cached names (to avoid recollision)
    for (const [p] of this.#pathToFolderId) {
      if (getParentPath(p) === parentPath && p) used.add(getFilename(p));
    }
    for (const child of driveChildren) {
      if (this.#folderIdToPath.has(child.id)) continue;
      const name = uniquifyFilename(child.name, (c) => used.has(c));
      used.add(name);
      const childPath = joinPath(parentPath, name);
      this.#pathToFolderId.set(childPath, child.id);
      this.#folderIdToPath.set(child.id, childPath);
    }
  }

  #registerFileChildren(parentPath: string, driveChildren: { id: string; name: string }[]): void {
    const used = new Set<string>();
    for (const [p] of this.#pathToFileId) {
      if (getParentPath(p) === parentPath) used.add(getFilename(p));
    }
    for (const child of driveChildren) {
      if (this.#fileIdToPath.has(child.id)) continue;
      const name = uniquifyFilename(child.name, (c) => used.has(c));
      used.add(name);
      const childPath = joinPath(parentPath, name);
      this.#pathToFileId.set(childPath, child.id);
      this.#fileIdToPath.set(child.id, childPath);
    }
  }

  // ---- Images ----

  async saveImage(data: Omit<ImageRecord, "path"> & { filename?: string }): Promise<string> {
    const folderPath = data.folderPath || "";
    const parentId = await this.#resolveFolderId(folderPath);
    if (!parentId) throw new Error(`Folder not found: ${folderPath}`);

    const isJpeg = data.originalDataUrl.startsWith("data:image/jpeg");
    const ext = isJpeg ? "anno.jpg" : "anno.png";
    const desired = data.filename || `image-${Date.now()}.${ext}`;
    validateName(desired);

    // Uniquify against current cache + live siblings
    await this.#ensureFolderListed(folderPath);
    const existingNames = new Set<string>();
    for (const [p] of this.#pathToFileId) {
      if (getParentPath(p) === folderPath) existingNames.add(getFilename(p));
    }
    const filename = uniquifyFilename(desired, (c) => existingNames.has(c));
    const path = joinPath(folderPath, filename);

    const blob = await this.#buildXmpBlob(
      { originalDataUrl: data.originalDataUrl, annotationsSvg: data.annotationsSvg, width: data.width, height: data.height, tags: data.tags },
      isJpeg ? "jpg" : "png",
    );
    const driveId = await this.#uploadFile(filename, blob, parentId);
    this.#pathToFileId.set(path, driveId);
    this.#fileIdToPath.set(driveId, path);
    return path;
  }

  async #ensureFolderListed(folderPath: string): Promise<void> {
    if (this.#loadedFolders.has(folderPath)) return;
    const parentId = await this.#resolveFolderId(folderPath);
    if (!parentId) return;
    const children = await this.#listDrive(
      `'${parentId}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`,
      "files(id,name,createdTime,thumbnailLink)",
    );
    this.#registerFileChildren(folderPath, children);
    // Also cache metadata per file (createdTime, thumbnail) in a side map
    for (const f of children) {
      this.#fileMeta.set(f.id, f);
    }
    this.#loadedFolders.add(folderPath);
  }

  #fileMeta = new Map<string, any>();

  async getImage(path: string): Promise<ImageRecord | undefined> {
    const folderPath = getParentPath(path);
    await this.#ensureFolderListed(folderPath);
    const driveId = this.#pathToFileId.get(path);
    if (!driveId) return undefined;

    try {
      const metaResp = await this.#fetch(`${DRIVE_API}/files/${driveId}?fields=id,name,createdTime,parents`);
      const meta = await metaResp.json();

      const binResp = await this.#fetch(`${DRIVE_API}/files/${driveId}?alt=media`);
      const arrayBuf = await binResp.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);

      const xmp = readEditableImage(bytes);
      const dataUrl = xmp?.originalImageDataUrl || await this.#blobToDataUrl(new Blob([bytes]));
      const cachedMeta = this.#fileMeta.get(driveId);

      return {
        path,
        folderPath,
        originalDataUrl: dataUrl,
        thumbnailDataUrl: cachedMeta?.thumbnailLink || "",
        annotationsSvg: xmp?.annotationsSvg || "",
        width: xmp?.width || 0,
        height: xmp?.height || 0,
        sourceUrl: "",
        tags: xmp?.tags || {},
        createdAt: meta.createdTime || "",
        updatedAt: meta.createdTime || "",
      };
    } catch {
      return undefined;
    }
  }

  async listImages(folderPath: string): Promise<ImageRecord[]> {
    await this.#ensureFolderListed(folderPath);
    const results: ImageRecord[] = [];
    for (const [path] of this.#pathToFileId) {
      if (getParentPath(path) !== folderPath) continue;
      const driveId = this.#pathToFileId.get(path)!;
      const m = this.#fileMeta.get(driveId) || {};
      results.push({
        path,
        folderPath,
        originalDataUrl: "",
        thumbnailDataUrl: m.thumbnailLink || "",
        annotationsSvg: "",
        width: 0,
        height: 0,
        sourceUrl: "",
        tags: {},
        createdAt: m.createdTime || "",
        updatedAt: m.createdTime || "",
      });
    }
    results.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return results;
  }

  async updateImage(path: string, updates: ImageRecordUpdate): Promise<string> {
    const driveId = this.#pathToFileId.get(path);
    if (!driveId) return path;

    if (updates.annotationsSvg !== undefined || updates.tags !== undefined) {
      const record = await this.getImage(path);
      if (!record || !record.originalDataUrl) return path;

      const annotationsSvg = updates.annotationsSvg ?? record.annotationsSvg;
      const tags = updates.tags ?? record.tags;
      const isJpeg = record.originalDataUrl.startsWith("data:image/jpeg");

      const blob = await this.#buildXmpBlob(
        { ...record, annotationsSvg, tags },
        isJpeg ? "jpg" : "png",
      );

      await this.#fetch(`${UPLOAD_API}/files/${driveId}?uploadType=media`, {
        method: "PATCH",
        headers: { "Content-Type": blob.type },
        body: blob,
      });
    }

    // Handle move
    if (updates.folderPath !== undefined && updates.folderPath !== getParentPath(path)) {
      const newFolderPath = updates.folderPath;
      const newParentId = await this.#resolveFolderId(newFolderPath);
      if (!newParentId) throw new Error(`Folder not found: ${newFolderPath}`);

      // Remove from old parent
      const metaResp = await this.#fetch(`${DRIVE_API}/files/${driveId}?fields=parents`);
      const metaData = await metaResp.json();
      const oldParents = (metaData.parents || []).join(",");
      await this.#fetch(
        `${DRIVE_API}/files/${driveId}?addParents=${newParentId}&removeParents=${oldParents}`,
        { method: "PATCH" },
      );

      // Update local cache
      const newPath = joinPath(newFolderPath, getFilename(path));
      this.#pathToFileId.delete(path);
      this.#pathToFileId.set(newPath, driveId);
      this.#fileIdToPath.set(driveId, newPath);
      return newPath;
    }

    return path;
  }

  async renameImage(path: string, newName: string): Promise<string> {
    validateName(newName);
    const driveId = this.#pathToFileId.get(path);
    if (!driveId) return path;
    const folderPath = getParentPath(path);
    const newPath = joinPath(folderPath, newName);
    if (newPath === path) return path;
    if (this.#pathToFileId.has(newPath)) throw new Error(`Image already exists: ${newPath}`);

    await this.#fetch(`${DRIVE_API}/files/${driveId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    this.#pathToFileId.delete(path);
    this.#pathToFileId.set(newPath, driveId);
    this.#fileIdToPath.set(driveId, newPath);
    return newPath;
  }

  async deleteImage(path: string): Promise<void> {
    const driveId = this.#pathToFileId.get(path);
    if (!driveId) return;
    await this.#fetch(`${DRIVE_API}/files/${driveId}`, { method: "DELETE" });
    this.#pathToFileId.delete(path);
    this.#fileIdToPath.delete(driveId);
    this.#fileMeta.delete(driveId);
  }

  // ---- Folders ----

  async createFolder(parentPath: string, name: string): Promise<string> {
    validateName(name);
    const parentId = await this.#resolveFolderId(parentPath);
    if (!parentId) throw new Error(`Parent folder not found: ${parentPath}`);

    const fullPath = joinPath(parentPath, name);
    if (this.#pathToFolderId.has(fullPath)) throw new Error(`Folder already exists: ${fullPath}`);

    const resp = await this.#fetch(`${DRIVE_API}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    const data = await resp.json();
    this.#pathToFolderId.set(fullPath, data.id);
    this.#folderIdToPath.set(data.id, fullPath);
    return fullPath;
  }

  async listFolders(parentPath: string): Promise<FolderRecord[]> {
    const parentId = await this.#resolveFolderId(parentPath);
    if (!parentId) return [];
    const children = await this.#listDrive(
      `'${parentId}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`,
      "files(id,name,createdTime)",
    );
    this.#registerFolderChildren(parentPath, children);
    const results: FolderRecord[] = children.map((f: any) => {
      const path = this.#folderIdToPath.get(f.id)!;
      return {
        path,
        parentPath,
        name: getFilename(path),
        createdAt: f.createdTime || "",
      };
    });
    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
  }

  async getFolder(path: string): Promise<FolderRecord | undefined> {
    if (!path) return undefined;
    const driveId = await this.#resolveFolderId(path);
    if (!driveId) return undefined;
    return {
      path,
      parentPath: getParentPath(path),
      name: getFilename(path),
      createdAt: "",
    };
  }

  async renameFolder(path: string, newName: string): Promise<string> {
    validateName(newName);
    const driveId = this.#pathToFolderId.get(path);
    if (!driveId) return path;
    const parentPath = getParentPath(path);
    const newPath = joinPath(parentPath, newName);
    if (newPath === path) return path;
    if (this.#pathToFolderId.has(newPath)) throw new Error(`Folder already exists: ${newPath}`);

    await this.#fetch(`${DRIVE_API}/files/${driveId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    this.#rewriteDescendantPaths(path, newPath);
    return newPath;
  }

  async moveFolder(path: string, newParentPath: string): Promise<string> {
    const driveId = this.#pathToFolderId.get(path);
    if (!driveId) return path;
    const newParentId = await this.#resolveFolderId(newParentPath);
    if (!newParentId) throw new Error(`Parent folder not found: ${newParentPath}`);

    const newPath = joinPath(newParentPath, getFilename(path));
    if (newPath === path) return path;
    if (this.#pathToFolderId.has(newPath)) throw new Error(`Folder already exists: ${newPath}`);

    // Get current parents
    const metaResp = await this.#fetch(`${DRIVE_API}/files/${driveId}?fields=parents`);
    const metaData = await metaResp.json();
    const oldParents = (metaData.parents || []).join(",");
    await this.#fetch(
      `${DRIVE_API}/files/${driveId}?addParents=${newParentId}&removeParents=${oldParents}`,
      { method: "PATCH" },
    );
    this.#rewriteDescendantPaths(path, newPath);
    return newPath;
  }

  #rewriteDescendantPaths(oldPath: string, newPath: string): void {
    // Rewrite folder entries
    const folderEntries = Array.from(this.#pathToFolderId.entries());
    for (const [p, driveId] of folderEntries) {
      if (p === oldPath || p.startsWith(oldPath + "/")) {
        const np = rewritePathPrefix(p, oldPath, newPath);
        this.#pathToFolderId.delete(p);
        this.#pathToFolderId.set(np, driveId);
        this.#folderIdToPath.set(driveId, np);
      }
    }
    // Rewrite file entries
    const fileEntries = Array.from(this.#pathToFileId.entries());
    for (const [p, driveId] of fileEntries) {
      if (p === oldPath || p.startsWith(oldPath + "/")) {
        const np = rewritePathPrefix(p, oldPath, newPath);
        this.#pathToFileId.delete(p);
        this.#pathToFileId.set(np, driveId);
        this.#fileIdToPath.set(driveId, np);
      }
    }
    // Rewrite loaded folders set
    const loaded = Array.from(this.#loadedFolders);
    this.#loadedFolders.clear();
    for (const p of loaded) {
      this.#loadedFolders.add(rewritePathPrefix(p, oldPath, newPath));
    }
  }

  async deleteFolder(path: string): Promise<void> {
    if (!path) return;
    const driveId = this.#pathToFolderId.get(path);
    if (!driveId) return;
    // Drive delete with folder deletes contents recursively
    await this.#fetch(`${DRIVE_API}/files/${driveId}`, { method: "DELETE" });
    // Clean up cache
    for (const [p] of Array.from(this.#pathToFolderId)) {
      if (p === path || p.startsWith(path + "/")) {
        const id = this.#pathToFolderId.get(p)!;
        this.#pathToFolderId.delete(p);
        this.#folderIdToPath.delete(id);
      }
    }
    for (const [p] of Array.from(this.#pathToFileId)) {
      if (p === path || p.startsWith(path + "/")) {
        const id = this.#pathToFileId.get(p)!;
        this.#pathToFileId.delete(p);
        this.#fileIdToPath.delete(id);
        this.#fileMeta.delete(id);
      }
    }
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

  // ---- Thumbnail ----

  async generateThumbnail(dataUrl: string, maxWidth = 480): Promise<string> {
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
      return this.#blobToDataUrl(outBlob);
    } catch {
      return "";
    }
  }

  // ---- Helpers ----

  async #uploadFile(filename: string, blob: Blob, parentId: string): Promise<string> {
    const metadata = JSON.stringify({ name: filename, parents: [parentId] });
    const boundary = "annot_boundary_" + Date.now();
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${blob.type}\r\nContent-Transfer-Encoding: base64\r\n\r\n`;
    const footer = `\r\n--${boundary}--`;
    // Use FileReader.readAsDataURL to base64-encode the blob. Spreading
    // a Uint8Array into String.fromCharCode(...bytes) blows the argument
    // stack for anything larger than a few hundred KiB, which is every
    // real screenshot.
    const dataUrl = await this.#blobToDataUrl(blob);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const fullBody = body + base64 + footer;
    const resp = await this.#fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: fullBody,
    });
    const data = await resp.json();
    return data.id;
  }

  async #buildXmpBlob(record: Partial<ImageRecord>, format: "jpg" | "png"): Promise<Blob> {
    let renderedBlob: Blob;
    if (record.annotationsSvg && record.annotationsSvg.length > 10 && record.originalDataUrl) {
      const renderedDataUrl = await renderImageRecord(
        record.originalDataUrl, record.annotationsSvg, record.width || 0, record.height || 0,
      );
      // Re-encode rendered PNG via shared encoder (PNG-8 smart fallback).
      // Skip JPEG — already small at q=92.
      let finalDataUrl = renderedDataUrl;
      if (format === "png") {
        try {
          const opts = loadEncodeOptions();
          const encoded = await encodeCapture(renderedDataUrl, opts);
          finalDataUrl = encoded.dataUrl;
        } catch (e) {
          console.warn("[drive-store] rendered-image re-encode failed, keeping PNG-24:", e);
        }
      }
      renderedBlob = await (await fetch(finalDataUrl)).blob();
    } else if (record.originalDataUrl) {
      renderedBlob = await (await fetch(record.originalDataUrl)).blob();
    } else {
      renderedBlob = new Blob([]);
    }
    return createEditableImage({
      renderedBlob,
      originalDataUrl: record.originalDataUrl || "",
      annotationsSvg: record.annotationsSvg || "",
      width: record.width || 0,
      height: record.height || 0,
      format,
      tags: record.tags || {},
    });
  }

  #blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }
}
