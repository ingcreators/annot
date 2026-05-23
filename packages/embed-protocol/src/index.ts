// Public surface for `@ingcreators/annot-embed-protocol`.
//
// Phase 5a of `docs/plans/living-spec-authoring-roadmap.md`.
// Tier A — pure types + constants, zero runtime deps,
// browser- + Node-friendly. Subsequent sub-phases extend the
// surface additively:
//
// - 5b adds the URL-callback codec (`url-callback.ts`).
// - 5c adds the postMessage dispatcher (`postmessage.ts`).

export type {
  EditAbandonedEvent,
  EditCommittedEvent,
  EditorReadyEvent,
  EditRequestedEvent,
  EmbedEvent,
  EmbedEventType,
  EmbedMode,
  EmbedProtocolVersion,
  ResizeNeededEvent,
} from "./events.js";
export {
  EMBED_EVENT_TYPES,
  EMBED_PROTOCOL_VERSION,
  isEmbedEvent,
} from "./events.js";
export type { EmbedRequestParams, EmbedReturnSignal } from "./url-callback.js";
export {
  EmbedRequestUrlError,
  encodeEmbedRequestUrl,
  encodeEmbedReturnHash,
  MAX_EMBED_REQUEST_URL_BYTES,
  parseEmbedReturnHash,
} from "./url-callback.js";
