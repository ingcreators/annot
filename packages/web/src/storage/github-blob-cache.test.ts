// Pure-Node tests for GitHubBlobCache. No DOM, no fetch — just
// state-machine assertions over the four-Map cache and its
// compound `purge` / `migrateEntry` / `rewriteEntriesForPrefix`
// helpers.

import type { ImageRecord } from "@ingcreators/annot-core/storage";
import { describe, expect, it } from "vitest";
import { GitHubBlobCache } from "./github-blob-cache.js";

/** Build a minimal `ImageRecord` for use as a test fixture. The
 *  cache class only needs the shape; field defaults match the
 *  most common production values so any test that does inspect
 *  `record.path` / `folderPath` is exercising real semantics. */
function makeRecord(path: string, overrides: Partial<ImageRecord> = {}): ImageRecord {
  return {
    path,
    originalDataUrl: "data:image/png;base64,AAAA",
    thumbnailDataUrl: "data:image/png;base64,AAAA",
    annotationsSvg: "",
    width: 100,
    height: 100,
    sourceUrl: "",
    tags: {},
    folderPath: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("GitHubBlobCache — record / meta / thumbnail / inFlight round-trips", () => {
  it("starts empty across all four caches", () => {
    const c = new GitHubBlobCache();
    expect(c.getRecord("a.png")).toBeUndefined();
    expect(c.getMeta("a.png")).toBeUndefined();
    expect(c.getThumbnail("a.png")).toBeUndefined();
    expect(c.hasThumbnail("a.png")).toBe(false);
    expect(c.getThumbnailInFlight("a.png")).toBeUndefined();
  });

  it("set/get/delete round-trips for record", () => {
    const c = new GitHubBlobCache();
    const rec = makeRecord("a.png");
    c.setRecord("a.png", rec);
    expect(c.getRecord("a.png")).toBe(rec);
    expect(c.deleteRecord("a.png")).toBe(true);
    expect(c.getRecord("a.png")).toBeUndefined();
    expect(c.deleteRecord("missing.png")).toBe(false);
  });

  it("set/get/delete round-trips for meta", () => {
    const c = new GitHubBlobCache();
    c.setMeta("a.png", { createdAt: "x", updatedAt: "y" });
    expect(c.getMeta("a.png")).toEqual({ createdAt: "x", updatedAt: "y" });
    expect(c.deleteMeta("a.png")).toBe(true);
    expect(c.getMeta("a.png")).toBeUndefined();
  });

  it("set/get/has/delete round-trips for thumbnail", () => {
    const c = new GitHubBlobCache();
    c.setThumbnail("a.png", "data:image/png;base64,Z");
    expect(c.hasThumbnail("a.png")).toBe(true);
    expect(c.getThumbnail("a.png")).toBe("data:image/png;base64,Z");
    expect(c.deleteThumbnail("a.png")).toBe(true);
    expect(c.hasThumbnail("a.png")).toBe(false);
  });

  it("set/get/delete round-trips for thumbnail in-flight promises", () => {
    const c = new GitHubBlobCache();
    const p = Promise.resolve();
    c.setThumbnailInFlight("a.png", p);
    expect(c.getThumbnailInFlight("a.png")).toBe(p);
    expect(c.deleteThumbnailInFlight("a.png")).toBe(true);
    expect(c.getThumbnailInFlight("a.png")).toBeUndefined();
  });
});

describe("GitHubBlobCache — purge", () => {
  it("drops record + meta + thumbnail + inFlight at the named path", () => {
    const c = new GitHubBlobCache();
    c.setRecord("a.png", makeRecord("a.png"));
    c.setMeta("a.png", { createdAt: "x" });
    c.setThumbnail("a.png", "thumb");
    c.setThumbnailInFlight("a.png", Promise.resolve());

    c.purge("a.png");

    expect(c.getRecord("a.png")).toBeUndefined();
    expect(c.getMeta("a.png")).toBeUndefined();
    expect(c.getThumbnail("a.png")).toBeUndefined();
    expect(c.getThumbnailInFlight("a.png")).toBeUndefined();
  });

  it("only affects the named path — siblings stay", () => {
    const c = new GitHubBlobCache();
    c.setRecord("a.png", makeRecord("a.png"));
    c.setRecord("b.png", makeRecord("b.png"));
    c.setMeta("a.png", { createdAt: "x" });
    c.setMeta("b.png", { createdAt: "y" });

    c.purge("a.png");

    expect(c.getRecord("b.png")).toBeDefined();
    expect(c.getMeta("b.png")).toEqual({ createdAt: "y" });
  });

  it("is a no-op for paths with no cached entries", () => {
    const c = new GitHubBlobCache();
    expect(() => c.purge("nothing.png")).not.toThrow();
  });
});

describe("GitHubBlobCache — migrateEntry", () => {
  it("moves record / meta / thumbnail entries from oldPath to newPath", () => {
    const c = new GitHubBlobCache();
    const rec = makeRecord("old/a.png");
    c.setRecord("old/a.png", rec);
    c.setMeta("old/a.png", { createdAt: "x" });
    c.setThumbnail("old/a.png", "thumb");

    c.migrateEntry("old/a.png", "new/a.png");

    expect(c.getRecord("old/a.png")).toBeUndefined();
    expect(c.getMeta("old/a.png")).toBeUndefined();
    expect(c.getThumbnail("old/a.png")).toBeUndefined();
    expect(c.getRecord("new/a.png")).toBe(rec); // identity preserved by default
    expect(c.getMeta("new/a.png")).toEqual({ createdAt: "x" });
    expect(c.getThumbnail("new/a.png")).toBe("thumb");
  });

  it("applies the record transform when supplied (e.g. fixing path / folderPath)", () => {
    const c = new GitHubBlobCache();
    c.setRecord("old/a.png", makeRecord("old/a.png", { folderPath: "old" }));

    c.migrateEntry("old/a.png", "new/a.png", (rec) => ({
      ...rec,
      path: "new/a.png",
      folderPath: "new",
    }));

    const after = c.getRecord("new/a.png");
    expect(after?.path).toBe("new/a.png");
    expect(after?.folderPath).toBe("new");
  });

  it("does NOT migrate the thumbnail in-flight promise", () => {
    const c = new GitHubBlobCache();
    const p = Promise.resolve();
    c.setRecord("old/a.png", makeRecord("old/a.png"));
    c.setThumbnailInFlight("old/a.png", p);

    c.migrateEntry("old/a.png", "new/a.png");

    // In-flight promise is dropped on migration (intentional: the
    // pending fetch was keyed to the old path).
    expect(c.getThumbnailInFlight("old/a.png")).toBe(p);
    expect(c.getThumbnailInFlight("new/a.png")).toBeUndefined();
  });

  it("is a no-op when no entries exist for the old path", () => {
    const c = new GitHubBlobCache();
    expect(() => c.migrateEntry("missing.png", "new.png")).not.toThrow();
    expect(c.getRecord("new.png")).toBeUndefined();
  });

  it("only migrates the caches that have an entry — empty caches stay empty", () => {
    const c = new GitHubBlobCache();
    c.setRecord("old.png", makeRecord("old.png")); // no meta, no thumb

    c.migrateEntry("old.png", "new.png");

    expect(c.getRecord("new.png")).toBeDefined();
    expect(c.getMeta("new.png")).toBeUndefined();
    expect(c.getThumbnail("new.png")).toBeUndefined();
  });
});

describe("GitHubBlobCache — rewriteEntriesForPrefix", () => {
  it("renames every record / meta / thumbnail entry under the prefix", () => {
    const c = new GitHubBlobCache();
    c.setRecord("old/a.png", makeRecord("old/a.png", { folderPath: "old" }));
    c.setRecord("old/sub/b.png", makeRecord("old/sub/b.png", { folderPath: "old/sub" }));
    c.setMeta("old/a.png", { createdAt: "x" });
    c.setThumbnail("old/sub/b.png", "thumb-b");

    c.rewriteEntriesForPrefix("old", "new");

    expect(c.getRecord("old/a.png")).toBeUndefined();
    expect(c.getRecord("new/a.png")).toBeDefined();
    expect(c.getRecord("new/sub/b.png")).toBeDefined();
    expect(c.getMeta("old/a.png")).toBeUndefined();
    expect(c.getMeta("new/a.png")).toEqual({ createdAt: "x" });
    expect(c.getThumbnail("new/sub/b.png")).toBe("thumb-b");
  });

  it("invokes the record transform with the new path so callers can fix path/folderPath", () => {
    const c = new GitHubBlobCache();
    c.setRecord("old/a.png", makeRecord("old/a.png", { folderPath: "old" }));
    c.setRecord("old/sub/b.png", makeRecord("old/sub/b.png", { folderPath: "old/sub" }));

    c.rewriteEntriesForPrefix("old", "new", (rec, np) => ({
      ...rec,
      path: np,
      folderPath: np.includes("/") ? np.slice(0, np.lastIndexOf("/")) : "",
    }));

    expect(c.getRecord("new/a.png")?.path).toBe("new/a.png");
    expect(c.getRecord("new/a.png")?.folderPath).toBe("new");
    expect(c.getRecord("new/sub/b.png")?.path).toBe("new/sub/b.png");
    expect(c.getRecord("new/sub/b.png")?.folderPath).toBe("new/sub");
  });

  it("only matches whole-segment boundaries (does NOT touch a sibling sharing the prefix)", () => {
    const c = new GitHubBlobCache();
    c.setRecord("old", makeRecord("old"));
    c.setRecord("old/file.png", makeRecord("old/file.png"));
    c.setRecord("oldfella/file.png", makeRecord("oldfella/file.png"));

    c.rewriteEntriesForPrefix("old", "new");

    // "old" itself + "old/file.png" migrate.
    expect(c.getRecord("old")).toBeUndefined();
    expect(c.getRecord("new")).toBeDefined();
    expect(c.getRecord("new/file.png")).toBeDefined();
    // "oldfella/file.png" survives unchanged.
    expect(c.getRecord("oldfella/file.png")).toBeDefined();
  });

  it("is a no-op when no entries match the prefix", () => {
    const c = new GitHubBlobCache();
    c.setRecord("a.png", makeRecord("a.png"));
    c.rewriteEntriesForPrefix("nothing", "elsewhere");
    expect(c.getRecord("a.png")).toBeDefined();
  });
});

describe("GitHubBlobCache — clear", () => {
  it("drops every entry across all four caches", () => {
    const c = new GitHubBlobCache();
    c.setRecord("a.png", makeRecord("a.png"));
    c.setMeta("a.png", { createdAt: "x" });
    c.setThumbnail("a.png", "thumb");
    c.setThumbnailInFlight("a.png", Promise.resolve());

    c.clear();

    expect(c.getRecord("a.png")).toBeUndefined();
    expect(c.getMeta("a.png")).toBeUndefined();
    expect(c.getThumbnail("a.png")).toBeUndefined();
    expect(c.getThumbnailInFlight("a.png")).toBeUndefined();
  });
});

describe("GitHubBlobCache — recordEntries iteration", () => {
  it("iterates every cached record entry as [path, record] pairs", () => {
    const c = new GitHubBlobCache();
    c.setRecord("a.png", makeRecord("a.png"));
    c.setRecord("b.png", makeRecord("b.png"));
    const seen = [...c.recordEntries()].map(([p]) => p).sort();
    expect(seen).toEqual(["a.png", "b.png"]);
  });
});
