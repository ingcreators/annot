// Test-only mock worker. Implements the `fetchImpl` contract by
// holding an in-memory workspace (images + documents + R2 blobs)
// and routing requests to the same surface the real worker
// exposes.
//
// NOT a production codepath; lives under `src/` so tests can
// `import` it without configuring extra include paths.

import type { DocumentWire, ImageWire } from "./wire-types.js";

interface ImageRow {
  wire: ImageWire;
  originalBytes: Uint8Array;
  annotationsSvg: string | null;
  annotationsYaml: string | null;
}

interface DocumentRow {
  wire: DocumentWire;
  bytes: Uint8Array;
}

let nextId = 1;
const newId = () => `mock-id-${nextId++}`;

export interface MockWorkerOptions {
  /** When set, the worker rejects with HTTP 401 — useful for
   *  testing the StoragePermissionError mapping. */
  forceUnauthenticated?: boolean;
  /** Optional pre-seeded workspaceId. Defaults to `"ws-mock"`. */
  workspaceId?: string;
  /** Optional ceiling on the workspace's storage — when set,
   *  uploads that push past it return 413 quota_exceeded. */
  storageCapBytes?: number;
}

export interface MockWorker {
  /** Drop-in for `fetch` — pass as `fetchImpl` to `AnnotCloudStore`. */
  fetch: typeof fetch;
  /** Direct seed-the-workspace handle for tests that want to set
   *  up state without going through the full POST flow. */
  seedImage(args: {
    path: string;
    bytes: Uint8Array;
    mimeType?: string;
    width?: number;
    height?: number;
    annotationsSvg?: string;
    annotationsYaml?: string;
    tags?: Record<string, string>;
  }): ImageWire;
  seedDocument(args: { path: string; bytes: string; title?: string }): DocumentWire;
  /** Read-only views for assertions. */
  images: () => ImageWire[];
  documents: () => DocumentWire[];
  imageBytes: (id: string) => Uint8Array | undefined;
  imageAnnotations: (id: string) => string | null | undefined;
  documentBytes: (id: string) => Uint8Array | undefined;
  /** Record of every request that came through. Tests assert on
   *  this to confirm the wire shape. */
  requests: { method: string; url: string }[];
}

export function makeMockWorker(options: MockWorkerOptions = {}): MockWorker {
  const workspaceId = options.workspaceId ?? "ws-mock";
  const images = new Map<string, ImageRow>();
  const documents = new Map<string, DocumentRow>();
  const requests: { method: string; url: string }[] = [];

  function findImageById(id: string): ImageRow | undefined {
    return images.get(id);
  }
  function findDocumentById(id: string): DocumentRow | undefined {
    return documents.get(id);
  }
  function findImageByPath(path: string): ImageRow | undefined {
    for (const row of images.values()) if (row.wire.path === path) return row;
    return undefined;
  }
  function findDocumentByPath(path: string): DocumentRow | undefined {
    for (const row of documents.values()) if (row.wire.path === path) return row;
    return undefined;
  }
  function totalBytes(): number {
    let total = 0;
    for (const row of images.values()) total += row.wire.sizeBytes;
    for (const row of documents.values()) total += row.wire.sizeBytes;
    return total;
  }

  function makeImageWire(opts: {
    path: string;
    bytes: number;
    width: number | null;
    height: number | null;
    mimeType: string | null;
    sourceUrl: string | null;
    tags: Record<string, string>;
    hasAnnotations: boolean;
  }): ImageWire {
    const now = Date.now();
    return {
      id: newId(),
      workspaceId,
      createdByUserId: "user-mock",
      path: opts.path,
      sizeBytes: opts.bytes,
      width: opts.width,
      height: opts.height,
      mimeType: opts.mimeType,
      sourceUrl: opts.sourceUrl,
      tags: opts.tags,
      hasAnnotations: opts.hasAnnotations,
      hasThumbnail: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  function makeDocumentWire(opts: {
    path: string;
    bytes: number;
    title: string | null;
    blockCount: number | null;
  }): DocumentWire {
    const now = Date.now();
    return {
      id: newId(),
      workspaceId,
      createdByUserId: "user-mock",
      path: opts.path,
      sizeBytes: opts.bytes,
      title: opts.title,
      blockCount: opts.blockCount,
      createdAt: now,
      updatedAt: now,
    };
  }

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function bytesResponse(status: number, body: Uint8Array, contentType: string): Response {
    // Slice into a fresh ArrayBuffer so the Response constructor's
    // BodyInit overload matches in the TS lib version CI uses
    // (where Uint8Array carries its ArrayBufferLike phantom).
    const buf = body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength,
    ) as ArrayBuffer;
    return new Response(buf, {
      status,
      headers: { "Content-Type": contentType },
    });
  }

  function quotaResponse(): Response {
    return jsonResponse(413, {
      ok: false,
      error: "quota_exceeded",
      exceeded: "storage",
      plan: "free",
      usage: { storageBytes: totalBytes(), documentCount: 0, shareCount: 0 },
      limits: {
        storageBytes: options.storageCapBytes ?? null,
        activeDocuments: null,
        activeShares: null,
      },
      message: "Quota exceeded",
    });
  }

  async function handle(method: string, url: URL, init: RequestInit): Promise<Response> {
    if (options.forceUnauthenticated) {
      return jsonResponse(401, { ok: false, error: "no_session", message: "no session" });
    }

    if (method === "GET" && url.pathname === "/api/auth/me") {
      return jsonResponse(200, {
        ok: true,
        user: {
          provider: "github",
          providerUserId: "12345",
          login: "mock-user",
          name: "Mock User",
          avatarUrl: "",
          userId: "user-mock",
          workspaceId,
        },
      });
    }

    // /api/images
    if (url.pathname === "/api/images") {
      if (method === "GET") {
        const folder = url.searchParams.get("folder");
        const out: ImageWire[] = [];
        for (const row of images.values()) {
          if (folder) {
            if (!row.wire.path.startsWith(folder)) continue;
          }
          out.push(row.wire);
        }
        return jsonResponse(200, {
          ok: true,
          images: out,
          count: out.length,
          limit: 500,
          offset: 0,
        });
      }
      if (method === "POST") {
        const path = url.searchParams.get("path");
        if (!path) {
          return jsonResponse(400, {
            ok: false,
            error: "invalid_request",
            message: "missing path",
          });
        }
        if (findImageByPath(path)) {
          return jsonResponse(409, {
            ok: false,
            error: "path_conflict",
            existingImageId: findImageByPath(path)!.wire.id,
            message: "conflict",
          });
        }
        const bytes = new Uint8Array((init.body as ArrayBuffer) ?? new ArrayBuffer(0));
        if (
          options.storageCapBytes !== undefined &&
          totalBytes() + bytes.byteLength > options.storageCapBytes
        ) {
          return quotaResponse();
        }
        const headers = init.headers as Record<string, string>;
        const wire = makeImageWire({
          path,
          bytes: bytes.byteLength,
          width: headers["X-Annot-Width"] ? Number(headers["X-Annot-Width"]) : null,
          height: headers["X-Annot-Height"] ? Number(headers["X-Annot-Height"]) : null,
          mimeType: headers["Content-Type"] ?? null,
          sourceUrl: headers["X-Annot-Source-Url"] ?? null,
          tags: {},
          hasAnnotations: false,
        });
        images.set(wire.id, {
          wire,
          originalBytes: bytes,
          annotationsSvg: null,
          annotationsYaml: null,
        });
        return jsonResponse(201, { ok: true, image: wire });
      }
    }

    // /api/images/:id (and subroutes)
    const imgMatch = url.pathname.match(/^\/api\/images\/([^/]+)(?:\/(.+))?$/);
    if (imgMatch) {
      const id = imgMatch[1]!;
      const sub = imgMatch[2];
      const row = findImageById(id);

      if (sub === "original") {
        if (method === "GET") {
          if (!row) return jsonResponse(404, { ok: false, error: "not_found" });
          return bytesResponse(200, row.originalBytes, row.wire.mimeType ?? "image/png");
        }
      }
      if (sub === "annotations") {
        if (method === "GET") {
          if (!row) return jsonResponse(404, { ok: false, error: "not_found" });
          if (!row.annotationsSvg) {
            return jsonResponse(404, { ok: false, error: "no_annotations" });
          }
          return bytesResponse(200, new TextEncoder().encode(row.annotationsSvg), "image/svg+xml");
        }
        if (method === "PATCH") {
          if (!row) return jsonResponse(404, { ok: false, error: "not_found" });
          const svg = new TextDecoder().decode(
            new Uint8Array((init.body as ArrayBuffer) ?? new ArrayBuffer(0)),
          );
          row.annotationsSvg = svg;
          row.wire.hasAnnotations = true;
          row.wire.updatedAt = Date.now();
          return jsonResponse(200, { ok: true, image: row.wire });
        }
      }
      if (sub === "annotations-yaml") {
        if (method === "GET") {
          if (!row) return jsonResponse(404, { ok: false, error: "not_found" });
          if (row.annotationsYaml === null) {
            return jsonResponse(404, { ok: false, error: "no_annotations_yaml" });
          }
          return bytesResponse(
            200,
            new TextEncoder().encode(row.annotationsYaml),
            "text/yaml; charset=utf-8",
          );
        }
        if (method === "PATCH") {
          if (!row) return jsonResponse(404, { ok: false, error: "not_found" });
          // The client sends the yaml as a string body (see
          // `setAnnotationsYaml`); tolerate an ArrayBuffer too.
          row.annotationsYaml =
            typeof init.body === "string"
              ? init.body
              : new TextDecoder().decode(
                  new Uint8Array((init.body as ArrayBuffer) ?? new ArrayBuffer(0)),
                );
          row.wire.updatedAt = Date.now();
          return jsonResponse(200, { ok: true });
        }
      }
      if (!sub) {
        if (!row) return jsonResponse(404, { ok: false, error: "not_found" });
        if (method === "GET") return jsonResponse(200, { ok: true, image: row.wire });
        if (method === "DELETE") {
          images.delete(id);
          return new Response(null, { status: 204 });
        }
        if (method === "PATCH") {
          const body = JSON.parse(
            new TextDecoder().decode(
              new Uint8Array((init.body as ArrayBuffer) ?? new ArrayBuffer(0)),
            ),
          ) as Record<string, unknown>;
          if (typeof body.path === "string" && body.path !== row.wire.path) {
            if (findImageByPath(body.path)) {
              return jsonResponse(409, { ok: false, error: "path_conflict" });
            }
            row.wire.path = body.path;
          }
          if (typeof body.width === "number") row.wire.width = body.width;
          if (typeof body.height === "number") row.wire.height = body.height;
          if (body.tags && typeof body.tags === "object") {
            row.wire.tags = body.tags as Record<string, string>;
          }
          if (typeof body.sourceUrl === "string") row.wire.sourceUrl = body.sourceUrl;
          row.wire.updatedAt = Date.now();
          return jsonResponse(200, { ok: true, image: row.wire });
        }
      }
    }

    // /api/documents
    if (url.pathname === "/api/documents") {
      if (method === "GET") {
        const folder = url.searchParams.get("folder");
        const out: DocumentWire[] = [];
        for (const row of documents.values()) {
          if (folder) {
            if (!row.wire.path.startsWith(folder)) continue;
          }
          out.push(row.wire);
        }
        return jsonResponse(200, {
          ok: true,
          documents: out,
          count: out.length,
          limit: 500,
          offset: 0,
        });
      }
      if (method === "POST") {
        const path = url.searchParams.get("path");
        if (!path) {
          return jsonResponse(400, { ok: false, error: "invalid_request" });
        }
        if (findDocumentByPath(path)) {
          return jsonResponse(409, { ok: false, error: "path_conflict" });
        }
        const bytes = new Uint8Array((init.body as ArrayBuffer) ?? new ArrayBuffer(0));
        if (
          options.storageCapBytes !== undefined &&
          totalBytes() + bytes.byteLength > options.storageCapBytes
        ) {
          return quotaResponse();
        }
        const headers = init.headers as Record<string, string>;
        const wire = makeDocumentWire({
          path,
          bytes: bytes.byteLength,
          title: headers["X-Annot-Title"] ?? null,
          blockCount: headers["X-Annot-Block-Count"]
            ? Number(headers["X-Annot-Block-Count"])
            : null,
        });
        documents.set(wire.id, { wire, bytes });
        return jsonResponse(201, { ok: true, document: wire });
      }
    }

    // /api/documents/:id (and subroutes)
    const docMatch = url.pathname.match(/^\/api\/documents\/([^/]+)(?:\/(.+))?$/);
    if (docMatch) {
      const id = docMatch[1]!;
      const sub = docMatch[2];
      const row = findDocumentById(id);
      if (sub === "content") {
        if (method === "GET") {
          if (!row) return jsonResponse(404, { ok: false, error: "not_found" });
          return bytesResponse(200, row.bytes, "text/html; charset=utf-8");
        }
        if (method === "PATCH") {
          if (!row) return jsonResponse(404, { ok: false, error: "not_found" });
          const bytes = new Uint8Array((init.body as ArrayBuffer) ?? new ArrayBuffer(0));
          row.bytes = bytes;
          row.wire.sizeBytes = bytes.byteLength;
          const headers = (init.headers as Record<string, string>) ?? {};
          if (headers["X-Annot-Title"] !== undefined) row.wire.title = headers["X-Annot-Title"];
          if (headers["X-Annot-Block-Count"] !== undefined) {
            row.wire.blockCount = Number(headers["X-Annot-Block-Count"]);
          }
          row.wire.updatedAt = Date.now();
          return jsonResponse(200, { ok: true, document: row.wire });
        }
      }
      if (!sub) {
        if (!row) return jsonResponse(404, { ok: false, error: "not_found" });
        if (method === "GET") return jsonResponse(200, { ok: true, document: row.wire });
        if (method === "DELETE") {
          documents.delete(id);
          return new Response(null, { status: 204 });
        }
        if (method === "PATCH") {
          const body = JSON.parse(
            new TextDecoder().decode(
              new Uint8Array((init.body as ArrayBuffer) ?? new ArrayBuffer(0)),
            ),
          ) as Record<string, unknown>;
          if (typeof body.path === "string" && body.path !== row.wire.path) {
            if (findDocumentByPath(body.path)) {
              return jsonResponse(409, { ok: false, error: "path_conflict" });
            }
            row.wire.path = body.path;
          }
          if (typeof body.title === "string") row.wire.title = body.title;
          if (typeof body.blockCount === "number") row.wire.blockCount = body.blockCount;
          row.wire.updatedAt = Date.now();
          return jsonResponse(200, { ok: true, document: row.wire });
        }
      }
    }

    return jsonResponse(404, { ok: false, error: "not_found", message: url.pathname });
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url);
    const method = init?.method ?? "GET";
    requests.push({ method, url: `${url.pathname}${url.search}` });
    // Normalise body to ArrayBuffer for the handler. Tests pass
    // ArrayBuffer / Uint8Array / string; we don't care about
    // streams.
    let body: ArrayBuffer | undefined;
    if (init?.body !== undefined && init.body !== null) {
      if (init.body instanceof ArrayBuffer) {
        body = init.body;
      } else if (ArrayBuffer.isView(init.body)) {
        body = init.body.buffer.slice(
          init.body.byteOffset,
          init.body.byteOffset + init.body.byteLength,
        );
      } else if (typeof init.body === "string") {
        body = new TextEncoder().encode(init.body).buffer as ArrayBuffer;
      } else {
        throw new Error(`MockWorker: unsupported body type ${typeof init.body}`);
      }
    }
    return await handle(method, url, { ...init, body });
  };

  return {
    fetch: fetchImpl,
    seedImage(args) {
      const wire = makeImageWire({
        path: args.path,
        bytes: args.bytes.byteLength,
        width: args.width ?? null,
        height: args.height ?? null,
        mimeType: args.mimeType ?? "image/png",
        sourceUrl: null,
        tags: args.tags ?? {},
        hasAnnotations: !!args.annotationsSvg,
      });
      images.set(wire.id, {
        wire,
        originalBytes: args.bytes,
        annotationsSvg: args.annotationsSvg ?? null,
        annotationsYaml: args.annotationsYaml ?? null,
      });
      return wire;
    },
    seedDocument(args) {
      const bytes = new TextEncoder().encode(args.bytes);
      const wire = makeDocumentWire({
        path: args.path,
        bytes: bytes.byteLength,
        title: args.title ?? null,
        blockCount: null,
      });
      documents.set(wire.id, { wire, bytes });
      return wire;
    },
    images: () => Array.from(images.values()).map((r) => r.wire),
    documents: () => Array.from(documents.values()).map((r) => r.wire),
    imageBytes: (id: string) => images.get(id)?.originalBytes,
    imageAnnotations: (id: string) => images.get(id)?.annotationsSvg,
    documentBytes: (id: string) => documents.get(id)?.bytes,
    requests,
  };
}
