// Wire shapes the worker returns. Kept separate from the
// `StorageProvider` types in `@ingcreators/annot-core/storage`
// because the worker shape evolves on its own deploy cadence —
// e.g. adding a server-side field doesn't change the client
// contract until the store starts using it.

export interface ImageWire {
  id: string;
  workspaceId: string;
  createdByUserId: string;
  path: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  sourceUrl: string | null;
  tags: Record<string, string>;
  hasAnnotations: boolean;
  hasThumbnail: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentWire {
  id: string;
  workspaceId: string;
  createdByUserId: string;
  path: string;
  sizeBytes: number;
  title: string | null;
  blockCount: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AuthMeWire {
  ok: true;
  user: {
    provider: "github" | "google";
    providerUserId: string;
    login: string;
    name: string;
    avatarUrl: string;
    userId: string;
    workspaceId: string;
  };
}

export interface ImageGetResponse {
  ok: true;
  image: ImageWire;
}

export interface ImageListResponse {
  ok: true;
  images: ImageWire[];
  limit: number;
  offset: number;
  count: number;
}

export interface DocumentGetResponse {
  ok: true;
  document: DocumentWire;
}

export interface DocumentListResponse {
  ok: true;
  documents: DocumentWire[];
  limit: number;
  offset: number;
  count: number;
}
