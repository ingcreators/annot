/**
 * `AutoCaptureEngine` — drives the change-detection-based capture
 * loop the spec describes (state machine: idle → changing →
 * stable-wait → captured → idle). Phase 4 of
 * `docs/plans/web-capture-redesign.md`.
 *
 * Loop shape (per `intervalMs`):
 *
 *   1. Grab the current full-resolution frame from the
 *      `CaptureSession`.
 *   2. Downscale to the comparison canvas (`comparisonWidth ×
 *      proportional height`) and read `ImageData`.
 *   3. Diff against the previous baseline.
 *   4. Drive the state machine:
 *        - no meaningful change → return to / stay in `idle`.
 *        - cursor-only (when enabled) → emit `ignored-cursor` and
 *          stay in `idle`.
 *        - meaningful change → enter `changing` (record the new
 *          baseline) → next sample with no further change moves
 *          us to `stable-wait` → after `stableWaitMs` of stillness
 *          we capture a full-resolution frame and emit it as a
 *          candidate → state goes back to `idle`.
 *
 * The engine doesn't hold the storage backend — it pushes
 * `CaptureCandidate` objects into the consumer-supplied
 * `CandidateStore` and lets the workspace's `candidate-accepted`
 * handler persist on user action.
 */

import type { CaptureSession } from "./capture-session.js";
import { computeDiffScore, isCursorOnly, isMeaningfulChange } from "./diff-detection.js";
import type { AutoCaptureState } from "./types.js";

/** Frame the engine surfaces when it decides a capture should land. */
export interface AutoCaptureFrame {
  dataUrl: string;
  width: number;
  height: number;
  diffScore?: number;
}

export interface AutoCaptureOptions {
  session: CaptureSession;
  intervalMs: number;
  stableWaitMs: number;
  minMsBetweenCaptures: number;
  comparisonWidth: number;
  ignoreCursorOnlyChanges: boolean;
  /** Called with the captured frame when the engine decides one
   *  should land. The workspace persists it via the host's
   *  `saveCapture` callback (which routes through
   *  `CaptureHost.saveDataUrlSilently`). Async — the engine awaits
   *  the result to honour back-pressure if storage is slow. */
  onCaptureReady: (frame: AutoCaptureFrame) => void | Promise<void>;
  /** Notified on every state transition. Workspace renders these
   *  as the spec §8.4 status copy. */
  onStateChange?: (state: AutoCaptureState) => void;
  /** Notified once a meaningful change is classified as cursor-only
   *  and dropped. Workspace surfaces this as a transient
   *  "Ignored cursor-only movement" status. */
  onCursorIgnored?: () => void;
  /** Number of captures already in this session (so the engine knows
   *  whether the cap below has been reached without holding a
   *  store reference). Re-read on every tick — the workspace
   *  decrements it when the user deletes a candidate. */
  getCapturedCount: () => number;
  /** Maximum captures to produce in this session before the engine
   *  pauses itself. Workspace surfaces a "buffer full" info bar via
   *  the `onBufferFull` callback. */
  maxCaptures?: number;
  /** Notified when the engine pauses because `maxCaptures` was hit. */
  onBufferFull?: () => void;
}

const DEFAULT_MAX_CAPTURES = 200;

export class AutoCaptureEngine {
  #opts: AutoCaptureOptions;
  #state: AutoCaptureState = "idle";
  #baseline: ImageData | null = null;
  #lastCaptureMs = 0;
  #stableWaitStartedMs: number | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #stopped = true;
  #comparisonCanvas: HTMLCanvasElement;
  #comparisonCtx: CanvasRenderingContext2D | null;

  constructor(opts: AutoCaptureOptions) {
    this.#opts = opts;
    this.#comparisonCanvas = document.createElement("canvas");
    this.#comparisonCtx = this.#comparisonCanvas.getContext("2d");
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#scheduleNext(0);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer != null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  get isRunning(): boolean {
    return !this.#stopped;
  }

  get state(): AutoCaptureState {
    return this.#state;
  }

  /** Drop the captured-baseline image so the next tick treats the
   *  current frame as "no previous comparison" and either records
   *  a new baseline or stays idle. Used by the workspace when the
   *  user manually pauses + resumes. */
  resetBaseline(): void {
    this.#baseline = null;
    this.#stableWaitStartedMs = null;
    this.#setState("idle");
  }

  #scheduleNext(delay: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      void this.#tick();
    }, delay);
  }

  async #tick(): Promise<void> {
    this.#timer = null;
    if (this.#stopped) return;
    if (!this.#opts.session.isLive) {
      this.stop();
      return;
    }
    try {
      this.#processFrame();
    } catch (err) {
      console.error("[AutoCaptureEngine] frame processing error:", err);
    }
    this.#scheduleNext(this.#opts.intervalMs);
  }

  #processFrame(): void {
    const ctx = this.#comparisonCtx;
    if (!ctx) return; // happy-dom / canvas-less environments — skip silently.

    const sourceW = this.#opts.session.sourceWidth;
    const sourceH = this.#opts.session.sourceHeight;
    if (!sourceW || !sourceH) return;

    const targetW = this.#opts.comparisonWidth;
    const scale = Math.min(1, targetW / sourceW);
    const targetH = Math.max(1, Math.round(sourceH * scale));
    if (this.#comparisonCanvas.width !== targetW || this.#comparisonCanvas.height !== targetH) {
      this.#comparisonCanvas.width = targetW;
      this.#comparisonCanvas.height = targetH;
    }

    const video = this.#opts.session.getVideoElementForSampling();
    if (!video) return;
    ctx.drawImage(video, 0, 0, targetW, targetH);
    const current = ctx.getImageData(0, 0, targetW, targetH);

    if (!this.#baseline) {
      this.#baseline = current;
      this.#setState("idle");
      // First-frame capture: the spec phrasing "save only meaningful
      // screen changes" is correct on the technical merits, but in
      // practice users sharing a static page got no feedback at all
      // (the engine waits for changes that may never come). Capture
      // the starting frame as a candidate so reviewers always see
      // immediate feedback + have a reference point for subsequent
      // diffs. Throttled by `#captureNow`'s `minMsBetweenCaptures`
      // gate just like every other capture — meaningful changes
      // detected within ~1.5s of start still defer politely.
      this.#captureNow(current);
      return;
    }

    // Source dimensions changed (user resized the shared window /
    // navigated to a page with a different layout that resized the
    // viewport / DPR shifted) — `computeDiffScore` would throw on
    // mismatched dimensions and `#tick`'s try / catch would swallow
    // it silently, leaving the engine paralysed (every subsequent
    // tick throws against the same stale baseline → no captures
    // ever land). Reset the baseline + capture the new view as a
    // fresh starting point.
    if (this.#baseline.width !== current.width || this.#baseline.height !== current.height) {
      this.#baseline = current;
      this.#stableWaitStartedMs = null;
      this.#setState("idle");
      this.#captureNow(current);
      return;
    }

    const diff = computeDiffScore(this.#baseline, current);
    const meaningful = isMeaningfulChange(diff);

    if (!meaningful) {
      // Frame is "still". If we were waiting for stability, the
      // stable-wait timer accumulates from the moment changing
      // ended; once it crosses `stableWaitMs` we capture.
      if (this.#state === "changing" || this.#state === "stable-wait") {
        if (this.#state === "changing") {
          this.#stableWaitStartedMs = Date.now();
        }
        this.#setState("stable-wait");
        const elapsed = Date.now() - (this.#stableWaitStartedMs ?? Date.now());
        if (elapsed >= this.#opts.stableWaitMs) {
          this.#captureNow(current, diff.changedRatio);
        }
      } else {
        // Already idle and the frame matches the baseline — keep
        // baseline current so a slow-drift change still triggers.
        this.#baseline = current;
      }
      return;
    }

    if (this.#opts.ignoreCursorOnlyChanges && isCursorOnly(diff)) {
      this.#opts.onCursorIgnored?.();
      // Don't update the baseline — the next sample should still
      // detect the user's actual content change.
      this.#setState("idle");
      return;
    }

    // Meaningful change → enter `changing`, take this as the new
    // baseline so the stable-wait clock resets relative to it.
    this.#baseline = current;
    this.#stableWaitStartedMs = null;
    this.#setState("changing");
  }

  #captureNow(currentBaseline: ImageData, diffScore?: number): void {
    if (Date.now() - this.#lastCaptureMs < this.#opts.minMsBetweenCaptures) {
      // Throttle — keep state in stable-wait so we try again next tick.
      return;
    }
    const cap = this.#opts.maxCaptures ?? DEFAULT_MAX_CAPTURES;
    if (this.#opts.getCapturedCount() >= cap) {
      this.#opts.onBufferFull?.();
      this.stop();
      return;
    }

    const frame = this.#opts.session.captureFrame();
    // Fire-and-forget: the workspace's `onCaptureReady` saves via
    // `StorageProvider.saveImage`; that's async but we don't await
    // because the engine's tick should re-schedule immediately and
    // a slow disk shouldn't stall the diff loop. Failures are the
    // workspace's responsibility (logs + toast).
    void this.#opts.onCaptureReady({
      dataUrl: frame.dataUrl,
      width: frame.width,
      height: frame.height,
      diffScore,
    });
    this.#lastCaptureMs = Date.now();
    this.#baseline = currentBaseline;
    this.#stableWaitStartedMs = null;
    this.#setState("captured");
    // Quickly drop back to idle so the next tick can detect the
    // next change.
    this.#setState("idle");
  }

  #setState(next: AutoCaptureState): void {
    if (this.#state === next) return;
    this.#state = next;
    this.#opts.onStateChange?.(next);
  }
}
