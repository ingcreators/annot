# MCP tools reference

Five tools at v1. Each returns either an MCP `image` content
block (base64 PNG, displayed inline in clients like Claude
Desktop) or a text confirmation when `output` is set to an
absolute filesystem path.

| Tool | Image source | Position |
| --- | --- | --- |
| `annot_annotate_screenshot` | bytes or path | bbox only |
| `annot_annotate_url` | URL (Annot drives Chromium) | locator or bbox |
| `annot_redact_screenshot` | bytes or path | bbox only |
| `annot_redact_url` | URL | locator or bbox |
| `annot_compare_screenshots` | two PNGs (same dims) | — |

The annotation shape vocabulary is documented in the
[DSL reference](../api/dsl). The optional `encode` block on
every tool (since `annot-mcp@0.2.0`) is documented in the
[Encode pipeline reference](../api/encode) — set it to
shrink the output bytes for inclusion in GitHub issues,
manuals, or PR comments.

## `annot_annotate_screenshot`

Overlay annotations on a pre-captured PNG.

```jsonc
{
  "image": "/abs/path/to/screenshot.png",   // or "data:image/png;base64,..."
  "annotations": [
    { "type": "rect", "bbox": { "x": 420, "y": 380, "width": 120, "height": 44 },
      "intent": "error" },
    { "type": "callout",
      "at": { "x": 200, "y": 360 },
      "targetBbox": { "x": 420, "y": 380, "width": 120, "height": 44 },
      "content": "Submit button disabled" }
  ],
  "output": "/abs/path/to/out.png"   // optional
}
```

## `annot_annotate_url`

Open a URL in headless Chromium, capture, overlay annotations
positioned by Playwright locator strings. The headline
locator-first tool.

```jsonc
{
  "url": "https://staging.example.com/login",
  "annotations": [
    { "type": "rect",
      "locator": "button:has-text('Submit')",
      "intent": "error" },
    { "type": "callout",
      "atLocator": "form",
      "targetLocator": "button:has-text('Submit')",
      "content": "Submit button is disabled" }
  ],
  "viewport": { "width": 1280, "height": 800, "deviceScaleFactor": 1 },
  "fullPage": false,
  "waitFor": "load",   // "load" | "domcontentloaded" | "networkidle"
  "encode": {          // optional — see ../api/encode
    "format": "smart",
    "saveSizePreset": "standard"
  }
}
```

Each `locator` resolves to a bbox via
`page.locator(s).boundingBox()`. Non-rect shapes use the
adaptation rules documented [here](../api/dsl#locator-flavour-dsl-mcp-only).

## `annot_redact_screenshot`

Destructively burn redactions (solid / mosaic / blur) into a
PNG. Original pixels under each region are **irrecoverably**
replaced.

```jsonc
{
  "image": "/abs/path/to/screenshot.png",
  "regions": [
    { "bbox": { "x": 100, "y": 100, "width": 200, "height": 30 },
      "style": "blur" },
    { "bbox": { "x": 100, "y": 150, "width": 200, "height": 30 },
      "style": "solid", "color": "#000" }
  ]
}
```

Styles:

- `solid` — `ctx.fillRect` with `color` (default `#000`).
- `mosaic` — nearest-neighbour downsample + upsample with
  smoothing disabled. Block size 16 px.
- `blur` — `ctx.filter = "blur(12px)"` clipped to the region.

## `annot_redact_url`

Live-capture variant of redact. Regions accept locator strings
or bboxes:

```jsonc
{
  "url": "https://staging.example.com/account",
  "regions": [
    { "locator": "input[type=password]", "style": "blur" },
    { "locator": "[data-testid=ssn]", "style": "solid", "color": "#000" }
  ]
}
```

Same viewport / fullPage / waitFor / encode knobs as
`annot_annotate_url`.

## `annot_compare_screenshots`

Pixel-perfect diff. Returns a PNG of the `after` image with
changed regions highlighted as `warning`-intent rects.

```jsonc
{
  "before": "/abs/path/before.png",
  "after":  "/abs/path/after.png",
  "threshold": 0.1,            // 0 strict … 1 permissive
  "includeChangeList": false,  // when true, append a text summary
  "encode": {                  // optional — see ../api/encode
    "format": "smart",
    "saveSizePreset": "standard"
  }
}
```

The two inputs must have identical dimensions. Backed by
[`pixelmatch`](https://www.npmjs.com/package/pixelmatch);
contiguous changed pixels are aggregated into bounding
rectangles via flood-fill (minimum region size 4 px to drop AA
noise).
