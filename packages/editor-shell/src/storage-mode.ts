/**
 * Storage-mode primitives — host-neutral surface shared between
 * the gallery (in `@ingcreators/annot-editor-shell/gallery/*`) and
 * `@ingcreators/annot-web`'s storage bridge.
 *
 * Phase 2 of `docs/plans/host-convergence.md` lifts these out of
 * `packages/web/src/storage/bridge.ts` so the gallery doesn't
 * back-channel into annot-web. The PWA's `bridge.ts` re-imports
 * from here, keeping `BUILT_IN_STORAGE_MODES` as the single source
 * of truth for "which built-ins exist".
 */

/**
 * Built-in storage backends recognised across hosts. Plugin code
 * (PWA's `PluginContext.registerStorage`) registers additional
 * modes alongside these; consumers iterate this list (or use
 * `BuiltInStorageMode` for type narrowing) when they need to
 * differentiate a built-in from a plugin-supplied mode.
 *
 * `desktop` is included even though no host other than
 * `@ingcreators/annot-desktop` ever instantiates a `DesktopStore`
 * — the mode is recognised here so shared consumers (sidebar chip
 * strip, breadcrumb root label, `disableBuiltinStorage`
 * validation, plugin-vs-built-in check) treat it consistently.
 */
export const BUILT_IN_STORAGE_MODES = [
  "browser",
  "device",
  "googledrive",
  "github",
  "extension",
  "desktop",
] as const;

export type BuiltInStorageMode = (typeof BUILT_IN_STORAGE_MODES)[number];

/**
 * A storage mode key. Kept open as `string` so plugin-registered
 * backends can introduce their own modes without editing every
 * consumer.
 *
 * Use `BuiltInStorageMode` if you specifically need to refer only
 * to the bundled backends (sidebar layout assertions, the
 * `loadLastStorage` validator, etc.).
 */
export type StorageMode = string;
