import type { CaptureRect } from "@ingcreators/annot-core/utils/types";
import type { ContentBus } from "./content-bus.js";

let overlay: HTMLDivElement | null = null;
const OVERLAY_ID = "annot-overlay";

/**
 * Optional debug logger. Default is silent so the package stays
 * console-quiet by default; the host can plug in `logger.debug` when
 * it needs to trace area-selection state across content-script
 * re-injection cycles.
 */
export type AreaSelectorLog = (message: string, ...args: unknown[]) => void;

export interface StartAreaSelectionOpts {
  /** Bus the area selector posts `area-selected` / `area-cancelled`
   *  events on. Required; without it the host has no way to learn
   *  the result. */
  bus: ContentBus;
  /** Optional debug logger; defaults to a no-op. */
  log?: AreaSelectorLog;
}

export function startAreaSelection(opts: StartAreaSelectionOpts): void {
  const { bus } = opts;
  const log = opts.log ?? (() => {});
  // Idempotent entry: if a previous invocation left state behind
  // (overlay variable still set from an aborted selection, or a stray
  // overlay div in the DOM that we don't have a reference to because
  // a re-injected content-script's closure was reset), tear it down
  // before creating a fresh one. The previous `if (overlay) return;`
  // early-out silently no-op'd in those cases — visible symptom was
  // "Capture selected area does nothing on the second click" or
  // "Capture selected area does nothing after extension reload".
  log(
    "[annot/area-select] startAreaSelection invoked; previous overlay variable:",
    !!overlay,
    "stray DOM node:",
    !!document.getElementById(OVERLAY_ID),
  );
  if (overlay) {
    // Defensive: in production, `overlay` was observed to be truthy
    // BUT lacking `.remove` (TypeError seen on b.hatena.ne.jp). The
    // exact root cause hasn't been pinned (likely a minifier-collision
    // edge case where the module-level slot got reused for an unrelated
    // value across content-script re-injection cycles), but the safety
    // check is cheap and lets us recover instead of throwing through
    // the message handler.
    if (typeof (overlay as { remove?: unknown })?.remove === "function") {
      overlay.remove();
    }
    overlay = null;
  }
  // Belt-and-suspenders: if a stray overlay div exists in the DOM
  // without a JS reference (e.g. the previous content-script context
  // got torn down), remove it too. This won't restore the lost event
  // listeners, but at least the visible blocker is gone.
  document.getElementById(OVERLAY_ID)?.remove();

  overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "crosshair",
    background: "rgba(0,0,0,0.3)",
  });

  const selection = document.createElement("div");
  selection.id = "annot-selection";
  Object.assign(selection.style, {
    position: "absolute",
    border: "2px dashed #00d4ff",
    background: "transparent",
    display: "none",
    boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)",
  });
  overlay.appendChild(selection);

  const info = document.createElement("div");
  Object.assign(info.style, {
    position: "absolute",
    color: "#00d4ff",
    fontSize: "12px",
    fontFamily: "monospace",
    pointerEvents: "none",
    padding: "2px 6px",
    background: "rgba(0,0,0,0.7)",
    borderRadius: "3px",
    display: "none",
  });
  overlay.appendChild(info);

  let startX = 0;
  let startY = 0;
  let dragging = false;

  const onMouseDown = (e: MouseEvent) => {
    startX = e.clientX;
    startY = e.clientY;
    dragging = true;
    selection.style.display = "block";
    info.style.display = "block";
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    Object.assign(selection.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    info.textContent = `${w} x ${h}`;
    info.style.left = `${x}px`;
    info.style.top = `${y + h + 4}px`;
  };

  const onMouseUp = (e: MouseEvent) => {
    if (!dragging) return;
    dragging = false;

    const rect: CaptureRect = {
      x: Math.min(startX, e.clientX),
      y: Math.min(startY, e.clientY),
      width: Math.abs(e.clientX - startX),
      height: Math.abs(e.clientY - startY),
    };

    cleanup();

    if (rect.width > 5 && rect.height > 5) {
      bus.send({
        type: "area-selected",
        rect,
        dpr: window.devicePixelRatio,
      });
    } else {
      bus.send({ type: "area-cancelled" });
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      cleanup();
      bus.send({ type: "area-cancelled" });
    }
  };

  function cleanup(): void {
    overlay?.remove();
    overlay = null;
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("mouseup", onMouseUp, true);
    document.removeEventListener("keydown", onKeyDown, true);
  }

  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("keydown", onKeyDown, true);

  document.body.appendChild(overlay);
}
