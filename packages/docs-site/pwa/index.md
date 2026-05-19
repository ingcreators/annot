# Annot Cloud (PWA)

The PWA at [`annot.work/app`](https://annot.work/app) is the
hand-edit surface for the same SVG annotation format produced by
the headless annotator. Capture once, hand-tune in the browser,
share the result.

## Topics

- **[Sign in](./sign-in.md)** — GitHub + Google login flows for
  cloud sync.
- **[Switch storage backends](./storage-backends.md)** — Local
  IndexedDB, the OS file system, GitHub repos, Google Drive.
- **[Share links](./share-links.md)** — Generate a public URL for
  any annotated screenshot.

## When to use the PWA vs the Playwright fixture

- **PWA**: hand-tuned annotations. Designers, product managers,
  bug reporters who want to mark up a screenshot once and share
  it.
- **Playwright fixture**: programmatic annotations from CI. Test
  authors, build pipelines, docs generators.

Both produce the same SVG format. A PWA-edited screenshot can be
opened in a script via `parseAnnotationSvg`; a Playwright-generated
screenshot can be opened in the PWA for further hand-editing.

## Pricing

The PWA is free to use under the
[Apache-2.0 licence](https://github.com/ingcreators/annot/blob/main/LICENSE).
A paid Pro tier covering team sharing, history, and increased
quotas is on the roadmap.

::: warning Roadmap
The cloud sync features (multi-device, share links, team
sharing) are in active development. See
[`docs/plans/annot-cloud-roadmap.md`](https://github.com/ingcreators/annot/blob/main/docs/plans/annot-cloud-roadmap.md)
for the current state.
:::
