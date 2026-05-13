/**
 * `<annot-capture-workspace>` — the `/capture` route's main surface.
 * Owns the `MediaStream` (via `CaptureSession`) + the
 * `<annot-capture-preview>` + `<annot-capture-toolbar>` +
 * `<annot-candidate-panel>` triad.
 *
 * Post-Phase-5 model: every captured frame (Auto Capture-detected
 * OR manually added via the toolbar button) persists immediately
 * through the host's `saveCapture` callback. The panel renders a
 * session-local list of already-saved records. Delete in the panel
 * routes through `deleteCapture` to remove from storage too. No
 * Accept gate, no in-memory blob buffer, no "discard pending"
 * confirm on exit — the user can leave any time without losing
 * work.
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
import { AutoCaptureEngine } from "./auto-capture.js";
import { CandidateStore } from "./candidate-store.js";
import {
  type CapturePendingSession,
  consumeCapturePendingSession,
} from "./capture-pending-session.js";
import { CaptureSession } from "./capture-session.js";
import type { AutoCaptureState } from "./types.js";

/** Max captures the engine produces per session before pausing
 *  itself. Workspace surfaces a "buffer full" info bar; the user
 *  deletes some to resume. Same cap applies to the (already-
 *  persisted) panel list. */
const MAX_CAPTURES = 200;

/** Spec §10.4 defaults — used when the workspace runs in Auto
 *  mode. spec Phase 5 (deferred) will surface them through the
 *  Advanced settings panel. */
const AUTO_CAPTURE_DEFAULTS = {
  intervalMs: 1000,
  stableWaitMs: 700,
  minMsBetweenCaptures: 1500,
  comparisonWidth: 320,
  ignoreCursorOnlyChanges: true,
};

/** Map `AutoCaptureState` → spec §8.4 status copy. */
const AUTO_STATE_COPY: Record<AutoCaptureState, string> = {
  idle: "Watching for screen changes",
  changing: "Screen change detected",
  "stable-wait": "Waiting for the screen to settle",
  captured: "Capture saved",
};

/** Result the host returns from `saveCapture`. Mirrors
 *  `CaptureHost.saveDataUrlSilently`'s return shape. */
export interface CaptureSaveResult {
  path: string;
  thumbnailDataUrl: string;
  width: number;
  height: number;
}

/** Host-supplied callback that persists a captured frame and
 *  returns the saved record + thumbnail. */
export type CaptureSaveFn = (
  dataUrl: string,
  tags: Record<string, string>,
) => Promise<CaptureSaveResult | null>;

/** Host-supplied callback that deletes a saved capture from
 *  storage. The workspace calls this when the user clicks Delete
 *  on a candidate card. */
export type CaptureDeleteFn = (path: string) => Promise<void>;

type WorkspaceState = "no-pending" | "starting" | "sharing" | "stopped" | "cancelled";

export class AnnotCaptureWorkspaceElement extends LitElement {
  static override properties = {
    state: { state: true },
    statusMessage: { state: true },
    sourceWidth: { state: true },
    sourceHeight: { state: true },
    saveCapture: { attribute: false },
    deleteCapture: { attribute: false },
  };

  declare state: WorkspaceState;
  declare statusMessage: string;
  declare sourceWidth: number;
  declare sourceHeight: number;
  /** Host-supplied save callback (see `CaptureSaveFn`). Required
   *  for a working session — the workspace surfaces a console
   *  warning if invoked while unset (Storybook fixture missing
   *  the wiring, etc.). */
  declare saveCapture: CaptureSaveFn | null;
  /** Host-supplied delete callback (see `CaptureDeleteFn`). When
   *  unset, Delete still drops from the panel but leaves the
   *  storage record in place. */
  declare deleteCapture: CaptureDeleteFn | null;

  #pending: CapturePendingSession | null = null;
  #session: CaptureSession | null = null;
  #preview: AnnotCapturePreviewElement | null = null;
  #store: CandidateStore = new CandidateStore();
  #engine: AutoCaptureEngine | null = null;
  #autoEnabled = true;
  #bufferFullNotified = false;
  /** Session id shared by every tag emitted during this session
   *  so the gallery can group them later. */
  #sessionId: string = newIdB58();

  constructor() {
    super();
    this.state = "no-pending";
    this.statusMessage = "";
    this.sourceWidth = 0;
    this.sourceHeight = 0;
    this.saveCapture = null;
    this.deleteCapture = null;
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
    this.#engine?.stop();
    this.#engine = null;
    const video = this.#preview?.getVideoElement();
    video?.removeEventListener("resize", this.#onVideoResize);
    this.#session?.stop();
    this.#session = null;
    this.#store.clear();
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
                  .autoEnabled=${this.#engine !== null && this.#autoEnabled}
                  .autoSupported=${this.#pending?.mode === "auto"}
                  @capture-once-click=${this.#manualCapture}
                  @auto-toggle-click=${this.#toggleAuto}
                  @stop-click=${this.#exit}
                ></annot-capture-toolbar>`
                : nothing
            }
          </div>
          <div class="capture-workspace-side">
            <annot-candidate-panel
              .store=${this.#store}
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

  /** Toolbar's "Add Capture" button — grabs the current frame and
   *  saves it via the host. The previous Phase 2 "Capture Once"
   *  semantic (capture + open editor) was retired post-rollout
   *  because the editor hand-off interrupted the user's triage
   *  flow; manual captures now go through the same save+panel
   *  path as Auto Capture detections. */
  #manualCapture = (): void => {
    if (!this.#session?.isLive) return;
    const frame = this.#session.captureFrame();
    void this.#persistCapture(frame.dataUrl, frame.width, frame.height, "manual");
  };

  /** Persist a captured frame via the host's `saveCapture`
   *  callback, then push the result onto the session panel. */
  async #persistCapture(
    dataUrl: string,
    width: number,
    height: number,
    sessionKind: "auto" | "manual",
    diffScore?: number,
  ): Promise<void> {
    if (!this.saveCapture) {
      console.warn("[capture-workspace] saveCapture not wired; dropping frame");
      return;
    }
    if (!this.#pending) return;
    if (this.#store.size >= MAX_CAPTURES) {
      // Engine self-pauses via `onBufferFull`; this guard catches
      // the manual-add path post-cap. Surface the same message.
      this.#notifyBufferFull();
      return;
    }
    const tags: Record<string, string> = {
      captureId: newIdB58(),
      session: this.#sessionId,
      sessionKind,
      sessionIndex: String(this.#store.size),
    };
    let saved: CaptureSaveResult | null;
    try {
      saved = await this.saveCapture(dataUrl, tags);
    } catch (err) {
      console.error("[capture-workspace] saveCapture failed:", err);
      return;
    }
    if (!saved) return;
    this.#store.add({
      id: saved.path,
      path: saved.path,
      createdAt: new Date().toISOString(),
      sourceWidth: saved.width,
      sourceHeight: saved.height,
      thumbnailDataUrl: saved.thumbnailDataUrl,
      diffScore,
    });
  }

  /** "Stop & Exit" / "Back to gallery" — stops the session and
   *  asks the host (via `workspace-exit` CustomEvent) to navigate
   *  back. No confirmation needed — every capture is already
   *  persisted, so there's nothing to lose. */
  #exit = (): void => {
    this.#engine?.stop();
    this.#engine = null;
    this.#session?.stop();
    this.#session = null;
    this.dispatchEvent(new CustomEvent("workspace-exit", { bubbles: true }));
  };

  /** Workspace toolbar's `Auto OFF` toggle — pause / resume the
   *  engine. `resetBaseline` so the next tick treats the current
   *  frame as the new starting point. */
  #toggleAuto = (): void => {
    if (!this.#engine) return;
    this.#autoEnabled = !this.#autoEnabled;
    if (this.#autoEnabled) {
      this.#engine.resetBaseline();
      this.#engine.start();
      this.statusMessage = AUTO_STATE_COPY.idle;
    } else {
      this.#engine.stop();
      this.statusMessage = "Auto Capture paused.";
    }
    // Trigger a render so the toolbar reflects the new state.
    this.requestUpdate();
  };

  #onCandidateDelete = (e: Event): void => {
    const id = (e as CustomEvent).detail?.id as string | undefined;
    if (!id) return;
    this.#store.remove(id);
    if (this.deleteCapture) {
      void this.deleteCapture(id).catch((err) => {
        console.error("[capture-workspace] deleteCapture failed:", err);
      });
    }
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
    this.sourceWidth = session.sourceWidth;
    this.sourceHeight = session.sourceHeight;
    // Track source-resolution changes so the "Source: WxH" label
    // stays accurate when the user resizes the shared window or
    // navigates to a page with a different layout. The
    // `<video>` element fires `resize` whenever its
    // `videoWidth` / `videoHeight` change post-load. The Auto
    // Capture engine also re-baselines on dimension change
    // (`auto-capture.ts:#processFrame`), so the engine + the
    // header display stay in sync.
    const video = this.#preview?.getVideoElement();
    video?.addEventListener("resize", this.#onVideoResize);
    if (this.#pending.mode === "auto") {
      this.statusMessage = AUTO_STATE_COPY.idle;
      this.#startAutoEngine();
    } else {
      this.statusMessage = "Sharing — click Add Capture to save the current frame.";
    }
  }

  #onVideoResize = (): void => {
    if (!this.#session) return;
    this.sourceWidth = this.#session.sourceWidth;
    this.sourceHeight = this.#session.sourceHeight;
  };

  #startAutoEngine(): void {
    if (!this.#session) return;
    this.#engine = new AutoCaptureEngine({
      session: this.#session,
      ...AUTO_CAPTURE_DEFAULTS,
      maxCaptures: MAX_CAPTURES,
      getCapturedCount: () => this.#store.size,
      onCaptureReady: ({ dataUrl, width, height, diffScore }) =>
        this.#persistCapture(dataUrl, width, height, "auto", diffScore),
      onStateChange: (state) => {
        this.statusMessage = AUTO_STATE_COPY[state];
      },
      onCursorIgnored: () => {
        this.statusMessage = "Ignored cursor-only movement";
      },
      onBufferFull: () => this.#notifyBufferFull(),
    });
    this.#engine.start();
  }

  #notifyBufferFull(): void {
    if (this.#bufferFullNotified) return;
    this.#bufferFullNotified = true;
    this.statusMessage = `Capture buffer full (${MAX_CAPTURES}) — delete some to keep capturing.`;
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
