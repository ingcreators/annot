// @vitest-environment happy-dom
/**
 * `GoogleDriveStore` annotations YAML sidecar tests — Phase 4a of
 * `docs/plans/living-spec-authoring-roadmap.md`. Exercises the
 * `getAnnotationsYaml` / `setAnnotationsYaml` methods against the
 * MSW-backed Drive REST mock. The mock's `files.list` query parser
 * was extended in the same PR to filter on `name = 'X'` so the
 * store's `#findChildIdByName` lookup resolves correctly.
 */

import { supportsAnnotationsYaml } from "@ingcreators/annot-core/storage";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startDriveMockServer } from "./google-drive-api.test-mock.js";
import { GoogleDriveStore } from "./google-drive-store.js";

vi.mock("../workers/encode-client.js", () => ({
  encodeCaptureInWorker: async (dataUrl: string) => ({ dataUrl }),
}));

const ROOT_FOLDER_ID = "root-0000";
const { server, reset } = startDriveMockServer(ROOT_FOLDER_ID);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  reset();
});
afterAll(() => server.close());

beforeEach(() => {
  reset();
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

function makeStore(): GoogleDriveStore {
  return new GoogleDriveStore("fake-token", ROOT_FOLDER_ID);
}

describe("GoogleDriveStore annotations YAML sidecar", () => {
  it("supportsAnnotationsYaml narrows GoogleDriveStore positively", () => {
    const store = makeStore();
    expect(supportsAnnotationsYaml(store)).toBe(true);
  });

  it("getAnnotationsYaml returns undefined when no sidecar exists", async () => {
    const store = makeStore();
    expect(await store.getAnnotationsYaml("login.png")).toBeUndefined();
  });

  it("setAnnotationsYaml then getAnnotationsYaml round-trips byte-identically", async () => {
    const store = makeStore();
    await store.setAnnotationsYaml("login.png", SAMPLE_YAML);
    expect(await store.getAnnotationsYaml("login.png")).toBe(SAMPLE_YAML);
  });

  it("setAnnotationsYaml replaces existing content via PATCH", async () => {
    const store = makeStore();
    await store.setAnnotationsYaml("login.png", SAMPLE_YAML);
    const replacement = `${SAMPLE_YAML}  - id: o2\n    kind: numberedBadge\n    match: { role: textbox, name: Password }\n    number: 2\n`;
    await store.setAnnotationsYaml("login.png", replacement);
    expect(await store.getAnnotationsYaml("login.png")).toBe(replacement);
  });

  it("derives sidecar name as <pngFilename>.annotations.yaml within the same folder", async () => {
    const store = makeStore();
    await store.setAnnotationsYaml("login.png", SAMPLE_YAML);
    expect(await store.getAnnotationsYaml("login.png")).toBe(SAMPLE_YAML);
    expect(await store.getAnnotationsYaml("other.png")).toBeUndefined();
  });
});
