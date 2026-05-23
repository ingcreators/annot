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

import { flattenEditablePng } from "@ingcreators/annot-annotator/flatten";
import type { ElementTree } from "@ingcreators/annot-core";
import {
  bakeAnnotationsTranslate,
  pruneAnnotationsOutsideRect,
} from "@ingcreators/annot-core/editor/bake-translate";
import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { dataUrlToUint8Array } from "@ingcreators/annot-core/xmp";
import type { CanvasManager, History, SelectionManager } from "@ingcreators/annot-editor";
import {
  CanvasManager as CanvasManagerImpl,
  exportSVGString,
  getPngDataUrl,
  History as HistoryImpl,
  SelectionManager as SelectionManagerImpl,
} from "@ingcreators/annot-editor";
import type {
  OverlayEntry,
  OverlayProposal,
  OverlayToolContext,
  SnapshotPickerHandle,
} from "@ingcreators/annot-editor/tools/overlay-tool";
import type {
  AnnotationsFile,
  OverlayEntry as ProductDocsOverlayEntry,
} from "@ingcreators/annot-product-docs/annotations-yaml";
import { burnRedactionsIntoBitmap, cropBitmap } from "@ingcreators/annot-render";
import { loadAnnotationsYaml } from "./annotation-yaml-loader.js";
import { saveAnnotationsYaml } from "./annotation-yaml-writer.js";
import { restoreAnnotations } from "./restore-annotations.js";
import type { AnnotSnapshotOverlayElement } from "./snapshot-overlay.js";
import "./snapshot-overlay.js";

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
export type EditorShellEvent = "dirty" | "saved" | "error" | "selection-change";

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
  /** Canonical screen-capture tree. Hosts that read
   *  `annot:elementTree` PNG XMP via `readElementTreePng` push it
   *  here on each mount; the right panel's Elements section renders
   *  the tree view when set. Null when no tree was found (most
   *  non-instrumented captures). */
  #elementTree: ElementTree | null = null;
  /** Phase 4e: PNG path supplied via `mountFromRecord` opts that the
   *  Phase 4a storage capability uses to resolve the sidecar yaml.
   *  Typically the same as `#currentPath` — kept as a separate slot
   *  so a host that drives sidecar yaml against a path different
   *  from the image's own (e.g. a future MDX-attached editor view)
   *  can override. Null when the host didn't supply one. */
  #overlayYamlPngPath: string | null = null;
  /** Phase 4e: Cached `AnnotationsFile` for the active image.
   *  Loaded lazily after mount via `loadAnnotations`; queried by
   *  the OverlayTool's context provider for the existing-entries
   *  list + the number-auto-assign source. Null when no sidecar
   *  exists (the editor falls back to "empty overlays"). */
  #currentAnnotations: AnnotationsFile | null = null;
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
  mountFromRecord(
    path: string | null,
    record: ImageRecord,
    opts?: { annotationsYamlPath?: string },
  ): void {
    if (this.#destroyed) {
      throw new Error("EditorShell.mountFromRecord: shell already destroyed");
    }
    this.#currentPath = path;
    this.#currentRecord = record;
    // Phase 4e: opt-in to overlay-yaml capabilities. When the host
    // doesn't supply an `annotationsYamlPath`, the shell stays
    // overlay-yaml-agnostic — `publishOverlay` throws,
    // `getCurrentAnnotationsYaml` returns null, and
    // `createOverlayToolContext` returns null so the OverlayTool
    // factory's fallback kicks in. Hosts that DO want yaml editing
    // typically pass `annotationsYamlPath: path` (the image's own
    // path — the Phase 4a storage capability resolves the sidecar
    // location internally via `<pngPath>.annotations.yaml`).
    this.#overlayYamlPngPath = opts?.annotationsYamlPath ?? null;
    this.#currentAnnotations = null;
    this.#mountCanvas(record);
    // Fire-and-forget async load; callers that need to await it use
    // `loadAnnotations` directly. Production code reads
    // `#currentAnnotations` via the OverlayTool context provider,
    // which is queried at click time — by then the load is usually
    // done, and on the rare race the tool sees zero entries (i.e.
    // auto-assigns number 1; the next pick fetches the up-to-date
    // list).
    if (this.#overlayYamlPngPath !== null) {
      void this.loadAnnotations();
    }
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
    const baseHref = canvas.imageEl.getAttribute("href") || record.originalDataUrl;
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

  /**
   * Permanently crop the current document's base bitmap to the
   * supplied (x, y, w, h) rectangle in world (viewBox) coordinates.
   *
   * Mirrors {@link applyAllRedactions} for the destructive-crop
   * pipeline:
   *
   *   1. Decode the live `imageEl.href` (which is normally equal
   *      to the loaded `record.originalDataUrl`, but a previous
   *      redact-burn / crop-bake will have already mutated it).
   *   2. `cropBitmap` produces the cropped PNG / JPEG blob.
   *   3. The annotation tree is shifted by `(-x, -y)` via
   *      `bakeAnnotationsTranslate` so every shape stays visually
   *      anchored to its target after the origin moves.
   *   4. The live canvas's `imageEl` is repointed at the new bytes
   *      and the SVG viewBox is reset to `0 0 w h` so the cropped
   *      bitmap fills the canvas at native size.
   *   5. The new `originalDataUrl` + `width` + `height` +
   *      `annotationsSvg` get persisted via
   *      `storage.updateImage` BEFORE the history snapshot, for
   *      the same reason `applyAllRedactions` does — the host's
   *      debounced annotation save would otherwise re-merge the
   *      OLD bitmap from disk against the new SVG, leaving a
   *      mismatched record on disk.
   *
   * The action is **session-undoable**: a single history snapshot
   * captures the cropped state, so Ctrl+Z reverts it within the
   * open editor (the previous frame still holds the pre-crop
   * annotation positions; the bitmap restore happens via the
   * canvas's serialised form). **After save, the cropped-out
   * pixels are gone** — the calling host's confirmation dialog
   * is what surfaces that distinction to the user before this
   * method runs (per the destructive-action policy in
   * `CLAUDE.md`).
   *
   * No-ops (returns `{ applied: false }`) when no image is open
   * or the rect is degenerate. Callers that want to gate the UI
   * on rect validity should check before invoking.
   *
   * If the explicit persistence step fails, the method re-throws
   * after firing the `error` event so the calling host can
   * surface a banner. The canvas stays in the cropped state
   * visually (Ctrl+Z reverts); the file on disk is still the
   * pre-crop version, so a retry of the apply gesture WOULD
   * re-apply against an already-bitmap-mutated canvas (Ctrl+Z is
   * the rollback affordance).
   */
  async applyCrop(
    x: number,
    y: number,
    w: number,
    h: number,
  ): Promise<{ applied: boolean; width: number; height: number }> {
    if (this.#destroyed) return { applied: false, width: 0, height: 0 };
    const canvas = this.#canvas;
    const history = this.#history;
    const record = this.#currentRecord;
    if (!canvas || !history || !record) {
      return { applied: false, width: 0, height: 0 };
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(w > 0) || !(h > 0)) {
      return { applied: false, width: 0, height: 0 };
    }

    const baseHref = canvas.imageEl.getAttribute("href") || record.originalDataUrl;
    const base = await loadHtmlImage(baseHref);

    const blob = await cropBitmap(base, x, y, w, h);
    const dataUrl = await blobToDataUrl(blob);

    // Drop annotations whose entire bbox sits outside the crop rect
    // — privacy + file-size win — BEFORE the translate, so the
    // remaining children all shift by (-x, -y) into the new origin.
    // Annotations that PARTIALLY overlap the crop boundary are kept
    // (clipping per-shape geometry is intentionally out of scope;
    // see `_done/destructive-crop-bake.md`).
    pruneAnnotationsOutsideRect(canvas.annotations, { x, y, w, h });

    // Translate every remaining annotation child by (-x, -y) so the
    // visible positions stay anchored to whatever the user drew them
    // on top of. Done BEFORE the viewBox / imageEl swap so a mid-bake
    // error (e.g. a malformed line endpoint blowing up
    // bakeLineTransform) doesn't leave the canvas with a cropped
    // bitmap and stale annotations.
    bakeAnnotationsTranslate(canvas.annotations, -x, -y);

    // Live canvas reflects the crop immediately so the user sees
    // the result without a reload.
    canvas.imageEl.setAttribute("href", dataUrl);
    canvas.imageEl.setAttribute("x", "0");
    canvas.imageEl.setAttribute("y", "0");
    // The cropped bitmap may not be exactly (w, h) — `cropBitmap`
    // floors / clamps to integer dims that fit inside the source.
    // Read back from the decoded blob instead of trusting the
    // requested rect.
    const dims = await measureBlob(blob);
    const croppedW = dims.width;
    const croppedH = dims.height;
    canvas.imageEl.setAttribute("width", String(croppedW));
    canvas.imageEl.setAttribute("height", String(croppedH));
    canvas.updateViewBox(0, 0, croppedW, croppedH);
    canvas.fitToView();

    // Update the in-memory record so a subsequent debounced save
    // (fired by the `history.save()` below) sees the new bitmap +
    // dimensions if it ever needs the snapshot.
    this.#currentRecord = {
      ...record,
      originalDataUrl: dataUrl,
      width: croppedW,
      height: croppedH,
    };

    // Persist atomically. The host's debounced annotation-save path
    // can't carry the bitmap or new dimensions on its own — same
    // reasoning as applyAllRedactions, just extended to width /
    // height (which `ImageRecordUpdate` was extended to carry in
    // lockstep with this method).
    const path = this.#currentPath;
    if (path) {
      try {
        const updates = {
          annotationsSvg: exportSVGString(canvas),
          originalDataUrl: dataUrl,
          width: croppedW,
          height: croppedH,
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

    // Single history snapshot captures the cropped state. Ctrl+Z
    // reverts to the pre-crop state within the session.
    history.save();

    return { applied: true, width: croppedW, height: croppedH };
  }

  /** Canonical screen-capture tree setter. Hosts pass the tree
   *  from `readElementTreePng(record.originalDataUrl)` (when
   *  present) so the right-panel Elements section can render the
   *  hierarchical view. Pass `null` when the capture didn't carry
   *  one (paste / desktop screenshot / legacy). */
  setElementTree(tree: ElementTree | null): void {
    this.#elementTree = tree;
  }

  /** Snapshot of the current ElementTree. */
  getCurrentElementTree(): ElementTree | null {
    return this.#elementTree;
  }

  // ╭─ Phase 4e: annotations YAML sidecar ───────────────────────────╮
  // │ Wires the host's `OverlayTool` activation to the Phase 4b      │
  // │ loader / writer using the Phase 4a storage capability. Hosts   │
  // │ that don't supply an `annotationsYamlPath` at mount time get   │
  // │ a no-op path — `getCurrentAnnotationsYaml` returns null;       │
  // │ `publishOverlay` throws; `createOverlayToolContext` returns    │
  // │ null so the OverlayTool factory falls back to the inert        │
  // │ no-context tool.                                               │
  // ╰────────────────────────────────────────────────────────────────╯

  /** Re-read the annotations sidecar for the active image. Hosts
   *  that want to refresh after an out-of-band edit (e.g. another
   *  tab wrote to the same file) can call this manually; the
   *  result lands in `#currentAnnotations`. Returns the loaded
   *  file (null when the sidecar is missing OR the store doesn't
   *  expose the capability). */
  async loadAnnotations(): Promise<AnnotationsFile | null> {
    const pngPath = this.#overlayYamlPngPath;
    if (pngPath === null) {
      this.#currentAnnotations = null;
      return null;
    }
    const file = await loadAnnotationsYaml(this.#host.storage, pngPath);
    this.#currentAnnotations = file;
    return file;
  }

  /** Snapshot of the in-memory `AnnotationsFile`. Null when no
   *  sidecar is loaded for the active image. Used by the
   *  OverlayTool's context provider + future MDX-attached editor
   *  modes that want to mirror the editor's view of the world. */
  getCurrentAnnotationsYaml(): AnnotationsFile | null {
    return this.#currentAnnotations;
  }

  /** Persist a single overlay entry. Upserts by `id` — when an
   *  entry with the same id exists, it's replaced; otherwise the
   *  new entry is appended. Updates `#currentAnnotations` so
   *  subsequent activations of the OverlayTool see the new state
   *  without a re-load.
   *
   *  @throws Error when the host didn't supply an
   *    `annotationsYamlPath` at mount time (i.e.
   *    `#overlayYamlPngPath` is null).
   *  @throws backend-specific errors from the Phase 4b writer
   *    (e.g. `StoragePermissionError`).
   */
  async publishOverlay(entry: OverlayEntry): Promise<void> {
    const pngPath = this.#overlayYamlPngPath;
    if (pngPath === null) {
      throw new Error(
        "EditorShell.publishOverlay: no annotationsYamlPath set. Pass `annotationsYamlPath` " +
          "to `mountFromRecord` before invoking the OverlayTool.",
      );
    }
    // `OverlayEntry` is duplicated across `@ingcreators/annot-editor`
    // (Phase 4d, minimal — kept narrow to avoid an editor →
    // product-docs dep) and `@ingcreators/annot-product-docs` (Phase
    // 2a, wider `OverlayIntent` palette). The editor type is
    // structurally a subset of the product-docs one, so the cast at
    // the boundary is sound. A future refactor can lift the type
    // into `@ingcreators/annot-core` and drop the cast.
    const pdEntry = entry as ProductDocsOverlayEntry;
    const current = this.#currentAnnotations ?? { version: 1, overlays: [] };
    const overlays = [...current.overlays];
    const existingIdx = overlays.findIndex((o) => o.id === entry.id);
    if (existingIdx >= 0) {
      overlays[existingIdx] = pdEntry;
    } else {
      overlays.push(pdEntry);
    }
    const updated: AnnotationsFile = { ...current, overlays };
    await saveAnnotationsYaml(this.#host.storage, pngPath, updated);
    this.#currentAnnotations = updated;
  }

  /** Build a fresh `OverlayToolContext` snapshotting the shell's
   *  current state. Called by the host's `Toolbar` via the
   *  `overlayContextProvider` deps entry. Returns null when the
   *  shell can't usefully drive the tool — currently when no
   *  `annotationsYamlPath` is set (the publishOverlay path would
   *  throw, so the factory falls back to the no-context inert tool
   *  rather than activating one that throws on first click).
   *
   *  Hosts supply the `overlayContainer` (the HTML element that
   *  hosts the `<annot-snapshot-overlay>` Lit element) and the
   *  `openIntentDialog` (the function that renders an intent
   *  picker UI). The shell wires the snapshot-picker factory + the
   *  onCommit handler internally.
   */
  createOverlayToolContext(opts: {
    overlayContainer: HTMLElement;
    openIntentDialog: (proposal: OverlayProposal) => Promise<OverlayEntry | null>;
  }): OverlayToolContext | null {
    if (this.#overlayYamlPngPath === null) return null;
    const elementTree = this.#elementTree ?? undefined;
    // Same product-docs ↔ editor `OverlayEntry` duality as in
    // `publishOverlay`; structural subset assignment is sound, the
    // cast pins it for tsc until the type lifts to annot-core.
    const existingOverlays = (this.#currentAnnotations?.overlays ?? []) as readonly OverlayEntry[];
    return {
      overlayContainer: opts.overlayContainer,
      elementTree,
      existingOverlays,
      mountSnapshotPicker: (container, tree): SnapshotPickerHandle => {
        const element = document.createElement(
          "annot-snapshot-overlay",
        ) as AnnotSnapshotOverlayElement;
        element.elementTree = tree;
        container.appendChild(element);
        return {
          element,
          unmount: (): void => {
            element.remove();
          },
        };
      },
      openIntentDialog: opts.openIntentDialog,
      onCommit: (entry): Promise<void> => this.publishOverlay(entry),
    };
  }

  // ╭─ Phase 4f: publish-flat PNG via flattenEditablePng ────────────╮
  // │ The "Save as flat PNG" entry in `<annot-save-menu>` calls this │
  // │ to get distribution-ready bytes — annotations baked in         │
  // │ visibly, no recoverable editable layer. Demonstrates the       │
  // │ Phase 3 follow-up #2 annotator primitive from a user-facing    │
  // │ surface; opens the door for future host-ui workflows that      │
  // │ need flattened output (Slack drop, third-party viewers, etc.). │
  // ╰────────────────────────────────────────────────────────────────╯

  /** Produce a distribution-ready flat PNG. Renders the live
   *  canvas (so the user's most recent edits are visible) and
   *  passes the bytes through `flattenEditablePng` to strip any
   *  recoverable editable-layer chunks the canvas's underlying
   *  `originalDataUrl` may have carried. The result is safe to
   *  hand to a downstream viewer without leaking the original
   *  bitmap or the annotations SVG.
   *
   *  Returns `null` when no image is open. Throws on render
   *  failures.
   */
  async publishFlatPng(): Promise<Uint8Array | null> {
    if (this.#destroyed) return null;
    const canvas = this.#canvas;
    if (!canvas) return null;
    // Render the current canvas state as a PNG data URL — the
    // resulting bytes have the annotations rasterised into the
    // pixel data and no editable XMP layer of their own.
    const renderedDataUrl = await getPngDataUrl(canvas);
    const renderedBytes = dataUrlToUint8Array(renderedDataUrl);
    // Defensive flatten: should be a no-op on freshly rendered
    // bytes (no Adobe XMP / `svGo` chunks present), but guarantees
    // that even if a future rendering path were to round-trip
    // through an editable PNG, the published output stays flat.
    return flattenEditablePng(renderedBytes);
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
      reject(
        new Error(
          `EditorShell.applyAllRedactions: failed to load base image (${src.slice(0, 32)}…)`,
        ),
      );
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

/** Decode an image blob and return its natural width / height.
 *  Used by `applyCrop` to read the post-crop dimensions back from
 *  `cropBitmap`'s output without trusting the requested rect (the
 *  helper floors / clamps to integer dims that fit inside the
 *  source, so the actual pixel size may differ by ±1 from the
 *  user's drag). The two helpers are intentionally split so callers
 *  that only need one dimension don't decode twice — they share the
 *  same blob URL via the closures below. */
async function measureBlob(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("EditorShell.applyCrop: failed to decode cropped blob"));
      i.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
