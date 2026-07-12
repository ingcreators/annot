/**
 * MAIN-world DOM walker that produces an `ElementTree` snapshot for
 * the canonical living-spec model.
 *
 * Produces the `ElementTree` shape from
 * `@ingcreators/annot-core/element-tree`. Invoked by the chrome
 * extension's capture host (and the Electron Browse window's host)
 * via `chrome.scripting.executeScript({ func: walkElementTree,
 * world: "MAIN" })` / `webContents.executeJavaScript(...)`.
 *
 * **This function MUST stay closure-free.** The host serializes the
 * function body via `func.toString()` and runs it in the page's
 * main realm. Any external module reference inside the body becomes
 * an undefined identifier at runtime — keep imports out of the
 * function body.
 *
 * Returns an `ElementTree`-shaped object. The function declares the
 * shape inline (rather than importing from `@ingcreators/annot-core`)
 * because imports would break the MAIN-world serialization contract.
 * The cast at the call site is a documented part of the
 * orchestrator's contract.
 */

/** Inline copy of the `@ingcreators/annot-core/element-tree`
 *  `ElementTree` / `ElementNode` / `BBox` shape. Kept in sync by the
 *  orchestrator's `requestElementTree` cast on the host side. */
type WalkerElementTree = {
  version: 1;
  source: {
    kind: "extension";
    capturedAt: string;
    agent?: string;
    url?: string;
  };
  viewport: {
    width: number;
    height: number;
    scale: number;
  };
  root: WalkerElementNode;
};

type WalkerElementNode = {
  role: string;
  name?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  ref: string;
  states?: string[];
  attributes?: Record<string, string>;
  text?: string;
  children?: WalkerElementNode[];
};

/** Argument shape — viewport CSS pixels, narrowed for area /
 *  per-page / scroll-stitch captures. `null` means "use the visible
 *  viewport". Identical to `WalkerRegion` in the legacy walker. */
export type ElementTreeWalkerRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
} | null;

/**
 * Closure-free walker. Exported for the chrome host to pass as the
 * `func` argument to `chrome.scripting.executeScript({ world: "MAIN" })`.
 * The body must compile to JavaScript that runs in the page's
 * realm — keep it self-contained.
 *
 * The agent string identifies which walker version produced the tree.
 * Future versions of the walker can bump this; readers can dispatch
 * on the `agent` field if behaviour changes meaningfully.
 */
export function walkElementTree(regionArg: ElementTreeWalkerRegion): WalkerElementTree {
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

  function accessibleName(el: HTMLElement): string | undefined {
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;
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

  function elementText(el: HTMLElement): string | undefined {
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const inp = el as HTMLInputElement;
      // For text-bearing inputs, current value is the text content.
      if (
        inp.type === "text" ||
        inp.type === "email" ||
        inp.type === "password" ||
        inp.type === "search"
      ) {
        return inp.value || undefined;
      }
    }
    if (tag === "textarea") return (el as HTMLTextAreaElement).value || undefined;
    return undefined;
  }

  function collectStates(el: HTMLElement): string[] | undefined {
    const states: string[] = [];
    if (el.hasAttribute("aria-checked")) states.push(`checked=${el.getAttribute("aria-checked")}`);
    if (el.hasAttribute("aria-pressed")) states.push(`pressed=${el.getAttribute("aria-pressed")}`);
    if (el.hasAttribute("aria-expanded"))
      states.push(`expanded=${el.getAttribute("aria-expanded")}`);
    if (el.hasAttribute("aria-selected"))
      states.push(`selected=${el.getAttribute("aria-selected")}`);
    if (el.hasAttribute("aria-disabled"))
      states.push(`disabled=${el.getAttribute("aria-disabled")}`);
    if (el.hasAttribute("disabled")) states.push("disabled");
    if (el.hasAttribute("required")) states.push("required");
    if (el.hasAttribute("readonly")) states.push("readonly");
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const t = (el as HTMLInputElement).type;
      if ((t === "checkbox" || t === "radio") && (el as HTMLInputElement).checked) {
        states.push("checked");
      }
    }
    if (/^h[1-6]$/.test(tag)) {
      states.push(`level=${tag.slice(1)}`);
    }
    return states.length > 0 ? states : undefined;
  }

  // Whitelist of HTML attributes worth collecting per element.
  // INLINED copy of `ELEMENT_TREE_ATTR_WHITELIST` from
  // `@ingcreators/annot-core/element-tree` — this function body is
  // injected via `executeScript({func})` and cannot import. The
  // behavioural symmetry test in `element-tree-walker.test.ts`
  // fails the build if the two lists diverge. Principle:
  // `attributes` = element shape (HTML attributes), `states` =
  // element state (ARIA / dynamic) — aria-* never appears here.
  const ATTR_WHITELIST = [
    "id",
    "name",
    "type",
    "href",
    "placeholder",
    "value",
    "required",
    "disabled",
    "readonly",
    "checked",
    "maxlength",
    "minlength",
    "pattern",
    "min",
    "max",
    "step",
    "data-testid",
    "data-test-id",
  ];

  function collectAttributes(el: HTMLElement): Record<string, string> | undefined {
    const out: Record<string, string> = {};
    for (const attr of ATTR_WHITELIST) {
      const v = el.getAttribute(attr);
      if (v !== null) out[attr] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  // ── Walk the DOM, collect interesting elements + their DOM parent ─

  interface CollectedEntry {
    el: HTMLElement;
    node: WalkerElementNode;
  }
  const collected: CollectedEntry[] = [];
  let idCounter = 0;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => {
      const el = n as Element;
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

  let cursor: Node | null;
  while ((cursor = walker.nextNode()) !== null && collected.length < MAX_ELEMENTS) {
    const el = cursor as HTMLElement;
    if (!isVisuallyOnScreen(el)) continue;
    const r = el.getBoundingClientRect();
    const role = el.getAttribute("role") || implicitRole(el) || "generic";
    const name = accessibleName(el);
    const text = elementText(el);
    const states = collectStates(el);
    const attributes = collectAttributes(el);
    idCounter++;
    const node: WalkerElementNode = {
      ref: `e${idCounter}`,
      role,
    };
    if (name !== undefined && name.length > 0) node.name = name;
    if (text !== undefined) node.text = text;
    node.bbox = {
      x: Math.round(r.left + scrollX),
      y: Math.round(r.top + scrollY),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
    if (states !== undefined) node.states = states;
    if (attributes !== undefined) node.attributes = attributes;
    collected.push({ el, node });
  }

  // ── Reconstruct hierarchy: nearest-interesting-ancestor parent map ─
  // Walk each collected element's DOM parent chain. The first
  // ancestor that's also in `collected` becomes the parent. Anything
  // without a collected ancestor becomes a child of the synthetic root.

  const elementToEntry = new Map<HTMLElement, CollectedEntry>();
  for (const entry of collected) {
    elementToEntry.set(entry.el, entry);
  }

  const rootChildren: WalkerElementNode[] = [];
  for (const entry of collected) {
    let parentEntry: CollectedEntry | undefined;
    let p: HTMLElement | null = entry.el.parentElement;
    while (p !== null) {
      const candidate = elementToEntry.get(p);
      if (candidate !== undefined) {
        parentEntry = candidate;
        break;
      }
      p = p.parentElement;
    }
    if (parentEntry === undefined) {
      rootChildren.push(entry.node);
    } else {
      if (parentEntry.node.children === undefined) {
        parentEntry.node.children = [];
      }
      parentEntry.node.children.push(entry.node);
    }
  }

  // Synthetic root mirroring captureRect — keeps the schema's
  // single-root invariant. Role `"document"` mirrors what
  // accessibility trees in browsers report for the page root.
  const root: WalkerElementNode = {
    ref: "e0",
    role: "document",
    bbox: captureRect,
    children: rootChildren.length > 0 ? rootChildren : undefined,
  };

  return {
    version: 1,
    source: {
      kind: "extension",
      capturedAt: new Date().toISOString(),
      agent: "annot-extension-element-tree-walker@1",
      url: location.href,
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scale: window.devicePixelRatio || 1,
    },
    root,
  };
}
