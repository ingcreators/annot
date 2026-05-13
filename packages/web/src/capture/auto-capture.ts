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

import { newIdB58 } from "@ingcreators/annot-core/utils";
import type { CandidateStore } from "./candidate-store.js";
import type { CaptureSession } from "./capture-session.js";
import { computeDiffScore, isCursorOnly, isMeaningfulChange } from "./diff-detection.js";
import type { AutoCaptureState, CaptureCandidate } from "./types.js";

export interface AutoCaptureOptions {
  session: CaptureSession;
  store: CandidateStore;
  intervalMs: number;
  stableWaitMs: number;
  minMsBetweenCaptures: number;
  comparisonWidth: number;
  ignoreCursorOnlyChanges: boolean;
  /** Notified on every state transition + when a candidate lands.
   *  The workspace renders these as the spec §8.4 status copy. */
  onStateChange?: (state: AutoCaptureState) => void;
  /** Notified once a meaningful change is classified as cursor-only
   *  and dropped. Workspace surfaces this as a transient
   *  "Ignored cursor-only movement" status. */
  onCursorIgnored?: () => void;
  /** Maximum number of candidates the store should hold. The engine
   *  pauses on its own when this is reached so the workspace can
   *  show its "buffer full" info bar. The cap matches the
   *  workspace's `MAX_CANDIDATES` so both layers agree on the
   *  threshold. */
  maxCandidates?: number;
  /** Notified when the engine pauses because the candidate buffer
   *  hit `maxCandidates`. */
  onBufferFull?: () => void;
}

const DEFAULT_MAX_CANDIDATES = 200;

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
          this.#captureNow(current);
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

  #captureNow(currentBaseline: ImageData): void {
    if (Date.now() - this.#lastCaptureMs < this.#opts.minMsBetweenCaptures) {
      // Throttle — keep state in stable-wait so we try again next tick.
      return;
    }
    const cap = this.#opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
    if (this.#opts.store.size >= cap) {
      this.#opts.onBufferFull?.();
      this.stop();
      return;
    }

    const frame = this.#opts.session.captureFrame();
    const blob = dataUrlToBlob(frame.dataUrl);
    const candidate: CaptureCandidate = {
      id: newIdB58(),
      status: "candidate",
      createdAt: new Date().toISOString(),
      sourceWidth: frame.width,
      sourceHeight: frame.height,
      imageBlob: blob,
      thumbnailDataUrl: frame.dataUrl,
    };
    this.#opts.store.add(candidate);
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

/** Decode a `data:image/...;base64,...` URL into a `Blob`. Local
 *  copy of the workspace's helper to keep this module independent. */
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
