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
import { burnRedactionsIntoBitmap } from "@ingcreators/annot-render";
import { restoreAnnotations } from "./restore-annotations.js";

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
  /**
   * Optional pre-existing `<svg>` element the shell should adopt
   * instead of creating an anonymous one inside `container`. Lets
   * a host that ships an `<svg id="svg-root">` in its index.html
   * (today: PWA + Tauri desktop) preserve its existing CSS
   * selectors. If omitted (today: VSCode webview + happy-dom
   * tests), the shell creates an anonymous
   * `<svg data-annot-shell-root="1">` inside `container`.
   *
   * When supplied, the shell:
   *   - tags the element with `data-annot-shell-root="1"` so the
   *     attribute-keyed CSS rules in
   *     `packages/core/styles/editor.css` apply alongside any
   *     existing id-based rules;
   *   - clears its children + inline `style` on each mount so
   *     subsequent reopens start from a known state, mirroring
   *     the behaviour of the anonymous-SVG path;
   *   - leaves the element in place on `destroy()` (the host owns
   *     the SVG and is responsible for removing it from the DOM).
   *
   * The shell's host-boundary invariant is preserved — the shell
   * still does NOT call `document.getElementById(...)`. The host
   * passes the element in directly.
   */
  svgRoot?: SVGSVGElement;
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
  // True when the shell created `#svg` itself (the anonymous-root
  // path used by VSCode + happy-dom tests). False when the host
  // supplied `host.svgRoot` (the PWA / Tauri-desktop path that
  // pre-bakes the element in `index.html`). Drives `destroy()` —
  // host-owned SVGs stay in the DOM after teardown.
  #ownsSvg = false;
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

    // Restore the persisted annotation tree BEFORE wiring
    // `history.onStateChange` so the seed `history.save()` doesn't
    // fire a `dirty` event the host's autosave pipeline would
    // interpret as "user edited" and commit on open. Mirrors the
    // seed-before-wire discipline `EditorSession.setupEditor`
    // applied via its own restoreAnnotations call site (Phase 4 of
    // `docs/plans/editor-session-shell-switchover.md` removes the
    // duplicate PWA call once the boot path goes through here).
    if (record.annotationsSvg) {
      restoreAnnotations(canvas, record.annotationsSvg);
      history.save();
    }

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
  }

  /** Resolve the `<svg>` root the shell mounts the canvas into.
   *
   *  Three branches:
   *    1. First mount, host supplied `svgRoot` — adopt it. Tag with
   *       `data-annot-shell-root="1"` so the attribute-keyed CSS
   *       rules apply alongside whatever id the host already has.
   *       Mark `#ownsSvg = false` so `destroy()` leaves it in place.
   *    2. First mount, no `svgRoot` — create an anonymous SVG inside
   *       `host.container`. Mark `#ownsSvg = true` so `destroy()`
   *       removes it.
   *    3. Subsequent mount — reuse the already-resolved `#svg`,
   *       clearing children + inline `style` so the next image
   *       starts from a known state. Same regardless of branch.
   *
   *  The shell never queries the DOM for its root — for the host-
   *  supplied path the host passes the element in via
   *  `EditorShellHost.svgRoot`. Preserves the host-boundary
   *  invariant in `host-boundary.test.ts`. */
  #ensureSvgRoot(): SVGSVGElement {
    let svg = this.#svg;
    if (!svg) {
      const supplied = this.#host.svgRoot;
      if (supplied) {
        svg = supplied;
        svg.dataset.annotShellRoot = "1";
        svg.innerHTML = "";
        svg.removeAttribute("style");
        this.#ownsSvg = false;
      } else {
        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
        svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
        svg.dataset.annotShellRoot = "1";
        this.#host.container.appendChild(svg);
        this.#ownsSvg = true;
      }
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

  /**
   * Permanently bake every redact element in the current document
   * into the underlying base bitmap.
   *
   * Phase 2 of [`docs/plans/_done/redact-burn-into-image.md`](../../../docs/plans/_done/redact-burn-into-image.md) —
   * the host-orchestration half of the privacy-driven "make this
   * permanent" action. The Tier C-render side
   * (`burnRedactionsIntoBitmap`) does the pixel composition; this
   * method snapshots the redact elements, drives the renderer,
   * swaps the resulting bytes into the live canvas
   * (`imageEl.href`), removes the redact elements from the
   * annotations group, AND explicitly persists the new bitmap +
   * SVG via `storage.updateImage` before saving a history snapshot.
   *
   * The explicit persistence step is critical for the privacy
   * contract. Without it, the host's debounced annotation-save path
   * only writes `annotationsSvg` + `tags` (the legacy
   * `ImageRecordUpdate` fields), and each storage backend's
   * `updateImage` re-reads the OLD bitmap from disk + merges the
   * new SVG — leaving the original pixels intact on disk while the
   * canvas visually shows the burn. The user re-opens the file
   * from the gallery and sees the pre-burn original; the
   * "permanent" promise the dialog makes is broken. Persisting
   * `originalDataUrl` alongside `annotationsSvg` here closes that
   * gap (each backend's `updateImage` was extended to honor
   * `updates.originalDataUrl` in lockstep with this fix).
   *
   * The action is **session-undoable**: the burned state is one
   * history snapshot, so Ctrl+Z reverts it within the open editor.
   * **After save, the original pixels under the redactions are
   * gone for good** — the host's confirmation dialog (Phase 3 / 6)
   * is what surfaces that distinction to the user before this method
   * runs.
   *
   * No-ops (returns `{ count: 0 }`) when no redact elements are
   * present or no image is open. Callers that gate the UI on
   * "is there a redaction?" should use the count themselves rather
   * than relying on this no-op behaviour.
   *
   * If the explicit persistence step fails, the method
   * re-throws after firing the `error` event so the calling
   * host can surface a banner. The canvas stays in the burned
   * state visually (Ctrl+Z reverts); the file on disk is still
   * the pre-burn version, so a retry of the apply gesture WOULD
   * re-apply (the redacts are gone, but the user can re-draw
   * them — the wider rollback affordance is the standard undo
   * stack).
   */
  async applyAllRedactions(): Promise<{ count: number }> {
    if (this.#destroyed) return { count: 0 };
    const canvas = this.#canvas;
    const history = this.#history;
    const record = this.#currentRecord;
    if (!canvas || !history || !record) return { count: 0 };

    const redactEls = Array.from(
      canvas.annotations.querySelectorAll<SVGElement>("[data-redact-style]"),
    );
    if (redactEls.length === 0) return { count: 0 };

    // Load the current base image from the canvas's `imageEl` so the
    // burn renders against exactly what the user is looking at — not
    // a stale `originalDataUrl` from when the document was first
    // opened. The two are usually equal, but a previous burn-in or
    // any future feature that mutates the bitmap would diverge them.
    const baseHref =
      canvas.imageEl.getAttribute("href") || record.originalDataUrl;
    const base = await loadHtmlImage(baseHref);

    const blob = await burnRedactionsIntoBitmap(base, redactEls);
    const dataUrl = await blobToDataUrl(blob);

    // Live canvas reflects the burn immediately so the user sees
    // the result without a reload.
    canvas.imageEl.setAttribute("href", dataUrl);

    // Remove the redact elements from the annotations group. They're
    // baked into the bitmap now — re-applying the SVG-side overlay
    // on top would double-apply the redaction.
    for (const el of redactEls) {
      el.remove();
    }

    // Update the in-memory record so a subsequent debounced save
    // (fired by the `history.save()` below) sees the new bitmap if
    // it ever needs the snapshot.
    this.#currentRecord = { ...record, originalDataUrl: dataUrl };

    // Persist the new bitmap + SVG atomically. The host's debounced
    // annotation-save path can't carry the bitmap on its own — the
    // legacy `ImageRecordUpdate` only listed annotationsSvg + tags,
    // and even after extending it to include `originalDataUrl`, the
    // host has no way to know the bitmap mutated unless we say so
    // explicitly. So we save right here, before the dirty event
    // fires, with both fields populated. The host's subsequent
    // debounced save then runs against the on-disk burned state and
    // writes a no-op (or merges any further user edits, fine in
    // either case).
    const path = this.#currentPath;
    if (path) {
      try {
        const updates = {
          annotationsSvg: exportSVGString(canvas),
          originalDataUrl: dataUrl,
          updatedAt: new Date().toISOString(),
        };
        await this.#host.storage.updateImage(path, updates);
        this.#currentRecord = { ...this.#currentRecord, ...updates };
        this.#emit("saved", path);
      } catch (err) {
        this.#emit("error", err);
        throw err;
      }
    }

    // Single history snapshot captures the burned state. Ctrl+Z
    // reverts to the pre-burn state within the session (the
    // history's previous frame still holds the redact elements +
    // the unburned bitmap href via the canvas's serialized form).
    history.save();

    return { count: redactEls.length };
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

  /** Tear down per-session DOM listeners + remove the shell-owned
   *  `<svg>` from `host.container`. When the host supplied
   *  `svgRoot`, the SVG stays in the DOM (the host owns it) — the
   *  shell only clears its children + inline `style` so the host
   *  sees a clean element afterward. The shell is single-use after
   *  destroy(); construct a new one for the next image. */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#disposeCanvas();
    if (this.#svg) {
      if (this.#ownsSvg) {
        if (this.#svg.parentElement === this.#host.container) {
          this.#host.container.removeChild(this.#svg);
        }
      } else {
        this.#svg.innerHTML = "";
        this.#svg.removeAttribute("style");
      }
    }
    this.#svg = null;
    this.#ownsSvg = false;
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

// ---- internals (file-private; not exported from the package) ----

/** Load a URL (data: or otherwise) into a decoded `HTMLImageElement`.
 *  Mirrors the inline helpers in `redact-utils.ts` and
 *  `image-thumbnail.ts` — kept inline here so the shell doesn't
 *  reach back into `annot-editor`'s redact module just for one
 *  three-line helper. */
function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error(`EditorShell.applyAllRedactions: failed to load base image (${src.slice(0, 32)}…)`));
    img.src = src;
  });
}

/** Local copy of `blobToDataUrl` (matches the helpers in
 *  `image-thumbnail.ts` and `packages/core/src/encode/index.ts`).
 *  Kept inline so the shell doesn't reach back into annot-web —
 *  preserves the host-boundary invariant captured in
 *  `host-ui/src/host-boundary.test.ts`. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
