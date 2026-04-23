/**
 * Hide/restore page chrome before capture:
 *   - `fixed` / `sticky` elements (optional whitelist via preservedSelectors)
 *   - browser scrollbars (via injected CSS)
 */

const hiddenElements: Map<HTMLElement, { visibility: string }> = new Map();
const SCROLLBAR_STYLE_ID = "__annot_hide_scrollbar__";

export interface HidePrefs {
  overlays: boolean;
  preservedSelectors: string[];
  scrollbars: boolean;
}

export function hideForCapture(prefs: HidePrefs): void {
  // Overlays: re-apply fresh each call so segment N's state is authoritative
  // (e.g. segment 0 keeps them, segment 1 hides them when `keepFirstSegment`
  // is enabled). `hideStickies` clears any previous state internally.
  if (prefs.overlays) {
    hideStickies(prefs.preservedSelectors);
  } else {
    restoreStickies();
  }
  // Always hide OUR progress overlay so it never appears in captured
  // images — even on keepFirstSegment segment 0 where user overlays stay.
  forceHideOwnOverlay();
  if (prefs.scrollbars) {
    hideScrollbars();
  } else {
    restoreScrollbars();
  }
}

export function restoreAfterCapture(): void {
  restoreStickies();
  restoreOwnOverlay();
  restoreScrollbars();
}

// ---- Our own progress overlay — always hidden during capture ----
//
// We use `display: none` (not `visibility: hidden`) so the element is
// removed from the render tree entirely. This matters because
// `chrome.tabs.captureVisibleTab` can sometimes capture a frame that was
// already in the compositor pipeline before the style change landed;
// `display: none` forces layout / paint invalidation so Chrome can't
// deliver a stale frame with the overlay still visible.

const PROGRESS_OVERLAY_ID = "__annot_progress_overlay__";
const HIDDEN_MARKER = "data-annot-hidden";

function forceHideOwnOverlay(): void {
  const el = document.getElementById(PROGRESS_OVERLAY_ID);
  if (!el) return;
  el.setAttribute(HIDDEN_MARKER, el.style.display || "");
  el.style.display = "none";
  // Read a layout property to force synchronous style/layout commit so
  // the change can't be deferred past the upcoming captureVisibleTab.
  void el.offsetWidth;
}

function restoreOwnOverlay(): void {
  const el = document.getElementById(PROGRESS_OVERLAY_ID);
  if (!el) return;
  if (el.hasAttribute(HIDDEN_MARKER)) {
    const prev = el.getAttribute(HIDDEN_MARKER) || "";
    el.style.display = prev;
    el.removeAttribute(HIDDEN_MARKER);
  } else {
    el.style.display = "";
  }
}

// ---- Stickies / fixed overlays ----

export function hideStickies(preservedSelectors: string[] = []): void {
  restoreStickies(); // clear any previous state
  const shouldPreserve = buildPreserveMatcher(preservedSelectors);
  const all = document.querySelectorAll<HTMLElement>("*");
  for (const el of all) {
    if (shouldPreserve(el)) continue;
    const style = getComputedStyle(el);
    if (style.position === "fixed" || style.position === "sticky") {
      hiddenElements.set(el, { visibility: el.style.visibility });
      el.style.visibility = "hidden";
    }
  }
}

export function restoreStickies(): void {
  for (const [el, original] of hiddenElements) {
    el.style.visibility = original.visibility;
  }
  hiddenElements.clear();
}

function buildPreserveMatcher(selectors: string[]): (el: HTMLElement) => boolean {
  if (selectors.length === 0) return () => false;
  // Join selectors so `matches()` is a single call; if any individual
  // selector is invalid, fall back to a matcher that tries each separately.
  const joined = selectors.join(", ");
  try {
    document.createElement("div").matches(joined);
    return (el) => {
      try { return el.matches(joined); } catch { return false; }
    };
  } catch {
    return (el) => {
      for (const sel of selectors) {
        try { if (el.matches(sel)) return true; } catch { /* skip invalid */ }
      }
      return false;
    };
  }
}

// ---- Scrollbars ----

export function hideScrollbars(): void {
  if (document.getElementById(SCROLLBAR_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SCROLLBAR_STYLE_ID;
  style.textContent = `
    html::-webkit-scrollbar,
    body::-webkit-scrollbar,
    *::-webkit-scrollbar {
      width: 0 !important;
      height: 0 !important;
      background: transparent !important;
    }
    html, body {
      -ms-overflow-style: none !important;
      scrollbar-width: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

export function restoreScrollbars(): void {
  document.getElementById(SCROLLBAR_STYLE_ID)?.remove();
}
