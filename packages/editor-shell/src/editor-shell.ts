// `EditorShell` — host-neutral per-image editor lifecycle.
//
// Phase 1 stub. The class signature is the contract; subsequent
// phases (`docs/plans/_done/vscode-extension-host.md` Phase 2 / 3)
// fill the body by lifting `editor-session.ts` + the leaf editor
// components out of `packages/web/`.
//
// Until the body is filled, every method throws — calling code
// inside the PWA still goes through `EditorSession` directly. The
// stub exists so the package surface is reviewable + the dependency
// edge from web → editor-shell can be added incrementally without
// the type-check breaking.

import type { PageMetadata, StorageProvider } from "@ingcreators/annot-core/storage";

/**
 * Feature opt-out bag the host passes at construction. Defaults
 * favour the PWA's "everything on" surface so existing callers can
 * omit the bag entirely; the VSCode extension flips capture +
 * fileManager off because VSCode's own surfaces own those.
 */
export interface EditorShellFeatures {
  /** Capture pipeline (paste, screenshot, extension transfer).
   *  PWA: true. VSCode: false. Default: true. */
  capture?: boolean;
  /** File-manager / gallery view. PWA: true. VSCode: false (the
   *  Explorer is the file manager). Default: true. */
  fileManager?: boolean;
  /** Scratchpad popover. Default: true. */
  scratchpad?: boolean;
  /** Global `?` keyboard-help overlay. Default: true. */
  keyboardHelp?: boolean;
}

/**
 * Construction-time host contract. The shell mounts into
 * `container`, reads / writes through `storage`, and emits events
 * the host bridges to its own UI (PWA's `SaveStatusIndicator`,
 * VSCode's titlebar dirty mark, …).
 *
 * Plugin-host wiring (drawerSections / rightPanelSections /
 * disabled built-ins) lands in Phase 3 once the leaf components
 * have moved here in Phase 2 — adding it to the contract before
 * the components consume it would be premature.
 */
export interface EditorShellHost {
  /** Container element the shell mounts into. The shell owns this
   *  element's children for its lifetime — host code must not
   *  mutate them while the shell is active. */
  container: HTMLElement;
  /** StorageProvider backing the editor. Reads / writes
   *  annotations, image records, page metadata. */
  storage: StorageProvider;
  /** Feature opt-out bag. Optional; defaults favour the PWA. */
  features?: EditorShellFeatures;
  /** Token-override map applied to the shell's CSS custom
   *  properties. PWA leaves this empty (the design-system
   *  foundations theme is already in place); VSCode populates it
   *  with `var(--vscode-*)` references mapped to `--annot-*` token
   *  names so the editor follows the workbench theme. */
  themeOverrides?: Record<string, string>;
}

/**
 * Event names emitted by the shell. Subscribed via
 * `shell.on(event, handler)`; unsubscribe by calling the returned
 * disposer. Detail payloads are intentionally untyped at this
 * stage — Phase 3 narrows them once the bridge to the PWA's
 * `HeaderHost` / `StatusHost` / `SavePipeline` is wired and the
 * actual payload shape is stable.
 */
export type EditorShellEvent =
  | "dirty"
  | "saved"
  | "error"
  | "selection-change";

export type EditorShellEventHandler = (...args: unknown[]) => void;

/**
 * Per-image editor lifecycle. Single-use after `destroy()` —
 * construct a new instance for the next image.
 *
 * **Phase 1 stub**: every method throws. The class shape is the
 * actual deliverable for this phase; the body lands in Phases 2
 * (component moves) + 3 (PWA wiring switchover).
 */
export class EditorShell {
  readonly #host: EditorShellHost;

  constructor(host: EditorShellHost) {
    this.#host = host;
  }

  /** Open an image at the given storage path. Resolves once the
   *  canvas + selection + history + toolbar + right panel are
   *  mounted and the first annotation render has completed. */
  open(_path: string): Promise<void> {
    void this.#host;
    return Promise.reject(
      new Error(
        "EditorShell.open is a Phase 1 stub. Body lands in Phase 3 once " +
          "the leaf components have moved to editor-shell in Phase 2.",
      ),
    );
  }

  /** Save the current annotations through the host StorageProvider.
   *  Idempotent; no-op if there are no unsaved changes. */
  saveNow(): Promise<void> {
    return Promise.reject(
      new Error("EditorShell.saveNow is a Phase 1 stub."),
    );
  }

  /** Page metadata setter for hosts that capture it out-of-band
   *  (PWA's extension-transfer flow). The shell stashes it for the
   *  Elements panel; null clears. PWA-only today; VSCode populates
   *  this when Playwright integration lands. */
  setPageMetadata(_metadata: PageMetadata | null): void {
    throw new Error("EditorShell.setPageMetadata is a Phase 1 stub.");
  }

  /** Snapshot of the current page metadata. Used by the future
   *  VSCode "Reveal in test file" command to read the locator of
   *  the selected element. */
  getCurrentPageMetadata(): PageMetadata | null {
    return null;
  }

  /** Tear down per-session DOM listeners and remove the shell's
   *  children from `host.container`. The shell is single-use after
   *  destroy(). */
  destroy(): void {
    // No-op in the Phase 1 stub — there's nothing to tear down yet.
  }

  /** Subscribe to a shell-emitted event. Returns a disposer that
   *  unsubscribes. */
  on(_event: EditorShellEvent, _handler: EditorShellEventHandler): () => void {
    return () => {
      // No-op in the Phase 1 stub — the event bus lands in Phase 3.
    };
  }
}
