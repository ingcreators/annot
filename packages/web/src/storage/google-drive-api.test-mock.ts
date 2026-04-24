/**
 * In-memory simulator for the subset of the Google Drive v3 REST API
 * that {@link GoogleDriveStore} calls into.
 *
 * Drive is ID-native: every file and folder has a stable, server-
 * generated ID; names aren't unique; parent links are stored on the
 * child as a `parents: [parentId]` array. The simulator mirrors that
 * model as an `id → DriveFile` map plus a known `rootId`. Folder
 * hierarchy is reconstructed on demand by filtering on `parents`.
 *
 * Coverage (all endpoints the store actually hits):
 *
 *   GET  /drive/v3/files?q=...                    list with simple
 *                                                  `'parentId' in parents`
 *                                                  + optional mimeType
 *                                                  filter.
 *   GET  /drive/v3/files/:id?fields=...           metadata fetch.
 *   GET  /drive/v3/files/:id?alt=media            binary download.
 *   POST /upload/drive/v3/files?uploadType=multipart
 *                                                  multipart create
 *                                                  (metadata + base64
 *                                                  content in a single
 *                                                  `multipart/related`
 *                                                  body).
 *   POST /drive/v3/files                          folder create
 *                                                  (metadata-only).
 *   PATCH /drive/v3/files/:id                     rename / reparent
 *                                                  (addParents /
 *                                                  removeParents query
 *                                                  params).
 *   PATCH /upload/drive/v3/files/:id?uploadType=media
 *                                                  content update.
 *   DELETE /drive/v3/files/:id                    delete (cascades for
 *                                                  folders — Drive does
 *                                                  this server-side).
 *
 * The query language is parsed minimally: the store only ever builds
 * `'{parentId}' in parents and trashed = false and mimeType [=|!=] '...'`.
 * We extract the parent id and the mime filter, nothing more.
 */
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  createdTime: string;
  /** Base64-encoded content. Only populated for non-folders. */
  content?: string;
  /** Original Content-Type given at upload (separate from Drive's
   *  mimeType field, which for files stays the real image mime). */
  contentType?: string;
}

export interface DriveState {
  files: Map<string, DriveFile>;
  rootId: string;
  nextId: number;
}

export function createDriveState(rootId = "root-0000"): DriveState {
  const state: DriveState = { files: new Map(), rootId, nextId: 1 };
  // Seed the root folder so `getFile(rootId)` resolves if the store
  // ever walks up past its configured root. Not strictly required by
  // any store path we exercise, but keeps the mental model tidy.
  state.files.set(rootId, {
    id: rootId,
    name: "root",
    mimeType: FOLDER_MIME,
    parents: [],
    createdTime: new Date(0).toISOString(),
  });
  return state;
}

function mintId(state: DriveState, prefix: "f" | "d"): string {
  return `${prefix}-${String(state.nextId++).padStart(6, "0")}`;
}

/**
 * Parse the subset of Drive query language the store actually emits:
 * `'{parentId}' in parents and trashed = false and mimeType [=|!=] '...'`.
 * Anything else → `null` so the handler can return an obvious empty
 * list and surface the unexpected input in test output.
 */
function parseQuery(q: string): {
  parentId?: string;
  mimeTypeIs?: string;
  mimeTypeIsNot?: string;
} | null {
  const result: { parentId?: string; mimeTypeIs?: string; mimeTypeIsNot?: string } = {};
  const parentMatch = q.match(/'([^']+)' in parents/);
  if (parentMatch) result.parentId = parentMatch[1];
  const mimeEqMatch = q.match(/mimeType\s*=\s*'([^']+)'/);
  if (mimeEqMatch) result.mimeTypeIs = mimeEqMatch[1];
  const mimeNeMatch = q.match(/mimeType\s*!=\s*'([^']+)'/);
  if (mimeNeMatch) result.mimeTypeIsNot = mimeNeMatch[1];
  if (!result.parentId) return null;
  return result;
}

/**
 * Pull the JSON metadata part and binary body out of a
 * `multipart/related` upload request. The store always produces
 * exactly two parts (metadata, content) separated by `annot_boundary_*`.
 */
function parseMultipart(
  body: string,
  boundary: string,
): { metadata: Record<string, unknown>; base64: string } | null {
  const separator = `--${boundary}`;
  const parts = body.split(separator).filter((p) => p.trim() && !p.startsWith("--"));
  if (parts.length < 2) return null;

  // Each part starts with headers, then a blank line, then body.
  const parsePart = (raw: string): { headers: Record<string, string>; body: string } | null => {
    const trimmed = raw.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    const headerEnd = trimmed.indexOf("\r\n\r\n");
    if (headerEnd < 0) return null;
    const headerBlock = trimmed.slice(0, headerEnd);
    const body = trimmed.slice(headerEnd + 4);
    const headers: Record<string, string> = {};
    for (const line of headerBlock.split("\r\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
    return { headers, body };
  };

  const metaPart = parsePart(parts[0]);
  const contentPart = parsePart(parts[1]);
  if (!metaPart || !contentPart) return null;

  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(metaPart.body);
  } catch {
    return null;
  }
  return { metadata, base64: contentPart.body.trim() };
}

export function buildDriveHandlers(state: DriveState) {
  return [
    // --------------------------------------------------------------
    // GET /drive/v3/files — list with q filter
    // --------------------------------------------------------------
    http.get(`${DRIVE_API}/files`, ({ request }) => {
      const url = new URL(request.url);
      const q = url.searchParams.get("q") || "";
      const parsed = parseQuery(q);
      if (!parsed) return HttpResponse.json({ files: [] });

      const files: DriveFile[] = [];
      for (const f of state.files.values()) {
        if (!f.parents.includes(parsed.parentId!)) continue;
        if (parsed.mimeTypeIs && f.mimeType !== parsed.mimeTypeIs) continue;
        if (parsed.mimeTypeIsNot && f.mimeType === parsed.mimeTypeIsNot) continue;
        files.push(f);
      }
      // Same sort order Drive uses for the store's `orderBy=createdTime desc`.
      files.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
      return HttpResponse.json({
        files: files.map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          parents: f.parents,
          createdTime: f.createdTime,
        })),
      });
    }),

    // --------------------------------------------------------------
    // GET /drive/v3/files/:id — metadata OR binary (alt=media)
    // --------------------------------------------------------------
    http.get(`${DRIVE_API}/files/:id`, ({ request, params }) => {
      const id = params.id as string;
      const file = state.files.get(id);
      if (!file) return HttpResponse.json({ error: { message: "File not found" } }, { status: 404 });

      const url = new URL(request.url);
      if (url.searchParams.get("alt") === "media") {
        // Binary download — decode base64 and return raw bytes.
        const bytes = file.content
          ? Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0))
          : new Uint8Array(0);
        return new HttpResponse(bytes as BlobPart, {
          status: 200,
          headers: { "Content-Type": file.contentType || "application/octet-stream" },
        });
      }
      return HttpResponse.json({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        parents: file.parents,
        createdTime: file.createdTime,
      });
    }),

    // --------------------------------------------------------------
    // POST /upload/drive/v3/files?uploadType=multipart — create file
    // --------------------------------------------------------------
    http.post(`${UPLOAD_API}/files`, async ({ request }) => {
      const contentType = request.headers.get("Content-Type") || "";
      const boundaryMatch = contentType.match(/boundary=([^;]+)/);
      if (!boundaryMatch) {
        return HttpResponse.json({ error: { message: "missing boundary" } }, { status: 400 });
      }
      const boundary = boundaryMatch[1];
      const body = await request.text();
      const parsed = parseMultipart(body, boundary);
      if (!parsed) {
        return HttpResponse.json({ error: { message: "malformed multipart" } }, { status: 400 });
      }

      const meta = parsed.metadata as { name?: string; parents?: string[]; mimeType?: string };
      const id = mintId(state, "f");
      // Sniff the file's Content-Type from the multipart part headers;
      // not strictly needed for store correctness but keeps downloads
      // symmetric.
      const fileMimeMatch = body.match(/Content-Type:\s*([^\r\n]+)/g);
      const contentHeaderType = fileMimeMatch?.[1]?.split(":")[1]?.trim() || "application/octet-stream";
      const file: DriveFile = {
        id,
        name: meta.name || "unnamed",
        mimeType: meta.mimeType || "application/octet-stream",
        parents: meta.parents || [state.rootId],
        createdTime: new Date().toISOString(),
        content: parsed.base64,
        contentType: contentHeaderType,
      };
      state.files.set(id, file);
      return HttpResponse.json({ id, name: file.name, mimeType: file.mimeType });
    }),

    // --------------------------------------------------------------
    // PATCH /upload/drive/v3/files/:id?uploadType=media — content update
    // --------------------------------------------------------------
    http.patch(`${UPLOAD_API}/files/:id`, async ({ request, params }) => {
      const id = params.id as string;
      const file = state.files.get(id);
      if (!file) return HttpResponse.json({ error: { message: "File not found" } }, { status: 404 });

      // The store PATCHes with `Content-Type: <blob.type>` and the
      // blob itself as body. Read as ArrayBuffer → base64 to keep
      // the "content" field consistent with the multipart path.
      const buf = await request.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      file.content = btoa(binary);
      file.contentType = request.headers.get("Content-Type") || file.contentType;
      return HttpResponse.json({ id, name: file.name });
    }),

    // --------------------------------------------------------------
    // POST /drive/v3/files — folder create (metadata-only)
    // --------------------------------------------------------------
    http.post(`${DRIVE_API}/files`, async ({ request }) => {
      const meta = (await request.json()) as {
        name?: string;
        mimeType?: string;
        parents?: string[];
      };
      const id = mintId(state, "d");
      const file: DriveFile = {
        id,
        name: meta.name || "unnamed",
        mimeType: meta.mimeType || FOLDER_MIME,
        parents: meta.parents || [state.rootId],
        createdTime: new Date().toISOString(),
      };
      state.files.set(id, file);
      return HttpResponse.json({ id, name: file.name, mimeType: file.mimeType });
    }),

    // --------------------------------------------------------------
    // PATCH /drive/v3/files/:id — rename / reparent
    // --------------------------------------------------------------
    http.patch(`${DRIVE_API}/files/:id`, async ({ request, params }) => {
      const id = params.id as string;
      const file = state.files.get(id);
      if (!file) return HttpResponse.json({ error: { message: "File not found" } }, { status: 404 });

      const url = new URL(request.url);
      const addParents = url.searchParams.get("addParents");
      const removeParents = url.searchParams.get("removeParents");

      // PATCHes from the store come in two flavours:
      //   1. Query string only (reparent) — no body.
      //   2. JSON body `{ name }` (rename). No content-length-zero
      //      distinction is available server-side, but we can probe
      //      by peeking at content-type.
      let nameUpdate: string | undefined;
      const contentType = request.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        try {
          const body = (await request.json()) as { name?: string };
          nameUpdate = body.name;
        } catch {
          // Empty body is fine — reparent calls send no body.
        }
      }

      if (nameUpdate) file.name = nameUpdate;
      if (addParents) {
        for (const p of addParents.split(",").filter(Boolean)) {
          if (!file.parents.includes(p)) file.parents.push(p);
        }
      }
      if (removeParents) {
        const drop = new Set(removeParents.split(",").filter(Boolean));
        file.parents = file.parents.filter((p) => !drop.has(p));
      }
      return HttpResponse.json({ id, name: file.name, parents: file.parents });
    }),

    // --------------------------------------------------------------
    // DELETE /drive/v3/files/:id — delete (cascade for folders)
    // --------------------------------------------------------------
    http.delete(`${DRIVE_API}/files/:id`, ({ params }) => {
      const id = params.id as string;
      const file = state.files.get(id);
      if (!file) {
        return HttpResponse.json({ error: { message: "File not found" } }, { status: 404 });
      }
      // Server-side cascade: collect descendants first so we don't
      // mutate `state.files` during iteration.
      const toDrop = new Set<string>([id]);
      if (file.mimeType === FOLDER_MIME) {
        const queue = [id];
        while (queue.length) {
          const parentId = queue.shift()!;
          for (const [childId, child] of state.files) {
            if (child.parents.includes(parentId) && !toDrop.has(childId)) {
              toDrop.add(childId);
              if (child.mimeType === FOLDER_MIME) queue.push(childId);
            }
          }
        }
      }
      for (const d of toDrop) state.files.delete(d);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

/** One-liner for tests that don't need to share state across files. */
export function startDriveMockServer(rootId = "root-0000"): {
  server: ReturnType<typeof setupServer>;
  state: DriveState;
  reset: () => void;
} {
  const state = createDriveState(rootId);
  const server = setupServer(...buildDriveHandlers(state));
  return {
    server,
    state,
    reset: () => {
      state.files.clear();
      state.nextId = 1;
      // Re-seed root so the state is identical to a fresh factory.
      state.files.set(rootId, {
        id: rootId,
        name: "root",
        mimeType: FOLDER_MIME,
        parents: [],
        createdTime: new Date(0).toISOString(),
      });
    },
  };
}
