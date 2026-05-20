// Resolve `LocatorAnnotation`-flavour DSL entries against a live
// Playwright page, producing `BboxAnnotation`-flavour entries the
// `_screenshot` SVG conversion can consume directly.
//
// Locator strings follow Playwright's standard grammar — CSS,
// `text=`, `role=`, `[data-testid="..."]`, chained `>>`. The
// resolver calls `page.locator(s).boundingBox()` and adapts the
// returned bbox to the annotation shape per the rules documented
// in `docs/plans/agent-mcp-integration.md` §"The annotation DSL".
//
// `PageLike` / `LocatorLike` are structural — tests inject fakes;
// production code passes `playwright-core`'s `Page` which
// satisfies the interface naturally.

import type {
  BBox,
  BboxAnnotation,
  BboxArrowAnnotation,
  BboxCalloutAnnotation,
  BboxCircleAnnotation,
  BboxRectAnnotation,
  BboxTextAnnotation,
  LocatorAnnotation,
  Point,
} from "../dsl/types.js";

export interface PageLike {
  locator(selector: string): LocatorLike;
}

export interface LocatorLike {
  boundingBox(): Promise<BBox | null>;
}

export class LocatorResolutionError extends Error {
  readonly locator: string;
  constructor(locator: string, message: string) {
    super(message);
    this.name = "LocatorResolutionError";
    this.locator = locator;
  }
}

/**
 * Resolve a single locator string to its bounding box. Throws
 * `LocatorResolutionError` when the locator matches nothing or
 * lies outside the visible viewport (Playwright returns `null` for
 * both cases — we can't disambiguate without an extra `.count()`
 * call, and the error message keeps both possibilities in scope).
 */
export async function resolveLocator(page: PageLike, locator: string): Promise<BBox> {
  const bbox = await page.locator(locator).boundingBox();
  if (!bbox) {
    throw new LocatorResolutionError(
      locator,
      `Locator "${locator}" resolved to no visible element. ` +
        "Check the selector matches at least one element and the element is " +
        "inside the captured viewport.",
    );
  }
  return bbox;
}

/**
 * Convert a `LocatorAnnotation` to its `BboxAnnotation` equivalent
 * by resolving any embedded locator strings. Annotation type
 * dictates the adaptation rule for non-rect shapes:
 *
 *   - `rect`     — bbox stands in directly.
 *   - `circle`   — center = bbox centroid; radius = `min(w,h) / 2`.
 *   - `arrow`    — each endpoint resolves independently; locator
 *                  endpoints land at the bbox centroid.
 *   - `text`     — `at` = bbox top-left, raised one font line so
 *                  the caption sits above the element.
 *   - `callout`  — `at` / `atLocator` controls the caption anchor;
 *                  `targetBbox` / `targetLocator` the rect.
 *   - `raw`      — passes through unchanged.
 */
export async function resolveLocatorAnnotation(
  page: PageLike,
  annotation: LocatorAnnotation,
): Promise<BboxAnnotation> {
  switch (annotation.type) {
    case "rect": {
      const bbox =
        annotation.bbox ?? (await resolveLocator(page, mustHaveLocator(annotation.locator)));
      const result: BboxRectAnnotation = { ...stripLocator(annotation), type: "rect", bbox };
      return result;
    }
    case "circle": {
      if (annotation.center !== undefined && annotation.radius !== undefined) {
        const result: BboxCircleAnnotation = {
          ...stripLocator(annotation),
          type: "circle",
          center: annotation.center,
          radius: annotation.radius,
        };
        return result;
      }
      const bbox = await resolveLocator(page, mustHaveLocator(annotation.locator));
      const result: BboxCircleAnnotation = {
        ...stripLocator(annotation),
        type: "circle",
        center: centroid(bbox),
        radius: Math.min(bbox.width, bbox.height) / 2,
      };
      return result;
    }
    case "arrow": {
      const from =
        annotation.from ??
        centroid(await resolveLocator(page, mustHaveLocator(annotation.fromLocator)));
      const to =
        annotation.to ??
        centroid(await resolveLocator(page, mustHaveLocator(annotation.toLocator)));
      const result: BboxArrowAnnotation = {
        ...stripLocator(annotation),
        type: "arrow",
        from,
        to,
      };
      return result;
    }
    case "text": {
      const at =
        annotation.at ??
        textAnchorAbove(
          await resolveLocator(page, mustHaveLocator(annotation.locator)),
          annotation.fontSize,
        );
      const result: BboxTextAnnotation = {
        ...stripLocator(annotation),
        type: "text",
        at,
        content: annotation.content,
      };
      if (annotation.fontSize !== undefined) result.fontSize = annotation.fontSize;
      if (annotation.anchor !== undefined) result.anchor = annotation.anchor;
      return result;
    }
    case "callout": {
      const at = annotation.at ?? (await resolveCalloutAnchor(page, annotation.atLocator));
      const targetBbox =
        annotation.targetBbox ??
        (await resolveLocator(page, mustHaveLocator(annotation.targetLocator)));
      const result: BboxCalloutAnnotation = {
        ...stripLocator(annotation),
        type: "callout",
        at,
        targetBbox,
        content: annotation.content,
      };
      return result;
    }
    case "raw":
      return annotation;
  }
}

/**
 * Resolve every entry in a `LocatorAnnotation[]` against the page,
 * returning the corresponding `BboxAnnotation[]`. Failures throw
 * the first `LocatorResolutionError` — callers surface this as a
 * structured tool error so agents can retry with a corrected
 * selector.
 */
export async function resolveLocatorAnnotations(
  page: PageLike,
  annotations: readonly LocatorAnnotation[],
): Promise<BboxAnnotation[]> {
  // Sequential resolution — Playwright's locator engine isn't free,
  // and parallelism here makes error attribution harder. Locator
  // counts in real tool calls are O(1..5), so the cost is fine.
  const resolved: BboxAnnotation[] = [];
  for (const annotation of annotations) {
    resolved.push(await resolveLocatorAnnotation(page, annotation));
  }
  return resolved;
}

// ─── helpers ────────────────────────────────────────────────────

async function resolveCalloutAnchor(page: PageLike, locator: string | undefined): Promise<Point> {
  if (!locator) {
    throw new LocatorResolutionError(
      "<callout.at>",
      "callout annotations require either `at` or `atLocator`.",
    );
  }
  const bbox = await resolveLocator(page, locator);
  return centroid(bbox);
}

function centroid(bbox: BBox): Point {
  return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
}

function textAnchorAbove(bbox: BBox, fontSize: number | undefined): Point {
  const lift = (fontSize ?? 14) + 2;
  return { x: bbox.x, y: Math.max(0, bbox.y - lift) };
}

function mustHaveLocator(locator: string | undefined): string {
  if (locator === undefined) {
    throw new LocatorResolutionError(
      "<missing>",
      "Internal error: annotation passed schema validation without a locator or bbox. This is a bug.",
    );
  }
  return locator;
}

/**
 * Carry forward the design-system style fields (`intent`, `stroke`,
 * `strokeWidth`, `fill`, `color`) from a `LocatorAnnotation` to its
 * resolved `BboxAnnotation` counterpart. Geometry fields (`bbox`,
 * `locator`, `from`, …) are re-set per shape by the calling
 * branch.
 */
function stripLocator(annotation: LocatorAnnotation): AnnotationStyleSubset {
  if (annotation.type === "raw") {
    return {};
  }
  const out: AnnotationStyleSubset = {};
  if (annotation.intent !== undefined) out.intent = annotation.intent;
  if (annotation.stroke !== undefined) out.stroke = annotation.stroke;
  if (annotation.strokeWidth !== undefined) out.strokeWidth = annotation.strokeWidth;
  if (annotation.fill !== undefined) out.fill = annotation.fill;
  if (annotation.color !== undefined) out.color = annotation.color;
  return out;
}

type AnnotationStyleSubset = {
  intent?: "info" | "warning" | "error" | "success" | "neutral";
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  color?: string;
};
