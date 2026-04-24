// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { runStorageContract } from "./contract.test-helpers.js";
import { startGitHubMockServer } from "./github-api.test-mock.js";
import { GitHubStore } from "./github-store.js";

/**
 * GitHubStore against the shared StorageProvider contract.
 *
 * happy-dom gives us `Blob`, `FileReader`, `TextEncoder`, `fetch`
 * with data-URL support, and a functional `window` — enough to let
 * `createEditableImage` run its PNG code path end-to-end without
 * touching a real canvas. Contract payloads keep `annotationsSvg`
 * short (≤ 10 chars) so {@link GitHubStore.#buildXmpBlob} skips the
 * `renderImageRecord` branch that would otherwise need a canvas +
 * worker pipeline — see comment in `contract.test-helpers.ts`.
 *
 * The worker-backed PNG re-encode (`encodeCaptureInWorker`) is
 * stubbed to a passthrough below; under short-SVG payloads it's
 * never reached anyway, but the stub guards against accidental
 * reaches on future contract additions.
 */

// ---- Worker stub -----------------------------------------------------------
// The encode-client module spawns a Web Worker via Vite's
// `new Worker(new URL(...), { type: "module" })` syntax, which fails
// under Node/happy-dom. Replace the exported helper with a no-op
// passthrough. Only saveImage with long annotations (>10 char SVG)
// actually calls into it; the contract tests stay below that bar.
vi.mock("../workers/encode-client.js", () => ({
  encodeCaptureInWorker: async (dataUrl: string) => ({ dataUrl }),
}));

// ---- MSW lifecycle ---------------------------------------------------------
const { server, reset } = startGitHubMockServer();

// `bypass` lets `fetch("data:…")` in `#buildXmpBlob` resolve via
// happy-dom's native handler instead of tripping MSW's unhandled-
// request guard. Every real GitHub API call has an explicit handler
// below, so legitimate network activity still surfaces as an error.
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  reset();
});
afterAll(() => server.close());

// ---- Per-test state reset --------------------------------------------------
// Each test runs against a fresh, empty repo. The factory just swaps
// in a new GitHubStore pointed at the (reset-per-test) repo state.
beforeEach(() => {
  reset();
});

runStorageContract(
  "GitHubStore",
  () =>
    new GitHubStore("fake-pat-for-tests", {
      owner: "annot-test",
      repo: "sandbox",
      branch: "main",
      basePath: "",
    }),
);
