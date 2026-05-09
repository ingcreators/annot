/**
 * Unit tests for the Phase 1 `fs.*` IPC handlers.
 *
 * These exercise the handlers directly against a tmp directory —
 * no Electron, no IPC, no renderer. The factory's lack of any
 * Electron import is a deliberate design choice: it keeps the
 * traversal-guard + node:fs wrapping testable in plain Node.
 */

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsHandlers, FS_CHANNELS, type FsHandlers } from "./fs.js";

let root: string;
let handlers: FsHandlers;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "annot-fs-ipc-"));
  handlers = createFsHandlers(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const TEXT = new TextEncoder();

describe("fs.* IPC handlers — happy path round-trip", () => {
  it("write → read → stat → list", async () => {
    await handlers.mkdir({ path: "Inbox", recursive: true });
    await handlers.write({ path: "Inbox/cap.png", bytes: TEXT.encode("hello") });

    const bytes = await handlers.read({ path: "Inbox/cap.png" });
    expect(new TextDecoder().decode(bytes)).toBe("hello");

    const info = await handlers.stat({ path: "Inbox/cap.png" });
    expect(info?.kind).toBe("file");
    expect(info?.size).toBe(5);
    expect(typeof info?.mtime).toBe("number");

    const entries = await handlers.list({ path: "Inbox" });
    expect(entries).toEqual([{ name: "cap.png", kind: "file" }]);
  });

  it("rename moves files between directories", async () => {
    await handlers.mkdir({ path: "A", recursive: true });
    await handlers.mkdir({ path: "B", recursive: true });
    await handlers.write({ path: "A/x.png", bytes: TEXT.encode("x") });

    await handlers.rename({ from: "A/x.png", to: "B/x.png" });

    expect(await handlers.stat({ path: "A/x.png" })).toBeNull();
    expect((await handlers.stat({ path: "B/x.png" }))?.kind).toBe("file");
  });

  it("unlink with recursive removes a non-empty directory", async () => {
    await handlers.mkdir({ path: "Trash/sub", recursive: true });
    await handlers.write({ path: "Trash/sub/x.png", bytes: TEXT.encode("x") });

    await handlers.unlink({ path: "Trash", recursive: true });
    expect(await handlers.stat({ path: "Trash" })).toBeNull();
  });

  it("unlink without recursive rejects on non-empty directory", async () => {
    await handlers.mkdir({ path: "Stuck", recursive: true });
    await handlers.write({ path: "Stuck/x.png", bytes: TEXT.encode("x") });

    await expect(handlers.unlink({ path: "Stuck" })).rejects.toThrow();
    expect((await handlers.stat({ path: "Stuck" }))?.kind).toBe("directory");
  });

  it("list returns [] for a missing directory", async () => {
    expect(await handlers.list({ path: "DoesNotExist" })).toEqual([]);
  });

  it("stat returns null for a missing path", async () => {
    expect(await handlers.stat({ path: "missing.png" })).toBeNull();
  });
});

describe("fs.* IPC handlers — empty / root path", () => {
  it("treats '' and '.' as the library root", async () => {
    await handlers.mkdir({ path: "Inbox", recursive: true });

    const fromEmpty = await handlers.list({ path: "" });
    const fromDot = await handlers.list({ path: "." });
    expect(fromEmpty).toEqual(fromDot);
    expect(fromEmpty.find((e) => e.name === "Inbox")?.kind).toBe("directory");
  });
});

describe("fs.* IPC handlers — path-traversal validation", () => {
  it("rejects '..' segments", async () => {
    await expect(handlers.read({ path: "../../etc/passwd" })).rejects.toThrow(/path-traversal/);
    await expect(handlers.write({ path: "..", bytes: new Uint8Array() })).rejects.toThrow();
  });

  it("rejects absolute POSIX paths", async () => {
    await expect(handlers.read({ path: "/etc/passwd" })).rejects.toThrow(/absolute/);
  });

  it("rejects absolute Windows paths", async () => {
    await expect(handlers.read({ path: "C:/Windows/System32/cmd.exe" })).rejects.toThrow(
      /absolute/,
    );
    await expect(handlers.read({ path: "\\foo" })).rejects.toThrow(/absolute/);
  });

  it("rejects rename `from` or `to` that escape the root", async () => {
    await handlers.mkdir({ path: "Inbox", recursive: true });
    await handlers.write({ path: "Inbox/x.png", bytes: TEXT.encode("x") });

    await expect(handlers.rename({ from: "Inbox/x.png", to: "../escape.png" })).rejects.toThrow(
      /path-traversal/,
    );
    await expect(handlers.rename({ from: "../foo", to: "Inbox/y.png" })).rejects.toThrow(
      /path-traversal/,
    );
  });
});

describe("fs.* IPC handlers — channel-name surface", () => {
  it("exposes a stable, exhaustive channel inventory", () => {
    // The renderer-side `createElectronDesktopFs` and any future
    // contract test relies on these names. Fail closed here so a
    // typo in the wire format surfaces as a unit-test failure
    // rather than a silent runtime error.
    expect(FS_CHANNELS).toEqual({
      read: "fs.read",
      write: "fs.write",
      list: "fs.list",
      mkdir: "fs.mkdir",
      rename: "fs.rename",
      unlink: "fs.unlink",
      stat: "fs.stat",
    });
  });
});
