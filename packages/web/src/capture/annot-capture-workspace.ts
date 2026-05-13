/**
 * `<annot-capture-workspace>` — the `/capture` route's main surface.
 * Owns the `MediaStream` (via `CaptureSession`) + the
 * `<annot-capture-preview>` + `<annot-capture-toolbar>` +
 * `<annot-candidate-panel>` triad. Phase 2 wires Capture Once
 * end-to-end; Phase 3 adds the candidate panel + store; Phase 4
 * adds the Auto Capture engine.
 *
 * Lit Phase 6 — light DOM, `static properties`, no decorators.
 *
 * Lifecycle:
 *   - `connectedCallback` reads / consumes the
 *     `CapturePendingSession` and starts the `CaptureSession` if
 *     present. The dialog's Start button click is the user gesture
 *     for `getDisplayMedia` — a direct visit to `/capture` (no
 *     pending session) shows the no-session hint instead.
 *   - `disconnectedCallback` stops the session. Browser back from
 *     `/capture` mid-stream cleanly tears down the tracks.
 *
 * The workspace is mounted by `app.ts:#showCaptureWorkspace` into
 * a dedicated `#annot-capture-host` container appended to `<body>`,
 * mirroring how doc-mode mounts `#annot-doc-host`.
 */

import { html, LitElement, nothing } from "../lit.js";
import "./annot-candidate-panel.js";
import "./annot-capture-preview.js";
import "./annot-capture-toolbar.js";
import type { AnnotCapturePreviewElement } from "./annot-capture-preview.js";
import {
  type CapturePendingSession,
  consumeCapturePendingSession,
} from "./capture-pending-session.js";
import { CaptureSession } from "./capture-session.js";

export interface CaptureWorkspaceCaptureDetail {
  dataUrl: string;
  width: number;
  height: number;
  mode: CapturePendingSession["mode"];
  folderPath: string;
}

type WorkspaceState = "no-pending" | "starting" | "sharing" | "stopped" | "cancelled";

export class AnnotCaptureWorkspaceElement extends LitElement {
  static override properties = {
    state: { state: true },
    statusMessage: { state: true },
    sourceWidth: { state: true },
    sourceHeight: { state: true },
  };

  declare state: WorkspaceState;
  declare statusMessage: string;
  declare sourceWidth: number;
  declare sourceHeight: number;

  #pending: CapturePendingSession | null = null;
  #session: CaptureSession | null = null;
  #preview: AnnotCapturePreviewElement | null = null;

  constructor() {
    super();
    this.state = "no-pending";
    this.statusMessage = "";
    this.sourceWidth = 0;
    this.sourceHeight = 0;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override async connectedCallback(): Promise<void> {
    super.connectedCallback();
    this.#pending = consumeCapturePendingSession();
    if (!this.#pending) {
      this.state = "no-pending";
      this.statusMessage = "No capture session in progress. Open New > Capture Screen... to start.";
      return;
    }
    this.state = "starting";
    this.statusMessage = "Requesting screen share permission…";
    // Defer to the next microtask so the preview element renders +
    // its `<video>` is ready before we attach the stream.
    await this.updateComplete;
    await this.#startSession();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#session?.stop();
    this.#session = null;
  }

  override render() {
    return html`
      <div class="capture-workspace">
        <div class="capture-workspace-header">
          <span class="capture-workspace-header-status">
            ${
              this.state === "sharing"
                ? html`<span class="capture-workspace-status-dot"></span> Sharing`
                : this.state === "starting"
                  ? "Starting…"
                  : this.state === "stopped"
                    ? "Stopped"
                    : this.state === "cancelled"
                      ? "Cancelled"
                      : "Ready"
            }
          </span>
          <span class="capture-workspace-header-mode">
            Mode: ${this.#pending?.mode ?? "—"}
          </span>
          ${
            this.#pending
              ? html`<span class="capture-workspace-header-folder">
                Folder: ${this.#pending.folderPath || "(root)"}
              </span>`
              : nothing
          }
          <span class="capture-workspace-header-spacer"></span>
          <button
            type="button"
            class="capture-workspace-exit-btn"
            @click=${this.#exit}
          >
            ${this.state === "sharing" ? "Stop & Exit" : "Back to gallery"}
          </button>
        </div>

        <div class="capture-workspace-body">
          <div class="capture-workspace-main">
            ${this.#renderPreviewArea()}
            ${
              this.state === "sharing"
                ? html`<annot-capture-toolbar
                  .mode=${this.#pending?.mode ?? "once"}
                  .canCaptureOnce=${this.state === "sharing"}
                  @capture-once-click=${this.#captureOnce}
                  @stop-click=${this.#exit}
                ></annot-capture-toolbar>`
                : nothing
            }
          </div>
          <div class="capture-workspace-side">
            <annot-candidate-panel .count=${0}></annot-candidate-panel>
          </div>
        </div>
      </div>
    `;
  }

  #renderPreviewArea() {
    if (this.state === "no-pending") {
      return html`
        <div class="capture-workspace-empty">
          <div class="capture-workspace-empty-title">No capture session in progress</div>
          <div class="capture-workspace-empty-body">
            ${this.statusMessage}
          </div>
          <button
            type="button"
            class="capture-workspace-empty-btn"
            @click=${this.#exit}
          >
            Back to gallery
          </button>
        </div>
      `;
    }
    return html`
      <annot-capture-preview
        .status=${this.statusMessage}
        .sourceWidth=${this.sourceWidth}
        .sourceHeight=${this.sourceHeight}
      ></annot-capture-preview>
    `;
  }

  /** Workspace consumer hook — emit a `capture-once` CustomEvent
   *  (with the captured frame's data URL + dimensions + mode +
   *  folderPath) for the host to persist via its `StorageProvider`.
   *  The workspace stays storage-agnostic so it can be mounted in
   *  Storybook against a fake handler. */
  #captureOnce = (): void => {
    if (!this.#session?.isLive || !this.#pending) return;
    const frame = this.#session.captureFrame();
    this.dispatchEvent(
      new CustomEvent<CaptureWorkspaceCaptureDetail>("capture-once", {
        detail: {
          dataUrl: frame.dataUrl,
          width: frame.width,
          height: frame.height,
          mode: this.#pending.mode,
          folderPath: this.#pending.folderPath,
        },
        bubbles: true,
      }),
    );
  };

  /** "Stop & Exit" / "Back to gallery" — stops the session and
   *  asks the host (via `workspace-exit` CustomEvent) to navigate
   *  back. The host owns routing because the workspace shouldn't
   *  reach into `pushRoute`. */
  #exit = (): void => {
    this.#session?.stop();
    this.#session = null;
    this.dispatchEvent(new CustomEvent("workspace-exit", { bubbles: true }));
  };

  async #startSession(): Promise<void> {
    if (!this.#pending) return;
    this.#preview = this.querySelector<AnnotCapturePreviewElement>("annot-capture-preview");
    if (!this.#preview) {
      // Render hadn't run yet — wait one cycle and retry. Should
      // be unreachable since `connectedCallback` awaits
      // `updateComplete` before calling here.
      await this.updateComplete;
      this.#preview = this.querySelector<AnnotCapturePreviewElement>("annot-capture-preview");
      if (!this.#preview) {
        this.state = "no-pending";
        this.statusMessage = "Internal error: preview element missing.";
        return;
      }
    }
    const session = new CaptureSession({
      video: this.#preview.getVideoElement(),
      cursor: this.#pending.cursor,
      onStopped: () => {
        this.state = "stopped";
        this.statusMessage = "Screen sharing stopped.";
      },
    });
    this.#session = session;
    const ok = await session.start();
    if (!ok) {
      this.state = "cancelled";
      this.statusMessage = "Screen share was cancelled or denied.";
      this.#session = null;
      return;
    }
    this.state = "sharing";
    this.statusMessage = "Sharing — click Capture Once to save the current frame.";
    this.sourceWidth = session.sourceWidth;
    this.sourceHeight = session.sourceHeight;
  }
}

if (!customElements.get("annot-capture-workspace")) {
  customElements.define("annot-capture-workspace", AnnotCaptureWorkspaceElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-capture-workspace": AnnotCaptureWorkspaceElement;
  }
}
