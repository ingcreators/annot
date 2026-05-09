// @vitest-environment happy-dom

import { runStorageContract } from "@ingcreators/annot-web/storage/contract.test-helpers";
import type { BuildEditableImageDeps } from "@ingcreators/annot-web/storage/image-encode";
import { createMockDesktopFs } from "./desktop-fs.test-mock.js";
import { DesktopStore } from "./desktop-store.js";

/**
 * `DesktopStore` against the shared `StorageProvider` contract.
 *
 * Mirrors `device-store.contract.test.ts`'s pattern: hand the store
 * a fresh in-memory filesystem per test (`createMockDesktopFs`),
 * happy-dom for ambient `Blob` / `File` / `FileReader` /
 * `TextEncoder`, and pass a stubbed encode-deps object so the test
 * never reaches into the PWA's encoder worker (which lives behind
 * a Vite-resolved `new URL("./encode.worker.ts", import.meta.url)`
 * that doesn't survive an out-of-package import).
 *
 * Stub semantics match what the contract suite needs:
 *   - `renderImageRecord` is never called — every payload's
 *     `annotationsSvg` is ≤ 10 chars, hitting the `source-only`
 *     or `empty` strategy in `pickEncodeStrategy`.
 *   - `encodeCaptureInWorker` is never called for the same reason.
 *   - `loadEncodeOptions` returns a no-op shape; only consulted on
 *     the unreachable PNG re-encode branch.
 *   - `createEditableImage` runs for real (it's the actual XMP
 *     write that round-trips through `getImage` / `readEditableImage`).
 */

import { DEFAULT_ENCODE_OPTIONS } from "@ingcreators/annot-core/encode";
import { createEditableImage } from "@ingcreators/annot-core/xmp";

const stubDeps: BuildEditableImageDeps = {
  renderImageRecord: async () => {
    throw new Error("renderImageRecord should not be called in contract tests");
  },
  encodeCaptureInWorker: async (dataUrl: string) => ({
    dataUrl,
    chosen: "png",
  }),
  loadEncodeOptions: () => DEFAULT_ENCODE_OPTIONS,
  createEditableImage,
};

runStorageContract(
  "DesktopStore",
  () => new DesktopStore(createMockDesktopFs(), "mock-library", stubDeps),
);
