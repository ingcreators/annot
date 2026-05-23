/**
 * @vitest-environment happy-dom
 *
 * `DesktopStore` annotations YAML sidecar tests — Phase 4a of
 * `docs/plans/living-spec-authoring-roadmap.md`. Mirrors
 * `device-store.annotations-yaml.test.ts` against the in-memory
 * `DesktopFs` mock.
 */

import { DEFAULT_ENCODE_OPTIONS } from "@ingcreators/annot-core/encode";
import { supportsAnnotationsYaml } from "@ingcreators/annot-core/storage";
import { createEditableImage } from "@ingcreators/annot-core/xmp";
import { IndexedDBMetadataCache } from "@ingcreators/annot-host-ui/idb-metadata-cache";
import type { BuildEditableImageDeps } from "@ingcreators/annot-web/storage/image-encode";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { createMockDesktopFs } from "./desktop-fs.test-mock.js";
import { DesktopStore } from "./desktop-store.js";

const stubDeps: BuildEditableImageDeps = {
  renderImageRecord: async () => {
    throw new Error("renderImageRecord should not be called in annotations-yaml tests");
  },
  encodeCaptureInWorker: async (dataUrl: string) => ({ dataUrl, chosen: "png" }),
  loadEncodeOptions: () => DEFAULT_ENCODE_OPTIONS,
  createEditableImage,
};

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

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

function makeStore(): DesktopStore {
  const store = new DesktopStore(createMockDesktopFs(), "mock-library", stubDeps);
  store.attachMetadataCache(
    new IndexedDBMetadataCache({
      channelName: `desktop-store-annotations-yaml-${Math.random().toString(36).slice(2)}`,
      dispatchWindowEvents: false,
    }),
  );
  return store;
}

describe("DesktopStore annotations YAML sidecar", () => {
  it("supportsAnnotationsYaml narrows DesktopStore positively", () => {
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

  it("setAnnotationsYaml is idempotent", async () => {
    const store = makeStore();
    await store.setAnnotationsYaml("login.png", SAMPLE_YAML);
    await store.setAnnotationsYaml("login.png", SAMPLE_YAML);
    expect(await store.getAnnotationsYaml("login.png")).toBe(SAMPLE_YAML);
  });

  it("setAnnotationsYaml replaces existing content", async () => {
    const store = makeStore();
    await store.setAnnotationsYaml("login.png", SAMPLE_YAML);
    const replacement = `${SAMPLE_YAML}  - id: o2\n    kind: numberedBadge\n    match: { role: textbox, name: Password }\n    number: 2\n`;
    await store.setAnnotationsYaml("login.png", replacement);
    expect(await store.getAnnotationsYaml("login.png")).toBe(replacement);
  });

  it("derives sidecar path from PNG path as <pngPath>.annotations.yaml", async () => {
    const store = makeStore();
    await store.setAnnotationsYaml("shots/mobile/login.png", SAMPLE_YAML);
    expect(await store.getAnnotationsYaml("shots/mobile/login.png")).toBe(SAMPLE_YAML);
    expect(await store.getAnnotationsYaml("shots/mobile/other.png")).toBeUndefined();
  });

  it("creates the parent folder on first write", async () => {
    const store = makeStore();
    await store.setAnnotationsYaml("never-touched-folder/login.png", SAMPLE_YAML);
    expect(await store.getAnnotationsYaml("never-touched-folder/login.png")).toBe(SAMPLE_YAML);
  });
});
