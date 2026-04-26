/**
 * @vitest-environment happy-dom
 *
 * Pure-FS tests for `device-fs.ts` driven against the in-memory
 * `device-fs.test-mock.ts` directory tree. No DeviceStore, no
 * index file, no contract scaffolding — just the helpers exercised
 * directly with the same kind of FSA-shaped handle DeviceStore
 * receives in production.
 */

import { describe, expect, it } from "vitest";
import { createMockRoot } from "./device-fs.test-mock.js";
import { fileExists, getDirHandle, purgeEmptyFiles } from "./device-fs.js";

async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  content: string,
): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}

describe("getDirHandle", () => {
  it("returns the root unchanged for an empty path", async () => {
    const root = createMockRoot();
    const out = await getDirHandle(root, "");
    expect(out).toBe(root);
  });

  it("walks single-segment paths", async () => {
    const root = createMockRoot();
    await root.getDirectoryHandle("a", { create: true });
    const out = await getDirHandle(root, "a");
    expect(out.name).toBe("a");
  });

  it("walks multi-segment paths", async () => {
    const root = createMockRoot();
    const a = await root.getDirectoryHandle("a", { create: true });
    const b = await a.getDirectoryHandle("b", { create: true });
    await b.getDirectoryHandle("c", { create: true });
    const out = await getDirHandle(root, "a/b/c");
    expect(out.name).toBe("c");
  });

  it("creates missing intermediate directories with create=true", async () => {
    const root = createMockRoot();
    const out = await getDirHandle(root, "fresh/branch/leaf", true);
    expect(out.name).toBe("leaf");
    // Verify the chain actually materialised.
    const a = await root.getDirectoryHandle("fresh");
    const b = await a.getDirectoryHandle("branch");
    expect((await b.getDirectoryHandle("leaf")).name).toBe("leaf");
  });

  it("throws on a missing intermediate when create=false", async () => {
    const root = createMockRoot();
    await expect(getDirHandle(root, "missing/sub")).rejects.toBeDefined();
  });
});

describe("fileExists", () => {
  it("returns true for an existing file", async () => {
    const root = createMockRoot();
    await writeFile(root, "a.png", "x");
    expect(await fileExists(root, "a.png")).toBe(true);
  });

  it("returns false for a missing file", async () => {
    const root = createMockRoot();
    expect(await fileExists(root, "missing.png")).toBe(false);
  });

  it("returns false even when a directory has the same name", async () => {
    // Asking for a *file* handle on a directory entry rejects in
    // the FSA spec; the helper surfaces that as `false`.
    const root = createMockRoot();
    await root.getDirectoryHandle("not-a-file", { create: true });
    expect(await fileExists(root, "not-a-file")).toBe(false);
  });
});

describe("purgeEmptyFiles", () => {
  it("removes only zero-byte files at the root", async () => {
    const root = createMockRoot();
    await writeFile(root, "keeper.png", "real content");
    await writeFile(root, "empty.png", "");
    const deleted = await purgeEmptyFiles(root, "");
    expect(deleted).toEqual(["empty.png"]);
    expect(await fileExists(root, "keeper.png")).toBe(true);
    expect(await fileExists(root, "empty.png")).toBe(false);
  });

  it("recurses into subdirectories", async () => {
    const root = createMockRoot();
    const sub = await root.getDirectoryHandle("sub", { create: true });
    await writeFile(sub, "good.png", "content");
    await writeFile(sub, "bad.png", "");
    const deleted = await purgeEmptyFiles(root, "");
    expect(deleted).toEqual(["sub/bad.png"]);
    expect(await fileExists(sub, "good.png")).toBe(true);
    expect(await fileExists(sub, "bad.png")).toBe(false);
  });

  it("returns deleted paths joined with the parent prefix", async () => {
    const root = createMockRoot();
    const sub = await root.getDirectoryHandle("alpha", { create: true });
    await writeFile(sub, "tiny.png", "");
    const deleted = await purgeEmptyFiles(root, "outer");
    expect(deleted).toEqual(["outer/alpha/tiny.png"]);
  });

  it("does NOT remove directories — even if they end up empty", async () => {
    const root = createMockRoot();
    const sub = await root.getDirectoryHandle("doomed", { create: true });
    await writeFile(sub, "ghost.png", "");
    await purgeEmptyFiles(root, "");
    // The empty file is gone but the directory survives.
    const survivors: string[] = [];
    for await (const [name] of root.entries()) {
      survivors.push(name);
    }
    expect(survivors).toContain("doomed");
  });

  it("returns empty array when nothing was deleted", async () => {
    const root = createMockRoot();
    await writeFile(root, "all-good.png", "content");
    const deleted = await purgeEmptyFiles(root, "");
    expect(deleted).toEqual([]);
  });

  it("collects deletions from multiple subdirectories", async () => {
    const root = createMockRoot();
    const a = await root.getDirectoryHandle("a", { create: true });
    const b = await root.getDirectoryHandle("b", { create: true });
    await writeFile(a, "empty1.png", "");
    await writeFile(b, "empty2.png", "");
    await writeFile(root, "empty-root.png", "");
    const deleted = await purgeEmptyFiles(root, "");
    // Order is FS-iteration dependent, so sort for stability.
    expect(deleted.sort()).toEqual(["a/empty1.png", "b/empty2.png", "empty-root.png"]);
  });
});
