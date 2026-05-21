import { writeFile } from "node:fs/promises";

import { test } from "@ingcreators/annot-product-docs";
import { renderAnnotatedScreen } from "@ingcreators/annot-product-docs-astro";

// Dogfood tour. Captures live screens of the Annot web app at
// `annot.work/app/` (production) or a maintainer-supplied URL
// passed via ANNOT_APP_URL, then:
//   1. Saves the raw screenshot PNG to a temp variable.
//   2. Runs `screen.capture(...)` to refresh the MDX
//      `annot:snapshot` + `annot:attributes` comment blocks.
//   3. Calls `renderAnnotatedScreen(..., { editable })` with the
//      raw bytes to bake numbered callout badges onto the
//      screenshot using the bbox markers from the refreshed
//      snapshot AND embed the original capture + annotations
//      SVG in the PNG's XMP / `svGo` chunk via the new
//      `Annotator.toEditablePng()` path.
//   4. Writes the editable PNG to `public/app/shots/<id>.png`
//      so Astro serves it under `/docs/app/shots/<id>.png` at
//      build time. The file is a valid PNG for image viewers
//      AND drop-in re-editable in Annot Cloud
//      (`annot.work/app/`) for any reader who wants to tweak
//      the callouts.
//
// Why pass `basePngBytes`: the MDX's `<Screen src>` is the
// absolute browser URL (`/docs/app/shots/...`) because Astro
// serves static assets from `public/`, not from `src/content/`.
// `renderAnnotatedScreen`'s default `loadBasePng` would treat
// that URL as a filesystem path and fail. The `basePngBytes`
// override skips the load step and uses the raw screenshot
// directly.
//
// Tour failures are advisory: `docs-tour.yml` has
// `continue-on-error: true` while the tour stabilises.

const ANNOT_APP_URL = process.env.ANNOT_APP_URL || "https://annot.work/app/";
const MDX_PATH = "src/content/docs/app/index.mdx";
const SHOT_PATH = "public/app/shots/app-overview.png";
const SCREEN_ID = "app-overview";

test.describe("Annot web app dogfood tour", () => {
  test("app overview", async ({ page, screen }) => {
    await page.goto(ANNOT_APP_URL);

    // Give the SPA chrome a beat to settle. Annot's web app
    // renders the editor toolbar + drawer at first paint, but
    // some right-panel sections lazy-render after the first
    // ImageRecord loads.
    await page.waitForLoadState("networkidle");

    // 1. Raw screenshot bytes (kept in memory; we don't write
    //    them to disk — only the annotated version goes to
    //    public/).
    const rawBytes = await page.screenshot({ fullPage: false });

    // 2. Re-sync the MDX `annot:snapshot` + `annot:attributes`
    //    comment blocks against the live aria-snapshot. This
    //    must run BEFORE step 3 so `renderAnnotatedScreen`
    //    reads the refreshed bbox markers.
    await screen.capture({
      id: SCREEN_ID,
      mdxPath: MDX_PATH,
    });

    // 3. Bake the numbered callout badges onto the screenshot
    //    using the refreshed bbox data. `basePngBytes` skips
    //    `renderAnnotatedScreen`'s default file-system load
    //    (which would try to read `/docs/app/shots/...` as a
    //    filesystem path).
    //
    //    `editable: { tags }` swaps the underlying annotator call
    //    from `toPng` to `toEditablePng`, so the output PNG
    //    carries the original capture + annotations SVG embedded
    //    in XMP. Anyone visiting
    //    `https://annot.work/docs/app/shots/<id>.png` can save the
    //    image and drop it into `annot.work/app/` to tweak the
    //    callouts.
    const result = await renderAnnotatedScreen({
      mdxPath: MDX_PATH,
      screenId: SCREEN_ID,
      basePngBytes: new Uint8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength),
      editable: {
        tags: {
          source: "docs-tour",
          screen: SCREEN_ID,
          capturedAt: new Date().toISOString(),
          ...(process.env.GITHUB_SHA ? { commit: process.env.GITHUB_SHA } : {}),
        },
      },
    });

    // 4. Persist the annotated PNG to Astro's `public/` so it's
    //    served as a static asset at the URL the MDX references.
    await writeFile(SHOT_PATH, result.bytes);
  });
});
