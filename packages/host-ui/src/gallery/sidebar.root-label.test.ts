/**
 * @vitest-environment happy-dom
 *
 * `resolveStorageRootLabel` — the shared helper that backs both
 * `<annot-sidebar>`'s FOLDERS root row and `FileManager`'s
 * breadcrumb / search-placeholder. Built-in modes come from the
 * chip-descriptor table; plugin modes come from
 * `getPluginStorages()`. Anything else falls back to the
 * pre-refactor default `"Browser"`.
 */

import { describe, expect, it } from "vitest";
import type { StorageRegistration } from "../plugin-host-types.js";
import { resolveStorageRootLabel } from "./sidebar.js";

describe("resolveStorageRootLabel", () => {
  it("resolves every built-in mode to its chip-descriptor label", () => {
    expect(resolveStorageRootLabel("browser")).toBe("Browser");
    expect(resolveStorageRootLabel("device")).toBe("Device");
    expect(resolveStorageRootLabel("googledrive")).toBe("Google Drive");
    expect(resolveStorageRootLabel("github")).toBe("GitHub");
    expect(resolveStorageRootLabel("cloud")).toBe("Annot Cloud");
    expect(resolveStorageRootLabel("desktop")).toBe("Desktop");
  });

  it("resolves a plugin-registered mode to the registration's label", () => {
    const plugins: StorageRegistration[] = [
      {
        mode: "team-library",
        label: "Team Library",
        priority: 100,
        connect: async () => null,
        restore: () => null,
        status: () => ({ connected: false }),
      },
    ];
    expect(resolveStorageRootLabel("team-library", () => plugins)).toBe("Team Library");
  });

  it('falls back to "Browser" for an unknown mode', () => {
    expect(resolveStorageRootLabel("unrecognised-mode")).toBe("Browser");
    expect(resolveStorageRootLabel("unrecognised-mode", () => [])).toBe("Browser");
  });
});
