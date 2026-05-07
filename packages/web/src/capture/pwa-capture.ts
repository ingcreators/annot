/// <reference path="../types/document-pip.d.ts" />

/**
 * PWA capture methods — alternatives to Chrome Extension capture.
 * Works without any extension installed.
 */

/** Cursor visibility for screen capture. */
export type CursorMode = "always" | "motion" | "never";

/**
 * Capture screen via getDisplayMedia API.
 * Shows browser's screen/window/tab picker dialog.
 * Returns a data URL of the captured frame, or null if cancelled.
 */
export async function captureScreen(cursor: CursorMode = "always"): Promise<string | null> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor } as MediaTrackConstraints,
    });

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    // Wait for video to be ready with actual frame data
    await new Promise<void>((resolve) => {
      video.onloadeddata = () => resolve();
      video.play();
    });

    // Wait extra frames to ensure a real frame is rendered
    await new Promise((r) => setTimeout(r, 200));

    // Use video's actual dimensions (not track settings which can be wrong)
    const w = video.videoWidth;
    const h = video.videoHeight;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, w, h);

    // Stop all tracks immediately after capture
    stream.getTracks().forEach((t) => t.stop());

    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return null;
  }
}

/**
 * Read image from clipboard.
 * Returns a data URL, or null if no image in clipboard.
 */
export async function pasteFromClipboard(): Promise<string | null> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith("image/")) {
          const blob = await item.getType(type);
          return new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Phase 2 of `docs/plans/host-convergence.md` lifted
// `isScreenCaptureSupported` / `isClipboardReadSupported` into
// `@ingcreators/annot-editor-shell/capture-predicates` so the
// gallery (now in editor-shell) can import them without reaching
// back into `@ingcreators/annot-web`. The runtime entry points
// below (`captureScreen`, `pasteFromClipboard`,
// `startIntervalCapture`, the PiP overlay) stay PWA-side.

/** Control handle returned by startIntervalCapture. */
export interface IntervalCaptureHandle {
  /** Cancel remaining captures and stop the underlying media stream. */
  cancel: () => void;
  /** Promise that resolves when all frames are captured (or cancelled). */
  done: Promise<void>;
}

export interface IntervalCaptureOptions {
  /** Number of seconds between captures. */
  intervalSec: number;
  /** Total number of frames to capture. */
  count: number;
  /** Cursor visibility in captured frames. Defaults to "always". */
  cursor?: CursorMode;
  /** Called once per captured frame with (dataUrl, index, total). */
  onFrame: (dataUrl: string, index: number, total: number) => void | Promise<void>;
  /** Optional progress callback (captured so far, total). */
  onProgress?: (captured: number, total: number) => void;
  /** Optional error callback. */
  onError?: (err: unknown) => void;
}

/**
 * Start interval-based screen capture. The user approves getDisplayMedia once;
 * the media stream is kept alive and frames are grabbed at each interval.
 *
 * Returns a handle with `cancel()` to stop early and `done` promise that
 * resolves when the full sequence completes (or is cancelled).
 *
 * Note: if the user clicks the browser's "Stop sharing" button mid-sequence,
 * remaining captures are aborted automatically.
 */
/** Interface implemented by both in-tab and PiP overlays. */
interface CaptureOverlay {
  update(captured: number, total: number, nextInMs: number): void;
  hide(): void;
  show(): void;
  close(): void;
}

/** Create a floating overlay. Prefers Document PiP for always-on-top visibility. */
async function createCaptureOverlay(): Promise<CaptureOverlay> {
  const dpip = window.documentPictureInPicture;
  if (dpip) {
    try {
      const pip = await dpip.requestWindow({ width: 260, height: 110 });
      return mountOverlay(pip.document, true, () => pip.close());
    } catch {
      // Fall through to in-tab overlay
    }
  }
  return mountOverlay(document, false, null);
}

function mountOverlay(
  doc: Document,
  isPip: boolean,
  onCloseHost: (() => void) | null,
): CaptureOverlay {
  const root = doc.createElement("div");
  root.className = `capture-overlay${isPip ? " capture-overlay-pip" : ""}`;

  // Inline styles so the element stays self-contained inside a PiP document.
  // `Object.assign` against CSSStyleDeclaration's typed surface accepts
  // the property bag straight; the previous `as any` was leftover from
  // before lib.dom narrowed the indexer.
  Object.assign(root.style, {
    position: isPip ? "fixed" : "fixed",
    top: isPip ? "0" : "auto",
    left: isPip ? "0" : "auto",
    right: isPip ? "0" : "20px",
    bottom: isPip ? "0" : "20px",
    background: "rgba(15,23,48,0.92)",
    color: "#eef2ff",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    borderRadius: isPip ? "0" : "12px",
    padding: "14px 18px",
    minWidth: "220px",
    boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
    border: "1px solid rgba(255,255,255,0.12)",
    zIndex: "2147483647",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    transition: "opacity 0.1s",
    pointerEvents: "none",
    height: isPip ? "100%" : "auto",
    boxSizing: "border-box",
    justifyContent: "center",
  });

  const countEl = doc.createElement("div");
  Object.assign(countEl.style, {
    fontSize: "15px",
    fontWeight: "600",
    letterSpacing: "0.02em",
  });
  root.appendChild(countEl);

  const nextEl = doc.createElement("div");
  Object.assign(nextEl.style, {
    fontSize: "12px",
    color: "#b7c0e0",
  });
  root.appendChild(nextEl);

  const bar = doc.createElement("div");
  Object.assign(bar.style, {
    height: "4px",
    background: "rgba(255,255,255,0.12)",
    borderRadius: "2px",
    overflow: "hidden",
    marginTop: "2px",
  });
  const fill = doc.createElement("div");
  Object.assign(fill.style, {
    height: "100%",
    width: "0%",
    background: "#7c9cff",
    transition: "width 0.25s ease",
  });
  bar.appendChild(fill);
  root.appendChild(bar);

  doc.body.appendChild(root);

  return {
    update(captured: number, total: number, nextInMs: number) {
      countEl.textContent = `Captured ${captured} / ${total}`;
      if (captured < total) {
        const sec = Math.max(0, Math.ceil(nextInMs / 1000));
        nextEl.textContent = `Next capture in ${sec}s`;
      } else {
        nextEl.textContent = "Finishing...";
      }
      fill.style.width = `${Math.min(100, Math.round((captured / total) * 100))}%`;
    },
    hide() {
      root.style.visibility = "hidden";
    },
    show() {
      root.style.visibility = "visible";
    },
    close() {
      try {
        root.remove();
      } catch {
        /* ignore */
      }
      if (onCloseHost) {
        try {
          onCloseHost();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

export async function startIntervalCapture(
  opts: IntervalCaptureOptions,
): Promise<IntervalCaptureHandle | null> {
  const { intervalSec, count, cursor = "always", onFrame, onProgress, onError } = opts;
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) throw new Error("intervalSec must be > 0");
  if (!Number.isInteger(count) || count <= 0) throw new Error("count must be a positive integer");

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor } as MediaTrackConstraints,
    });
  } catch {
    return null;
  }

  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;

  await new Promise<void>((resolve) => {
    video.onloadeddata = () => resolve();
    video.play();
  });

  // Build overlay after share is approved (so it doesn't block user interaction)
  let overlay: CaptureOverlay | null = null;
  try {
    overlay = await createCaptureOverlay();
  } catch {
    /* continue without overlay */
  }

  let cancelled = false;
  let captured = 0;
  let timer: number | undefined;
  let tickTimer: number | undefined;
  let nextCaptureAt = Date.now() + 300;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const cleanup = () => {
    if (cancelled) return;
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
    if (tickTimer !== undefined) clearInterval(tickTimer);
    stream.getTracks().forEach((t) => t.stop());
    overlay?.close();
    resolveDone();
  };

  // Stop early if the user clicks "Stop sharing" in the browser UI.
  stream.getVideoTracks().forEach((t) => {
    t.addEventListener("ended", () => {
      if (!cancelled) cleanup();
    });
  });

  // Live countdown — updates every 200ms
  tickTimer = window.setInterval(() => {
    if (cancelled) return;
    overlay?.update(captured, count, nextCaptureAt - Date.now());
  }, 200);

  const grabFrame = async (): Promise<string> => {
    // Hide overlay so it does not appear in the captured frame.
    overlay?.hide();
    // Allow the video stream to reflect the unobscured view.
    // Two rAFs + short delay: modern browsers need ~50-100ms for the MediaStream to catch up.
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    await new Promise((r) => setTimeout(r, 120));

    const w = video.videoWidth;
    const h = video.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

    overlay?.show();
    return dataUrl;
  };

  const captureNext = async () => {
    if (cancelled) return;
    try {
      const dataUrl = await grabFrame();
      captured++;
      onProgress?.(captured, count);
      overlay?.update(captured, count, intervalSec * 1000);
      await onFrame(dataUrl, captured - 1, count);
    } catch (e) {
      onError?.(e);
    }
    if (!cancelled && captured < count) {
      nextCaptureAt = Date.now() + intervalSec * 1000;
      timer = window.setTimeout(captureNext, intervalSec * 1000);
    } else {
      cleanup();
    }
  };

  overlay?.update(0, count, nextCaptureAt - Date.now());
  // Small initial delay so first frame reflects a settled window
  timer = window.setTimeout(captureNext, 300);

  return { cancel: cleanup, done };
}
