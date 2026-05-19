# Show HN draft

> Channel: <https://news.ycombinator.com/submit>
> Type: Show HN
> Status: **Drafted, not posted.**
> Recommended posting window: Tuesday or Wednesday, 09:00 PT.

## Title

```
Show HN: Annot – Annotate Playwright screenshots with one fixture call
```

(80 chars including the "Show HN:" prefix. HN's limit is 80; this fits.)

## URL field

```
https://annot.work
```

(Not the docs site — the landing page tells the story. The docs
site is linked from there.)

## Text field (first comment)

```
Hi HN, I'm Naoki — solo OSS maintainer working on Annot.

For the last year I've been frustrated that when a Playwright
test fails, my team's HTML report shows just a flat screenshot
plus a stack trace. The visual context — "which button did it
expect to be enabled?" — has to be reconstructed from the test
source. So I built a Playwright fixture that adds annotations
to screenshots from inside the test, with the same SVG format
my hand-edit PWA uses.

The single-call shape is:

  await annotator.annotateScreenshot(page, {
    annotationsSvg: rectForBoundingBox(box, { stroke: "#ff5252" }),
  });

You get a PNG back; pass it to testInfo.attach() and it appears
inline in the HTML report next to the failing step. Three pure
SVG-fragment helpers (rectForBoundingBox, arrowBetween, textAt)
compose via string concat, so you can build up arbitrary
annotation layouts without learning a DSL.

Under the hood it's a headless renderer built on @resvg/resvg-js
+ @xmldom/xmldom. Same SVG format the PWA at annot.work/app
produces, so a screenshot annotated in CI can be opened in the
PWA for further hand-tuning, and vice versa.

Three npm packages — annot-playwright (the fixture),
annot-annotator (the headless renderer), annot-core (the format).
All Apache-2.0. The monorepo also ships the PWA, a Chrome
extension, an Electron desktop app, and a VSCode extension —
all sharing the same SVG core.

Things I'd love feedback on:

- Is the fixture shape idiomatic for Playwright suites?
- The helpers return strings — would a builder API be friendlier?
- The PWA is the editor I personally use; how visible should it
  be on the landing page vs. the fixture?

The cloud sync (annot.work signed-in storage) is on a free tier
today; paid Pro is on the roadmap (team sharing, history, higher
quotas) — pricing TBD.

Repo: https://github.com/ingcreators/annot
Docs: https://annot.work/docs
Try the editor: https://annot.work/app
```

## Notes for the operator

- **Account age** — HN throttles new accounts. Post from the
  main account, not a fresh one.
- **Don't ask for upvotes.** HN auto-detects vote rings; any
  hint of coordination kills the submission.
- **Be on hand for 4 hours** after posting. Answer every comment
  in the first 60 minutes — first-hour engagement is what gets
  the post onto the front page.
- **Don't reply defensively** to negative comments. "Good point,
  I'll think about it" beats "Actually you're wrong because…"
  every time.
- **Don't link the social posts** from the HN thread. HN
  audience hates cross-promotion.

## Anti-patterns to avoid in the draft

- ❌ "AI-powered" / "blockchain" / "revolutionary" — buzzword
  flags get the post downvoted.
- ❌ Cap-walls of bullet-point features. HN prefers a short
  narrative + a code snippet.
- ❌ "Please upvote" / "Please share" — instant kill.
- ❌ Reading like marketing copy. Use first-person ("I built"),
  not third-person ("Annot is a…").
- ❌ Burying the moat. The Playwright integration is the
  reason to care; lead with it.
