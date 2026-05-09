/**
 * Top-level barrel of `@ingcreators/annot-capture`.
 *
 * Most consumers should reach for the typed subpath
 * (`@ingcreators/annot-capture/content`, `…/encode`, `…/shared`,
 * `…/orchestrate`, `…/host`) rather than the root, which is mainly
 * here for tests and TypeDoc-style consumers.
 */

export * from "./content/index.js";
export * from "./encode/index.js";
export * from "./host.js";
export * from "./orchestrate/index.js";
export * from "./shared/index.js";
