/**
 * @vitest-environment happy-dom
 *
 * `<annot-file-details-drawer>` tests covering the section-host
 * behaviour: built-in section presence + ordering, plugin section
 * interleave + filter, the `isBuiltinSectionDisabled` opt-out,
 * lifecycle (mount + unmount on disconnect), and the reactive
 * `update(ctx)` path through `notifyUpdate`.
 *
 * happy-dom supplies the DOM + customElements registry the Lit
 * element needs; the surface-level test exercises the full mount
 * / render / dispose loop end to end.
 */

import { describe, expect, it, vi } from "vitest";
import type { UISection, UISectionLifecycle } from "../app/plugin-host.js";
import "./file-details-drawer.js";
import {
  type AnnotFileDetailsDrawerElement,
  BUILTIN_DRAWER_SECTION_IDS,
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

function getSectionHeadings(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll(".file-details-section-title")).map(
    (n) => n.textContent || "",
  );
}

/** Build + mount a drawer with the supplied props + append to
 *  `document.body`. Returns the element so the test can call
 *  methods / read classes. Waits one microtask tick so Lit's
 *  async `updated()` has a chance to run. */
async function mountDrawer(
  data: FileDetailsData,
  deps: {
    getPluginSections?: () => UISection[];
    isBuiltinSectionDisabled?: (id: string) => boolean;
  } = {},
): Promise<AnnotFileDetailsDrawerElement> {
  const el = document.createElement("annot-file-details-drawer");
  el.data = data;
  if (deps.getPluginSections) el.getPluginSections = deps.getPluginSections;
  if (deps.isBuiltinSectionDisabled) el.isBuiltinSectionDisabled = deps.isBuiltinSectionDisabled;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("<annot-file-details-drawer> — section-host migration", () => {
  it("renders the four built-in sections in priority order (File → Tags → Last commit → Links)", async () => {
    const el = await mountDrawer(
      baseData({
        lastCommit: {
          authorName: "alice",
          messageHeadline: "fix bug",
          date: "2026-01-01T00:00:00Z",
          shortSha: "abc1234",
        },
        externalLinks: [{ label: "View on GitHub", url: "https://example.test" }],
      }),
    );
    expect(getSectionHeadings(el)).toEqual(["File", "Tags", "Last commit", "Links"]);
  });

  it("hides the Last commit + Links sections when the data has no commit / links (visible() gate)", async () => {
    const el = await mountDrawer(baseData()); // no lastCommit, no externalLinks
    // Only File + Tags should render. The visible() predicates on
    // last-commit and external-links return false → the host skips
    // the mount entirely.
    expect(getSectionHeadings(el)).toEqual(["File", "Tags"]);
  });

  it("isBuiltinSectionDisabled filters built-in sections out of the render", async () => {
    const el = await mountDrawer(
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
    expect(getSectionHeadings(el)).toEqual(["Tags"]);
  });

  it("plugin sections interleave with built-ins by priority", async () => {
    const between: UISection = {
      id: "test.between",
      title: "Plugin between",
      priority: 25, // lands between Tags (20) and Last commit (30)
      mount: () => () => {},
    };
    const el = await mountDrawer(
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
    expect(getSectionHeadings(el)).toEqual(["File", "Tags", "Plugin between", "Last commit"]);
  });

  it("calls the plugin section's mount with the host-supplied container + ctx", async () => {
    type MountArgs = Parameters<UISection["mount"]>;
    const mountSpy = vi.fn<(...args: MountArgs) => UISectionLifecycle>(() => () => {});
    const plugin: UISection = {
      id: "test.spy",
      title: "Spy",
      priority: 100,
      mount: mountSpy,
    };
    await mountDrawer(baseData(), { getPluginSections: () => [plugin] });
    expect(mountSpy).toHaveBeenCalledTimes(1);
    const call = mountSpy.mock.calls[0]!;
    expect(call[0]).toBeInstanceOf(HTMLElement);
    // Context shape sanity: the host passes the live tags snapshot.
    expect(call[1].tags).toEqual({ author: "alice" });
  });

  it("disconnect runs every section's teardown (function lifecycle)", async () => {
    const teardownA = vi.fn();
    const teardownB = vi.fn();
    const el = await mountDrawer(baseData(), {
      getPluginSections: () => [
        { id: "test.a", title: "A", priority: 100, mount: () => teardownA },
        { id: "test.b", title: "B", priority: 200, mount: () => teardownB },
      ],
    });
    expect(teardownA).not.toHaveBeenCalled();
    el.destroy();
    expect(teardownA).toHaveBeenCalledTimes(1);
    expect(teardownB).toHaveBeenCalledTimes(1);
  });

  it("disconnect runs every section's unmount (object lifecycle) and survives a teardown throw", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const goodUnmount = vi.fn();
    const el = await mountDrawer(baseData(), {
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
    el.destroy();
    // Bad section's throw is logged but doesn't prevent the good
    // section from tearing down.
    expect(goodUnmount).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("notifyUpdate dispatches update(ctx) to reactive sections only — function-teardown sections aren't called", async () => {
    const reactiveUpdate = vi.fn();
    const reactiveUnmount = vi.fn();
    const simpleTeardown = vi.fn();
    const el = await mountDrawer(baseData(), {
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
    el.notifyUpdate();
    expect(reactiveUpdate).toHaveBeenCalledTimes(1);
    expect(simpleTeardown).not.toHaveBeenCalled();
    // Sanity: ctx carries the latest tags from the drawer's data.
    const call = reactiveUpdate.mock.calls[0]!;
    expect((call[0] as { tags: Record<string, string> }).tags).toEqual({ author: "alice" });
  });

  it("setLastCommit triggers a full re-render — newly-visible Last commit section appears", async () => {
    const el = await mountDrawer(baseData());
    // Initial render: no Last commit (data.lastCommit is undefined).
    expect(getSectionHeadings(el)).toEqual(["File", "Tags"]);
    el.setLastCommit({
      authorName: "alice",
      messageHeadline: "add Phase 2",
      date: "2026-04-25T00:00:00Z",
      shortSha: "1234abc",
    });
    await el.updateComplete;
    // After setLastCommit: visibility flipped, section appears.
    expect(getSectionHeadings(el)).toEqual(["File", "Tags", "Last commit"]);
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
