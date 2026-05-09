/**
 * `<annot-doc-image-editor-modal>` — a full-viewport modal that
 * mounts an `EditorShell` against the bytes embedded in a single
 * image block, lets the user annotate, and resolves with either
 * the new SVG (Save) or `null` (Cancel).
 *
 * Phase 5a of `docs/plans/annot-html-document.md`. The doc shell
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
import { html, LitElement, type TemplateResult } from "./lit.js";

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
}

export type ImageEditorModalResult =
  | { readonly kind: "save"; readonly svg: string }
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
  width: 90vw;
  height: 80vh;
  max-width: 1400px;
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
  display: grid;
  grid-template-rows: auto 1fr auto;
  overflow: hidden;
}
.annot-doc-image-editor-modal-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--annot-doc-muted, #6b7280);
  font-weight: 600;
}
.annot-doc-image-editor-modal-body {
  position: relative;
  overflow: auto;
  background: var(--annot-doc-code-bg, #f3f4f6);
}
.annot-doc-image-editor-modal-canvas {
  position: relative;
  min-height: 100%;
  min-width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.annot-doc-image-editor-modal-canvas > svg {
  max-width: 100%;
  height: auto;
}
.annot-doc-image-editor-modal-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--annot-doc-muted, #6b7280);
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
`;

let activeModal: AnnotDocImageEditorModalElement | null = null;

export class AnnotDocImageEditorModalElement extends LitElement {
  static override properties = {
    input: { attribute: false },
  };

  declare input: ImageEditorModalInput | null;

  #shell: EditorShell | null = null;
  #onKeydown: ((e: KeyboardEvent) => void) | null = null;
  /** Resolves on Save / Cancel. The promise is set up in
   *  `openFor`. */
  #resolver: ((result: ImageEditorModalResult) => void) | null = null;

  constructor() {
    super();
    this.input = null;
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
        this.#resolveCancel();
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
    return html`
      <style>${STYLES}</style>
      <div
        class="annot-doc-image-editor-modal-overlay"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.#resolveCancel();
        }}
      >
        <div
          class="annot-doc-image-editor-modal-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Edit image"
        >
          <div class="annot-doc-image-editor-modal-header">Edit image</div>
          <div class="annot-doc-image-editor-modal-body">
            <div class="annot-doc-image-editor-modal-canvas"></div>
          </div>
          <div class="annot-doc-image-editor-modal-footer">
            <button type="button" @click=${() => this.#resolveCancel()}>Cancel</button>
            <button type="button" class="primary" @click=${() => this.#resolveSave()}>
              Save
            </button>
          </div>
        </div>
      </div>
    `;
  }

  #mountShell(): void {
    if (!this.input) return;
    const container = this.querySelector(
      ".annot-doc-image-editor-modal-canvas",
    ) as HTMLElement | null;
    if (!container) return;

    const record = synthesiseRecord(this.input);
    const shell = new EditorShell({ container, storage: NOOP_STORAGE });
    shell.mountFromRecord(record.path, record);
    this.#shell = shell;
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
    r({ kind: "save", svg });
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
