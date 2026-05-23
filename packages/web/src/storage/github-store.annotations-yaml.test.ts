// @vitest-environment happy-dom
/**
 * `GitHubStore` annotations YAML sidecar tests — Phase 4a of
 * `docs/plans/living-spec-authoring-roadmap.md`. Exercises the
 * `getAnnotationsYaml` / `setAnnotationsYaml` methods against the
 * MSW-backed GitHub Contents API mock, verifying the
 * `supportsAnnotationsYaml` predicate narrows positively and the
 * commit-as-save semantics survive a create + update + read cycle.
 */

import { supportsAnnotationsYaml } from "@ingcreators/annot-core/storage";
import { IndexedDBMetadataCache } from "@ingcreators/annot-host-ui/idb-metadata-cache";
import { IDBFactory } from "fake-indexeddb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startGitHubMockServer } from "./github-api.test-mock.js";
import { GitHubStore } from "./github-store.js";

vi.mock("../workers/encode-client.js", () => ({
  encodeCaptureInWorker: async (dataUrl: string) => ({ dataUrl }),
}));

const { server, reset } = startGitHubMockServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  reset();
});
afterAll(() => server.close());

beforeEach(() => {
  reset();
  globalThis.indexedDB = new IDBFactory();
});

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

function makeStore(): GitHubStore {
  const store = new GitHubStore("fake-pat-for-tests", {
    owner: "annot-test",
    repo: "sandbox",
    branch: "main",
    basePath: "",
  });
  store.attachMetadataCache(
    new IndexedDBMetadataCache({
      channelName: `github-store-annotations-yaml-${Math.random().toString(36).slice(2)}`,
      dispatchWindowEvents: false,
    }),
  );
  return store;
}

describe("GitHubStore annotations YAML sidecar", () => {
  it("supportsAnnotationsYaml narrows GitHubStore positively", () => {
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

  it("setAnnotationsYaml replaces existing content via update commit", async () => {
    const store = makeStore();
    await store.setAnnotationsYaml("login.png", SAMPLE_YAML);
    const replacement = `${SAMPLE_YAML}  - id: o2\n    kind: numberedBadge\n    match: { role: textbox, name: Password }\n    number: 2\n`;
    await store.setAnnotationsYaml("login.png", replacement);
    expect(await store.getAnnotationsYaml("login.png")).toBe(replacement);
  });

  it("derives sidecar path as <pngPath>.annotations.yaml", async () => {
    const store = makeStore();
    await store.setAnnotationsYaml("shots/mobile/login.png", SAMPLE_YAML);
    expect(await store.getAnnotationsYaml("shots/mobile/login.png")).toBe(SAMPLE_YAML);
    expect(await store.getAnnotationsYaml("shots/mobile/other.png")).toBeUndefined();
  });
});
