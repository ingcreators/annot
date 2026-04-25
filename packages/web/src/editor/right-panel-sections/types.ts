/**
 * Shared types for right-panel section modules. Centralized here so
 * the section files can import the page-metadata shape without
 * pulling the right-panel host (avoids the import cycle that would
 * otherwise form right-panel → sections → right-panel host).
 */

import type { PageMetadata } from "@ingcreators/annot-core";

/** The fields the page-elements section reads from `PageMetadata`.
 *  Aliased so the section signature stays expressive even though
 *  it's structurally identical to the upstream type. */
export type PageMetadataLike = PageMetadata;
