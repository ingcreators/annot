/**
 * `<annot-capture-preview>` — owns the live `<video>` element the
 * shared `MediaStream` paints into, plus a status overlay.
 *
 * Phase 2 of `docs/plans/web-capture-redesign.md`. The status prop
 * is a string set by the workspace; Phase 4 wires the
 * `AutoCaptureState` machine into it for the Auto Capture mode
 * messages (`Watching for screen changes`, `Screen change detected`,
 * etc.).
 *
 * The element doesn't own the `CaptureSession` — the workspace
 * constructs both, hands the `<video>` reference into the session
 * via `getVideoElement()`, and decides when to start / stop. Keeping
 * the lifecycle in the workspace lets future phases reuse the
 * preview from a hypothetical `<annot-capture-area-overlay>` without
 * duplicating session bookkeeping.
 */

import { html, LitElement, nothing } from "../lit.js";

export class AnnotCapturePreviewElement extends LitElement {
  static override properties = {
    status: { type: String },
    sourceWidth: { type: Number },
    sourceHeight: { type: Number },
  };

  declare status: string;
  declare sourceWidth: number;
  declare sourceHeight: number;

  #video: HTMLVideoElement;

  constructor() {
    super();
    this.status = "Waiting for screen share…";
    this.sourceWidth = 0;
    this.sourceHeight = 0;
    this.#video = document.createElement("video");
    this.#video.className = "capture-preview-video";
    this.#video.muted = true;
    this.#video.playsInline = true;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Workspace calls this to construct a `CaptureSession` against
   *  the same `<video>` the preview renders. */
  getVideoElement(): HTMLVideoElement {
    return this.#video;
  }

  override render() {
    return html`
      <div class="capture-preview">
        <div class="capture-preview-frame">
          ${this.#renderVideoSlot()}
          ${
            this.status
              ? html`<div class="capture-preview-status" role="status">${this.status}</div>`
              : nothing
          }
        </div>
        ${
          this.sourceWidth && this.sourceHeight
            ? html`<div class="capture-preview-meta">
              Source: ${this.sourceWidth} × ${this.sourceHeight}
            </div>`
            : nothing
        }
      </div>
    `;
  }

  /** Slot the video element imperatively after render — Lit's
   *  light-DOM template can't host a pre-constructed element via
   *  declarative templating, so we stitch it in once.
   *  `firstUpdated` fires after every initial render of a freshly-
   *  attached element, which matches what we need. */
  protected override firstUpdated(): void {
    const frame = this.querySelector<HTMLElement>(".capture-preview-frame");
    if (frame && !this.#video.parentElement) {
      frame.insertBefore(this.#video, frame.firstChild);
    }
  }

  /** Re-attach the video on subsequent renders if Lit re-built the
   *  frame (it shouldn't because the element is re-used, but this
   *  is the cheap defensive check). */
  protected override updated(): void {
    const frame = this.querySelector<HTMLElement>(".capture-preview-frame");
    if (frame && this.#video.parentElement !== frame) {
      frame.insertBefore(this.#video, frame.firstChild);
    }
  }

  #renderVideoSlot() {
    // Empty — `firstUpdated` / `updated` insert the pre-built
    // video element. Returning a slot keeps the template valid
    // and lets the status overlay render after the slot in the
    // CSS stacking order.
    return nothing;
  }
}

if (!customElements.get("annot-capture-preview")) {
  customElements.define("annot-capture-preview", AnnotCapturePreviewElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-capture-preview": AnnotCapturePreviewElement;
  }
}
