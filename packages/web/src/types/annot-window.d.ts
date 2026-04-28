/**
 * Ambient declarations for the `__annot_*` window globals the
 * Tauri desktop shell + the PWA host wire onto `window`.
 *
 * Why ambient: the toolbar (and a couple of related UI files)
 * read these globals to decide whether to render a button or
 * fire a host action. Before this file every read site cast
 * `window` to `any` to silence the TS error — typing the
 * globals here makes those casts unnecessary and lets a
 * reader find every entry point with a single `grep` for
 * `window.__annot_`.
 *
 * Sign-off (Phase 4 of `docs/plans/source-audit-cleanup.md`):
 * the globals stay in `packages/web` — only the PWA + the
 * Tauri shell set them, and `core` is committed to staying
 * DOM-free for the headless future.
 *
 * Each global is optional; consumers must `typeof` check
 * before invoking (the Tauri shell installs them, the PWA
 * does not).
 */

declare global {
  interface Window {
    /** Open-file action installed by the Tauri shell.
     *  PWA host: never present (file open lives in the gallery). */
    __annot_openFile?: () => void;
    /** Save-current-annotations action installed by the Tauri
     *  shell so the toolbar's Save button can drive the host's
     *  XMP save flow.
     *  PWA host: never present (save is auto-debounced). */
    __annot_saveAnnotations?: () => void;
    /** Show-gallery action installed by the Tauri shell so the
     *  toolbar can switch back to gallery without owning routing.
     *  PWA host: never present (gallery is a route the editor
     *  navigates to via History.pushState). */
    __annot_showGallery?: () => void;
  }
}

export {};
