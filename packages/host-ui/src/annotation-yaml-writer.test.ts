/**
 * @vitest-environment happy-dom
 *
 * Annotation YAML writer tests — Phase 4b of
 * `docs/plans/living-spec-authoring-roadmap.md`.
 *
 * Covers:
 *   1. Throws `AnnotationsYamlUnsupportedError` when the store
 *      lacks the Phase 4a capability (safety-net for callers
 *      that forgot to gate on `supportsAnnotationsYaml`).
 *   2. Writes the serialized form when capability is present.
 *   3. Idempotency — saving an equal `AnnotationsFile` twice
 *      produces byte-identical store contents.
 *   4. Round-trip with the Phase 4b loader — saving a file then
 *      loading returns a deeply-equal `AnnotationsFile`.
 */

import type { StorageProvider } from "@ingcreators/annot-core/storage";
import type { AnnotationsFile } from "@ingcreators/annot-product-docs";
import { describe, expect, it } from "vitest";
import { loadAnnotationsYaml } from "./annotation-yaml-loader.js";
import { AnnotationsYamlUnsupportedError, saveAnnotationsYaml } from "./annotation-yaml-writer.js";

function bareStorage(): StorageProvider {
  const stub = (() => {
    throw new Error("not implemented");
  }) as never;
  return {
    saveImage: stub,
    getImage: stub,
    listImages: stub,
    updateImage: stub,
    moveImage: stub,
    renameImage: stub,
    deleteImage: stub,
    createFolder: stub,
    listFolders: stub,
    getFolder: stub,
    renameFolder: stub,
    moveFolder: stub,
    deleteFolder: stub,
    getBreadcrumb: stub,
  };
}

/**
 * In-memory store with the Phase 4a yaml capability. Exposes
 * the underlying sidecar map for assertions on persisted bytes.
 */
function makeYamlStore(): StorageProvider & { sidecars: Map<string, string> } {
  const sidecars = new Map<string, string>();
  const store = {
    ...bareStorage(),
    saveDocument: async () => "",
    getDocument: async () => undefined,
    listDocuments: async () => [],
    updateDocument: async () => {},
    async getAnnotationsYaml(pngPath: string) {
      return sidecars.get(pngPath);
    },
    async setAnnotationsYaml(pngPath: string, content: string) {
      sidecars.set(pngPath, content);
    },
    sidecars,
  } as StorageProvider & { sidecars: Map<string, string> };
  return store;
}

const SAMPLE_FILE: AnnotationsFile = {
  version: 1,
  overlays: [
    {
      id: "o1",
      kind: "numberedBadge",
      match: { role: "textbox", name: "Email" },
      intent: "required",
      number: 1,
    },
  ],
};

describe("saveAnnotationsYaml", () => {
  it("throws AnnotationsYamlUnsupportedError when the store lacks the capability", async () => {
    await expect(
      saveAnnotationsYaml(bareStorage(), "login.png", SAMPLE_FILE),
    ).rejects.toBeInstanceOf(AnnotationsYamlUnsupportedError);
  });

  it("writes the serialized AnnotationsFile to the store", async () => {
    const store = makeYamlStore();
    await saveAnnotationsYaml(store, "login.png", SAMPLE_FILE);
    const written = store.sidecars.get("login.png");
    expect(written).toBeDefined();
    expect(written).toContain("version: 1");
    expect(written).toContain("id: o1");
    expect(written).toContain("kind: numberedBadge");
    expect(written).toContain("Email");
  });

  it("is idempotent — saving the same file twice produces identical bytes", async () => {
    const store = makeYamlStore();
    await saveAnnotationsYaml(store, "login.png", SAMPLE_FILE);
    const first = store.sidecars.get("login.png");
    await saveAnnotationsYaml(store, "login.png", SAMPLE_FILE);
    const second = store.sidecars.get("login.png");
    expect(second).toBe(first);
  });

  it("save → load round-trips the AnnotationsFile structurally", async () => {
    const store = makeYamlStore();
    await saveAnnotationsYaml(store, "login.png", SAMPLE_FILE);
    const loaded = await loadAnnotationsYaml(store, "login.png");
    expect(loaded).toEqual(SAMPLE_FILE);
  });

  it("replaces an existing sidecar atomically", async () => {
    const store = makeYamlStore();
    await saveAnnotationsYaml(store, "login.png", SAMPLE_FILE);
    const updated: AnnotationsFile = {
      ...SAMPLE_FILE,
      overlays: [
        ...SAMPLE_FILE.overlays,
        {
          id: "o2",
          kind: "numberedBadge",
          match: { role: "textbox", name: "Password" },
          number: 2,
        },
      ],
    };
    await saveAnnotationsYaml(store, "login.png", updated);
    const loaded = await loadAnnotationsYaml(store, "login.png");
    expect(loaded?.overlays).toHaveLength(2);
    expect(loaded?.overlays[1]?.id).toBe("o2");
  });
});
