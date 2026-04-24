import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { describe, expect, it } from "vitest";

/**
 * Shared contract suite for every `StorageProvider` implementation.
 *
 * The `StorageProvider` interface is the contract Annot's editor /
 * gallery code targets — four independent implementations (Browser,
 * Device, Google Drive, GitHub) must all behave identically from
 * its perspective, otherwise a fix in one backend is a bug in
 * another. This helper encodes the invariants we rely on into a
 * table-driven test suite; each backend's `.contract.test.ts`
 * supplies a factory and gets a free battery of round-trip +
 * semantic checks.
 *
 * The tests here deliberately stay at the interface level:
 *   - No backend-specific methods (`forceRefresh`, `getViewUrl`,
 *     `verifyWriteAccess`, etc.) — those get their own unit tests.
 *   - No timing-sensitive behaviour (debounces, amend heuristics)
 *     — same reason.
 *   - No fields we can't assert back through the interface (commit
 *     messages, tree shapes, IDB keys).
 *
 * When adding a new contract, ask: "does every backend need to
 * honour this?" If yes, add it here and watch the backends that
 * fail catch up. If only some do, put it in a unit test.
 *
 * ## Current coverage
 *
 * All four backends implement the full contract:
 *
 * - `BrowserStore`     — `browser-store.contract.test.ts`
 *                        (fake-indexeddb per test)
 * - `GitHubStore`      — `github-store.contract.test.ts`
 *                        (msw + happy-dom + in-memory repo simulator
 *                        in `github-api.test-mock.ts`)
 * - `GoogleDriveStore` — `google-drive-store.contract.test.ts`
 *                        (msw + happy-dom + ID-native Drive simulator
 *                        in `google-drive-api.test-mock.ts`)
 * - `DeviceStore`      — `device-store.contract.test.ts`
 *                        (happy-dom + in-memory FileSystemDirectoryHandle
 *                        in `device-fs.test-mock.ts`)
 *
 * All payloads keep `annotationsSvg` ≤ 10 chars so the GitHub / Drive
 * stores' `#buildXmpBlob` skips the `renderImageRecord` +
 * `encodeCaptureInWorker` branch that would otherwise need a real
 * canvas pipeline — see the comment on the `updateImage` test below.
 */

/**
 * Factory: returns a fresh, empty `StorageProvider`. Each test
 * calls this in a `beforeEach` equivalent, so cross-test state
 * leaks are impossible.
 */
export type StorageFactory = () => Promise<StorageProvider> | StorageProvider;

/** Minimal valid `ImageRecord` payload. Tests extend this as needed. */
export function makeImagePayload(
  overrides: Partial<ImageRecord & { filename?: string }> = {},
): Omit<ImageRecord, "path"> & { filename?: string } {
  const now = new Date().toISOString();
  // 1x1 transparent PNG, smallest valid payload.
  const tinyPng =
    "data:image/png;base64," +
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  return {
    folderPath: "",
    originalDataUrl: tinyPng,
    thumbnailDataUrl: "",
    annotationsSvg: "",
    width: 1,
    height: 1,
    sourceUrl: "",
    tags: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Run the full contract suite against the given factory.
 *
 * @param backend Label used in the `describe` block — "BrowserStore",
 *                "GitHubStore", etc. Shows up as the test group name.
 * @param factory Returns a fresh storage instance per test.
 */
export function runStorageContract(backend: string, factory: StorageFactory): void {
  describe(`StorageProvider contract: ${backend}`, () => {
    // ---- saveImage / getImage / listImages ----

    it("saveImage → getImage returns the saved record with its path", async () => {
      const store = await factory();
      const payload = makeImagePayload({
        filename: "one.annot.png",
        annotationsSvg: "<g/>",
        tags: { a: "1" },
      });
      const path = await store.saveImage(payload);
      expect(path).toBe("one.annot.png");

      const back = await store.getImage(path);
      expect(back).toBeDefined();
      expect(back!.path).toBe(path);
      expect(back!.folderPath).toBe("");
      expect(back!.annotationsSvg).toBe("<g/>");
      expect(back!.tags).toEqual({ a: "1" });
    });

    it("saveImage chooses a filename when one isn't provided", async () => {
      const store = await factory();
      const path = await store.saveImage(makeImagePayload());
      expect(path).not.toBe("");
      expect(path).not.toContain("/"); // no folder, just a name
    });

    it("saveImage uniquifies a colliding filename with ' (2)', ' (3)', …", async () => {
      // Uniquify splits on the final `.` only, so `dup.annot.png`
      // becomes `dup.annot (2).png` — NOT `dup (2).annot.png`. The
      // contract is "insert ` (N)` before the last extension"; every
      // backend must match that rule, or round-tripping across stores
      // would produce different names for the same input.
      const store = await factory();
      await store.saveImage(makeImagePayload({ filename: "dup.annot.png" }));
      const p2 = await store.saveImage(makeImagePayload({ filename: "dup.annot.png" }));
      const p3 = await store.saveImage(makeImagePayload({ filename: "dup.annot.png" }));
      expect(p2).toBe("dup.annot (2).png");
      expect(p3).toBe("dup.annot (3).png");
    });

    it("listImages returns images in the requested folder only", async () => {
      const store = await factory();
      await store.saveImage(makeImagePayload({ filename: "root.annot.png" }));
      await store.createFolder("", "A");
      await store.saveImage(makeImagePayload({ filename: "a.annot.png", folderPath: "A" }));

      const rootImgs = await store.listImages("");
      const aImgs = await store.listImages("A");
      expect(rootImgs.map((r) => r.path).sort()).toEqual(["root.annot.png"]);
      expect(aImgs.map((r) => r.path).sort()).toEqual(["A/a.annot.png"]);
    });

    it("getImage returns undefined for an unknown path", async () => {
      const store = await factory();
      const back = await store.getImage("does/not/exist.annot.png");
      expect(back).toBeUndefined();
    });

    // ---- updateImage ----

    it("updateImage persists annotation + tag changes in place", async () => {
      // Keep the SVG payload short (≤10 chars). GitHubStore rerenders
      // the source image through a canvas pipeline whenever the SVG
      // exceeds that threshold, which drags a full DOM/canvas stack
      // into the test harness for no new coverage — the round-trip
      // itself is what's being exercised here.
      const store = await factory();
      const path = await store.saveImage(
        makeImagePayload({ filename: "u.annot.png", annotationsSvg: "<o/>", tags: {} }),
      );
      const returned = await store.updateImage(path, {
        annotationsSvg: "<n/>",
        tags: { t: "v" },
      });
      expect(returned).toBe(path);

      const back = await store.getImage(path);
      expect(back!.annotationsSvg).toBe("<n/>");
      expect(back!.tags).toEqual({ t: "v" });
    });

    it("updateImage with a new folderPath moves the image and returns the new path", async () => {
      const store = await factory();
      await store.createFolder("", "Dest");
      const path = await store.saveImage(makeImagePayload({ filename: "mv.annot.png" }));

      const newPath = await store.updateImage(path, { folderPath: "Dest" });
      expect(newPath).toBe("Dest/mv.annot.png");
      expect(await store.getImage(path)).toBeUndefined();
      const back = await store.getImage(newPath);
      expect(back).toBeDefined();
      expect(back!.folderPath).toBe("Dest");
    });

    // ---- renameImage ----

    it("renameImage changes the filename and preserves contents", async () => {
      const store = await factory();
      const path = await store.saveImage(
        makeImagePayload({ filename: "old.annot.png", annotationsSvg: "<a/>" }),
      );
      const newPath = await store.renameImage(path, "new.annot.png");
      expect(newPath).toBe("new.annot.png");
      expect(await store.getImage(path)).toBeUndefined();
      const back = await store.getImage(newPath);
      expect(back!.annotationsSvg).toBe("<a/>");
    });

    // ---- deleteImage ----

    it("deleteImage removes the record", async () => {
      const store = await factory();
      const path = await store.saveImage(makeImagePayload({ filename: "doomed.annot.png" }));
      await store.deleteImage(path);
      expect(await store.getImage(path)).toBeUndefined();
      const listed = await store.listImages("");
      expect(listed.map((r) => r.path)).not.toContain(path);
    });

    // ---- createFolder / listFolders / getFolder ----

    it("createFolder + listFolders surfaces the new folder under its parent", async () => {
      const store = await factory();
      const p = await store.createFolder("", "Alpha");
      expect(p).toBe("Alpha");
      const roots = await store.listFolders("");
      expect(roots.map((f) => f.path)).toContain("Alpha");
    });

    it("createFolder supports nested creation", async () => {
      const store = await factory();
      await store.createFolder("", "Alpha");
      const nested = await store.createFolder("Alpha", "Beta");
      expect(nested).toBe("Alpha/Beta");
      const children = await store.listFolders("Alpha");
      expect(children.map((f) => f.path)).toContain("Alpha/Beta");
    });

    it("createFolder throws when the same name already exists", async () => {
      const store = await factory();
      await store.createFolder("", "Dup");
      await expect(store.createFolder("", "Dup")).rejects.toThrow();
    });

    it("getFolder returns a record for an existing folder, undefined otherwise", async () => {
      const store = await factory();
      await store.createFolder("", "X");
      const rec = await store.getFolder("X");
      expect(rec?.path).toBe("X");
      expect(rec?.name).toBe("X");
      expect(rec?.parentPath).toBe("");
      expect(await store.getFolder("nope")).toBeUndefined();
    });

    // ---- renameFolder / moveFolder ----

    it("renameFolder updates paths of the folder and its children", async () => {
      const store = await factory();
      await store.createFolder("", "Before");
      await store.saveImage(
        makeImagePayload({ filename: "inside.annot.png", folderPath: "Before" }),
      );
      const newPath = await store.renameFolder("Before", "After");
      expect(newPath).toBe("After");
      expect(await store.getFolder("Before")).toBeUndefined();
      const listed = await store.listImages("After");
      expect(listed.map((r) => r.path)).toEqual(["After/inside.annot.png"]);
    });

    it("moveFolder relocates the folder under a new parent", async () => {
      const store = await factory();
      await store.createFolder("", "Src");
      await store.createFolder("", "Dest");
      await store.saveImage(makeImagePayload({ filename: "x.annot.png", folderPath: "Src" }));
      const newPath = await store.moveFolder("Src", "Dest");
      expect(newPath).toBe("Dest/Src");
      const listed = await store.listImages("Dest/Src");
      expect(listed.map((r) => r.path)).toEqual(["Dest/Src/x.annot.png"]);
    });

    // ---- deleteFolder ----

    it("deleteFolder cascades: images + sub-folders gone after delete", async () => {
      const store = await factory();
      await store.createFolder("", "Bulk");
      await store.saveImage(makeImagePayload({ filename: "a.annot.png", folderPath: "Bulk" }));
      await store.saveImage(makeImagePayload({ filename: "b.annot.png", folderPath: "Bulk" }));
      await store.deleteFolder("Bulk");
      expect(await store.getFolder("Bulk")).toBeUndefined();
      expect(await store.getImage("Bulk/a.annot.png")).toBeUndefined();
      expect(await store.getImage("Bulk/b.annot.png")).toBeUndefined();
    });

    // ---- getBreadcrumb ----

    it("getBreadcrumb returns [] for the root", async () => {
      const store = await factory();
      expect(await store.getBreadcrumb("")).toEqual([]);
    });

    it("getBreadcrumb walks root → target for a nested folder", async () => {
      const store = await factory();
      await store.createFolder("", "A");
      await store.createFolder("A", "B");
      await store.createFolder("A/B", "C");
      const crumbs = await store.getBreadcrumb("A/B/C");
      expect(crumbs.map((c) => c.path)).toEqual(["A", "A/B", "A/B/C"]);
    });
  });
}
