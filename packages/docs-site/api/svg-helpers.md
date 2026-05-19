# SVG helpers

Three pure functions that return SVG fragments as strings. Combine
them with string concatenation:

```ts
import {
  rectForBoundingBox,
  arrowBetween,
  textAt,
} from "@ingcreators/annot-playwright";

const svg =
  rectForBoundingBox(box, { stroke: "#ff5252" }) +
  arrowBetween({ from: anchor, to: box }, { stroke: "#ff5252" }) +
  textAt({ x: anchor.x, y: anchor.y - 8 }, "Failing here", { fill: "#ff5252" });
```

They have no Playwright dependency — you can also import them
from `@ingcreators/annot-core/editor`.

## `rectForBoundingBox`

```ts
function rectForBoundingBox(
  box: { x: number; y: number; width: number; height: number },
  style?: { stroke?: string; strokeWidth?: number; fill?: string },
): string;
```

Returns a `<rect>` matching `box`. Default style is a 3-pixel red
stroke with no fill — designed to drop straight over a screenshot
without obscuring the target element.

```ts
const box = (await locator.boundingBox())!;
const rect = rectForBoundingBox(box, { stroke: "#0088ff" });
```

## `arrowBetween`

```ts
function arrowBetween(
  endpoints: {
    from: { x: number; y: number };
    to: { x: number; y: number };
  },
  style?: { stroke?: string; strokeWidth?: number },
): string;
```

Returns a `<path>` arrow from `from` to `to`. The arrowhead is
sized proportionally to the stroke width.

```ts
const arrow = arrowBetween(
  { from: { x: 50, y: 50 }, to: { x: 200, y: 100 } },
  { stroke: "#7c9cff" },
);
```

## `textAt`

```ts
function textAt(
  anchor: { x: number; y: number },
  text: string,
  style?: {
    fill?: string;
    fontSize?: number;
    fontFamily?: string;
  },
): string;
```

Returns a `<text>` at `anchor`. Default font is the logical
`Annot Sans` token with a system-font cascade — no web-font
download required.

```ts
const label = textAt({ x: 100, y: 50 }, "Sign-in button", {
  fill: "#ff5252",
});
```
