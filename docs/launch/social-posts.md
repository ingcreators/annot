# Social posts draft

> Channel: Twitter / X · Bluesky · Mastodon
> Type: Ready-to-paste posts
> Status: **Drafted, not posted.**
> Length budget: 280 characters each (X's limit; works on
> Bluesky's 300, Mastodon's 500).

## Posting cadence

| # | When | Vibe |
| --- | --- | --- |
| 1 | Day 1, ~30 min after Show HN goes up | Launch announcement |
| 2 | Day 1, 3 hours later | Code snippet flex |
| 3 | Day 2 morning | Blog post launch |
| 4 | Day 3 | Use-case 1 — assertion failure |
| 5 | Day 4 | Use-case 2 — DOM locator highlight |
| 6 | Day 5 | OSS / npm install reminder |

---

## Post 1 — Launch announcement (Day 1)

```
just shipped 📸 Annot — a screenshot annotation toolkit
you can call from Playwright. one fixture, one call, annotated
PNGs in your HTML report.

annotator.annotateScreenshot(page, { annotationsSvg })

OSS (Apache-2.0), three npm packages, free hosted PWA.

https://annot.work
```

(257 chars)

## Post 2 — Code snippet flex (Day 1, +3h)

```
the moat:

import { test, rectForBoundingBox } from "@ingcreators/annot-playwright";

test("ok", async ({ page, annotator }) => {
  const box = (await page.getByRole("button").boundingBox())!;
  await annotator.annotateScreenshot(page, {
    annotationsSvg: rectForBoundingBox(box, { stroke: "red" }),
  });
});
```

(269 chars — actual code, no commentary needed)

## Post 3 — Blog post launch (Day 2)

```
new post → "Why we open-sourced the annotator core"

two reasons:
1. a portable SVG format needs a portable renderer (the
   browser + Node sides have to agree byte-for-byte)
2. trust beats discovery — your screenshots stay on
   *your* machine

https://annot.work/blog/why-we-ossd-the-core
```

(263 chars — adjust URL when blog goes live)

## Post 4 — Assertion failure use-case (Day 3)

```
how I use Annot in CI:

assertion fails → catch the error → annotate the locator that
misbehaved → attach the PNG to the HTML report → re-throw.

future me opens the report, sees a red rectangle around the
button that wasn't enabled, knows exactly what broke.

https://annot.work/docs/recipes/assertion-failure
```

(280 chars exactly)

## Post 5 — DOM locator use-case (Day 4)

```
the @ingcreators/annot-playwright fixture has 3 pure
SVG-fragment helpers:

· rectForBoundingBox(box)
· arrowBetween({ from, to })
· textAt({ x, y }, label)

string concat composes them. zero dependencies, no DSL,
works against any Playwright `page`.

https://annot.work/docs/api/svg-helpers
```

(275 chars)

## Post 6 — npm install reminder (Day 5)

```
if you build with Playwright and ever wanted annotated
screenshots in your HTML report:

  npm i -D @ingcreators/annot-playwright

three pure SVG helpers + a fixture. Apache-2.0. no CI phone-home.

🐙 https://github.com/ingcreators/annot
📖 https://annot.work/docs
```

(254 chars)

---

## Per-platform tweaks

### Bluesky

- Drop the leading emoji 📸 — Bluesky users dislike the X-style
  emoji-prefix convention.
- The `@ingcreators/annot-playwright` ping doesn't tag anyone on
  Bluesky; that's fine.

### Mastodon

- Use the `#playwright #opensource #typescript` tag suffix
  (Mastodon users discover via hashtag search).
- Skip the marketing-y emoji.

### Threads

- Skip Threads for launch. The platform's algorithm penalises
  outbound links; even Threads-native posts about OSS get low
  reach. Revisit if/when the API matures.

## Anti-patterns

- ❌ "Join the revolution" / "Check it out!" / generic CTA.
  Each post should make sense on its own without "the URL".
- ❌ Quote-tweet trains. One post = one statement.
- ❌ Auto-poster syndication (Buffer / Hootsuite). They mark
  posts as low-engagement-quality and the algorithm punishes
  them. Hand-post each one from the actual web client.
