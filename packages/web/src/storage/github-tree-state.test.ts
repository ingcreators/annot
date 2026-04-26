// Pure-Node tests for GitHubTreeState. No DOM, no fetch — just
// state-machine assertions on a class that owns three Maps + a
// loading lifecycle.

import { describe, expect, it } from "vitest";
import { GitHubTreeState } from "./github-tree-state.js";

describe("GitHubTreeState — blob access", () => {
  it("starts empty", () => {
    const t = new GitHubTreeState();
    expect(t.hasBlob("a.png")).toBe(false);
    expect(t.getBlobSha("a.png")).toBeUndefined();
    expect([...t.blobPaths()]).toEqual([]);
  });

  it("setBlobSha + getBlobSha + hasBlob round-trip", () => {
    const t = new GitHubTreeState();
    t.setBlobSha("a.png", "sha-1");
    expect(t.hasBlob("a.png")).toBe(true);
    expect(t.getBlobSha("a.png")).toBe("sha-1");
  });

  it("setBlobSha overwrites a previous SHA", () => {
    const t = new GitHubTreeState();
    t.setBlobSha("a.png", "sha-1");
    t.setBlobSha("a.png", "sha-2");
    expect(t.getBlobSha("a.png")).toBe("sha-2");
  });

  it("removeBlob returns true when present, false when absent", () => {
    const t = new GitHubTreeState();
    t.setBlobSha("a.png", "sha-1");
    expect(t.removeBlob("a.png")).toBe(true);
    expect(t.hasBlob("a.png")).toBe(false);
    expect(t.removeBlob("missing.png")).toBe(false);
  });

  it("blobPaths iterates every tracked path", () => {
    const t = new GitHubTreeState();
    t.setBlobSha("a.png", "1");
    t.setBlobSha("b.png", "2");
    t.setBlobSha("sub/c.png", "3");
    expect([...t.blobPaths()].sort()).toEqual(["a.png", "b.png", "sub/c.png"]);
  });
});

describe("GitHubTreeState — folder access", () => {
  it("addFolderExact tracks just the named path", () => {
    const t = new GitHubTreeState();
    t.addFolderExact("a/b/c");
    expect(t.hasFolder("a/b/c")).toBe(true);
    expect(t.hasFolder("a/b")).toBe(false);
    expect(t.hasFolder("a")).toBe(false);
  });

  it("addFolderWithAncestors materialises every ancestor", () => {
    const t = new GitHubTreeState();
    t.addFolderWithAncestors("a/b/c/d");
    expect(t.hasFolder("a/b/c/d")).toBe(true);
    expect(t.hasFolder("a/b/c")).toBe(true);
    expect(t.hasFolder("a/b")).toBe(true);
    expect(t.hasFolder("a")).toBe(true);
    // Empty string is the implicit root and is NOT added.
    expect(t.hasFolder("")).toBe(false);
  });

  it("addFolderWithAncestors is a no-op for the empty path", () => {
    const t = new GitHubTreeState();
    t.addFolderWithAncestors("");
    expect([...t.folderPaths()]).toEqual([]);
  });

  it("removeFolderExact removes a single path only", () => {
    const t = new GitHubTreeState();
    t.addFolderWithAncestors("a/b/c");
    expect(t.removeFolderExact("a/b")).toBe(true);
    expect(t.hasFolder("a/b")).toBe(false);
    expect(t.hasFolder("a")).toBe(true);
    expect(t.hasFolder("a/b/c")).toBe(true);
  });

  it("removeFolderTree removes the path AND every descendant", () => {
    const t = new GitHubTreeState();
    t.addFolderWithAncestors("a/b/c");
    t.addFolderWithAncestors("a/b/d/e");
    t.addFolderExact("z/y");

    t.removeFolderTree("a/b");

    expect(t.hasFolder("a/b")).toBe(false);
    expect(t.hasFolder("a/b/c")).toBe(false);
    expect(t.hasFolder("a/b/d")).toBe(false);
    expect(t.hasFolder("a/b/d/e")).toBe(false);
    // Sibling and parent are untouched.
    expect(t.hasFolder("a")).toBe(true);
    expect(t.hasFolder("z/y")).toBe(true);
  });

  it("removeFolderTree does NOT match a sibling sharing a prefix", () => {
    const t = new GitHubTreeState();
    t.addFolderExact("a");
    t.addFolderExact("ab");
    t.addFolderExact("a/b");
    t.removeFolderTree("a");
    // "a" itself + "a/b" gone; "ab" survives.
    expect(t.hasFolder("a")).toBe(false);
    expect(t.hasFolder("a/b")).toBe(false);
    expect(t.hasFolder("ab")).toBe(true);
  });

  it("rewriteFolderPrefix renames the path and every descendant in place", () => {
    const t = new GitHubTreeState();
    t.addFolderWithAncestors("old/sub/leaf");

    t.rewriteFolderPrefix("old", "new");

    expect(t.hasFolder("old")).toBe(false);
    expect(t.hasFolder("old/sub")).toBe(false);
    expect(t.hasFolder("old/sub/leaf")).toBe(false);
    expect(t.hasFolder("new")).toBe(true);
    expect(t.hasFolder("new/sub")).toBe(true);
    expect(t.hasFolder("new/sub/leaf")).toBe(true);
  });

  it("rewriteFolderPrefix only matches whole-segment boundaries", () => {
    const t = new GitHubTreeState();
    t.addFolderExact("foo");
    t.addFolderExact("foobar");
    t.addFolderExact("foo/sub");

    t.rewriteFolderPrefix("foo", "bar");

    expect(t.hasFolder("foo")).toBe(false);
    expect(t.hasFolder("foo/sub")).toBe(false);
    expect(t.hasFolder("bar")).toBe(true);
    expect(t.hasFolder("bar/sub")).toBe(true);
    // Sibling that just shared the prefix survives unchanged.
    expect(t.hasFolder("foobar")).toBe(true);
  });

  it("folderPaths iterates every tracked folder", () => {
    const t = new GitHubTreeState();
    t.addFolderWithAncestors("a/b/c");
    t.addFolderExact("z");
    expect([...t.folderPaths()].sort()).toEqual(["a", "a/b", "a/b/c", "z"]);
  });
});

describe("GitHubTreeState — loading lifecycle", () => {
  it("starts unloaded with no in-flight promise", () => {
    const t = new GitHubTreeState();
    expect(t.isLoaded()).toBe(false);
    expect(t.getLoadInFlight()).toBeNull();
  });

  it("markLoaded flips the loaded flag", () => {
    const t = new GitHubTreeState();
    t.markLoaded();
    expect(t.isLoaded()).toBe(true);
  });

  it("setLoadInFlight stores and getLoadInFlight retrieves the same promise", () => {
    const t = new GitHubTreeState();
    const p = Promise.resolve();
    t.setLoadInFlight(p);
    expect(t.getLoadInFlight()).toBe(p);
    t.setLoadInFlight(null);
    expect(t.getLoadInFlight()).toBeNull();
  });
});

describe("GitHubTreeState — clear", () => {
  it("drops every blob, folder, loaded flag, and in-flight promise", () => {
    const t = new GitHubTreeState();
    t.setBlobSha("a.png", "sha-1");
    t.addFolderWithAncestors("x/y");
    t.markLoaded();
    t.setLoadInFlight(Promise.resolve());

    t.clear();

    expect([...t.blobPaths()]).toEqual([]);
    expect([...t.folderPaths()]).toEqual([]);
    expect(t.isLoaded()).toBe(false);
    expect(t.getLoadInFlight()).toBeNull();
  });
});
