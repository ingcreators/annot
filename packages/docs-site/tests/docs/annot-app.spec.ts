import { test } from "@ingcreators/annot-product-docs";

// Dogfood tour. Captures live screens of the Annot web app at
// `annot.work/app/` (production) or a maintainer-supplied URL
// passed via ANNOT_APP_URL.
//
// `page.screenshot({ annot: { mdx } })` from
// `@ingcreators/annot-product-docs-astro/playwright` bundles in one
// call what previously required four coordinated steps
// (`page.screenshot` + `screen.capture` + `renderAnnotatedScreen`
// + `writeFile`). The fixture:
//
//   1. Refreshes the MDX's `annot:snapshot` + `annot:attributes`
//      comment blocks against the live page (via `captureScreen`).
//   2. Takes the raw screenshot via the original
//      `page.screenshot`.
//   3. Resolves the `<Screen id>`'s `<Overlay>` blocks against the
//      refreshed snapshot and bakes the editable PNG (overlays +
//      embedded original capture in the XMP).
//   4. Writes the bytes to `path`.
//
// The resulting PNG is drop-in re-editable in Annot Cloud
// (`annot.work/app/`) — anyone can save the image and load it as
// an editable session.
//
// Tour failures are advisory: `docs-tour.yml` has
// `continue-on-error: true` while the tour stabilises.

const ANNOT_APP_URL = process.env.ANNOT_APP_URL || "https://annot.work/app/";
const MDX_PATH = "src/content/docs/app/index.mdx";
const SHOT_PATH = "public/app/shots/app-overview.png";
const SCREEN_ID = "app-overview";

test.describe("Annot web app dogfood tour", () => {
  test("app overview", async ({ page }) => {
    await page.goto(ANNOT_APP_URL);

    // Give the SPA chrome a beat to settle. Annot's web app
    // renders the editor toolbar + drawer at first paint, but
    // some right-panel sections lazy-render after the first
    // ImageRecord loads.
    await page.waitForLoadState("networkidle");

    // Capture + refresh + bake + write — one call.
    //
    // `tags` are written verbatim into the XMP (no auto-fill per
    // the plan's Open Question 2). The `commit` line rides
    // `process.env.GITHUB_SHA` so CI-published shots carry the
    // build SHA but local dev runs don't write a placeholder.
    await page.screenshot({
      path: SHOT_PATH,
      annot: {
        mdx: { id: SCREEN_ID, path: MDX_PATH },
        tags: {
          source: "docs-tour",
          screen: SCREEN_ID,
          capturedAt: new Date().toISOString(),
          ...(process.env.GITHUB_SHA ? { commit: process.env.GITHUB_SHA } : {}),
        },
      },
    });
  });
});
