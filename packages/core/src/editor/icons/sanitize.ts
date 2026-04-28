/**
 * Allow-list-based SVG sanitiser for plugin-supplied
 * `IconSpec({ kind: "svg", svg: "…" })` markup.
 *
 * Phase 3 of `docs/plans/svg-icons-and-plugin-icon-spec.md`.
 *
 * The sanitiser is the security boundary between plugin-authored
 * SVG strings and the host DOM. Plugin code is loaded into the
 * same realm as Annot itself (no iframe sandbox today), so any
 * SVG injection that lands in the host's DOM has the same
 * privilege level as the host. We therefore parse the plugin's
 * SVG into a detached `Document`, walk it, and re-serialise
 * exclusively allow-listed elements + attributes into a fresh
 * SVG string. Anything not on the lists is dropped.
 *
 * Tier-B placement: takes Element instances via `DOMParser`;
 * jsdom-friendly. Works in pure-Node tests, web bundles, and
 * extension service-worker contexts where DOMParser is exposed.
 *
 * Why hand-rolled vs. DOMPurify:
 *
 *   The icon use-case is narrow (≈30 SVG elements + ≈25
 *   attributes). DOMPurify ships ~22 KB min+gz of HTML-focused
 *   logic that we'd still have to layer SVG-side allow-listing
 *   on top of. A focused walker keeps Tier-B clean and concentrates
 *   security review onto the small allow-list constants below.
 *
 * Threat model — what this DOES protect against:
 *
 *   - `<script>` injection (element + on* attributes).
 *   - `javascript:` / `data:text/html` URLs in `<use href>`.
 *   - External-origin `<image>` / `<use>` references (both
 *     anchored and absolute URLs).
 *   - `<foreignObject>` (full HTML escape hatch — banned).
 *   - `<style>` and `style=` attributes (CSS injection).
 *   - Unknown / non-SVG namespaces.
 *
 * Threat model — what this does NOT protect against:
 *
 *   - DoS via maliciously huge SVG payloads (mitigated by
 *     `MAX_INPUT_BYTES` below — 64 KB is far above any legitimate
 *     icon).
 *   - Pathological `path` data that could crash a CPU-time-
 *     starved renderer. Browsers cap render budgets; we accept
 *     the residual risk.
 *   - Visually-deceptive but technically valid SVG (e.g. a fake
 *     icon that mimics another product's logomark). Out of
 *     scope — content moderation, not sanitisation.
 */

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Maximum input length, in characters. 64 KB ≈ 200× the largest
 *  icon SVG we ship; anything past that is either a bug or an
 *  attack. */
const MAX_INPUT_BYTES = 64 * 1024;

/** Allow-listed SVG element local names, mapped from the
 *  lowercased form (used for case-insensitive lookup against
 *  happy-dom / browser-DOM output) to the canonical camelCase
 *  form re-emitted on serialisation. SVG itself IS case-
 *  sensitive on `linearGradient` / `radialGradient`, so we have
 *  to keep the camelCase name on output even when the parser
 *  lowercased it. */
const ALLOWED_ELEMENTS: Record<string, string> = {
  svg: "svg",
  g: "g",
  path: "path",
  circle: "circle",
  ellipse: "ellipse",
  rect: "rect",
  line: "line",
  polyline: "polyline",
  polygon: "polygon",
  defs: "defs",
  lineargradient: "linearGradient",
  radialgradient: "radialGradient",
  stop: "stop",
  symbol: "symbol",
  use: "use",
  title: "title",
  desc: "desc",
  text: "text",
  tspan: "tspan",
};

/** Attributes allowed on every allowed element. The set
 *  intentionally excludes `style` (CSS injection vector),
 *  `href`/`xlink:href` on non-`<use>` elements (external resource
 *  loaders), and any `on*` event handlers. */
const ALLOWED_ATTRS_GLOBAL = new Set([
  "id",
  "class",
  "viewBox",
  "preserveAspectRatio",
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "stroke-miterlimit",
  "transform",
  "opacity",
  "color",
  "aria-hidden",
  "aria-label",
  "role",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "fr",
  "fx",
  "fy",
  "text-anchor",
  "dominant-baseline",
  "font-size",
  "font-family",
  "font-weight",
  "letter-spacing",
  "dx",
  "dy",
]);

/** Attributes allowed only on specific elements. `<use>` is the
 *  one element where we accept `href` (and the legacy
 *  `xlink:href`), but only when the value points at an
 *  internal-document fragment (`#id`). */
const ELEMENT_SPECIFIC_ATTRS: Record<string, ReadonlySet<string>> = {
  use: new Set(["href", "xlink:href"]),
};

/** Validate a `<use>`-style href: only same-document fragment
 *  references (`#some-id`) are accepted. Any other scheme —
 *  including relative paths, `https://`, `data:`, or
 *  `javascript:` — is rejected. */
function isSafeUseHref(value: string): boolean {
  return /^#[A-Za-z_][A-Za-z0-9_\-:.]*$/.test(value);
}

/** Reject any `javascript:` / `data:text/html` / `vbscript:`
 *  scheme even on global allow-listed attrs. Belt-and-braces in
 *  case a future addition to `ALLOWED_ATTRS_GLOBAL` introduces a
 *  URL-bearing attribute. */
function hasUnsafeScheme(value: string): boolean {
  return /^\s*(javascript|data:text\/html|vbscript):/i.test(value);
}

/** Escape `&`, `<`, `>`, `"` for safe interpolation into an
 *  XML / HTML serialisation context. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Parse plugin-supplied SVG into a detached document, walk it,
 * and serialise the allow-listed subset back to a string we
 * control. Returns the sanitised SVG, or `null` if the input
 * could not be parsed as a single `<svg>` root.
 *
 * The renderer (Phase 3 sibling) treats `null` as "skip this
 * icon" rather than crashing — a malformed plugin spec
 * shouldn't break the host UI.
 */
export function sanitizeIconSvg(input: string): string | null {
  if (typeof input !== "string" || input.length === 0) return null;
  if (input.length > MAX_INPUT_BYTES) return null;

  const Parser = (globalThis as unknown as { DOMParser?: typeof DOMParser }).DOMParser;
  if (!Parser) return null;

  const parser = new Parser();
  // image/svg+xml lets the parser produce a real SVGElement for
  // the root. Browsers + jsdom honour the namespace correctly;
  // happy-dom's coverage of image/svg+xml is partial but it
  // exposes localName / namespaceURI on the parsed elements,
  // which is all we need.
  const doc = parser.parseFromString(input, "image/svg+xml");
  const root = doc.documentElement;
  if (!root) return null;
  // Some parsers emit a parseerror element with an `<svg>`-like
  // localName attached to a non-SVG namespace; check both.
  if (root.namespaceURI !== SVG_NAMESPACE) return null;
  if ((root.localName ?? "").toLowerCase() !== "svg") return null;

  return serialiseElement(root);
}

/** Walk an SVG element + its allowed children, producing a
 *  byte-stable serialisation. Self-closes elements with no
 *  children, otherwise emits `<tag>…</tag>`. */
function serialiseElement(el: Element): string {
  const lookupKey = (el.localName ?? "").toLowerCase();
  const canonical = ALLOWED_ELEMENTS[lookupKey];
  if (!canonical) return "";
  // Force the SVG namespace on the root for unambiguous
  // re-parsing on the consumer side. Children inherit it via
  // XML namespace inheritance.
  const isRoot = canonical === "svg";
  const attrs = serialiseAttributes(el, lookupKey, isRoot);
  const children: string[] = [];
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1 /* ELEMENT_NODE */) {
      const childEl = child as Element;
      if (childEl.namespaceURI !== SVG_NAMESPACE) continue;
      const inner = serialiseElement(childEl);
      if (inner) children.push(inner);
    } else if (child.nodeType === 3 /* TEXT_NODE */) {
      // Text nodes inside <title> / <desc> / <text> / <tspan>
      // are safe; outside them they're typically whitespace from
      // pretty-printed input. Either way a plain text-node copy
      // can't carry script.
      const text = child.nodeValue ?? "";
      if (text.length > 0) children.push(xmlEscape(text));
    }
    // CDATA / processing-instructions / comments dropped.
  }
  if (children.length === 0) return `<${canonical}${attrs}/>`;
  return `<${canonical}${attrs}>${children.join("")}</${canonical}>`;
}

function serialiseAttributes(el: Element, lookupKey: string, isRoot: boolean): string {
  const elementSpecific = ELEMENT_SPECIFIC_ATTRS[lookupKey];
  const out: string[] = [];
  if (isRoot) out.push(` xmlns="${SVG_NAMESPACE}"`);
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name;
    if (name.startsWith("on")) continue;
    if (name === "style") continue;
    if (name.startsWith("xmlns")) continue; // handled by isRoot above
    const isGlobal = ALLOWED_ATTRS_GLOBAL.has(name);
    const isElementSpecific = elementSpecific?.has(name) === true;
    if (!isGlobal && !isElementSpecific) continue;
    if (isElementSpecific && !isSafeUseHref(attr.value)) continue;
    if (hasUnsafeScheme(attr.value)) continue;
    out.push(` ${name}="${xmlEscape(attr.value)}"`);
  }
  return out.join("");
}
