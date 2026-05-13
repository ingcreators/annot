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

import { newIdB58 } from "@ingcreators/annot-core/utils";
import { html, LitElement, nothing } from "../lit.js";
import "./annot-candidate-panel.js";
import "./annot-capture-preview.js";
import "./annot-capture-toolbar.js";
import type { AnnotCapturePreviewElement } from "./annot-capture-preview.js";
import { CandidateStore } from "./candidate-store.js";
import {
  type CapturePendingSession,
  consumeCapturePendingSession,
} from "./capture-pending-session.js";
import { CaptureSession } from "./capture-session.js";
import type { CaptureCandidate } from "./types.js";

export interface CaptureWorkspaceCaptureDetail {
  dataUrl: string;
  width: number;
  height: number;
  mode: CapturePendingSession["mode"];
  folderPath: string;
}

/** Detail dispatched on `candidate-accepted`. The host's
 *  workspace-mount handler in app.ts persists the blob via
 *  `storage.saveImage` and then calls `removeCandidate(id)` on
 *  the workspace so the panel re-renders without the card. */
export interface CandidateAcceptedDetail {
  id: string;
  blob: Blob;
  thumbnailDataUrl: string;
  width: number;
  height: number;
  folderPath: string;
  /** When `true`, the host should also navigate into the editor
   *  for the saved record (the Edit button shortcut). */
  openEditor: boolean;
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
  #store: CandidateStore = new CandidateStore();

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
    this.#store.clear();
  }

  /** Workspace-internal API the host can call to drop a candidate
   *  after persisting it. The candidate panel re-renders via the
   *  store's `change` event. */
  removeCandidate(id: string): void {
    this.#store.remove(id);
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
            ${this.#renderDevDebugButton()}
          </div>
          <div class="capture-workspace-side">
            <annot-candidate-panel
              .store=${this.#store}
              @candidate-accept=${(e: Event) => this.#onCandidateAccept(e, false)}
              @candidate-edit=${(e: Event) => this.#onCandidateAccept(e, true)}
              @candidate-delete=${this.#onCandidateDelete}
            ></annot-candidate-panel>
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

  /** Phase 3 dev-only debug surface. Lets reviewers exercise the
   *  candidate panel + Accept / Edit / Delete actions before Phase
   *  4's Auto Capture engine starts populating the store
   *  organically. Removed in Phase 4 (the engine takes its place).
   *  Gated on `import.meta.env.DEV` so production builds drop it. */
  #renderDevDebugButton() {
    if (!import.meta.env.DEV) return nothing;
    if (this.state !== "sharing") return nothing;
    return html`
      <div class="capture-workspace-dev-tools">
        <button
          type="button"
          class="capture-workspace-dev-btn"
          @click=${this.#pushTestCandidate}
        >
          [debug] Push test candidate
        </button>
      </div>
    `;
  }

  #pushTestCandidate = (): void => {
    if (!this.#session?.isLive) return;
    const frame = this.#session.captureFrame();
    const candidate: CaptureCandidate = {
      id: newIdB58(),
      status: "candidate",
      createdAt: new Date().toISOString(),
      sourceWidth: frame.width,
      sourceHeight: frame.height,
      // Reuse the JPEG data URL as both blob source AND thumbnail —
      // good enough for the debug surface; Phase 4's engine builds
      // a proper downscaled thumbnail.
      imageBlob: dataUrlToBlob(frame.dataUrl),
      thumbnailDataUrl: frame.dataUrl,
    };
    this.#store.add(candidate);
  };

  #onCandidateAccept = (e: Event, openEditor: boolean): void => {
    const id = (e as CustomEvent).detail?.id as string | undefined;
    if (!id || !this.#pending) return;
    const c = this.#store.get(id);
    if (!c) return;
    this.#store.accept(id);
    this.dispatchEvent(
      new CustomEvent<CandidateAcceptedDetail>("candidate-accepted", {
        detail: {
          id,
          blob: c.imageBlob,
          thumbnailDataUrl: c.thumbnailDataUrl,
          width: c.sourceWidth,
          height: c.sourceHeight,
          folderPath: this.#pending.folderPath,
          openEditor,
        },
        bubbles: true,
      }),
    );
  };

  #onCandidateDelete = (e: Event): void => {
    const id = (e as CustomEvent).detail?.id as string | undefined;
    if (!id) return;
    this.#store.remove(id);
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

/** Decode a `data:image/...;base64,...` URL into a `Blob`. Used by
 *  the Phase 3 dev-only debug button so the candidate it pushes
 *  carries a real `Blob` (matching what Phase 4's engine produces
 *  via canvas `toBlob`). */
function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return new Blob([], { type: "application/octet-stream" });
  const mime = m[1] ?? "application/octet-stream";
  const b64 = m[2] ?? "";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

if (!customElements.get("annot-capture-workspace")) {
  customElements.define("annot-capture-workspace", AnnotCaptureWorkspaceElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-capture-workspace": AnnotCaptureWorkspaceElement;
  }
}
