// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { runStorageContract } from "./contract.test-helpers.js";
import { startDriveMockServer } from "./google-drive-api.test-mock.js";
import { GoogleDriveStore } from "./google-drive-store.js";

/**
 * GoogleDriveStore against the shared StorageProvider contract.
 *
 * Same shape as `github-store.contract.test.ts` — happy-dom gives us
 * the DOM-shaped APIs (`Blob`, `FileReader`, `fetch`, `atob/btoa`)
 * that `createEditableImage`'s PNG path + `#uploadFile`'s multipart
 * assembly need, and msw intercepts the v3 REST calls against the
 * in-memory Drive simulator in `google-drive-api.test-mock.ts`.
 *
 * The contract helper deliberately keeps `annotationsSvg` ≤ 10 chars
 * so `#buildXmpBlob` skips `renderImageRecord` + `encodeCaptureInWorker`
 * (see comment in `contract.test-helpers.ts`). The worker stub below
 * is a belt-and-braces guard against a future contract addition
 * crossing that threshold.
 */

vi.mock("../workers/encode-client.js", () => ({
  encodeCaptureInWorker: async (dataUrl: string) => ({ dataUrl }),
}));

const ROOT_FOLDER_ID = "root-0000";
const { server, reset } = startDriveMockServer(ROOT_FOLDER_ID);

// `bypass` lets `fetch("data:…")` in `#buildXmpBlob` resolve through
// happy-dom's native handler instead of tripping MSW's unhandled-
// request guard. Every Drive REST call has an explicit handler so
// legitimate network activity still surfaces as an error.
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  reset();
});
afterAll(() => server.close());

beforeEach(() => {
  reset();
});

runStorageContract("GoogleDriveStore", () => new GoogleDriveStore("fake-token", ROOT_FOLDER_ID));
