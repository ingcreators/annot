// @vitest-environment happy-dom
/**
 * Round-trip test for the Electron-backed `DesktopFs` factory.
 *
 * The factory is a thin pass-through over
 * `window.electronAPI.invoke('fs.*', payload)`. To prove it speaks
 * the right wire format end-to-end, this test wires a stub
 * `electronAPI` whose `invoke` dispatches to the matching
 * Node-side `fs.*` handler from
 * `packages/desktop/src-electron/ipc/fs.ts`. So the same factory
 * the production renderer uses talks to the same handler the
 * production main process registers — only the `ipcMain.handle` /
 * `ipcRenderer.invoke` plumbing is short-circuited.
 *
 * If the JSON-payload shape on either side drifts (e.g. someone
 * renames `path` → `relPath` on the renderer but not the main
 * process), this test fails before the real Electron build does.
 */

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsHandlers, type FsHandlers } from "../../src-electron/ipc/fs.js";
import { createElectronDesktopFs, type ElectronApi } from "./desktop-fs.js";

let root: string;
let handlers: FsHandlers;

function makeStubApi(h: FsHandlers): ElectronApi {
  // Map channel names to the matching handler key. Keep it
  // parallel to FS_CHANNEL_TO_HANDLER from the IPC module — but
  // we redeclare here so the test is independent of the lookup
  // table and would catch a swap-the-table mistake.
  return {
    async invoke<T>(channel: string, args?: unknown): Promise<T> {
      switch (channel) {
        case "fs.read":
          return (await h.read(args as { path: string })) as T;
        case "fs.write":
          await h.write(args as { path: string; bytes: Uint8Array });
          return undefined as T;
        case "fs.list":
          return (await h.list(args as { path: string })) as T;
        case "fs.mkdir":
          await h.mkdir(args as { path: string; recursive?: boolean });
          return undefined as T;
        case "fs.rename":
          await h.rename(args as { from: string; to: string });
          return undefined as T;
        case "fs.unlink":
          await h.unlink(args as { path: string; recursive?: boolean });
          return undefined as T;
        case "fs.stat":
          return (await h.stat(args as { path: string })) as T;
        default:
          throw new Error(`unstubbed channel: ${channel}`);
      }
    },
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "annot-electron-fs-"));
  handlers = createFsHandlers(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("createElectronDesktopFs ↔ fs.* IPC handlers round-trip", () => {
  it("write → readDir → stat → readFile flow", async () => {
    const api = makeStubApi(handlers);
    const desktopFs = createElectronDesktopFs(api);

    await desktopFs.mkdir("Inbox", { recursive: true });
    await desktopFs.writeFile("Inbox/cap.png", new TextEncoder().encode("annot"));

    const entries = await desktopFs.readDir("Inbox");
    expect(entries).toEqual([{ name: "cap.png", kind: "file" }]);

    const info = await desktopFs.stat("Inbox/cap.png");
    expect(info?.kind).toBe("file");
    expect(info?.size).toBe(5);

    const bytes = await desktopFs.readFile("Inbox/cap.png");
    expect(new TextDecoder().decode(bytes)).toBe("annot");
  });

  it("readDir returns [] on missing path (matches StorageProvider contract)", async () => {
    const desktopFs = createElectronDesktopFs(makeStubApi(handlers));
    expect(await desktopFs.readDir("DoesNotExist")).toEqual([]);
  });

  it("stat returns undefined on missing path", async () => {
    const desktopFs = createElectronDesktopFs(makeStubApi(handlers));
    expect(await desktopFs.stat("missing.png")).toBeUndefined();
  });

  it("rename and remove (non-recursive on empty dir)", async () => {
    const desktopFs = createElectronDesktopFs(makeStubApi(handlers));
    await desktopFs.mkdir("A", { recursive: true });
    await desktopFs.writeFile("A/x.png", new TextEncoder().encode("x"));

    await desktopFs.rename("A/x.png", "A/y.png");
    expect(await desktopFs.stat("A/x.png")).toBeUndefined();
    expect((await desktopFs.stat("A/y.png"))?.kind).toBe("file");

    await desktopFs.remove("A/y.png");
    await desktopFs.remove("A");
    expect(await desktopFs.stat("A")).toBeUndefined();
  });

  it("propagates traversal-guard errors from the IPC layer", async () => {
    const desktopFs = createElectronDesktopFs(makeStubApi(handlers));
    await expect(desktopFs.readFile("../escape")).rejects.toThrow(/path-traversal/);
  });
});
