/**
 * @vitest-environment happy-dom
 *
 * FileDetailsDrawer — Phase 2 tests covering the section-host
 * migration: built-in section presence + ordering, plugin section
 * interleave + filter, the `disableBuiltinUISections` opt-out,
 * lifecycle (mount + unmount on `destroy`), and the reactive
 * `update(ctx)` path through `notifyUpdate`.
 *
 * happy-dom supplies the DOM the drawer mounts into; the surface-
 * level test exercises the full mount / render / dispose loop end
 * to end without any host wiring.
 */

import { describe, expect, it, vi } from "vitest";
import type { UISection, UISectionLifecycle } from "../app/plugin-host.js";
import {
  BUILTIN_DRAWER_SECTION_IDS,
  FileDetailsDrawer,
  type FileDetailsData,
} from "./file-details-drawer.js";

function baseData(overrides: Partial<FileDetailsData> = {}): FileDetailsData {
  return {
    filename: "image.png",
    folderPath: "Screenshots",
    width: 1024,
    height: 768,
    fileSizeBytes: 12345,
    tags: { author: "alice" },
    ...overrides,
  };
}

function getSectionHeadings(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".file-details-section-title")).map(
    (el) => el.textContent || "",
  );
}

describe("FileDetailsDrawer — section-host migration", () => {
  it("renders the four built-in sections in priority order (File → Tags → Last commit → Links)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    new FileDetailsDrawer(container, baseData({
      lastCommit: {
        authorName: "alice",
        messageHeadline: "fix bug",
        date: "2026-01-01T00:00:00Z",
        shortSha: "abc1234",
      },
      externalLinks: [{ label: "View on GitHub", url: "https://example.test" }],
    }));
    const panel = container.querySelector(".file-details-drawer") as HTMLElement;
    expect(getSectionHeadings(panel)).toEqual(["File", "Tags", "Last commit", "Links"]);
  });

  it("hides the Last commit + Links sections when the data has no commit / links (visible() gate)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    new FileDetailsDrawer(container, baseData()); // no lastCommit, no externalLinks
    const panel = container.querySelector(".file-details-drawer") as HTMLElement;
    // Only File + Tags should render. The visible() predicates on
    // last-commit and external-links return false → the host skips
    // the mount entirely.
    expect(getSectionHeadings(panel)).toEqual(["File", "Tags"]);
  });

  it("disableBuiltinUISections filters built-in sections out of the render", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    new FileDetailsDrawer(
      container,
      baseData({
        lastCommit: {
          authorName: "alice",
          messageHeadline: "fix bug",
          date: "2026-01-01T00:00:00Z",
          shortSha: "abc1234",
        },
      }),
      {
        // The deployment opted out of File + Last commit. Only Tags
        // remains (External links has no data so its visible()
        // would skip it anyway).
        isBuiltinSectionDisabled: (id) => id === "drawer.file" || id === "drawer.last-commit",
      },
    );
    const panel = container.querySelector(".file-details-drawer") as HTMLElement;
    expect(getSectionHeadings(panel)).toEqual(["Tags"]);
  });

  it("plugin sections interleave with built-ins by priority", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const between: UISection = {
      id: "test.between",
      title: "Plugin between",
      priority: 25, // lands between Tags (20) and Last commit (30)
      mount: () => () => {},
    };
    new FileDetailsDrawer(
      container,
      baseData({
        lastCommit: {
          authorName: "alice",
          messageHeadline: "fix bug",
          date: "2026-01-01T00:00:00Z",
          shortSha: "abc1234",
        },
      }),
      { getPluginSections: () => [between] },
    );
    const panel = container.querySelector(".file-details-drawer") as HTMLElement;
    expect(getSectionHeadings(panel)).toEqual([
      "File",
      "Tags",
      "Plugin between",
      "Last commit",
    ]);
  });

  it("calls the plugin section's mount with the host-supplied container + ctx", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    type MountArgs = Parameters<UISection["mount"]>;
    const mountSpy = vi.fn<(...args: MountArgs) => UISectionLifecycle>(() => () => {});
    const plugin: UISection = {
      id: "test.spy",
      title: "Spy",
      priority: 100,
      mount: mountSpy,
    };
    new FileDetailsDrawer(container, baseData(), {
      getPluginSections: () => [plugin],
    });
    expect(mountSpy).toHaveBeenCalledTimes(1);
    const call = mountSpy.mock.calls[0]!;
    expect(call[0]).toBeInstanceOf(HTMLElement);
    // Context shape sanity: the host passes the live tags snapshot.
    expect(call[1].tags).toEqual({ author: "alice" });
  });

  it("destroy() runs every section's teardown (function lifecycle)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const teardownA = vi.fn();
    const teardownB = vi.fn();
    const drawer = new FileDetailsDrawer(container, baseData(), {
      getPluginSections: () => [
        { id: "test.a", title: "A", priority: 100, mount: () => teardownA },
        { id: "test.b", title: "B", priority: 200, mount: () => teardownB },
      ],
    });
    expect(teardownA).not.toHaveBeenCalled();
    drawer.destroy();
    expect(teardownA).toHaveBeenCalledTimes(1);
    expect(teardownB).toHaveBeenCalledTimes(1);
  });

  it("destroy() runs every section's unmount (object lifecycle) and survives a teardown throw", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const goodUnmount = vi.fn();
    const drawer = new FileDetailsDrawer(container, baseData(), {
      getPluginSections: () => [
        {
          id: "test.bad",
          title: "Bad",
          priority: 100,
          mount: () =>
            ({
              unmount: () => {
                throw new Error("boom");
              },
            }) satisfies UISectionLifecycle,
        },
        {
          id: "test.good",
          title: "Good",
          priority: 200,
          mount: () => ({ unmount: goodUnmount }) satisfies UISectionLifecycle,
        },
      ],
    });
    drawer.destroy();
    // Bad section's throw is logged but doesn't prevent the good
    // section from tearing down.
    expect(goodUnmount).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("notifyUpdate dispatches update(ctx) to reactive sections only — function-teardown sections aren't called", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const reactiveUpdate = vi.fn();
    const reactiveUnmount = vi.fn();
    const simpleTeardown = vi.fn();
    const drawer = new FileDetailsDrawer(container, baseData(), {
      getPluginSections: () => [
        {
          id: "test.reactive",
          title: "Reactive",
          priority: 100,
          mount: () => ({ update: reactiveUpdate, unmount: reactiveUnmount }),
        },
        {
          id: "test.simple",
          title: "Simple",
          priority: 200,
          mount: () => simpleTeardown,
        },
      ],
    });
    drawer.notifyUpdate();
    expect(reactiveUpdate).toHaveBeenCalledTimes(1);
    expect(simpleTeardown).not.toHaveBeenCalled();
    // Sanity: ctx carries the latest tags from the drawer's data.
    const call = reactiveUpdate.mock.calls[0]!;
    expect((call[0] as { tags: Record<string, string> }).tags).toEqual({ author: "alice" });
  });

  it("setLastCommit triggers a full re-render — newly-visible Last commit section appears", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const drawer = new FileDetailsDrawer(container, baseData());
    const panel = container.querySelector(".file-details-drawer") as HTMLElement;
    // Initial render: no Last commit (data.lastCommit is undefined).
    expect(getSectionHeadings(panel)).toEqual(["File", "Tags"]);
    drawer.setLastCommit({
      authorName: "alice",
      messageHeadline: "add Phase 2",
      date: "2026-04-25T00:00:00Z",
      shortSha: "1234abc",
    });
    // After setLastCommit: visibility flipped, section appears.
    expect(getSectionHeadings(panel)).toEqual(["File", "Tags", "Last commit"]);
  });

  it("BUILTIN_DRAWER_SECTION_IDS lists the four built-in ids", () => {
    expect(BUILTIN_DRAWER_SECTION_IDS).toEqual([
      "drawer.file",
      "drawer.tags",
      "drawer.last-commit",
      "drawer.external-links",
    ]);
  });
});
