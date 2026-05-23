/**
 * @vitest-environment happy-dom
 *
 * `DeviceStore` annotations YAML sidecar tests — Phase 4a of
 * `docs/plans/living-spec-authoring-roadmap.md`. Verifies the
 * optional `getAnnotationsYaml` / `setAnnotationsYaml` methods +
 * the `supportsAnnotationsYaml` predicate narrowing on a real
 * `DeviceStore` instance.
 */

import { supportsAnnotationsYaml } from "@ingcreators/annot-core/storage";
import { IndexedDBMetadataCache } from "@ingcreators/annot-host-ui/idb-metadata-cache";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRoot } from "./device-fs.test-mock.js";
import { DeviceStore } from "./device-store.js";

vi.mock("../workers/encode-client.js", () => ({
  encodeCaptureInWorker: async (dataUrl: string) => ({ dataUrl }),
}));

const SAMPLE_YAML = `version: 1
overlays:
  - id: o1
    kind: numberedBadge
    match:
      role: textbox
      name: Email
    intent: required
    number: 1
`;

function makeStore(): DeviceStore {
  const store = new DeviceStore(createMockRoot() as unknown as FileSystemDirectoryHandle);
  store.attachMetadataCache(
    new IndexedDBMetadataCache({
      channelName: `device-store-annotations-yaml-${Math.random().toString(36).slice(2)}`,
      dispatchWindowEvents: false,
    }),
  );
  return store;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("DeviceStore annotations YAML sidecar", () => {
  it("supportsAnnotationsYaml narrows DeviceStore positively", () => {
    const store = makeStore();
    expect(supportsAnnotationsYaml(store)).toBe(true);
  });

  it("getAnnotationsYaml returns undefined when no sidecar exists", async () => {
    const store = makeStore();
    expect(await store.getAnnotationsYaml("shots/login.png")).toBeUndefined();
  });

  it("setAnnotationsYaml then getAnnotationsYaml round-trips byte-identically", async () => {
    const store = makeStore();
    await store.setAnnotationsYaml("shots/login.png", SAMPLE_YAML);
    expect(await store.getAnnotationsYaml("shots/login.png")).toBe(SAMPLE_YAML);
  });

  it("setAnnotationsYaml is idempotent (same content twice produces the same bytes)", async () => {
    const store = makeStore();
    await store.setAnnotationsYaml("login.png", SAMPLE_YAML);
    await store.setAnnotationsYaml("login.png", SAMPLE_YAML);
    expect(await store.getAnnotationsYaml("login.png")).toBe(SAMPLE_YAML);
  });

  it("setAnnotationsYaml replaces existing content atomically", async () => {
    const store = makeStore();
    await store.setAnnotationsYaml("login.png", SAMPLE_YAML);
    const replacement = `${SAMPLE_YAML}  - id: o2\n    kind: numberedBadge\n    match:\n      role: textbox\n      name: Password\n    number: 2\n`;
    await store.setAnnotationsYaml("login.png", replacement);
    expect(await store.getAnnotationsYaml("login.png")).toBe(replacement);
  });

  it("derives sidecar path from PNG path as <pngPath>.annotations.yaml", async () => {
    const store = makeStore();
    await store.setAnnotationsYaml("shots/mobile/login.png", SAMPLE_YAML);
    // The sidecar is addressed by the PNG path, not the yaml path.
    expect(await store.getAnnotationsYaml("shots/mobile/login.png")).toBe(SAMPLE_YAML);
    // A different PNG in the same folder doesn't pick up the sidecar.
    expect(await store.getAnnotationsYaml("shots/mobile/other.png")).toBeUndefined();
  });

  it("creates the parent folder on first write", async () => {
    const store = makeStore();
    // No saveImage was called yet, so the folder doesn't exist.
    await store.setAnnotationsYaml("never-touched-folder/login.png", SAMPLE_YAML);
    expect(await store.getAnnotationsYaml("never-touched-folder/login.png")).toBe(SAMPLE_YAML);
  });
});
