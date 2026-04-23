# Brand Assets

Shared brand assets for the **ingcreators** family.

- **ingcreators** — the creators network (parent brand)
- **Annot** — an annotation tool, the first product in the family

All SVGs use `viewBox` so they scale crisply to any size. Run
`node brand/render-previews.mjs` to produce PNGs in `brand/preview/`.

---

## Brand Narrative

### ingcreators — "you are the bridge"

ingcreators is a network for creators who are simultaneously **someone's
follower and someone's leader**. Every creator stands in the middle
place: behind them, people who follow their path; ahead of them,
people they look up to.

The mark encodes this directly:

| Color | Hex | Meaning |
|---|---|---|
| **Blue** | `#7c9cff` | `i` — you, the creator, the individual |
| **Green** | `#7ef0c5` | 追跡者 / follower — lower-left, behind, still following your steps |
| **Purple** | `#b391ff` | 先駆者 / pioneer — upper-right, ahead, someone you look up to |

The blue arc from green to purple physically connects follower ↔
pioneer in the color of `i`. The message is not "you are connected
to the network" but "**you ARE the connection.** You bridge the one
behind and the one ahead."

### Annot — "highlight the moment"

Annot is the letter **A** with a floating annotation pin. The pin
signals the app's purpose (mark up, point to, annotate) while the
letterform makes the product instantly recognizable.

---

## Shared Design System

Both marks use the same container, palette, and color grammar — they
are siblings, not random logos that happen to look alike.

### Container
- `rect 48×48 rx=10 fill="#0f1730"` (dark navy rounded square)

### Palette (exactly 3 colors, no greys)
| Color | Hex | Role |
|---|---|---|
| Blue | `#7c9cff` | `i` / anchor / connector |
| Green | `#7ef0c5` | Left-side element — follower/trailing/left-leg |
| Purple | `#b391ff` | Right-side element — pioneer/leading/right-leg |

### Color grammar (shared rule)
- **Left = green, right = purple, top/connector = blue.** Never swap.
- **Blue bridges green and purple.** Annot expresses this as a straight
  crossbar; ingcreators expresses it as an arc. Both are `#7c9cff`.

### Text colors
| Color | Hex | Use |
|---|---|---|
| Ink on light bg | `#0f1730` | Primary wordmark text |
| Ink on dark bg | `#eef2ff` | Wordmark text on dark |
| Muted on light bg | `#4e5ea0` | Subtitle / "by ingcreators" / secondary text on light |
| Muted on dark bg | `#9fb0dc` | Subtitle / "by ingcreators" / secondary text on dark |

**Note on muted ink colors.** Secondary text is a **muted blue derived
from the brand blue (`#7c9cff`)**, not a neutral grey. "ingcreators"
is literally the blue `i` network — so attribution lines ("by
ingcreators") and secondary labels are rendered in the color of that
network. This is a small detail that reinforces the narrative at
every touchpoint.

---

## Files

### Canonical icons (source of truth)
| File | Use case |
|---|---|
| `ingcreators-icon.svg` | ingcreators master mark (24px and above). |
| `ingcreators-icon-16.svg` | Favicon-optimized variant (≤24px). Arc + stem removed, dots enlarged. |
| `annot-icon.svg` | Mirror of `packages/browser-extension/public/icons/icon.svg`. |
| `annot-icon-16.svg` | Favicon-optimized variant (≤24px). Pin removed, strokes thickened. |

The Annot source of truth lives inside the extension package. The
`brand/annot-icon.svg` file mirrors it so render-previews can pick it
up; keep them in sync.

### Wordmark lockups
| File | Layout | Background |
|---|---|---|
| `ingcreators-wordmark.svg` | Icon + "ingcreators" horizontal | Light |
| `ingcreators-wordmark-inverse.svg` | Icon + "ingcreators" horizontal | Dark |
| `annot-wordmark.svg` | Icon + "Annot" horizontal | Light |
| `annot-wordmark-inverse.svg` | Icon + "Annot" horizontal | Dark |
| `annot-wordmark-stacked.svg` | Icon + "Annot" + "by ingcreators" tagline | Light |
| `annot-wordmark-stacked-inverse.svg` | Stacked lockup | Dark |

### Family lockup
| File | Use |
|---|---|
| `family.svg` | Both marks side-by-side with labels. For docs/decks explaining the product family. |

### Explorations
`_archive/` contains the rejected variants from the design exploration
(10+ triangle directions, rotation / hierarchy / orbit combinations,
opacity tests). Kept for reference only — do not ship from `_archive/`.

---

## Size rules

| Display size | Icon to use |
|---|---|
| ≤ 24 px | `*-icon-16.svg` variants (stripped-down for legibility) |
| 25–127 px | `*-icon.svg` full mark |
| ≥ 128 px | `*-icon.svg` (scales cleanly via SVG vector) |

At small sizes the 16px variants replace decorative elements (Annot's
pin, ingcreators' arc + stem) with the core silhouette only. This is
standard practice (Google, Airbnb, Spotify all ship size-specific
variants rather than downscaling the master mark).

---

## Typography

Wordmarks reference **Sora** with a system-font fallback stack:
- `Sora, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`
- Weights: 700 for primary names, 500 for secondary/muted lines
- Letter-spacing: `-0.03em` for horizontal marks, `-0.025em` for stacked

If you need bulletproof rendering in environments where Sora isn't
available, convert text to paths with Inkscape / Figma / `fonttools`
before distributing.

---

## Clear space

Reserve at least **1× icon width (48 px)** of empty space around every
wordmark. Don't crop the icon or alter the proportions between mark
and text. Don't place the wordmark over busy photography without a
backdrop.

---

## Making changes

1. Edit the canonical SVG (`ingcreators-icon.svg`, `annot-icon.svg`,
   or the wordmark files).
2. If you changed `annot-icon.svg`, also update
   `packages/browser-extension/public/icons/icon.svg` to match.
3. Run `node brand/render-previews.mjs` to regenerate preview PNGs.
4. Inspect `brand/preview/` before committing.
