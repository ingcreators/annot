/**
 * `<annot-doc-image-editor-modal>` — a full-viewport modal that
 * mounts an `EditorShell` against the bytes embedded in a single
 * image block, lets the user annotate, and resolves with either
 * the new SVG (Save) or `null` (Cancel).
 *
 * Phase 5a of `docs/plans/_done/annot-html-document.md`. The doc shell
 * wires this in for the click-to-edit affordance on image blocks
 * when `editing=true`.
 *
 * Light DOM (Hybrid CSS) following the host-ui convention. The
 * modal is mounted to `document.body` so the panel can size
 * 90vw × 80vh without ancestor `overflow` clipping it. The
 * matching CSS lives inline in the element's render — keeping
 * styling self-contained for the test environment that doesn't
 * load `editor.css`.
 */

import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { exportSVGString } from "@ingcreators/annot-editor";
import { EditorShell } from "./editor-shell.js";
import { html, LitElement, nothing, type TemplateResult } from "./lit.js";
import { StatusHost } from "./orchestrators/status-host.js";
// `<annot-editor-right-panel>` registers a custom element on import.
import "./right-panel.js";
import type { AnnotEditorRightPanelElement } from "./right-panel.js";
import { Toolbar } from "./toolbar.js";
import { showConfirmDialog } from "./ui/dialog.js";

// The host that mounts this modal (PWA / VSCode webview / Storybook
// preview) is responsible for loading the editor-side stylesheets
// (`editor.css` / `toolbar.css` / `property-panel.css` / `fonts.css`)
// at boot. Re-importing them here would either duplicate them in
// the bundle or fail TS's module-resolution sweep depending on the
// host's tsconfig. The doc-shell only mounts this modal AFTER the
// shell itself has rendered, so the stylesheets are guaranteed to
// be in the document by then.

/** Stub `StorageProvider` used to back the `EditorShell` inside the
 *  modal — the shell never reads or writes through it because we
 *  use `mountFromRecord` (not `open`) to seed the canvas, and we
 *  bypass `saveNow` entirely on the Save path (we read the
 *  serialised SVG directly via `exportSVGString`). The methods
 *  throw or return empty so any unexpected call shows up loudly
 *  in tests instead of silently no-op-ing. */
const NOOP_STORAGE: StorageProvider = {
  saveImage: async () => {
    throw new Error("annot-doc-image-editor-modal: saveImage not supported");
  },
  getImage: async () => undefined,
  listImages: async () => [],
  updateImage: async () => {},
  moveImage: async () => "",
  renameImage: async () => "",
  deleteImage: async () => {},
  createFolder: async () => "",
  listFolders: async () => [],
  getFolder: async () => undefined,
  renameFolder: async () => "",
  moveFolder: async () => "",
  deleteFolder: async () => {},
  getBreadcrumb: async () => [],
};

export interface ImageEditorModalInput {
  /** Stable id for the image block being edited. Used as the
   *  pseudo-path passed to the `EditorShell`. */
  readonly id: string;
  /** Canonical `.annot.svg` bytes carried by the block (the
   *  `<svg>` outer + base `<image>` + the annotation `<g>`). */
  readonly svg: string;
  /** Phase 6 of `docs/plans/annot-html-document-ux-polish.md` —
   *  position of this image within the document's image blocks
   *  (1-indexed). Drives the "Editing image N of M" header
   *  copy. Optional for back-compat / standalone use. */
  readonly positionInImages?: number;
  /** Total image blocks in the document. */
  readonly totalImages?: number;
  /** Phase 5 of `card-document-image-gallery-link-sync.md` —
   *  the gallery `ImageRecord.path` this block links to, when
   *  any. Drives the linked-badge + Unlink affordance in the
   *  header. Missing → block is doc-only (no badge shown). */
  readonly sourceImagePath?: string;
}

export type ImageEditorModalResult =
  | {
      readonly kind: "save";
      readonly svg: string;
      /** Phase 5 — true when the user clicked Unlink during this
       *  edit session. The doc shell strips `sourceImagePath`
       *  from the block on receipt. Absent / `false` means the
       *  block's link state is unchanged. */
      readonly unlinked?: boolean;
    }
  | { readonly kind: "cancel" };

const STYLES = `
.annot-doc-image-editor-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.annot-doc-image-editor-modal-panel {
  background: var(--annot-doc-bg, #ffffff);
  color: var(--annot-doc-fg, #1f2937);
  width: 92vw;
  height: 88vh;
  max-width: 1600px;
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
  display: grid;
  /* header / body (3-col grid for toolbar / canvas / right-panel) /
     statusbar / footer */
  grid-template-rows: auto 1fr auto auto;
  overflow: hidden;
}
.annot-doc-image-editor-modal-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--annot-doc-muted, #6b7280);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 12px;
}
.annot-doc-image-editor-modal-dirty {
  font-size: 0.75rem;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.16);
  color: #b45309;
}
.annot-doc-image-editor-modal-link-badge {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  font-weight: 500;
}
.annot-doc-image-editor-modal-link-badge-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
}
.annot-doc-image-editor-modal-link-badge-path {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.annot-doc-image-editor-modal-link-badge button.unlink {
  font-size: 0.78rem;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--annot-doc-muted, #6b7280);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.annot-doc-image-editor-modal-link-badge button.unlink:hover {
  background: rgba(37, 99, 235, 0.08);
}
.annot-doc-image-editor-modal-body {
  display: grid;
  grid-template-columns: 48px 1fr 280px;
  min-height: 0;
  border-bottom: 1px solid var(--annot-doc-muted, #6b7280);
}
.annot-doc-image-editor-modal-toolbar {
  border-right: 1px solid var(--annot-doc-muted, #6b7280);
  overflow: visible;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.annot-doc-image-editor-modal-canvas-wrap {
  /* The canvas wrap is the scrolling viewport AND the direct
     parent of the editor SVG. Mirrors the main editor's
     "#canvas-container" (in editor.css) — block-level with
     overflow:auto, no inner flex / wrapper. The SVG itself
     handles horizontal centring (block-level margin:auto from
     the "[data-annot-shell-root]" rule) and vertical breathing
     room (the same rule's "margin: 20px auto"), so we don't
     need a separate ".annot-doc-image-editor-modal-canvas" div
     here.

     Earlier the modal had an intermediate flex wrapper
     (".annot-doc-image-editor-modal-canvas") that, by virtue
     of "flex-shrink: 0" + "min-height: 100%", grew to match
     the SVG's natural height. CanvasManager.fitToView() reads
     "svg.parentElement.clientHeight" — that meant the fit
     calculation used the SVG's own (un-fitted) height as the
     viewport reference, so tall images never actually fit
     vertically and showed at 100% zoom with a vertical
     scrollbar even in "Fit" mode. Dropping the wrapper makes
     the SVG's parent the canvas wrap itself, whose
     clientHeight is the real viewport. */
  position: relative;
  overflow: auto;
  background: var(--annot-doc-code-bg, #f3f4f6);
  min-width: 0;
  min-height: 0;
}
.annot-doc-image-editor-modal-rightpanel {
  border-left: 1px solid var(--annot-doc-muted, #6b7280);
  overflow: auto;
  min-height: 0;
}
.annot-doc-image-editor-modal-statusbar {
  border-bottom: 1px solid var(--annot-doc-muted, #6b7280);
  /* StatusHost expects a flex container; existing editor.css's
     #statusbar rule handles its own layout, this is just a
     hosting slot. */
}
.annot-doc-image-editor-modal-footer {
  padding: 12px 16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.annot-doc-image-editor-modal-footer button {
  padding: 8px 14px;
  border-radius: 4px;
  border: 1px solid var(--annot-doc-muted, #6b7280);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 0.9rem;
}
.annot-doc-image-editor-modal-footer button.primary {
  background: var(--annot-doc-accent, #2563eb);
  border-color: var(--annot-doc-accent, #2563eb);
  color: #ffffff;
}

/* Phase 9 of annot-html-document-ux-polish.md — phone-class
   viewports: take the full screen + collapse the body's
   3-column grid into a single column so the canvas isn't
   crushed between the toolbar / right-panel slots. The right
   panel scrolls under the canvas instead. Footer buttons
   gain comfortable tap heights. */
@media (max-width: 600px) {
  .annot-doc-image-editor-modal-panel {
    width: 100vw;
    height: 100vh;
    max-width: none;
    border-radius: 0;
  }
  .annot-doc-image-editor-modal-body {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr auto;
  }
  .annot-doc-image-editor-modal-toolbar {
    border-right: none;
    border-bottom: 1px solid var(--annot-doc-muted, #6b7280);
    flex-direction: row;
    overflow-x: auto;
  }
  .annot-doc-image-editor-modal-rightpanel {
    border-left: none;
    border-top: 1px solid var(--annot-doc-muted, #6b7280);
    max-height: 30vh;
  }
  .annot-doc-image-editor-modal-footer button {
    padding: 12px 18px;
    min-height: 44px;
  }
}
`;

let activeModal: AnnotDocImageEditorModalElement | null = null;

export class AnnotDocImageEditorModalElement extends LitElement {
  static override properties = {
    input: { attribute: false },
    dirty: { state: true },
    unlinked: { state: true },
  };

  declare input: ImageEditorModalInput | null;
  /** Phase 6 of `annot-html-document-ux-polish.md` — true once
   *  the user has made any edit since the modal opened. Drives
   *  the Esc-to-cancel confirmation guard + the header subtitle. */
  declare dirty: boolean;
  /** Phase 5 of `card-document-image-gallery-link-sync.md` — set
   *  to `true` once the user has clicked Unlink in this session.
   *  Hides the link-badge from that point on; the save path
   *  surfaces it back to the doc shell so the block's
   *  `sourceImagePath` is stripped on next history push. */
  declare unlinked: boolean;

  #shell: EditorShell | null = null;
  #toolbar: Toolbar | null = null;
  #rightPanel: AnnotEditorRightPanelElement | null = null;
  #statusHost: StatusHost | null = null;
  #fitObserver: ResizeObserver | null = null;
  #onKeydown: ((e: KeyboardEvent) => void) | null = null;
  /** Resolves on Save / Cancel. The promise is set up in
   *  `openFor`. */
  #resolver: ((result: ImageEditorModalResult) => void) | null = null;

  constructor() {
    super();
    this.input = null;
    this.dirty = false;
    this.unlinked = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Open a modal for the given image-block bytes. Returns a
   *  promise resolving to the user's choice (save with new svg,
   *  or cancel). Single-instance — replaces any previously open
   *  modal. */
  static async openFor(input: ImageEditorModalInput): Promise<ImageEditorModalResult> {
    if (activeModal) activeModal.#resolveCancel();
    const el = document.createElement(
      "annot-doc-image-editor-modal",
    ) as AnnotDocImageEditorModalElement;
    el.input = input;
    document.body.appendChild(el);
    activeModal = el;
    return new Promise<ImageEditorModalResult>((resolve) => {
      el.#resolver = (result) => {
        resolve(result);
        el.#close();
      };
    });
  }

  static closeActive(): void {
    if (activeModal) activeModal.#resolveCancel();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#onKeydown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        // Phase 6 — confirm before discarding dirty edits.
        void this.#requestCancel();
      }
    };
    document.addEventListener("keydown", this.#onKeydown, { capture: true });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.#onKeydown) {
      document.removeEventListener("keydown", this.#onKeydown, { capture: true });
      this.#onKeydown = null;
    }
    this.#fitObserver?.disconnect();
    this.#fitObserver = null;
    this.#rightPanel?.destroy();
    this.#rightPanel = null;
    this.#toolbar = null;
    this.#statusHost = null;
    if (this.#shell) {
      this.#shell.destroy();
      this.#shell = null;
    }
    if (activeModal === this) activeModal = null;
  }

  protected override firstUpdated(): void {
    this.#mountShell();
  }

  override render(): TemplateResult {
    const pos = this.input?.positionInImages;
    const total = this.input?.totalImages;
    // Phase 6 of `annot-html-document-ux-polish.md` — header
    // copy: "Editing image N of M" when N+M known; falls back to
    // "Edit image" for pre-Phase-6 callers. Subtitle pill shows
    // "Unsaved changes" when the modal is dirty.
    const headerLabel =
      pos !== undefined && total !== undefined && total > 0
        ? `Editing image ${pos} of ${total}`
        : "Edit image";
    return html`
      <style>${STYLES}</style>
      <div
        class="annot-doc-image-editor-modal-overlay"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) void this.#requestCancel();
        }}
      >
        <div
          class="annot-doc-image-editor-modal-panel"
          role="dialog"
          aria-modal="true"
          aria-label=${headerLabel}
        >
          <div class="annot-doc-image-editor-modal-header">
            <span>${headerLabel}</span>
            ${
              this.dirty
                ? html`<span class="annot-doc-image-editor-modal-dirty">Unsaved changes</span>`
                : ""
            }
            ${this.#renderLinkBadge()}
          </div>
          <div class="annot-doc-image-editor-modal-body">
            <div class="annot-doc-image-editor-modal-toolbar"></div>
            <div class="annot-doc-image-editor-modal-canvas-wrap"></div>
            <div class="annot-doc-image-editor-modal-rightpanel"></div>
          </div>
          <div class="annot-doc-image-editor-modal-statusbar"></div>
          <div class="annot-doc-image-editor-modal-footer">
            <button type="button" @click=${() => void this.#requestCancel()}>Cancel</button>
            <button type="button" class="primary" @click=${() => this.#resolveSave()}>
              Save
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /** Phase 5 — linked-badge surface. Renders the gallery-link
   *  indicator + Unlink action in the modal header when the
   *  block was opened with a `sourceImagePath` AND the user
   *  hasn't already clicked Unlink in this session. Pure
   *  presentation — the host runs the click handler via
   *  `#requestUnlink`. */
  #renderLinkBadge(): TemplateResult | typeof nothing {
    const path = this.input?.sourceImagePath;
    if (path === undefined || path.length === 0) return nothing;
    if (this.unlinked) return nothing;
    const fileName = extractFileName(path);
    return html`
      <span
        class="annot-doc-image-editor-modal-link-badge"
        title="Edits to this image also update the gallery copy."
      >
        <span class="annot-doc-image-editor-modal-link-badge-label" aria-label="Linked to gallery">
          <span aria-hidden="true">🔗</span>
          <span class="annot-doc-image-editor-modal-link-badge-path">${fileName}</span>
        </span>
        <button
          type="button"
          class="unlink"
          @click=${() => void this.#requestUnlink()}
        >Unlink</button>
      </span>
    `;
  }

  /** Phase 5 — Unlink action. Prompts the user (irreversible-ish
   *  in the sense that future edits stop syncing; the badge can
   *  be restored only by deleting + re-inserting the block from
   *  gallery), then flips `this.unlinked = true` which both
   *  hides the badge and tells `#resolveSave` to carry the
   *  signal back to the doc shell. */
  async #requestUnlink(): Promise<void> {
    const ok = await showConfirmDialog({
      title: "Unlink image from gallery?",
      message:
        "Future edits to this image will stay inside this document only. " +
        "The gallery copy and this document copy will diverge.",
      okLabel: "Unlink",
      cancelLabel: "Keep linked",
      danger: false,
    });
    if (!ok) return;
    this.unlinked = true;
  }

  /** Phase 6 — Esc / Cancel button / overlay-click dispatch.
   *  When the modal carries unsaved edits (`dirty=true`), prompt
   *  the user to confirm; otherwise resolve cancel directly. */
  async #requestCancel(): Promise<void> {
    if (!this.dirty) {
      this.#resolveCancel();
      return;
    }
    const ok = await showConfirmDialog({
      title: "Discard changes to image?",
      message: "You have unsaved changes to this image. Closing now will discard them. Save first?",
      okLabel: "Discard",
      cancelLabel: "Keep editing",
      danger: true,
    });
    if (!ok) return;
    this.#resolveCancel();
  }

  #mountShell(): void {
    if (!this.input) return;
    // The canvas wrap is the SVG's direct parent — see the CSS
    // comment on `.annot-doc-image-editor-modal-canvas-wrap`
    // for why we don't nest the SVG inside an intermediate
    // flex container. `CanvasManager.fitToView()` reads
    // `svg.parentElement.clientHeight`, so the wrap-as-parent
    // arrangement is what lets "Fit" actually fit vertically.
    const container = this.querySelector(
      ".annot-doc-image-editor-modal-canvas-wrap",
    ) as HTMLElement | null;
    if (!container) return;

    const record = synthesiseRecord(this.input);
    const shell = new EditorShell({ container, storage: NOOP_STORAGE });
    shell.mountFromRecord(record.path, record);
    this.#shell = shell;
    // Phase 6 of `annot-html-document-ux-polish.md` — listen for
    // the shell's `dirty` event so the header subtitle + the
    // Esc / Cancel guard react to mid-edit state.
    shell.on("dirty", () => {
      this.dirty = true;
    });
    this.#mountToolbarAndPanel();
    // Fit the canvas to the modal's canvas area on first open so
    // (a) the SVG doesn't overflow + scroll immediately when the
    // source image is larger than the available width, and
    // (b) `CanvasManager.#fitMode` becomes `true` so the existing
    // ResizeObserver below keeps the canvas fitted as the modal
    // resizes. Subsequent `setZoom` calls (toolbar zoom buttons,
    // statusbar zoom chip, wheel-zoom) drop fit mode and scale
    // the SVG via `width` / `height` attrs + inline style.
    //
    // `CanvasManager`'s constructor already calls `fitToView()`,
    // but at construction time the canvas container's
    // `clientWidth` / `clientHeight` are still 0 (Lit's render
    // → `firstUpdated` runs before the browser has laid out the
    // modal panel). `fitToView` early-returns when the container
    // is 0-sized, leaving `#fitMode = false`; the SVG then stays
    // at natural pixel size and used to be silently clamped by a
    // since-removed `max-width: 100%` rule, which masked the
    // bug. We schedule a follow-up `fitToView` for the next
    // paint frame, by which time the modal's flex / grid layout
    // has resolved and the container has its real size.
    const canvas = shell.getCanvas();
    if (canvas) {
      requestAnimationFrame(() => {
        if (this.#shell !== shell) return; // modal closed or re-mounted
        canvas.fitToView();
      });
    }
  }

  /**
   * Mount the toolbar (left strip), right-panel (property panel +
   * tool-properties), and statusbar inside the modal — same set
   * the VSCode webview / PWA editor wire up around an
   * `EditorShell`. Without these, the user sees the canvas but
   * has no drawing tools, no selection-property controls, and no
   * zoom indicator. Matches `mountToolbarAndRightPanel` in
   * `packages/vscode/src/webview/main.ts`; the doc image-editor
   * modal is the second consumer of the same pattern.
   */
  #mountToolbarAndPanel(): void {
    const shell = this.#shell;
    if (!shell) return;
    const canvas = shell.getCanvas();
    const history = shell.getHistory();
    const selection = shell.getSelection();
    if (!canvas || !history || !selection) return;

    const toolbarMount = this.querySelector(
      ".annot-doc-image-editor-modal-toolbar",
    ) as HTMLElement | null;
    const rightPanelMount = this.querySelector(
      ".annot-doc-image-editor-modal-rightpanel",
    ) as HTMLElement | null;
    const statusbarMount = this.querySelector(
      ".annot-doc-image-editor-modal-statusbar",
    ) as HTMLElement | null;
    const canvasWrap = this.querySelector(
      ".annot-doc-image-editor-modal-canvas-wrap",
    ) as HTMLElement | null;
    if (!toolbarMount || !rightPanelMount || !statusbarMount || !canvasWrap) return;

    // Right-panel first so the toolbar's `onToolChange` callback
    // (which calls `panel.showToolProperties`) has a target.
    const panel = document.createElement(
      "annot-editor-right-panel",
    ) as AnnotEditorRightPanelElement;
    panel.canvas = canvas;
    panel.history = history;
    panel.selection = selection;
    panel.getPluginSections = null;
    panel.isBuiltinSectionDisabled = null;
    panel.applyAllRedactions = () => shell.applyAllRedactions();
    panel.refreshRedactCount();
    rightPanelMount.appendChild(panel);
    this.#rightPanel = panel;
    panel.setElementTree(shell.getCurrentElementTree());

    // Toolbar — vertical strip on the left. Same hidden-affordance
    // bag the VSCode webview uses (no theme toggle / gallery /
    // save group inside an embedded editor surface).
    this.#toolbar = new Toolbar(
      toolbarMount,
      canvas,
      history,
      selection,
      (toolName, toolId) => {
        this.#rightPanel?.showToolProperties(toolId);
        this.#statusHost?.setActiveTool(toolName);
      },
      {
        orientation: "vertical",
        showSettingsButton: false,
        showGalleryButton: false,
        showSaveGroup: false,
        hideToolDropdowns: false,
        applyCrop: async (x, y, w, h) => {
          const ok = await showConfirmDialog({
            title: "Crop image?",
            message:
              `The image will be permanently cropped to ${Math.round(w)}×${Math.round(h)} pixels. ` +
              "The pixels outside the crop region can no longer be recovered after the next save. Continue?",
            okLabel: "Crop",
            cancelLabel: "Cancel",
            danger: true,
          });
          if (!ok) return false;
          const result = await shell.applyCrop(x, y, w, h);
          return result.applied;
        },
      },
    );
    panel.toolbar = this.#toolbar;

    // Statusbar — `[zoom] [dimensions] ───── [current tool]`.
    this.#statusHost = new StatusHost(statusbarMount);
    this.#statusHost.build(canvas, canvas.imageWidth, canvas.imageHeight);

    // Selection-change → right-panel's selection-properties section.
    // Mirrors the VSCode webview wiring exactly.
    const previousOnChange = selection.onChange;
    selection.onChange = () => {
      previousOnChange?.();
      const els = selection.selectedElements;
      if (els.length > 0 && !canvas.activeTool) {
        this.#rightPanel?.showSelectionProperties(els);
      } else {
        this.#rightPanel?.showSelectionProperties([]);
      }
    };

    // Re-fit the canvas whenever the panel resizes (the modal
    // is sized in vw/vh, so window resize / orientation change
    // alters the canvas slot's dimensions). Skipped silently
    // when the user is on a fixed zoom level.
    this.#fitObserver = new ResizeObserver(() => canvas.refitIfFitMode());
    this.#fitObserver.observe(canvasWrap);
  }

  #resolveSave(): void {
    if (!this.#resolver) return;
    const shell = this.#shell;
    const canvas = shell?.getCanvas();
    if (!shell || !canvas) {
      this.#resolveCancel();
      return;
    }
    const svg = exportSVGString(canvas);
    const r = this.#resolver;
    this.#resolver = null;
    // Phase 5 — surface the unlink intent back to the doc shell.
    // Only set when the user actually clicked Unlink in this
    // session AND the block had been opened with a link;
    // otherwise the field is absent so the shell's existing
    // "unchanged link" path runs untouched.
    const unlinked = this.unlinked && this.input?.sourceImagePath !== undefined;
    r(unlinked ? { kind: "save", svg, unlinked: true } : { kind: "save", svg });
  }

  #resolveCancel(): void {
    if (!this.#resolver) return;
    const r = this.#resolver;
    this.#resolver = null;
    r({ kind: "cancel" });
  }

  #close(): void {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
}

customElements.define("annot-doc-image-editor-modal", AnnotDocImageEditorModalElement);

declare global {
  interface HTMLElementTagNameMap {
    "annot-doc-image-editor-modal": AnnotDocImageEditorModalElement;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an `ImageRecord` from a doc image block's SVG payload.
 *  Width / height / originalDataUrl come from the embedded base
 *  `<image>` element. The full SVG bytes go into `annotationsSvg`
 *  so `EditorShell.mountFromRecord` → `restoreAnnotations` can
 *  rebuild the annotation tree (which already handles both the
 *  wrapped `<g id="annotations">` form and the flat form
 *  `exportSVGString` produces). */
function synthesiseRecord(input: ImageEditorModalInput): ImageRecord {
  const parsed = new DOMParser().parseFromString(input.svg, "image/svg+xml");
  const root = parsed.documentElement;
  const baseImage = root.querySelector("image");
  const href = baseImage?.getAttribute("href") ?? baseImage?.getAttribute("xlink:href") ?? "";
  const width = pickInt(
    baseImage?.getAttribute("width"),
    root.getAttribute("width"),
    parseViewBoxWidth(root.getAttribute("viewBox")),
    800,
  );
  const height = pickInt(
    baseImage?.getAttribute("height"),
    root.getAttribute("height"),
    parseViewBoxHeight(root.getAttribute("viewBox")),
    600,
  );
  const now = new Date().toISOString();
  return {
    path: `_doc-image-${input.id}`,
    folderPath: "",
    originalDataUrl: href,
    thumbnailDataUrl: "",
    annotationsSvg: input.svg,
    width,
    height,
    sourceUrl: "",
    tags: {},
    createdAt: now,
    updatedAt: now,
  };
}

/** Pull the last path segment out of a slash-separated path for the
 *  link badge's compact display. Treats backslashes the same as
 *  forward slashes so Windows-style backends present nicely. */
function extractFileName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

function pickInt(...candidates: (string | number | null | undefined)[]): number {
  for (const c of candidates) {
    if (c === null || c === undefined) continue;
    const n = typeof c === "number" ? c : Number.parseInt(c, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function parseViewBoxWidth(viewBox: string | null): number | null {
  if (!viewBox) return null;
  const parts = viewBox.trim().split(/\s+/).map(Number);
  if (parts.length !== 4) return null;
  return Number.isFinite(parts[2]) ? (parts[2] as number) : null;
}

function parseViewBoxHeight(viewBox: string | null): number | null {
  if (!viewBox) return null;
  const parts = viewBox.trim().split(/\s+/).map(Number);
  if (parts.length !== 4) return null;
  return Number.isFinite(parts[3]) ? (parts[3] as number) : null;
}
