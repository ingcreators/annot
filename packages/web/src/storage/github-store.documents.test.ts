/**
 * @vitest-environment happy-dom
 *
 * `GitHubStore` document support — Phase 7d of
 * `docs/plans/annot-html-document.md`.
 *
 * GitHub's REST surface (recursive tree fetch + Contents API
 * commit-as-save) is exercised end-to-end by
 * `github-store.contract.test.ts` against the MSW-backed
 * `github-api.test-mock.ts`. That mock doesn't yet model
 * `text/html` payloads or `.annot.html` extensions, so this file
 * covers the parts of Phase 7d we can exercise without extending
 * the mock — the capability narrowing on a real `GitHubStore`
 * instance — and explicitly defers full saveDocument /
 * getDocument round-trip coverage to the follow-up that grows the
 * mock.
 *
 * The contract test still runs — it doesn't exercise documents,
 * but its image-side coverage confirms that Phase 7d's changes
 * (the new `#docMeta` cache + extended `deleteImage` cleanup +
 * the `StorageWithDocuments` opt-in) haven't regressed the image
 * flows.
 */

import { supportsDocuments } from "@ingcreators/annot-core/storage";
import { describe, expect, it } from "vitest";
import { GitHubStore } from "./github-store.js";

describe("GitHubStore: supportsDocuments narrowing", () => {
  it("narrows GitHubStore to StorageWithDocuments", () => {
    // Construct directly with a fake repo ref so we don't hit
    // the network. The narrowing check is structural — it only
    // verifies the four document methods are present + callable.
    const store = new GitHubStore("fake-pat-for-tests", {
      owner: "annot-test",
      repo: "sandbox",
      branch: "main",
      basePath: "",
    });
    expect(supportsDocuments(store)).toBe(true);
  });
});
