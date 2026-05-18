// `@ingcreators/annot-cloud-store` — public surface.
//
// Phase 4 client-side of `docs/plans/annot-cloud-roadmap.md`.
// Talks to the `@ingcreators/annot-worker` HTTP API via a session
// cookie. Implements `StorageProvider` so the PWA can mount it
// behind the existing storage bridge.

export { ApiClient, type ApiClientOptions, ApiError, type ApiErrorBody } from "./api-client.js";
export { AnnotCloudStore, type AnnotCloudStoreOptions } from "./cloud-store.js";
export type {
  AuthMeWire,
  DocumentGetResponse,
  DocumentListResponse,
  DocumentWire,
  ImageGetResponse,
  ImageListResponse,
  ImageWire,
} from "./wire-types.js";
