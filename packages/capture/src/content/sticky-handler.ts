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
  // Each helper is wrapped in its own try-catch so a failure in one
  // (e.g. a page with weird DOM that breaks `restoreStickies`)
  // doesn't abort the others. Earlier sequential calls left
  // scrollbars hidden if `restoreOwnOverlay` threw mid-flow,
  // because the subsequent `restoreScrollbars()` never ran.
  try {
    restoreStickies();
  } catch (err) {
    console.error("[annot] restoreStickies failed:", err);
  }
  try {
    restoreOwnOverlay();
  } catch (err) {
    console.error("[annot] restoreOwnOverlay failed:", err);
  }
  try {
    restoreScrollbars();
  } catch (err) {
    console.error("[annot] restoreScrollbars failed:", err);
  }
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
      try {
        return el.matches(joined);
      } catch {
        return false;
      }
    };
  } catch {
    return (el) => {
      for (const sel of selectors) {
        try {
          if (el.matches(sel)) return true;
        } catch {
          /* skip invalid */
        }
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
  // Keep the scrollbar gutter reserved at its intrinsic OS width and
  // paint thumb / track / arrows transparent. On Windows / Linux Chrome
  // (classic, gutter-occupying scrollbars), collapsing the gutter with
  // `width: 0` / `scrollbar-width: none` widens the viewport ~15px
  // mid-capture and shows a layout-flash. Transparency keeps the
  // intrinsic geometry so layout is undisturbed; the gutter shows the
  // html element's background through, which is the same color the
  // browser would paint immediately adjacent to the scrollbar anyway.
  style.textContent = `
    html::-webkit-scrollbar,
    body::-webkit-scrollbar,
    *::-webkit-scrollbar {
      background: transparent !important;
    }
    html::-webkit-scrollbar-thumb,
    body::-webkit-scrollbar-thumb,
    *::-webkit-scrollbar-thumb {
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
    }
    html::-webkit-scrollbar-track,
    body::-webkit-scrollbar-track,
    *::-webkit-scrollbar-track {
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
    }
    html::-webkit-scrollbar-button,
    body::-webkit-scrollbar-button,
    *::-webkit-scrollbar-button {
      background: transparent !important;
      display: none !important;
    }
    html::-webkit-scrollbar-corner,
    body::-webkit-scrollbar-corner,
    *::-webkit-scrollbar-corner {
      background: transparent !important;
    }
    html, body {
      scrollbar-color: transparent transparent !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

export function restoreScrollbars(): void {
  // Primary path: remove by id from the top-level document.
  const el = document.getElementById(SCROLLBAR_STYLE_ID);
  if (el) {
    el.remove();
  }
  // Defensive: scan the entire document for any leftover element
  // with the same id. Covers pathological pages where a
  // MutationObserver / runtime DOM rewriter moved or cloned the
  // node (we've seen this on react-renderer-heavy SPAs that snapshot
  // the head and re-apply it after layout settles). querySelectorAll
  // returns an empty NodeList when no matches — the loop short-
  // circuits naturally on the common path.
  for (const stale of document.querySelectorAll(`#${SCROLLBAR_STYLE_ID}`)) {
    stale.remove();
  }
  // Force a synchronous reflow so the browser drops any cached
  // scrollbar visibility state from the CSSOM. Reading `offsetHeight`
  // flushes pending layout. Some Chrome versions (observed on dev
  // builds) leave the scrollbar gutter mid-paint when a `<style>`
  // with `::-webkit-scrollbar` rules is removed without an
  // additional layout trigger.
  void document.documentElement.offsetHeight;
}
