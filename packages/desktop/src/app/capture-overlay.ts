/**
 * Snipping Tool-like capture overlay.
 * Shows a fullscreen overlay with the screenshot, and lets user select:
 * - "rect": draw a rectangle
 * - "window": hover to highlight windows, click to select
 * - "fullscreen": immediately returns the full image
 */

import type { CaptureResult, WindowInfo } from "@ingcreators/annot-core/utils/tauri-bridge";

export type CaptureMode = "rect" | "window" | "fullscreen";

export interface RegionResult {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Show a fullscreen overlay and let user select a region/window.
 * Returns pixel coordinates in screen space, or null if cancelled.
 */
export function showCaptureOverlay(
  screenshot: CaptureResult,
  mode: CaptureMode,
  windows?: WindowInfo[],
): Promise<RegionResult | null> {
  if (mode === "fullscreen") {
    return Promise.resolve({
      x: 0,
      y: 0,
      w: screenshot.width,
      h: screenshot.height,
    });
  }

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "capture-overlay";
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 99999;
      background: #000; cursor: crosshair;
    `;

    // Screenshot as background
    const img = document.createElement("img");
    img.src = screenshot.data_url;
    img.style.cssText = `
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      object-fit: fill;
      pointer-events: none;
      opacity: 0.75;
    `;
    overlay.appendChild(img);

    // Toolbar hint
    const hint = document.createElement("div");
    hint.style.cssText = `
      position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
      color: #fff; font: 14px sans-serif;
      background: rgba(0,0,0,0.75); padding: 8px 20px; border-radius: 8px;
      pointer-events: none; z-index: 2;
    `;
    hint.textContent =
      mode === "rect"
        ? "Drag to select area. Press Escape to cancel."
        : "Click a window to capture. Press Escape to cancel.";
    overlay.appendChild(hint);

    // Scale from CSS px to screen px
    const scaleX = screenshot.width / window.innerWidth;
    const scaleY = screenshot.height / window.innerHeight;

    function cleanup() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        cleanup();
        resolve(null);
      }
    }
    document.addEventListener("keydown", onKey);

    if (mode === "rect") {
      setupRectMode(overlay, scaleX, scaleY, cleanup, resolve);
    } else if (mode === "window") {
      setupWindowMode(overlay, scaleX, scaleY, windows || [], cleanup, resolve);
    }

    document.body.appendChild(overlay);
  });
}

function setupRectMode(
  overlay: HTMLElement,
  scaleX: number,
  scaleY: number,
  cleanup: () => void,
  resolve: (r: RegionResult | null) => void,
): void {
  const sel = document.createElement("div");
  sel.style.cssText = `
    position: absolute; border: 2px solid #00d4ff;
    background: rgba(0,212,255,0.12);
    display: none; pointer-events: none;
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.45);
  `;
  overlay.appendChild(sel);

  const info = document.createElement("div");
  info.style.cssText = `
    position: absolute; color: #00d4ff; font: 13px monospace;
    background: rgba(0,0,0,0.8); padding: 3px 8px; border-radius: 4px;
    display: none; pointer-events: none;
  `;
  overlay.appendChild(info);

  let sx = 0;
  let sy = 0;
  let dragging = false;

  overlay.addEventListener("mousedown", (e) => {
    sx = e.clientX;
    sy = e.clientY;
    dragging = true;
    sel.style.display = "block";
    info.style.display = "block";
  });

  overlay.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const x = Math.min(sx, e.clientX);
    const y = Math.min(sy, e.clientY);
    const w = Math.abs(e.clientX - sx);
    const h = Math.abs(e.clientY - sy);
    sel.style.left = `${x}px`;
    sel.style.top = `${y}px`;
    sel.style.width = `${w}px`;
    sel.style.height = `${h}px`;
    info.textContent = `${Math.round(w * scaleX)} \u00d7 ${Math.round(h * scaleY)}`;
    info.style.left = `${x}px`;
    info.style.top = `${y + h + 6}px`;
  });

  overlay.addEventListener("mouseup", (e) => {
    if (!dragging) return;
    dragging = false;
    const x = Math.min(sx, e.clientX);
    const y = Math.min(sy, e.clientY);
    const w = Math.abs(e.clientX - sx);
    const h = Math.abs(e.clientY - sy);
    cleanup();
    if (w > 5 && h > 5) {
      resolve({
        x: Math.round(x * scaleX),
        y: Math.round(y * scaleY),
        w: Math.round(w * scaleX),
        h: Math.round(h * scaleY),
      });
    } else {
      resolve(null);
    }
  });
}

function setupWindowMode(
  overlay: HTMLElement,
  scaleX: number,
  scaleY: number,
  windows: WindowInfo[],
  cleanup: () => void,
  resolve: (r: RegionResult | null) => void,
): void {
  overlay.style.cursor = "pointer";

  // Highlight rect
  const highlight = document.createElement("div");
  highlight.style.cssText = `
    position: absolute; border: 3px solid #00d4ff;
    background: rgba(0,212,255,0.15);
    pointer-events: none; display: none;
    border-radius: 4px;
  `;
  overlay.appendChild(highlight);

  const label = document.createElement("div");
  label.style.cssText = `
    position: absolute; color: #fff; font: 12px sans-serif;
    background: rgba(0,100,200,0.85); padding: 3px 10px; border-radius: 4px;
    pointer-events: none; display: none; white-space: nowrap;
  `;
  overlay.appendChild(label);

  // Convert window positions to CSS px
  const cssWindows = windows.map((w) => ({
    ...w,
    cx: w.x / scaleX,
    cy: w.y / scaleY,
    cw: w.width / scaleX,
    ch: w.height / scaleY,
  }));

  let hoveredIdx = -1;

  overlay.addEventListener("mousemove", (e) => {
    const mx = e.clientX;
    const my = e.clientY;
    // Find topmost window under cursor (first in list = topmost)
    let found = -1;
    for (let i = 0; i < cssWindows.length; i++) {
      // Loop bound matches array length; `[i]` always defined.
      const w = cssWindows[i]!;
      if (mx >= w.cx && mx <= w.cx + w.cw && my >= w.cy && my <= w.cy + w.ch) {
        found = i;
        break;
      }
    }

    if (found !== hoveredIdx) {
      hoveredIdx = found;
      if (found >= 0) {
        // `found` came from a valid loop index above.
        const w = cssWindows[found]!;
        highlight.style.left = `${w.cx}px`;
        highlight.style.top = `${w.cy}px`;
        highlight.style.width = `${w.cw}px`;
        highlight.style.height = `${w.ch}px`;
        highlight.style.display = "block";
        label.textContent = w.title;
        label.style.left = `${w.cx}px`;
        label.style.top = `${Math.max(0, w.cy - 28)}px`;
        label.style.display = "block";
      } else {
        highlight.style.display = "none";
        label.style.display = "none";
      }
    }
  });

  overlay.addEventListener("click", () => {
    if (hoveredIdx < 0) return;
    // `hoveredIdx` was assigned from the same loop iteration where
    // `cssWindows` and `windows` are 1:1.
    const w = windows[hoveredIdx]!;
    cleanup();
    resolve({ x: w.x, y: w.y, w: w.width, h: w.height });
  });
}
