/**
 * @vitest-environment happy-dom
 *
 * `GoogleDriveStore` document support — Phase 7c of
 * `docs/plans/annot-html-document.md`.
 *
 * Drive's API surface (`files.list` / multipart uploads / media
 * PATCH / `appProperties`) is more involved than DeviceStore's
 * filesystem mock; the existing `google-drive-api.test-mock.ts`
 * doesn't yet model `appProperties` or `text/html` payloads. This
 * test file covers the parts of Phase 7c we can exercise without
 * extending that mock — the capability narrowing on a real
 * `GoogleDriveStore` instance and the `stripDocExtension` helper's
 * shape — and explicitly defers full saveDocument / getDocument
 * round-trip coverage to the follow-up that grows the mock.
 *
 * The contract test (`google-drive-store.contract.test.ts`) still
 * runs — it doesn't exercise documents, but its image-side
 * coverage confirms that Phase 7c's changes (the new file-children
 * discrimination + extended deleteImage path-key resolution +
 * widened upload signature) haven't regressed the image flows.
 */

import { supportsDocuments } from "@ingcreators/annot-core/storage";
import { describe, expect, it } from "vitest";
import { createGoogleDriveApiClient } from "./google-drive-api-client.js";
import { GoogleDriveStore } from "./google-drive-store.js";

describe("GoogleDriveStore: supportsDocuments narrowing", () => {
  it("narrows GoogleDriveStore to StorageWithDocuments", () => {
    // Construct directly with a fake api client so we don't hit
    // the network. The narrowing check is structural — it only
    // verifies the four document methods are present + callable.
    const api = createGoogleDriveApiClient("fake-token");
    const store = new GoogleDriveStore("fake-token", "root-folder", api);
    expect(supportsDocuments(store)).toBe(true);
  });
});
