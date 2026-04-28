/**
 * Floating progress indicator shown on the source page during scroll /
 * per-page captures and the subsequent encode pass.
 *
 * The element uses `position: fixed`, so `hideStickies()` during each
 * capture automatically sets `visibility: hidden` on it — the overlay is
 * invisible in the captured image and visible to the user between shots.
 *
 * Kept intentionally inline (no external CSS) so it works even on pages
 * that aggressively reset styles.
 */

const OVERLAY_ID = "__annot_progress_overlay__";
const STYLE_ID = "__annot_progress_style__";

export function showProgress(text: string): void {
  ensureStyle();
  let el = document.getElementById(OVERLAY_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = OVERLAY_ID;
    el.setAttribute("data-annot-ui", "1");
    el.style.cssText = [
      "position: fixed",
      "top: 12px",
      "right: 12px",
      "z-index: 2147483647",
      "background: rgba(15, 23, 48, 0.94)",
      "color: #fff",
      "padding: 10px 14px",
      "border-radius: 8px",
      "font: 500 13px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
      "box-shadow: 0 6px 24px rgba(0, 0, 0, 0.55)",
      "pointer-events: none",
      "user-select: none",
      "display: flex",
      "align-items: center",
      "gap: 10px",
      "max-width: 320px",
      "letter-spacing: 0.01em",
      "border: 1px solid rgba(124, 156, 255, 0.4)",
    ].join("; ");
    el.innerHTML =
      `<span class="__ing-spin" style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.2);border-top-color:#7c9cff;border-radius:50%;flex:0 0 auto"></span>` +
      `<span class="__ing-progress-text"></span>`;
    document.documentElement.appendChild(el);
  }
  const textEl = el.querySelector<HTMLElement>(".__ing-progress-text");
  if (textEl) textEl.textContent = text;
}

export function hideProgress(): void {
  document.getElementById(OVERLAY_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `@keyframes __ing_spin { to { transform: rotate(360deg); } } #${OVERLAY_ID} .__ing-spin { animation: __ing_spin 0.9s linear infinite; }`;
  document.documentElement.appendChild(style);
}
