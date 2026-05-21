import { test } from "@ingcreators/annot-product-docs";

// Phase 5 of `docs/plans/annot-work-astro-unification.md` — the
// dogfood tour. Captures live screens of the Annot web app at
// `annot.work/app/` (production) or a maintainer-supplied URL
// passed via ANNOT_APP_URL, then resyncs the matching MDX
// snapshot blocks.
//
// Tour failures are advisory initially: the GitHub Actions
// workflow that runs this tour
// (`.github/workflows/docs-tour.yml`) marks failures as warning
// annotations, not blocking failures, until the screens are
// stable across 2-3 release cycles.
//
// Phase 5 scope (Open Question #1 resolution): all pages that
// explain the Annot web app. This PR ships ONE proof-of-concept
// capture against the `/app/` overview screen; expanding to
// the remaining /docs/app/* pages (sign-in / storage-backends
// / share-links) plus the screenshot-heavy getting-started /
// recipes pages is follow-up work.

const ANNOT_APP_URL = process.env.ANNOT_APP_URL || "https://annot.work/app/";

test.describe("Annot web app dogfood tour", () => {
  test("app overview", async ({ page, screen }) => {
    await page.goto(ANNOT_APP_URL);

    // Give the SPA chrome a beat to settle. Annot's web app
    // renders the editor toolbar + drawer at first paint, but
    // some right-panel sections lazy-render after the first
    // ImageRecord loads.
    await page.waitForLoadState("networkidle");

    await screen.capture({
      id: "app-overview",
      mdxPath: "src/content/docs/app/index.mdx",
    });
  });
});
