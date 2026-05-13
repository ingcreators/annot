/**
 * `CaptureSession` — wraps the `MediaStream` + `<video>` element +
 * single-frame canvas grab that Phase 2 of
 * `docs/plans/web-capture-redesign.md` factors out of `pwa-capture.ts`'s
 * inline `captureScreen()` so the workspace and the (future) Auto
 * Capture engine share one source-of-truth.
 *
 * Owns:
 *   - the `MediaStream` returned by `getDisplayMedia`
 *   - a `<video>` element bound to it (set by the workspace's
 *     `<annot-capture-preview>` — the session doesn't append it to
 *     the DOM itself)
 *   - track-ended detection (the user clicking "Stop sharing" in
 *     Chrome's screen-share toolbar fires `ended`; we propagate to
 *     the consumer via the `onStopped` callback)
 *
 * Lifecycle: `start()` → resolves once metadata + first frame are
 * available. `captureFrame()` may be called any time after that.
 * `stop()` is idempotent — safe to call from React-style cleanup
 * hooks AND from the user-initiated `Stop` button.
 */

import type { CursorMode } from "./capture-prefs.js";

export interface CaptureSessionOptions {
  /** `<video>` element the session attaches the stream to. The
   *  workspace constructs this inside `<annot-capture-preview>`
   *  so its layout / styles stay co-located with the preview. */
  video: HTMLVideoElement;
  /** Cursor visibility for `getDisplayMedia({video:{cursor}})`. */
  cursor?: CursorMode;
  /** Invoked when the underlying track stops (user clicked the
   *  browser's "Stop sharing" toolbar, or the source window
   *  closed). The session has already cleaned up internally; the
   *  callback exists so the workspace can navigate or update its
   *  status message. */
  onStopped?: () => void;
}

export interface CaptureFrameResult {
  /** Lossless PNG-24 data URL — the raw canvas read-back. The
   *  `CaptureHost.saveDataUrlSilently` step pipes this through
   *  `encodeCapture()` from `@ingcreators/annot-core/encode`,
   *  which decides (per `DEFAULT_ENCODE_OPTIONS`) whether to
   *  quantize down to PNG-8 (UI-heavy frames) or fall back to
   *  PNG-24 / JPEG (photo-heavy frames). Output of this method
   *  stays as the lossless PNG-24 so the encoder has the full
   *  fidelity to work with. */
  dataUrl: string;
  width: number;
  height: number;
}

export class CaptureSession {
  #video: HTMLVideoElement;
  #stream: MediaStream | null = null;
  #cursor: CursorMode;
  #onStopped?: () => void;
  #stopped = false;

  constructor(opts: CaptureSessionOptions) {
    this.#video = opts.video;
    this.#cursor = opts.cursor ?? "always";
    this.#onStopped = opts.onStopped;
  }

  /** Trigger the browser's screen-share picker, attach the stream
   *  to the bound video element, and resolve once a real frame is
   *  available. Returns `false` if the user cancelled the picker
   *  (rejected `getDisplayMedia` Promise). */
  async start(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: this.#cursor } as MediaTrackConstraints,
      });
      this.#stream = stream;
      this.#video.srcObject = stream;
      this.#video.muted = true;
      this.#video.playsInline = true;

      await new Promise<void>((resolve) => {
        this.#video.onloadeddata = () => resolve();
        void this.#video.play();
      });
      // Mirror `pwa-capture.ts:33` — wait extra frames so the first
      // captured frame isn't a black or partially-painted frame.
      await new Promise((r) => setTimeout(r, 200));

      // Track-ended detection: Chrome's "Stop sharing" toolbar
      // emits `ended` on the video track. Propagate so the
      // workspace can render its `stopped` state.
      const track = stream.getVideoTracks()[0];
      track?.addEventListener("ended", () => {
        if (this.#stopped) return;
        this.stop();
        this.#onStopped?.();
      });

      return true;
    } catch {
      // User cancelled the picker, OR getDisplayMedia threw (no
      // permission, no displays, etc.). Either way the session is
      // not live; the workspace surfaces the "no session" state.
      this.#stream = null;
      return false;
    }
  }

  /** Capture the current frame. Caller is responsible for ensuring
   *  the session is live (`start()` resolved true and `stop()` not
   *  called). */
  captureFrame(): CaptureFrameResult {
    const w = this.#video.videoWidth;
    const h = this.#video.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("CaptureSession: 2D context unavailable");
    ctx.drawImage(this.#video, 0, 0, w, h);
    // Lossless PNG-24 — the encoder downstream needs full fidelity
    // to make the best quantization decision. The final bytes
    // stored on disk are produced by `encodeCapture()` in
    // `CaptureHost.saveDataUrlSilently`, which runs the smart
    // PNG-8 / PNG-24 / JPEG routing the Chrome Extension uses.
    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: w,
      height: h,
    };
  }

  /** Stop all tracks and release the video element's source.
   *  Idempotent. */
  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    if (this.#stream) {
      this.#stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore — already stopped */
        }
      });
      this.#stream = null;
    }
    try {
      this.#video.srcObject = null;
    } catch {
      /* ignore */
    }
  }

  get sourceWidth(): number {
    return this.#video.videoWidth;
  }

  get sourceHeight(): number {
    return this.#video.videoHeight;
  }

  get isLive(): boolean {
    return this.#stream !== null && !this.#stopped;
  }

  /** Read-only accessor for the bound `<video>` element so the
   *  `AutoCaptureEngine` (Phase 4) can sample frames into its
   *  comparison canvas. The session keeps full ownership — the
   *  engine MUST NOT modify `srcObject` / dimensions / etc. */
  getVideoElementForSampling(): HTMLVideoElement | null {
    if (!this.isLive) return null;
    return this.#video;
  }
}
