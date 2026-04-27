/**
 * page-metadata — DOM structure extraction for screenshot annotations.
 *
 * Called by the content script right before a capture fires. Walks the
 * DOM, filters to INTERACTIVE / LABELED elements (buttons, links,
 * inputs, form labels, headings, anything with an ARIA role), and
 * produces a flat list with text + bounding boxes. The editor later
 * uses this list to offer one-click "box the Submit button" style
 * annotations.
 *
 * Why only interactive elements:
 *   - A full DOM dump would be massive (5k+ elements on complex pages)
 *     and mostly noise (divs, spans).
 *   - Users want to annotate the things users CLICK or TYPE on —
 *     which are exactly the interactive elements.
 *   - Labels + headings add context for orientation.
 *
 * Coordinate system:
 *   - bbox is in CSS pixels, DOCUMENT space (not viewport).
 *   - Document coords = page top-left is (0, 0); scroll doesn't move
 *     the frame. This is what you get from
 *     `getBoundingClientRect().top + window.scrollY`.
 *   - The screenshot is in DEVICE pixels; consumers multiply by DPR.
 */

import type { PageElement, PageMetadata } from "@ingcreators/annot-core";

/** Upper bound on elements collected. Protects against pathological
 *  pages (e.g. 10k-row tables). User-visible symptom of hitting the
 *  cap would be "some elements missing from the sidebar" — acceptable. */
const MAX_ELEMENTS = 2000;

/** Minimum bbox area (CSS px²) to include. Filters out zero-sized
 *  elements (display:none children missed by visibility check,
 *  tracking pixels, etc.). */
const MIN_AREA = 16;

/** Optional: the area within the current viewport that the
 *  screenshot will cover. CSS pixels, viewport coords (NOT doc).
 *  When omitted, the metadata's `captureRect` is set to the full
 *  viewport — appropriate for visible-tab captures. For area
 *  captures the service worker passes the user-selected rect so
 *  the editor can correctly filter / position elements. */
export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Traverse the document + return a PageMetadata snapshot. Safe to
 *  call from a content script at any time — purely read-only.
 *  `region` (optional, viewport coords) limits what's considered
 *  "in the screenshot" so area captures don't end up listing
 *  off-frame elements with garbage coordinates in the editor. */
export function capturePageMetadata(region?: CaptureRegion): PageMetadata {
  // Pre-walk: touch every potentially-interactive element's
  // `getBoundingClientRect()` once before the real walk. This forces
  // Chrome to lay out each one INDIVIDUALLY, which is the documented
  // way to "unskip" `content-visibility: auto` descendants — body-
  // level offsetHeight reads (Chrome's usual "force sync layout"
  // trick) DON'T propagate into auto-skipped subtrees.
  //
  // Without this, `serializeElement`'s `getBoundingClientRect()`
  // calls return 0×0 for every descendant of an auto-skipped card
  // and the `width * height < MIN_AREA` check filters them all out.
  // Empirical proof on b.hatena.ne.jp (viewport 1198×1305, no
  // emulation): 1326 interactive elements visible to a page-side
  // diagnostic, 0 elements surviving the walker without this
  // pre-pass; ~950 elements after.
  //
  // Cost: one extra DOM walk + bbox read per interactive element
  // (~5ms for 1k elements on a typical page). Well under the
  // ~400 ms capture-prep delay the user is already paying.
  const interactiveSelector =
    "a,button,input,select,textarea,label,h1,h2,h3,h4,h5,h6,[role],[tabindex],[contenteditable]";
  const interactiveCandidates = document.querySelectorAll(interactiveSelector);
  for (const candidate of interactiveCandidates) {
    void (candidate as HTMLElement).getBoundingClientRect();
  }
  const elements: PageElement[] = [];
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  let idCounter = 0;

  // Document-coord rectangle that the SCREENSHOT will actually cover.
  // - No region    → full viewport at current scroll position.
  // - With region  → the area within the viewport, offset by scroll.
  const captureRect = region
    ? {
        x: region.x + scrollX,
        y: region.y + scrollY,
        width: region.width,
        height: region.height,
      }
    : {
        x: scrollX,
        y: scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
      };

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      const el = node as Element;
      // Skip our own UI (area selector, progress overlay, etc.) —
      // the content script marks them with this attribute.
      if (el.hasAttribute("data-annot-ui")) {
        return NodeFilter.FILTER_REJECT;
      }
      // Skip script / style / head-ish elements.
      const tag = el.tagName.toLowerCase();
      if (
        tag === "script" ||
        tag === "style" ||
        tag === "noscript" ||
        tag === "link" ||
        tag === "meta"
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return isInteresting(el) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    if (elements.length >= MAX_ELEMENTS) break;
    const el = node as HTMLElement;
    const entry = serializeElement(el, idCounter++, scrollX, scrollY);
    if (entry) elements.push(entry);
  }

  return {
    version: 1,
    url: location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio || 1,
    scrollOffset: { x: scrollX, y: scrollY },
    captureRect,
    capturedAt: new Date().toISOString(),
    elements,
  };
}

/** Robust visibility check — returns true iff the element is
 *  actually rendered AND on the visible canvas (not tucked off-
 *  screen by a translate trick, not collapsed, not display:none).
 *
 *  Why this matters: pages routinely keep many inactive widgets
 *  in the DOM (closed modals, hidden tooltips, mega-menus, cookie
 *  banners that have been dismissed, off-screen carousel slides).
 *  Including them in the sidebar would (a) clutter the list with
 *  ghost rows the user can't see in the screenshot and (b) map
 *  to garbage coordinates when annotated.
 *
 *  IMPORTANT: aria-hidden ANCESTOR check is intentionally NOT
 *  performed here. Many SPAs / design systems wrap large sections
 *  in `aria-hidden="true"` decorative containers (e.g. icon
 *  wrappers, decorative SVGs); using `closest('[aria-hidden]')`
 *  would over-filter and drop perfectly visible interactive
 *  controls. We rely on the actual rendered visibility (display,
 *  visibility, opacity, bbox) which catches the intended hidden
 *  cases without false positives. The element's OWN
 *  `aria-hidden="true"` is still respected.
 *
 *  All checks wrapped in try/catch — defensive against pages that
 *  override DOM methods or throw inside getComputedStyle (rare,
 *  but observed in some heavily-customized React apps). */
function isVisuallyOnScreen(el: HTMLElement): boolean {
  try {
    // Element's OWN aria-hidden — explicit "this is not for users".
    if (el.getAttribute("aria-hidden") === "true") return false;

    // Native visibility check — walks the ANCESTOR chain for us, so
    // an overlay kept in the DOM but hidden via `visibility: hidden`
    // or `opacity: 0` higher up the tree (common for hover mega-menus
    // / closed modals / "will animate in" panels) is correctly
    // rejected. Without this, sites like Kewpie's nav — which
    // pre-renders its dropdown panel with opacity:0 and fades it in
    // on hover — would dump every link in the hidden menu into our
    // metadata, even though those links don't appear in the actual
    // screenshot.
    //
    // checkVisibility is Chrome 105+ / Firefox 125+; absence is
    // treated as "unknown" and we fall through to the manual checks
    // below.
    //
    // `contentVisibilityAuto: true` is INTENTIONALLY OMITTED.
    // Long content sites (b.hatena.ne.jp/hotentry/it, news feeds,
    // infinite-scroll listings) increasingly mark every card with
    // `content-visibility: auto`, so the browser can skip rendering
    // descendants that are not currently in the viewport. With the
    // strict flag set, `checkVisibility` reports those skipped
    // descendants as "not visible" — even though they are real DOM
    // nodes the user can scroll to and that belong in the Elements
    // panel. Empirically this zeroed the Elements list on
    // b.hatena.ne.jp (1337 walker-accepted interactive elements,
    // ALL filtered out by the strict flag); without it, 958
    // elements survive and the panel populates correctly.
    //
    // The over-filter protection the original intent was about —
    // "an overlay kept in the DOM but hidden via visibility:hidden
    // / opacity:0 higher up the tree" — still works through
    // `checkVisibilityCSS: true` and `checkOpacity: true`, which
    // walk the ancestor chain for those properties.
    if (typeof el.checkVisibility === "function") {
      const visible = el.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      } as CheckVisibilityOptions);
      if (!visible) return false;
    } else {
      // Fallback — own-element checks only, same as before.
      const style = window.getComputedStyle(el);
      if (style.display === "none") return false;
      if (style.visibility === "hidden" || style.visibility === "collapse") return false;
      if (Number.parseFloat(style.opacity || "1") <= 0.05) return false;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width * rect.height < MIN_AREA) return false;
    // Tucked off-screen (translate(-9999px) etc.). Doc + viewport
    // sanity bounds — anything more than ~5000 px outside the
    // document bbox is almost certainly an off-screen hide trick
    // rather than a legitimate scroll-into-view target.
    const docW = Math.max(document.documentElement.scrollWidth, window.innerWidth);
    const docH = Math.max(document.documentElement.scrollHeight, window.innerHeight);
    if (rect.right < -5000 || rect.left > docW + 5000) return false;
    if (rect.bottom < -5000 || rect.top > docH + 5000) return false;
    return true;
  } catch {
    // If anything throws, default to INCLUDING the element rather
    // than excluding — over-inclusion is fixable in the editor (the
    // captureRect filter strips off-frame items), under-inclusion
    // means the user can't reach the element from the sidebar.
    return true;
  }
}

/** Is the element one we want to surface to the user? Focuses on
 *  interactive controls + anything carrying semantic text labels. */
function isInteresting(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "button":
    case "a":
    case "input":
    case "select":
    case "textarea":
    case "label":
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return true;
  }
  // Explicit ARIA role counts too — captures custom buttons / links
  // / tabs / menuitems built from <div>s.
  const role = el.getAttribute("role");
  if (
    role &&
    /^(button|link|tab|menuitem|checkbox|radio|switch|textbox|combobox|searchbox|option|treeitem|slider|spinbutton)$/.test(
      role,
    )
  ) {
    return true;
  }
  // Any element explicitly in the tab order is interactive.
  if (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") {
    return true;
  }
  // `contenteditable` surfaces rich-text editors.
  if ((el as HTMLElement).isContentEditable && el.getAttribute("contenteditable") !== "inherit") {
    return true;
  }
  return false;
}

/** Build a PageElement from a DOM element. Returns null if the
 *  element is invisible / off-screen / explicitly aria-hidden —
 *  those aren't useful to annotate (would clutter the sidebar with
 *  ghost rows that map to garbage screenshot coords). */
function serializeElement(
  el: HTMLElement,
  seq: number,
  scrollX: number,
  scrollY: number,
): PageElement | null {
  if (!isVisuallyOnScreen(el)) return null;
  const rect = el.getBoundingClientRect();

  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role") || implicitRole(el) || undefined;
  const text = extractText(el);
  const ariaLabel = el.getAttribute("aria-label") || undefined;
  const domId = el.id || undefined;
  const selector = cssSelector(el);

  // Input-specific extras
  let inputType: string | undefined;
  let placeholder: string | undefined;
  if (tag === "input") {
    inputType = (el as HTMLInputElement).type || "text";
    placeholder = (el as HTMLInputElement).placeholder || undefined;
  } else if (tag === "textarea") {
    placeholder = (el as HTMLTextAreaElement).placeholder || undefined;
  }

  // Link-specific extras
  let href: string | undefined;
  if (tag === "a") {
    href = (el as HTMLAnchorElement).href || undefined;
  }

  return {
    id: `e${seq}`,
    tag,
    role,
    text,
    ariaLabel,
    inputType,
    placeholder,
    href,
    domId,
    bbox: [
      Math.round(rect.left + scrollX),
      Math.round(rect.top + scrollY),
      Math.round(rect.width),
      Math.round(rect.height),
    ],
    selector,
    visible: true,
  };
}

/** Best-effort extraction of the "visible text" for this element.
 *  For inputs / selects, falls back to value / associated label. */
function extractText(el: HTMLElement): string | undefined {
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    const input = el as HTMLInputElement;
    // For buttons, the "text" is the value attribute
    if (input.type === "submit" || input.type === "button" || input.type === "reset") {
      return input.value || undefined;
    }
    // For other input types, don't expose the VALUE (may be sensitive)
    // — just use the associated label text if available.
    return labelFor(input) || undefined;
  }
  if (tag === "textarea") {
    return labelFor(el as HTMLTextAreaElement) || undefined;
  }
  if (tag === "select") {
    const sel = el as HTMLSelectElement;
    return sel.options[sel.selectedIndex]?.text || labelFor(sel) || undefined;
  }
  // For everything else, use textContent trimmed + collapsed.
  const raw = (el.textContent || "").trim().replace(/\s+/g, " ");
  if (!raw) return undefined;
  // Clip very long text so sidebar rows stay compact — users can
  // always see the full text via tooltip on hover.
  return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
}

/** Find the <label> associated with a form control. Supports both the
 *  "label-for" pattern (<label for="x">) and the "wrapped" pattern
 *  (<label><input>...</label>). Returns the label's text content. */
function labelFor(input: HTMLElement): string | null {
  const id = input.id;
  if (id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (lbl?.textContent) return lbl.textContent.trim().replace(/\s+/g, " ");
  }
  const parent = input.closest("label");
  if (parent?.textContent) return parent.textContent.trim().replace(/\s+/g, " ");
  return null;
}

/** Implicit ARIA role for the common HTML tags we care about. Spec
 *  has a longer list; we cover the cases that appear in isInteresting. */
function implicitRole(el: HTMLElement): string | null {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "button":
      return "button";
    case "a":
      return (el as HTMLAnchorElement).href ? "link" : null;
    case "input": {
      const t = (el as HTMLInputElement).type;
      if (t === "button" || t === "submit" || t === "reset") return "button";
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "range") return "slider";
      if (t === "search") return "searchbox";
      return "textbox";
    }
    case "textarea":
      return "textbox";
    case "select":
      return "combobox";
    case "label":
      return null;
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
  }
  return null;
}

/** Build a short-ish CSS selector for the element. Prefers id, then
 *  stable attrs, then nth-of-type chain. Not guaranteed unique across
 *  arbitrary pages; best-effort for re-highlighting on reload / page
 *  state change. */
function cssSelector(el: Element): string {
  if (el.id) {
    // IDs can contain characters that need escaping in selectors.
    return `#${CSS.escape(el.id)}`;
  }
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 6) {
    let part = cur.tagName.toLowerCase();
    // Add data-testid / data-test-id if present — the standard hook
    // automated tests use, great stability.
    const testId = cur.getAttribute("data-testid") || cur.getAttribute("data-test-id");
    if (testId) {
      part += `[data-testid="${CSS.escape(testId)}"]`;
      parts.unshift(part);
      break;
    }
    // nth-of-type chain for stability.
    if (cur.parentElement) {
      const siblings = Array.from(cur.parentElement.children).filter(
        (c) => c.tagName === cur!.tagName,
      );
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
      }
    }
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return parts.join(" > ") || el.tagName.toLowerCase();
}
