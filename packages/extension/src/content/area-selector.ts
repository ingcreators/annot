import type { CaptureRect } from "@ingcreators/annot-core/utils/types";

let overlay: HTMLDivElement | null = null;

export function startAreaSelection(): void {
  if (overlay) return;

  overlay = document.createElement("div");
  overlay.id = "anno-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "crosshair",
    background: "rgba(0,0,0,0.3)",
  });

  const selection = document.createElement("div");
  selection.id = "anno-selection";
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
      left: x + "px",
      top: y + "px",
      width: w + "px",
      height: h + "px",
    });
    info.textContent = `${w} x ${h}`;
    info.style.left = x + "px";
    info.style.top = y + h + 4 + "px";
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
      chrome.runtime.sendMessage({
        type: "area-selected",
        rect,
        dpr: window.devicePixelRatio,
      });
    } else {
      chrome.runtime.sendMessage({ type: "area-cancelled" });
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      cleanup();
      chrome.runtime.sendMessage({ type: "area-cancelled" });
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
