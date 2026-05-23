/**
 * Annotation YAML loader — Phase 4b of
 * [`docs/plans/living-spec-authoring-roadmap.md`](../../../docs/plans/living-spec-authoring-roadmap.md).
 *
 * Thin wrapper around the Phase 4a `getAnnotationsYaml` storage
 * capability + the Phase 2a annotation yaml parser. Returns `null`
 * for stores that don't expose the capability AND for stores where
 * the sidecar file is simply missing — the editor's Overlay tool
 * treats both as "no existing overlays" and proceeds from an
 * empty in-memory state.
 *
 * No DOM. Tier C-friendly (host-ui home) but pure logic — safe to
 * import from any host runtime.
 */

import type { StorageProvider } from "@ingcreators/annot-core/storage";
import { supportsAnnotationsYaml } from "@ingcreators/annot-core/storage";
import {
  type AnnotationsFile,
  parseAnnotationsYaml,
} from "@ingcreators/annot-product-docs/annotations-yaml";

/**
 * Load the annotations YAML sidecar paired with `pngPath`.
 *
 * @returns the parsed `AnnotationsFile`, or `null` when:
 *   - the store doesn't implement the Phase 4a yaml capability
 *     ({@link supportsAnnotationsYaml} narrows negatively), OR
 *   - the sidecar file doesn't exist for that PNG.
 *
 * Parse errors propagate up — a malformed yaml is loud-fail, not
 * silent-fallback. The editor's host can surface that as a
 * dialog / error toast.
 */
export async function loadAnnotationsYaml(
  store: StorageProvider,
  pngPath: string,
): Promise<AnnotationsFile | null> {
  if (!supportsAnnotationsYaml(store)) return null;
  const source = await store.getAnnotationsYaml(pngPath);
  if (source === undefined) return null;
  return parseAnnotationsYaml(source);
}
