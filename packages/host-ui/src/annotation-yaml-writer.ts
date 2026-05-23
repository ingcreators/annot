/**
 * Annotation YAML writer — Phase 4b of
 * [`docs/plans/living-spec-authoring-roadmap.md`](../../../docs/plans/living-spec-authoring-roadmap.md).
 *
 * Thin wrapper around the Phase 4a `setAnnotationsYaml` storage
 * capability + the Phase 2a annotation yaml serializer. Persists
 * the caller-supplied `AnnotationsFile` as the new full state of
 * the sidecar.
 *
 * Idempotent — saving an unchanged `AnnotationsFile` produces
 * byte-identical on-disk output. Saving a deeply-equal file twice
 * is a no-op observable through the storage layer's mtime / SHA
 * tracking (the writer doesn't dedupe — the underlying store may).
 *
 * Concurrent edits across tabs / sessions follow last-write-wins
 * semantics at the storage layer. Phase 5 of the roadmap will
 * optionally upgrade to ETag-based optimistic locking when the
 * embedded editor flow lands; Phase 4b explicitly does NOT model
 * that yet — the in-memory `AnnotationsFile` IS the authoritative
 * desired state at the moment of the call.
 *
 * No DOM. Tier C-friendly (host-ui home) but pure logic.
 */

import type { StorageProvider } from "@ingcreators/annot-core/storage";
import { supportsAnnotationsYaml } from "@ingcreators/annot-core/storage";
import {
  type AnnotationsFile,
  serializeAnnotationsYaml,
} from "@ingcreators/annot-product-docs/annotations-yaml";

/**
 * Thrown by {@link saveAnnotationsYaml} when the provided store
 * doesn't implement the Phase 4a yaml capability. Callers that
 * accept stores from arbitrary hosts should gate on
 * {@link supportsAnnotationsYaml} before calling — this error is
 * a safety net rather than a normal control-flow signal.
 */
export class AnnotationsYamlUnsupportedError extends Error {
  constructor() {
    super(
      "Storage provider does not support annotations YAML sidecar writes. " +
        "Check `supportsAnnotationsYaml(store)` before calling `saveAnnotationsYaml`.",
    );
    this.name = "AnnotationsYamlUnsupportedError";
  }
}

/**
 * Save (or create) the annotations YAML sidecar paired with
 * `pngPath`. Replaces the existing sidecar atomically — the
 * caller-supplied `file` becomes the new full state.
 *
 * The Overlay tool's "add an overlay" flow (Phase 4d) merges its
 * new entry into the in-memory `AnnotationsFile` state managed by
 * the shell (Phase 4e), then calls this writer with the updated
 * file. No additional merge logic lives here.
 *
 * @throws {AnnotationsYamlUnsupportedError} when the store lacks
 *   the Phase 4a capability.
 * @throws backend-specific errors from the store's underlying
 *   `setAnnotationsYaml` (e.g. `StoragePermissionError`,
 *   `StorageQuotaError`).
 */
export async function saveAnnotationsYaml(
  store: StorageProvider,
  pngPath: string,
  file: AnnotationsFile,
): Promise<void> {
  if (!supportsAnnotationsYaml(store)) {
    throw new AnnotationsYamlUnsupportedError();
  }
  const content = serializeAnnotationsYaml(file);
  await store.setAnnotationsYaml(pngPath, content);
}
