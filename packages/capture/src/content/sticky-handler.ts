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
  // DIAGNOSTIC LOGS — narrowing which of the three restore helpers
  // throws (the "AFTER restore" log was missing in the user's repro,
  // proving one of them aborts mid-flow). Will be removed once the
  // root cause is identified.
  console.log("[annot] restoreAfterCapture called");
  const before = document.getElementById(SCROLLBAR_STYLE_ID);
  console.log("[annot] scrollbar style element BEFORE restore:", before);
  try {
    restoreStickies();
    console.log("[annot] restoreStickies OK");
  } catch (e) {
    console.error("[annot] restoreStickies THREW:", e);
  }
  try {
    restoreOwnOverlay();
    console.log("[annot] restoreOwnOverlay OK");
  } catch (e) {
    console.error("[annot] restoreOwnOverlay THREW:", e);
  }
  try {
    restoreScrollbars();
    console.log("[annot] restoreScrollbars OK");
  } catch (e) {
    console.error("[annot] restoreScrollbars THREW:", e);
  }
  const after = document.getElementById(SCROLLBAR_STYLE_ID);
  console.log("[annot] scrollbar style element AFTER restore:", after);
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
