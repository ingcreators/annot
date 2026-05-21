import { writeFile } from "node:fs/promises";

import { test } from "@ingcreators/annot-product-docs";

// Dogfood tour. Captures live screens of the Annot web app at
// `annot.work/app/` (production) or a maintainer-supplied URL
// passed via ANNOT_APP_URL, then:
//   1. Saves the base screenshot PNG to `public/app/shots/<id>.png`
//      so Astro serves it under `/docs/app/shots/<id>.png` at
//      build time (the `<Screen src>` value in the MDX).
//   2. Runs `screen.capture(...)` to refresh the MDX
//      `annot:snapshot` + `annot:attributes` comment blocks.
//
// Tour failures are advisory: `docs-tour.yml` has
// `continue-on-error: true` while the tour stabilises.

const ANNOT_APP_URL = process.env.ANNOT_APP_URL || "https://annot.work/app/";

test.describe("Annot web app dogfood tour", () => {
  test("app overview", async ({ page, screen }) => {
    await page.goto(ANNOT_APP_URL);

    // Give the SPA chrome a beat to settle. Annot's web app
    // renders the editor toolbar + drawer at first paint, but
    // some right-panel sections lazy-render after the first
    // ImageRecord loads.
    await page.waitForLoadState("networkidle");

    // 1. Persist the base screenshot to Astro's `public/` so it's
    //    served as a static asset at the URL the MDX references.
    const pngBytes = await page.screenshot({ fullPage: false });
    await writeFile("public/app/shots/app-overview.png", pngBytes);

    // 2. Re-sync the MDX `annot:snapshot` + `annot:attributes`
    //    comment blocks against the live aria-snapshot.
    await screen.capture({
      id: "app-overview",
      mdxPath: "src/content/docs/app/index.mdx",
    });
  });
});
