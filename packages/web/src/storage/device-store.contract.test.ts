// @vitest-environment happy-dom
import { vi } from "vitest";
import { runStorageContract } from "./contract.test-helpers.js";
import { createMockRoot } from "./device-fs.test-mock.js";
import { DeviceStore } from "./device-store.js";

/**
 * DeviceStore against the shared StorageProvider contract.
 *
 * DeviceStore sits on the File System Access API — `showDirectory-
 * Picker()` returns a `FileSystemDirectoryHandle` the store then
 * operates against. There's no standard polyfill for the API, but
 * the store only touches a dozen methods; `device-fs.test-mock.ts`
 * implements that subset in-memory. The factory below hands the
 * store a fresh `MockDirectoryHandle` as its root for every test,
 * and happy-dom supplies the ambient `Blob` / `File` / `FileReader`
 * / `fetch` primitives the XMP pipeline needs.
 *
 * The worker stub mirrors the Drive / GitHub contract tests —
 * short-SVG payloads from `makeImagePayload` never actually hit the
 * worker, but the stub shields us from any future contract addition
 * crossing the 10-char SVG threshold.
 */

vi.mock("../workers/encode-client.js", () => ({
  encodeCaptureInWorker: async (dataUrl: string) => ({ dataUrl }),
}));

runStorageContract(
  "DeviceStore",
  () => new DeviceStore(createMockRoot() as unknown as FileSystemDirectoryHandle),
);
