/**
 * Electron-flavoured desktop IPC bridge — Phase 1 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * Sibling of {@link "./tauri-bridge"} during Phases 1–4: same
 * exported function names + payload shapes, different transport
 * (`window.electronAPI.invoke(channel, args)` instead of
 * `__TAURI_INTERNALS__.invoke(...)`). Renderer call sites in
 * `@ingcreators/annot-editor` / `@ingcreators/annot-editor-shell`
 * still import from `tauri-bridge` today; the migration's Phase 5
 * cutover renames `tauri-bridge.ts` to `desktop-bridge.ts` (with a
 * one-cycle back-compat alias) and flips the imports in one go.
 *
 * For the duration of Phases 1–4 this file is a forward-looking
 * placeholder: the only consumer is the Electron-backed
 * `DesktopFs` (which uses `window.electronAPI.invoke` directly,
 * not via this file). Keeping the file checked in early lets
 * Phases 2–4 land their per-feature IPC channels here without
 * scope creep on the cutover PR.
 *
 * Detection model: the preload script sets
 * `window.__ANNOT_DESKTOP__ = true`; this file reads it via
 * `isDesktop`. The plan's Phase 5 cleanup adds an `isTauri`
 * back-compat alias so a single PR can rename imports without
 * touching every `if (isTauri)` predicate in the renderer.
 *
 * **Type surface**: every payload type used here
 * (`ToolPreset` / `ToolPresets` / `AnnotMetadata` / `CaptureResult`
 * / `WindowInfo` / `AnnotationShape` / `TextRun` /
 * `MosaicMediaPayload`) is **re-exported from `tauri-bridge`** to
 * keep one source of truth for the on-disk / on-clipboard schema
 * during the migration. When tauri-bridge.ts is deleted in
 * Phase 9, those types will move into desktop-bridge.ts directly
 * (see the plan's Phase 9 step 3).
 */

import type {
  AnnotationShape,
  AnnotMetadata,
  CaptureResult,
  MosaicMediaPayload,
  TextRun,
  ToolPreset,
  ToolPresets,
  WindowInfo,
} from "./tauri-bridge.js";

export type {
  AnnotationShape,
  AnnotMetadata,
  CaptureResult,
  MosaicMediaPayload,
  TextRun,
  ToolPreset,
  ToolPresets,
  WindowInfo,
};

interface ElectronApi {
  invoke<T = unknown>(channel: string, args?: unknown): Promise<T>;
}

const isDesktop =
  typeof window !== "undefined" &&
  !!(window as unknown as { __ANNOT_DESKTOP__?: boolean }).__ANNOT_DESKTOP__;

async function invoke<T>(channel: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop) throw new Error("Not running in Electron desktop host");
  const api = (window as unknown as { electronAPI?: ElectronApi }).electronAPI;
  if (!api) {
    throw new Error(
      "[desktop-bridge] window.electronAPI is missing — preload script not loaded?",
    );
  }
  return api.invoke<T>(channel, args);
}

// --- Library root (Electron equivalent of Tauri's portable_dir) ---
//
// Phase 1 of `desktop-electron-migration.md` introduces the
// `app.getLibraryRoot` channel — see
// `packages/desktop/src-electron/ipc/app.ts`. It returns
// `<userData>/library/`, the per-OS directory the Electron host
// stores the gallery library in. Mirrors the role
// `getPortableDir()` plays in `tauri-bridge.ts` for the
// extension-handoff sweep + the legacy-data toast (Phase 5+).
export async function getLibraryRoot(): Promise<string> {
  return invoke<string>("app.getLibraryRoot");
}

// --- Tool Presets (Phase 2) -------------------------------------
//
// Stub today — actual handler lands in Phase 2 of the migration
// plan when `settings.rs` is ported to `src-electron/ipc/settings.ts`.
// The exported shape mirrors `tauri-bridge.ts`'s `loadToolPresets`
// / `saveToolPresets` so the Phase 5 import-flip is a one-line
// rewrite per call site.

export async function loadToolPresets(): Promise<ToolPresets> {
  return invoke<ToolPresets>("load_tool_presets");
}

export async function saveToolPresets(presets: ToolPresets): Promise<void> {
  return invoke<void>("save_tool_presets", { presets });
}

// --- XMP (re-editable image save/load) — Phase 2 -----------------

export async function saveWithXmp(
  renderedImageB64: string,
  originalImageB64: string,
  annotationsSvg: string,
  width: number,
  height: number,
  filePath: string,
): Promise<void> {
  return invoke<void>("save_with_xmp", {
    renderedImageB64,
    originalImageB64,
    annotationsSvg,
    width,
    height,
    filePath,
  });
}

export async function readXmp(filePath: string): Promise<AnnotMetadata | null> {
  return invoke<AnnotMetadata | null>("read_xmp", { filePath });
}

// --- Screen capture — Phase 3 ------------------------------------

export async function captureScreen(): Promise<CaptureResult> {
  return invoke<CaptureResult>("capture_screen");
}

export async function listWindows(): Promise<WindowInfo[]> {
  return invoke<WindowInfo[]>("list_windows");
}

export async function captureWindow(hwnd: number): Promise<CaptureResult> {
  return invoke<CaptureResult>("capture_window", { hwnd });
}

export async function captureRegion(
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<CaptureResult> {
  return invoke<CaptureResult>("capture_region", { x, y, width, height });
}

// --- Office clipboard — Phase 4 ----------------------------------

export async function copyAsOffice(
  drawingXml: string,
  mosaicMedia: MosaicMediaPayload[],
  screenshotData?: string,
  pngDataUrl?: string,
): Promise<void> {
  return invoke<void>("copy_as_office", {
    drawingXml,
    mosaicMedia: mosaicMedia.map((m) => ({
      filename: m.filename,
      bytes: Array.from(m.bytes),
    })),
    screenshotData,
    pngDataUrl,
  });
}

// --- Window controls — Phase 2 -----------------------------------

export async function minimizeMainWindow(): Promise<void> {
  return invoke<void>("minimize_main_window");
}

export async function restoreMainWindow(): Promise<void> {
  return invoke<void>("restore_main_window");
}

export { isDesktop };

/**
 * Back-compat alias. Phase 5's "default-to-Electron" cutover
 * replaces every `if (isTauri)` call site with `if (isDesktop)`;
 * until then this alias makes a one-line import flip from
 * `@ingcreators/annot-core/tauri-bridge` to
 * `@ingcreators/annot-core/desktop-bridge` a no-op for predicate
 * code. Removed in the Phase 9 cleanup per the plan's
 * "remove the `isTauri` back-compat alias" step.
 */
export const isTauri = isDesktop;
