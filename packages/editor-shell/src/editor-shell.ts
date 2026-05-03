// `EditorShell` — host-neutral per-image editor lifecycle.
//
// Phase 3 of `docs/plans/_done/vscode-extension-host.md` — minimum
// viable implementation. The shell takes a host-supplied container
// + StorageProvider, owns the per-image canvas / history / selection
// triple, and exposes the underlying Tier C primitives so each host
// can layer its own toolbar / panels / capture flows on top.
//
// What lives here (host-neutral):
//   - SVG root creation inside `host.container`.
//   - `CanvasManager` + `History` + `SelectionManager` construction.
//   - `open(path)` reads the `ImageRecord` via `host.storage` and
//     boots the canvas with `originalDataUrl` + `width` + `height`
//     + the persisted `annotationsSvg` (when present).
//   - `saveNow()` writes the current SVG back to `host.storage`.
//   - Event bus (dirty / saved / error / selection-change) the host
//     bridges to its own UI surfaces.
//
// What stays in the host (PWA today, VSCode in Phase 4):
//   - The toolbar, drawer, right-panel mount points (each host puts
//     them where its own layout calls for; the shell exposes the
//     primitives via `getCanvas()` / `getHistory()` / `getSelection()`
//     so the host's wiring keeps owning the call sites).
//   - The `SaveStatusIndicator`, file-manager / capture pipeline,
//     routing, plugin host — none of which the shell models.
//
// The PWA's `EditorSession` (Phase 3 PR) constructs an `EditorShell`,
// calls `shell.open(path)`, and reads `shell.getCanvas()` etc. into
// its existing toolbar / drawer / right-panel wiring. The shell
// proves the architecture works without trying to swallow every
// PWA-shell concern in one go.

import type { CanvasManager, History, SelectionManager } from "@ingcreators/annot-editor";
import {
  CanvasManager as CanvasManagerImpl,
  exportSVGString,
  History as HistoryImpl,
  SelectionManager as SelectionManagerImpl,
} from "@ingcreators/annot-editor";
import type {
  ImageRecord,
  PageMetadata,
  StorageProvider,
} from "@ingcreators/annot-core/storage";

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
 * Construction-time host contract. The shell mounts an `<svg>` into
 * `container`, reads / writes through `storage`, and emits events
 * the host bridges to its own UI (PWA's `SaveStatusIndicator`,
 * VSCode's titlebar dirty mark, …).
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
 * stage — when richer payloads are required (e.g. error subclass
 * + path for the VSCode notifications), narrow per-event then.
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
 */
export class EditorShell {
  readonly #host: EditorShellHost;
  #svg: SVGSVGElement | null = null;
  #canvas: CanvasManager | null = null;
  #history: History | null = null;
  #selection: SelectionManager | null = null;
  #currentPath: string | null = null;
  #currentRecord: ImageRecord | null = null;
  #pageMetadata: PageMetadata | null = null;
  #destroyed = false;

  // Per-event handler arrays. A `Map<event, Set<handler>>` would
  // also work but the four event names are fixed and the per-event
  // arrays make subscription order observable for tests.
  readonly #handlers: Record<EditorShellEvent, EditorShellEventHandler[]> = {
    dirty: [],
    saved: [],
    error: [],
    "selection-change": [],
  };

  constructor(host: EditorShellHost) {
    this.#host = host;
    this.#applyThemeOverrides();
  }

  #applyThemeOverrides(): void {
    const overrides = this.#host.themeOverrides;
    if (!overrides) return;
    const target = this.#host.container;
    for (const [name, value] of Object.entries(overrides)) {
      target.style.setProperty(name, value);
    }
  }

  /** Open an image at the given storage path. Resolves once the
   *  canvas + selection + history are mounted; the host can read
   *  the live primitives via `getCanvas()` / `getHistory()` /
   *  `getSelection()` to wire its own toolbar / panels / events
   *  on top.
   *
   *  Errors propagate via the returned promise rejection AND fire
   *  the `error` event so a host that doesn't await `open()`
   *  directly (e.g. wraps it in a `void`) still sees the failure.
   */
  async open(path: string): Promise<void> {
    if (this.#destroyed) {
      throw new Error("EditorShell.open: shell already destroyed");
    }
    try {
      const record = await this.#host.storage.getImage(path);
      if (!record) {
        throw new Error(`EditorShell.open: no image at path ${path}`);
      }
      this.mountFromRecord(path, record);
    } catch (err) {
      this.#emit("error", err);
      throw err;
    }
  }

  /** Mount the editor on a pre-loaded `ImageRecord`. The PWA
   *  uses this when it already has the record in hand (capture
   *  flows, extension transfer, paste-from-clipboard) and doesn't
   *  need the shell to re-fetch it via `storage.getImage`. The
   *  VSCode extension uses `open(path)` instead and lets the shell
   *  fetch through `VSCodeStore`.
   *
   *  `path` is the storage path that subsequent `saveNow()` calls
   *  write back to. Pass `null` when the image isn't persisted yet
   *  (a freshly captured / pasted but un-saved image); `saveNow()`
   *  then no-ops until a path is assigned via a future
   *  `setCurrentPath` API. */
  mountFromRecord(path: string | null, record: ImageRecord): void {
    if (this.#destroyed) {
      throw new Error("EditorShell.mountFromRecord: shell already destroyed");
    }
    this.#currentPath = path;
    this.#currentRecord = record;
    this.#mountCanvas(record);
  }

  /** Mount the canvas inside `host.container`. Tears down any
   *  previous CanvasManager / SelectionManager so reopens don't
   *  accumulate listeners on a reused `<svg>` (the bug that
   *  prompted `EditorSession.disposePreviousEditor` originally). */
  #mountCanvas(record: ImageRecord): void {
    this.#disposeCanvas();
    const svg = this.#ensureSvgRoot();
    const canvas = new CanvasManagerImpl(svg, record.originalDataUrl, record.width, record.height);
    const history = new HistoryImpl(canvas.annotations);
    const selection = new SelectionManagerImpl(canvas, history);

    this.#canvas = canvas;
    this.#history = history;
    this.#selection = selection;

    // Selection-change → forward as a shell event so the host
    // (PWA's right-panel selection-properties section, future
    // VSCode status-bar selection summary) can drop its own
    // listener on the SelectionManager.
    //
    // SelectionManager exposes a single-slot `onChange?: () => void`
    // callback; we wrap an existing one if the host pre-set a
    // callback before constructing the shell — but that's not the
    // construction order today (the shell creates the
    // SelectionManager), so straight assignment is fine.
    selection.onChange = () => {
      this.#emit("selection-change");
    };

    // History mutation → mark the document dirty. The host's save
    // pipeline picks this up to enable / debounce save. Same
    // single-slot callback idiom as `onChange` above.
    history.onStateChange = () => {
      this.#emit("dirty");
    };

    // The persisted annotations SVG (if present) is restored by
    // the host today through `restoreAnnotations`. The shell
    // doesn't take that responsibility yet — restoring annotations
    // requires DOM-string parsing + element re-attachment that's
    // PWA-side today and would force a Tier B migration to lift
    // here cleanly. Tracked as a follow-up; for now the host's
    // existing call site keeps working since it operates on
    // `getCanvas().annotations` directly.
  }

  /** Create the `<svg>` root inside `host.container` if there
   *  isn't one yet, or reuse + clear an existing one. The id is
   *  intentionally NOT `svg-root` — that's a PWA-shell
   *  convention. The shell owns its own anonymous root so a host
   *  page can have multiple shells on different elements without
   *  id collisions. */
  #ensureSvgRoot(): SVGSVGElement {
    const container = this.#host.container;
    let svg = this.#svg;
    if (!svg) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
      svg.dataset.annotShellRoot = "1";
      container.appendChild(svg);
      this.#svg = svg;
    } else {
      svg.innerHTML = "";
      svg.removeAttribute("style");
    }
    return svg;
  }

  /** Dispose of the per-image canvas / history / selection. Safe
   *  to call repeatedly; the next `open()` re-creates. */
  #disposeCanvas(): void {
    this.#selection?.destroy();
    this.#canvas?.destroy();
    this.#canvas = null;
    this.#history = null;
    this.#selection = null;
  }

  /** Save the current annotations through the host StorageProvider.
   *  No-op if no image is open. Errors propagate to caller AND
   *  fire the `error` event. */
  async saveNow(): Promise<void> {
    if (this.#destroyed) return;
    const path = this.#currentPath;
    const canvas = this.#canvas;
    const record = this.#currentRecord;
    if (!path || !canvas || !record) return;
    try {
      // Serialize the editor's current SVG (image + every
      // annotation layer) via the editor package's standard
      // helper. The host's save pipeline can still drive
      // thumbnail regen + extra metadata on top via its own
      // debounce.
      const annotationsSvg = exportSVGString(canvas);
      const updates = {
        annotationsSvg,
        updatedAt: new Date().toISOString(),
      };
      await this.#host.storage.updateImage(path, updates);
      this.#currentRecord = { ...record, ...updates };
      this.#emit("saved", path);
    } catch (err) {
      this.#emit("error", err);
      throw err;
    }
  }

  /** Page metadata setter for hosts that capture it out-of-band
   *  (PWA's extension-transfer flow). The shell stashes it; hosts
   *  that consume it (right-panel Elements section) read it back
   *  via `getCurrentPageMetadata()`. */
  setPageMetadata(metadata: PageMetadata | null): void {
    this.#pageMetadata = metadata;
  }

  /** Snapshot of the current page metadata. */
  getCurrentPageMetadata(): PageMetadata | null {
    return this.#pageMetadata;
  }

  /** The live `CanvasManager` for the open image, or null if no
   *  image is open. Hosts pass this to their toolbar / drawer /
   *  right-panel wiring so the shell doesn't have to model every
   *  surface. */
  getCanvas(): CanvasManager | null {
    return this.#canvas;
  }

  /** The live `History` for the open image, or null. */
  getHistory(): History | null {
    return this.#history;
  }

  /** The live `SelectionManager` for the open image, or null. */
  getSelection(): SelectionManager | null {
    return this.#selection;
  }

  /** Tear down per-session DOM listeners + remove the shell's
   *  children from `host.container`. The shell is single-use
   *  after destroy(); construct a new one for the next image. */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#disposeCanvas();
    if (this.#svg && this.#svg.parentElement === this.#host.container) {
      this.#host.container.removeChild(this.#svg);
    }
    this.#svg = null;
    for (const key of Object.keys(this.#handlers) as EditorShellEvent[]) {
      this.#handlers[key].length = 0;
    }
  }

  /** Subscribe to a shell-emitted event. Returns a disposer that
   *  unsubscribes when called. Idempotent — calling the disposer
   *  twice is a no-op. */
  on(event: EditorShellEvent, handler: EditorShellEventHandler): () => void {
    this.#handlers[event].push(handler);
    return () => {
      const arr = this.#handlers[event];
      const i = arr.indexOf(handler);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  #emit(event: EditorShellEvent, ...args: unknown[]): void {
    // Snapshot to allow safe unsubscribe-during-emit.
    const handlers = this.#handlers[event].slice();
    for (const h of handlers) {
      try {
        h(...args);
      } catch (err) {
        // A handler throwing must not break the emission loop. Log
        // and continue. The shell stays host-neutral so we use
        // `console.error` rather than the PWA's `logger`.
        console.error(`[EditorShell] handler for "${event}" threw:`, err);
      }
    }
  }
}
