/**
 * MAIN-world DOM walker that produces a `PageMetadata` snapshot for
 * the editor's Elements panel.
 *
 * **This function MUST stay closure-free.** The chrome host calls
 * `chrome.scripting.executeScript({ func: walkPageMetadata, world:
 * "MAIN", args: [region] })`, which serializes the function body via
 * `func.toString()` and runs it in the page's main realm. Any
 * external module reference inside the body (other helpers, types,
 * imports) becomes an undefined identifier at runtime.
 *
 * Why MAIN world: empirically, `getBoundingClientRect()` calls in
 * the isolated world return 0×0 for descendants of cards using
 * `content-visibility: auto` — even after `captureVisibleTab` forces
 * a paint of the visible viewport, even after a per-element
 * `getBoundingClientRect()` pre-walk in the isolated world.
 * Page-side diagnostics (run in MAIN world via DevTools) on the
 * SAME page state at the SAME viewport returned 1326 interactive
 * elements; the isolated-world content script returned 0.
 *
 * `area` (when set, in viewport CSS pixels) narrows the captureRect
 * so area / per-page / scroll-stitch captures don't surface
 * off-frame elements in the editor. Returns a `PageMetadata`
 * shape — the function declares it inline (rather than importing
 * from `@ingcreators/annot-core`) because imports would break the
 * MAIN-world serialization contract.
 */

/** Inline copy of the `@ingcreators/annot-core` `PageMetadata` /
 *  `PageElement` shape. Kept in sync by the orchestrator's
 *  `requestPageMetadata` cast on the host side. */
type WalkerPageMetadata = {
  version: number;
  url: string;
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  scrollOffset: { x: number; y: number };
  captureRect: { x: number; y: number; width: number; height: number };
  capturedAt: string;
  elements: WalkerPageElement[];
};

type WalkerPageElement = {
  id: string;
  tag: string;
  role?: string;
  text?: string;
  ariaLabel?: string;
  inputType?: string;
  placeholder?: string;
  href?: string;
  domId?: string;
  bbox: [number, number, number, number];
  selector: string;
  visible: true;
};

/** Argument shape — viewport CSS pixels, narrowed for area /
 *  per-page / scroll-stitch captures. `null` means "use the visible
 *  viewport". */
export type WalkerRegion = { x: number; y: number; width: number; height: number } | null;

/**
 * Closure-free walker. Exported for the chrome host to pass as the
 * `func` argument to `chrome.scripting.executeScript({ world: "MAIN" })`.
 * The body must compile to JavaScript that runs in the page's
 * realm — keep it self-contained.
 */
export function walkPageMetadata(regionArg: WalkerRegion): WalkerPageMetadata {
  const MAX_ELEMENTS = 2000;
  const MIN_AREA = 16;
  const region = regionArg ?? undefined;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
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
    const role = el.getAttribute("role");
    if (
      role &&
      /^(button|link|tab|menuitem|checkbox|radio|switch|textbox|combobox|searchbox|option|treeitem|slider|spinbutton)$/.test(
        role,
      )
    )
      return true;
    if (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") return true;
    if ((el as HTMLElement).isContentEditable && el.getAttribute("contenteditable") !== "inherit")
      return true;
    return false;
  }

  function isVisuallyOnScreen(el: HTMLElement): boolean {
    try {
      if (el.getAttribute("aria-hidden") === "true") return false;
      const cv = (el as { checkVisibility?: (opts: object) => boolean }).checkVisibility;
      if (typeof cv === "function") {
        if (!cv.call(el, { checkOpacity: true, checkVisibilityCSS: true })) return false;
      } else {
        const style = window.getComputedStyle(el);
        if (style.display === "none") return false;
        if (style.visibility === "hidden" || style.visibility === "collapse") return false;
        if (Number.parseFloat(style.opacity || "1") <= 0.05) return false;
      }
      const r = el.getBoundingClientRect();
      if (r.width * r.height < MIN_AREA) return false;
      const docW = Math.max(document.documentElement.scrollWidth, window.innerWidth);
      const docH = Math.max(document.documentElement.scrollHeight, window.innerHeight);
      if (r.right < -5000 || r.left > docW + 5000) return false;
      if (r.bottom < -5000 || r.top > docH + 5000) return false;
      return true;
    } catch {
      return true;
    }
  }

  function implicitRole(el: Element): string | null {
    switch (el.tagName.toLowerCase()) {
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

  function labelTextFor(el: HTMLElement): string | null {
    const id = el.id;
    if (id) {
      const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab?.textContent) return lab.textContent.trim().replace(/\s+/g, " ");
    }
    const closest = el.closest("label");
    if (closest?.textContent) return closest.textContent.trim().replace(/\s+/g, " ");
    return null;
  }

  function extractText(el: HTMLElement): string | undefined {
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const inp = el as HTMLInputElement;
      if (inp.type === "submit" || inp.type === "button" || inp.type === "reset") {
        return inp.value || undefined;
      }
      return labelTextFor(el) || undefined;
    }
    if (tag === "textarea") return labelTextFor(el) || undefined;
    if (tag === "select") {
      const sel = el as HTMLSelectElement;
      return sel.options[sel.selectedIndex]?.text || labelTextFor(el) || undefined;
    }
    const text = (el.textContent || "").trim().replace(/\s+/g, " ");
    if (!text) return undefined;
    return text.length > 120 ? `${text.slice(0, 117)}…` : text;
  }

  function cssSelector(el: Element): string {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 6) {
      let part = cur.tagName.toLowerCase();
      const testId = cur.getAttribute("data-testid") || cur.getAttribute("data-test-id");
      if (testId) {
        part += `[data-testid="${CSS.escape(testId)}"]`;
        parts.unshift(part);
        break;
      }
      if (cur.parentElement) {
        const sibs = Array.from(cur.parentElement.children).filter(
          (c) => c.tagName === cur!.tagName,
        );
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(" > ") || el.tagName.toLowerCase();
  }

  const elements: WalkerPageElement[] = [];
  let id = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      const el = node as Element;
      if (el.hasAttribute("data-annot-ui")) return NodeFilter.FILTER_REJECT;
      const tag = el.tagName.toLowerCase();
      if (
        tag === "script" ||
        tag === "style" ||
        tag === "noscript" ||
        tag === "link" ||
        tag === "meta"
      )
        return NodeFilter.FILTER_REJECT;
      return isInteresting(el) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode()) !== null && elements.length < MAX_ELEMENTS) {
    const el = node as HTMLElement;
    if (!isVisuallyOnScreen(el)) continue;
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || implicitRole(el) || undefined;
    const text = extractText(el);
    const ariaLabel = el.getAttribute("aria-label") || undefined;
    const domId = el.id || undefined;
    const selector = cssSelector(el);
    let inputType: string | undefined;
    let placeholder: string | undefined;
    if (tag === "input") {
      inputType = (el as HTMLInputElement).type || "text";
      placeholder = (el as HTMLInputElement).placeholder || undefined;
    } else if (tag === "textarea") {
      placeholder = (el as HTMLTextAreaElement).placeholder || undefined;
    }
    let href: string | undefined;
    if (tag === "a") href = (el as HTMLAnchorElement).href || undefined;
    elements.push({
      id: `e${id++}`,
      tag,
      role,
      text,
      ariaLabel,
      inputType,
      placeholder,
      href,
      domId,
      bbox: [
        Math.round(r.left + scrollX),
        Math.round(r.top + scrollY),
        Math.round(r.width),
        Math.round(r.height),
      ],
      selector,
      visible: true,
    });
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
