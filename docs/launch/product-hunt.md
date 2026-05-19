# Product Hunt submission draft

> Channel: <https://www.producthunt.com/posts/new>
> Type: Product launch
> Status: **Drafted, not posted.**
> Recommended posting: **00:01 PT** of launch day. PH ranks by
> 24-hour score from the moment a post goes up; the day starts
> at midnight Pacific.

## Listing

### Name

```
Annot
```

### Tagline (60 chars max)

```
Annotated screenshots from a Playwright fixture
```

(48 chars — well under PH's limit)

### Topic tags (pick up to 4)

- Developer Tools
- GitHub Tools
- Testing
- Open Source

### Description (260 chars max)

```
Annot is an SVG-first screenshot annotation toolkit. Drop the
fixture into your Playwright suite, attach annotated PNGs to
your HTML report. Also: a hand-edit PWA, a Chrome extension,
a Desktop app, a VSCode extension. Apache-2.0. Free hosted.
```

(258 chars)

## Gallery images

Required: at least one 1270×760 (or 16:9) image. PH lets you
upload up to 8 — use all 8 slots.

| # | Subject | Purpose |
|---|---------|---------|
| 1 | Hero — Playwright code snippet with annotated PNG result side-by-side | First impression. **Most important pixel.** |
| 2 | PWA editor screenshot with annotations on a screenshot | "There's also an editor!" |
| 3 | Chrome extension capture flow (3-panel storyboard) | "Capture is built-in" |
| 4 | VSCode custom editor opening a `.annot.svg` file | "It's a real format" |
| 5 | GitHub repo README hero | "It's actually OSS" |
| 6 | Annotated screenshot demo — assertion failure use case | Concrete value |
| 7 | Annotated screenshot demo — DOM locator highlight | Range of use cases |
| 8 | npm package badges (annot-core / annot-annotator / annot-playwright) | Publishing proof |

**Asset spec**: 1270×760 PNG, RGB, no transparency, < 2 MB each.
PH downscales aggressively — use bold contrast and large text.

### Demo video

Optional but ranks higher. **30-second MP4**:

- 0:00–0:05 — `npm install --save-dev @ingcreators/annot-playwright`
  (terminal recording)
- 0:05–0:15 — A 4-line Playwright test with `annotator.annotateScreenshot`
- 0:15–0:25 — The HTML report opening, the annotated PNG inline
- 0:25–0:30 — annot.work landing page, ending on the hero

Voiceover optional. If included, English (US accent
preferred — PH audience is US-centric). No music. Output at
1920×1080 H.264, < 30 MB.

## First comment (from the maker)

PH expects the maker to comment first. This appears just below
the listing.

```
Hi PH! Naoki here — solo OSS maintainer.

I built Annot because I was tired of Playwright HTML reports
that showed flat screenshots when a test failed. The visual
context — "which button did it expect?" — kept living in the
test source.

The fixture's a one-liner:

  await annotator.annotateScreenshot(page, {
    annotationsSvg: rectForBoundingBox(box, { stroke: "red" }),
  });

The PNG attaches to your HTML report; future-you opens the
report, sees a red rectangle around the misbehaving locator,
knows what broke without reading the test source.

The full thing is OSS (Apache-2.0). Three npm packages
(@ingcreators/annot-{core,annotator,playwright}) for the
programmatic side; a hand-edit PWA + Chrome extension +
desktop + VSCode integration for the editing side. All
sharing the same SVG annotation format.

Happy to answer questions. The Show HN thread is over at
[link to HN] if you want the longer version.
```

## Posting checklist

- [ ] Submit at 00:01 PT exactly (PH algorithm)
- [ ] Maker comment posted within 5 minutes of going live
- [ ] Tweet "we're on PH" from the social account at 09:00 PT
      (peak US morning)
- [ ] Be available to reply to comments for the first 6 hours
- [ ] **Do NOT** ask friends to "hunt" or "upvote" — PH detects
      and shadow-bans coordinated voting

## Notes on ranking

PH ranks by:

- **Upvotes per hour** (the heaviest weight in the algorithm)
- **Comment engagement** (replies-per-comment ratio)
- **Maker-to-commenter engagement** (you replying to every
  comment helps)
- **Hunter reputation** (irrelevant if you're self-posting)

A typical successful OSS dev tool gets 200–500 upvotes on PH.
Top-10-of-the-day requires ~600. Don't optimise for #1; optimise
for a clean, well-engaged launch that drives traffic to the
landing page.
