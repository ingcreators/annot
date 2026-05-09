// Pure-Node tests for github-paths.ts. No `Headers`, `fetch`, or
// any other DOM-ish globals — just string math.

import { describe, expect, it } from "vitest";
import { commitMessage, contentsUrl, encodePath, fullPath, relPath } from "./github-paths.js";

describe("fullPath", () => {
  it("returns relPath verbatim when basePath is empty", () => {
    expect(fullPath("", "foo/bar.png")).toBe("foo/bar.png");
  });

  it("prefixes basePath when set", () => {
    expect(fullPath("screenshots", "foo/bar.png")).toBe("screenshots/foo/bar.png");
  });

  it("returns basePath unchanged when relPath is empty", () => {
    expect(fullPath("screenshots", "")).toBe("screenshots");
    expect(fullPath("", "")).toBe("");
  });
});

describe("relPath", () => {
  it("returns the input unchanged when basePath is empty", () => {
    expect(relPath("", "foo/bar.png")).toBe("foo/bar.png");
  });

  it("strips the basePath prefix", () => {
    expect(relPath("screenshots", "screenshots/foo/bar.png")).toBe("foo/bar.png");
  });

  it("returns the empty string when fullPath equals basePath", () => {
    expect(relPath("screenshots", "screenshots")).toBe("");
  });

  it("returns null for paths outside basePath", () => {
    expect(relPath("screenshots", "src/index.ts")).toBeNull();
    // Same prefix but not the boundary — must NOT match.
    expect(relPath("screenshots", "screenshotsroundup/file.png")).toBeNull();
  });
});

describe("encodePath", () => {
  it("encodes spaces as %20 in each segment", () => {
    expect(encodePath("a folder/file with space.png")).toBe("a%20folder/file%20with%20space.png");
  });

  it("preserves slashes between segments", () => {
    expect(encodePath("a/b/c.png")).toBe("a/b/c.png");
  });

  it("encodes other reserved characters", () => {
    expect(encodePath("a?b.png")).toBe("a%3Fb.png");
    expect(encodePath("name#tag.png")).toBe("name%23tag.png");
  });

  it("handles an empty string", () => {
    expect(encodePath("")).toBe("");
  });
});

describe("contentsUrl", () => {
  it("composes the GitHub Contents API URL with encoded owner / repo / path", () => {
    expect(contentsUrl("user", "repo", "folder/file.png")).toBe(
      "https://api.github.com/repos/user/repo/contents/folder/file.png",
    );
  });

  it("URL-encodes owner / repo names with reserved chars", () => {
    expect(contentsUrl("my org", "my repo", "x.png")).toBe(
      "https://api.github.com/repos/my%20org/my%20repo/contents/x.png",
    );
  });

  it("path encoding survives composition", () => {
    expect(contentsUrl("user", "repo", "a folder/file.png")).toBe(
      "https://api.github.com/repos/user/repo/contents/a%20folder/file.png",
    );
  });
});

describe("commitMessage", () => {
  it("uses the bare filename for nested paths", () => {
    expect(commitMessage("update", "folder/sub/file.png")).toBe("annot: update file.png");
  });

  it("falls back to the full path when there's no filename component", () => {
    // Path that has no separator → entire string is the filename.
    expect(commitMessage("add", "rootfile.png")).toBe("annot: add rootfile.png");
  });

  it("emits the verb verbatim", () => {
    expect(commitMessage("delete", "x/y.png")).toBe("annot: delete y.png");
    expect(commitMessage("add", "x/y.png")).toBe("annot: add y.png");
  });
});
