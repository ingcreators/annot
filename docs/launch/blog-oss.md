# Blog post draft — "Why we OSS'd the annotator core"

> Channel: annot.work/blog (post-launch — the blog itself doesn't
> exist yet)
> Type: Positioning post
> Status: **Drafted, not posted.**
> Recommended posting: **day 2** of the launch — link from the
> Show HN thread once the discussion warms up.

## Title

```
Why we open-sourced the annotator core
```

## Subtitle

```
The technical reason: testing the SVG format against itself.
The strategic reason: trust beats discovery.
```

## Body

```markdown
We just shipped Annot — an SVG-first screenshot annotation
toolkit that you can call from Playwright (`@ingcreators/annot-
playwright`) or use as a standalone PWA at
[annot.work/app](https://annot.work/app). All three published
npm packages are Apache-2.0, the entire monorepo lives on
GitHub at [ingcreators/annot](https://github.com/ingcreators/annot),
and the cloud sync ([annot.work](https://annot.work)) has a
generous free tier today with paid Pro on the roadmap.

A few people have asked: why is the annotator core open source?
There's a hosted product at annot.work — wouldn't keeping the
renderer proprietary be the obvious moat?

Two answers, one tactical, one strategic.

## The tactical reason: a portable SVG format needs a portable renderer

The whole product is built around a single principle: the SVG
file is the source of truth. PNGs are rendered artifacts. PPTX
is an export format. The `*.annot.svg` file is what you can
git-commit, what you can attach to a GitHub issue, what your
teammate can open in their PWA without sharing a database.

For that principle to hold, the renderer has to live in three
places simultaneously:

1. The browser canvas inside the PWA (live editing).
2. A `<canvas>` rasteriser for thumbnail generation.
3. A headless Node renderer for the Playwright fixture + the
   future GitHub Action.

If the canvas-side and the Node-side disagree about how an arrow
is drawn, the format breaks. The only way to keep them honest is
to test the same input through both, byte-for-byte. That's much
easier when the renderer is open — anyone reviewing a PR can
spot the divergence; anyone using the Playwright fixture
benefits from the same fix that lands in the PWA.

A closed-source renderer would have meant a parallel
implementation in CI, a second source of truth, and a permanent
risk of drift. We didn't want to pay that maintenance cost.

## The strategic reason: trust beats discovery

Annot's competitors are mostly Electron apps with a one-time
download. Their users have no way to verify what the binary
does with their screenshots. Our users can read the source.

That matters because of what an annotation tool sees: every
screenshot you mark up. For a tool you point at production
environments, internal dashboards, or customer support
escalations, "I trust this binary not to phone home" is a much
weaker claim than "I trust this source code, which I just
inspected, not to phone home." Open source isn't a feature; it's
a posture.

It also matters for the Playwright integration specifically.
Test engineers don't install random npm packages into CI. They
install packages whose source they can audit. A closed-source
annotator fixture would have hit a wall at the first security
review at any serious engineering org.

We chose Apache-2.0 because it's permissive (no copyleft
surprises for downstream commercial users) and because it's the
default expectation for developer-facing OSS libraries.

## What's actually free, what's actually paid

- **All code is OSS.** PWA, Chrome extension, desktop app,
  VSCode extension, headless annotator, Playwright fixture, the
  Cloudflare Worker that hosts annot.work — the entire monorepo.
- **Self-hosting is supported.** The Worker code in
  `packages/worker/` deploys to your own Cloudflare account
  unchanged. Bring your own D1, R2, KV bindings.
- **annot.work hosted** is free for personal use today. The Pro
  tier (team sharing, history, increased quotas) is on the
  roadmap, pricing TBD.

The wager is straightforward: most users won't self-host; some
will; the ones who pay for the hosted service do so because the
ops work is worth more than the subscription. None of those
calculations require the code to be closed.

## What's next

The roadmap that follows from this launch:

- **GitHub integration** — a `GitHubStore` backend for the PWA
  + a GitHub Action that posts annotated screenshots from CI
  onto PR comments.
- **i18n + a11y** — the editor surface needs full keyboard
  navigation + WCAG-AA contrast + at least a Japanese locale
  alongside English.
- **More Playwright recipes** — visual regression diffs,
  cross-browser snapshot stitching, integration with the
  Playwright HTML report's UI.

If you tried it and the Playwright fixture didn't fit your
suite, please open an issue at
[github.com/ingcreators/annot/issues](https://github.com/ingcreators/annot/issues).
The product is bent toward what the first wave of users actually
wants.

— Naoki, [github.com/ichim](https://github.com/ichim)
```

## Operator notes

- **Word count**: ~750 words. Long enough to make the case,
  short enough that nobody bounces.
- **Audience**: developers / OSS-adjacent readers — same as Show
  HN. The post should make sense even without context from the
  Show HN thread.
- **First-person voice**, signed by Naoki. Match the Show HN
  tone.
- **Link discipline**: every link goes to a primary source
  (annot.work, the GitHub repo, npm registry). No SEO-bait
  affiliate links.

## Anti-patterns

- ❌ Open-source-as-marketing posture ("we OSS'd because we
  love community"). Be specific about the tactical reason.
- ❌ "We're disrupting…" / "The future of annotation…"
- ❌ Hidden agenda (paid-tier-only features that should be free).
  If the free tier has real limits, name them.
