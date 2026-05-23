/**
 * @vitest-environment happy-dom
 *
 * Annotation YAML loader tests — Phase 4b of
 * `docs/plans/living-spec-authoring-roadmap.md`.
 *
 * Covers the three branches of {@link loadAnnotationsYaml}:
 *   1. Store doesn't implement the Phase 4a capability → `null`
 *   2. Capability present + sidecar missing → `null`
 *   3. Capability present + sidecar exists → parsed `AnnotationsFile`
 *
 * Plus loud-fail on a malformed yaml so callers see the parse
 * error instead of silently falling back to "empty".
 */

import type { StorageProvider } from "@ingcreators/annot-core/storage";
import { ANNOTATIONS_YAML_VERSION } from "@ingcreators/annot-product-docs/annotations-yaml";
import { describe, expect, it } from "vitest";
import { loadAnnotationsYaml } from "./annotation-yaml-loader.js";

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

/** Bare StorageProvider stub — no document / yaml capability. */
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

/** Store with the Phase 4a yaml capability backed by an in-memory map. */
function makeYamlStore(initial: Record<string, string> = {}): StorageProvider {
  const sidecars = new Map<string, string>(Object.entries(initial));
  return {
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
  } as StorageProvider;
}

describe("loadAnnotationsYaml", () => {
  it("returns null when the store lacks the Phase 4a yaml capability", async () => {
    const result = await loadAnnotationsYaml(bareStorage(), "shots/login.png");
    expect(result).toBeNull();
  });

  it("returns null when the capability is present but the sidecar is missing", async () => {
    const store = makeYamlStore();
    expect(await loadAnnotationsYaml(store, "shots/login.png")).toBeNull();
  });

  it("returns the parsed AnnotationsFile when the sidecar exists", async () => {
    const store = makeYamlStore({ "shots/login.png": SAMPLE_YAML });
    const file = await loadAnnotationsYaml(store, "shots/login.png");
    expect(file).not.toBeNull();
    expect(file?.version).toBe(ANNOTATIONS_YAML_VERSION);
    expect(file?.overlays).toHaveLength(1);
    expect(file?.overlays[0]?.id).toBe("o1");
    expect(file?.overlays[0]?.match).toEqual({ role: "textbox", name: "Email" });
    expect(file?.overlays[0]?.intent).toBe("required");
    expect(file?.overlays[0]?.number).toBe(1);
  });

  it("propagates parse errors (loud-fail) instead of returning null", async () => {
    const store = makeYamlStore({ "shots/login.png": "version: 99\noverlays: not-a-list\n" });
    await expect(loadAnnotationsYaml(store, "shots/login.png")).rejects.toThrow();
  });
});
