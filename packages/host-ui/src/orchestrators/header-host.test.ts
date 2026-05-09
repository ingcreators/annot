/**
 * @vitest-environment happy-dom
 *
 * HeaderHost is mostly callback-routing — the imperative DOM lives
 * inside `<annot-editor-header>`. The behavioural surface worth
 * pinning is:
 *
 *   - `build()` mounts the Lit element + wires every callback the
 *     header invokes (rename / nav / open / copy / save / save-menu /
 *     toggle-info).
 *   - `populateLastCommit()` race-guard: if the user navigates to a
 *     different image while the lookup is in flight, the drawer is
 *     NOT patched.
 *   - `renameCurrentImage()` happy path: storage call, current-path
 *     bookkeeping, route push, drawer refresh, last-commit re-fetch.
 *   - `renameCurrentImage()` defensive throw when no active file.
 */

import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnnotFileDetailsDrawerElement,
  LastCommitInfo,
} from "../annot-file-details-drawer.js";
import { HeaderHost, type HeaderHostDeps } from "./header-host.js";

interface DrawerStub {
  setData: ReturnType<typeof vi.fn>;
  setLastCommit: ReturnType<typeof vi.fn>;
  toggle: ReturnType<typeof vi.fn>;
}

function makeDrawerStub(): DrawerStub {
  return {
    setData: vi.fn(),
    setLastCommit: vi.fn(),
    toggle: vi.fn(),
  };
}

interface DepsState {
  storage: StorageProvider | null;
  imagePath: string | null;
  imageRecord: ImageRecord | null;
  folderPath: string;
  tags: Record<string, string>;
  drawer: DrawerStub | null;
  rootLabel: string;
  fetchLastCommitImpl?: HeaderHostDeps["fetchLastCommit"];
  pushEditRoute?: HeaderHostDeps["pushEditRoute"];
  collectExternalLinks: HeaderHostDeps["collectExternalLinks"];
  showGallery: HeaderHostDeps["showGallery"];
  openFile?: HeaderHostDeps["openFile"];
}

function buildDeps(state: Partial<DepsState> = {}): {
  deps: HeaderHostDeps;
  state: DepsState;
} {
  const s: DepsState = {
    storage: state.storage ?? null,
    imagePath: "imagePath" in state ? (state.imagePath as string | null) : "Inbox/x.annot.svg",
    imageRecord:
      "imageRecord" in state
        ? (state.imageRecord as ImageRecord | null)
        : ({ path: "Inbox/x.annot.svg", folderPath: "Inbox" } as ImageRecord),
    folderPath: state.folderPath ?? "Inbox",
    tags: state.tags ?? {},
    drawer: state.drawer ?? makeDrawerStub(),
    rootLabel: state.rootLabel ?? "Browser",
    fetchLastCommitImpl: state.fetchLastCommitImpl,
    pushEditRoute: state.pushEditRoute,
    collectExternalLinks:
      state.collectExternalLinks ??
      vi.fn<HeaderHostDeps["collectExternalLinks"]>().mockReturnValue([]),
    showGallery:
      state.showGallery ?? vi.fn<HeaderHostDeps["showGallery"]>().mockResolvedValue(undefined),
    openFile: state.openFile,
  };

  const deps: HeaderHostDeps = {
    getStorage: () => s.storage,
    getCurrentImagePath: () => s.imagePath,
    setCurrentImagePath: (path) => {
      s.imagePath = path;
    },
    getCurrentImageRecord: () => s.imageRecord,
    setCurrentImageRecord: (record) => {
      s.imageRecord = record;
    },
    getCurrentTags: () => s.tags,
    getCurrentImageDataUrl: () => "data:image/png;base64,",
    getCurrentFolderPath: () => s.folderPath,
    setCurrentFolderPath: (path) => {
      s.folderPath = path;
    },
    getFileDetailsDrawer: () => s.drawer as unknown as AnnotFileDetailsDrawerElement | null,
    getToolbar: () => null,
    getImageSize: () => ({ width: 800, height: 600 }),
    showGallery: s.showGallery,
    collectExternalLinks: s.collectExternalLinks,
    getRootLabel: () => s.rootLabel,
    pushEditRoute: s.pushEditRoute,
    fetchLastCommit: s.fetchLastCommitImpl,
    openFile: s.openFile,
  };
  return { deps, state: s };
}

function makeHost(): HTMLDivElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

describe("HeaderHost.build", () => {
  it("mounts <annot-editor-header> inside the host element", () => {
    const host = makeHost();
    const { deps } = buildDeps();
    const hh = new HeaderHost(host, deps);
    hh.build();
    expect(host.children.length).toBe(1);
    expect(host.firstElementChild!.tagName.toLowerCase()).toBe("annot-editor-header");
  });

  it("seeds rootLabel + filename + breadcrumb from deps", () => {
    const host = makeHost();
    const { deps } = buildDeps({
      imagePath: "ProjectA/Sub/screenshot.annot.svg",
      folderPath: "ProjectA/Sub",
      rootLabel: "GitHub",
    });
    const hh = new HeaderHost(host, deps);
    hh.build();
    const el = host.firstElementChild as unknown as {
      rootLabel: string;
      filename: string;
      fullPath: string;
      crumbs: Array<{ label: string; path: string }>;
    };
    expect(el.rootLabel).toBe("GitHub");
    expect(el.filename).toBe("screenshot.annot.svg");
    expect(el.fullPath).toBe("ProjectA/Sub/screenshot.annot.svg");
    expect(el.crumbs).toEqual([
      { label: "ProjectA", path: "ProjectA" },
      { label: "Sub", path: "ProjectA/Sub" },
    ]);
  });

  it("emits an empty crumbs array for the root folder", () => {
    const host = makeHost();
    const { deps } = buildDeps({ folderPath: "" });
    const hh = new HeaderHost(host, deps);
    hh.build();
    const el = host.firstElementChild as unknown as {
      crumbs: Array<{ label: string; path: string }>;
    };
    expect(el.crumbs).toEqual([]);
  });

  it("rebuilding clears the previous element + mounts a fresh one", () => {
    const host = makeHost();
    const { deps } = buildDeps();
    const hh = new HeaderHost(host, deps);
    hh.build();
    const first = host.firstElementChild;
    hh.build();
    expect(host.children.length).toBe(1);
    expect(host.firstElementChild).not.toBe(first);
  });
});

describe("HeaderHost.reset", () => {
  it("clears the inner ref so getSaveStatusIndicator returns null", () => {
    const host = makeHost();
    const { deps } = buildDeps();
    const hh = new HeaderHost(host, deps);
    hh.build();
    hh.reset();
    expect(hh.getSaveStatusIndicator()).toBeNull();
  });

  it("getSaveStatusIndicator() returns null before build()", () => {
    const host = makeHost();
    const { deps } = buildDeps();
    const hh = new HeaderHost(host, deps);
    expect(hh.getSaveStatusIndicator()).toBeNull();
  });
});

describe("HeaderHost.buildExternalLinksFor", () => {
  it("delegates to deps.collectExternalLinks with the supplied path", () => {
    const host = makeHost();
    const collected = [{ label: "View on GitHub", url: "https://github.com/foo" }];
    const { deps, state } = buildDeps({
      collectExternalLinks: vi.fn().mockReturnValue(collected),
    });
    const hh = new HeaderHost(host, deps);
    expect(hh.buildExternalLinksFor("Inbox/x.annot.svg")).toBe(collected);
    expect(state.collectExternalLinks).toHaveBeenCalledWith("Inbox/x.annot.svg");
  });
});

describe("HeaderHost.populateLastCommit", () => {
  it("no-op when path is null", async () => {
    const host = makeHost();
    const fetchLastCommit = vi.fn();
    const { deps } = buildDeps({ fetchLastCommitImpl: fetchLastCommit });
    const hh = new HeaderHost(host, deps);
    hh.build();
    await hh.populateLastCommit(null);
    expect(fetchLastCommit).not.toHaveBeenCalled();
  });

  it("no-op when fetchLastCommit dep is omitted (Desktop / VSCode hosts)", async () => {
    const host = makeHost();
    const drawer = makeDrawerStub();
    const { deps } = buildDeps({ drawer, fetchLastCommitImpl: undefined });
    const hh = new HeaderHost(host, deps);
    hh.build();
    await hh.populateLastCommit("Inbox/x.annot.svg");
    expect(drawer.setLastCommit).not.toHaveBeenCalled();
  });

  it("patches the drawer when fetch returns commit info", async () => {
    const host = makeHost();
    const drawer = makeDrawerStub();
    const info: LastCommitInfo = {
      authorName: "alice",
      messageHeadline: "feat: x",
      date: "2026-01-01T00:00:00Z",
      shortSha: "abc1234",
      url: "https://github.com/foo/commit/abc1234",
    };
    const { deps } = buildDeps({
      drawer,
      fetchLastCommitImpl: vi.fn().mockResolvedValue(info),
    });
    const hh = new HeaderHost(host, deps);
    hh.build();
    await hh.populateLastCommit("Inbox/x.annot.svg");
    expect(drawer.setLastCommit).toHaveBeenCalledWith(info);
  });

  it("does NOT patch the drawer when fetch returns null", async () => {
    const host = makeHost();
    const drawer = makeDrawerStub();
    const { deps } = buildDeps({
      drawer,
      fetchLastCommitImpl: vi.fn().mockResolvedValue(null),
    });
    const hh = new HeaderHost(host, deps);
    hh.build();
    await hh.populateLastCommit("Inbox/x.annot.svg");
    expect(drawer.setLastCommit).not.toHaveBeenCalled();
  });

  it("race-guards: doesn't patch the drawer if the user navigated mid-fetch", async () => {
    const host = makeHost();
    const drawer = makeDrawerStub();
    let resolveFetch: (info: LastCommitInfo) => void = () => {};
    const fetchPromise = new Promise<LastCommitInfo>((res) => {
      resolveFetch = res;
    });
    const { deps, state } = buildDeps({
      drawer,
      fetchLastCommitImpl: vi.fn().mockReturnValue(fetchPromise),
    });
    const hh = new HeaderHost(host, deps);
    hh.build();

    // Start the populate for path A.
    const populating = hh.populateLastCommit("PathA");
    // Mid-flight, the user navigates to PathB.
    state.imagePath = "PathB";
    // Resolve the fetch — but since current path no longer matches PathA,
    // the patch should be skipped.
    resolveFetch({
      authorName: "alice",
      messageHeadline: "stale",
      date: "2026-01-01T00:00:00Z",
      shortSha: "deadbee",
    } as LastCommitInfo);
    await populating;
    expect(drawer.setLastCommit).not.toHaveBeenCalled();
  });

  it("swallows fetch errors silently (drawer just omits the section)", async () => {
    const host = makeHost();
    const drawer = makeDrawerStub();
    const { deps } = buildDeps({
      drawer,
      fetchLastCommitImpl: vi.fn().mockRejectedValue(new Error("network")),
    });
    const hh = new HeaderHost(host, deps);
    hh.build();
    await expect(hh.populateLastCommit("Inbox/x.annot.svg")).resolves.toBeUndefined();
    expect(drawer.setLastCommit).not.toHaveBeenCalled();
  });
});

describe("HeaderHost.renameCurrentImage", () => {
  it("throws when no storage is mounted", async () => {
    const host = makeHost();
    const { deps } = buildDeps({ storage: null });
    const hh = new HeaderHost(host, deps);
    await expect(hh.renameCurrentImage("new.svg")).rejects.toThrow(/No active file/);
  });

  it("throws when no current image path", async () => {
    const host = makeHost();
    const renameImage = vi.fn();
    const { deps } = buildDeps({
      imagePath: null,
      storage: { renameImage } as unknown as StorageProvider,
    });
    const hh = new HeaderHost(host, deps);
    await expect(hh.renameCurrentImage("new.svg")).rejects.toThrow(/No active file/);
    expect(renameImage).not.toHaveBeenCalled();
  });

  it("updates current path / record / route / drawer / re-fetches last commit", async () => {
    const host = makeHost();
    const drawer = makeDrawerStub();
    const renameImage = vi.fn().mockResolvedValue("Inbox/renamed.annot.svg");
    const pushEditRoute = vi.fn();
    const fetchLastCommit = vi.fn().mockResolvedValue(null);
    const { deps, state } = buildDeps({
      drawer,
      pushEditRoute,
      fetchLastCommitImpl: fetchLastCommit,
      storage: { renameImage } as unknown as StorageProvider,
      imageRecord: {
        path: "Inbox/x.annot.svg",
        folderPath: "Inbox",
        createdAt: "2026-01-01",
        updatedAt: "2026-02-01",
      } as ImageRecord,
    });
    const hh = new HeaderHost(host, deps);
    hh.build();

    await hh.renameCurrentImage("renamed.annot.svg");

    expect(renameImage).toHaveBeenCalledWith("Inbox/x.annot.svg", "renamed.annot.svg");
    expect(state.imagePath).toBe("Inbox/renamed.annot.svg");
    expect(state.imageRecord!.path).toBe("Inbox/renamed.annot.svg");
    expect(pushEditRoute).toHaveBeenCalledWith("Inbox/renamed.annot.svg");
    expect(drawer.setData).toHaveBeenCalledTimes(1);
    expect(drawer.setData.mock.calls[0]![0]).toMatchObject({
      filename: "renamed.annot.svg",
      width: 800,
      height: 600,
    });
    // Last-commit refresh fires (race guard sees the new path is current).
    expect(fetchLastCommit).toHaveBeenCalledWith("Inbox/renamed.annot.svg");
  });

  it("handles the storage backend's uniquification — the returned path is what we adopt", async () => {
    const host = makeHost();
    const renameImage = vi.fn().mockResolvedValue("Inbox/renamed (2).annot.svg");
    const { deps, state } = buildDeps({
      storage: { renameImage } as unknown as StorageProvider,
    });
    const hh = new HeaderHost(host, deps);
    hh.build();
    await hh.renameCurrentImage("renamed.annot.svg");
    expect(state.imagePath).toBe("Inbox/renamed (2).annot.svg");
  });

  it("works without a pushEditRoute dep (Desktop has no router)", async () => {
    const host = makeHost();
    const renameImage = vi.fn().mockResolvedValue("Inbox/renamed.annot.svg");
    const { deps } = buildDeps({
      storage: { renameImage } as unknown as StorageProvider,
      pushEditRoute: undefined,
    });
    const hh = new HeaderHost(host, deps);
    hh.build();
    await expect(hh.renameCurrentImage("renamed.annot.svg")).resolves.toBeUndefined();
  });
});

// `populateLastCommit` interleaves with rename — quick sanity that
// timer-driven race conditions across the two flows don't regress.
describe("HeaderHost interleavings", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rename + populateLastCommit race: stale lookup against the OLD path is dropped", async () => {
    const host = makeHost();
    const drawer = makeDrawerStub();
    let release: (info: LastCommitInfo) => void = () => {};
    const slowLookup = new Promise<LastCommitInfo>((res) => {
      release = res;
    });
    const fetchLastCommit = vi
      .fn<NonNullable<HeaderHostDeps["fetchLastCommit"]>>()
      // First call (fired by the user's manual populate) returns the slow promise.
      .mockReturnValueOnce(slowLookup)
      // Second call (rename's own re-fetch) returns null instantly.
      .mockResolvedValueOnce(null);
    const renameImage = vi.fn().mockResolvedValue("Inbox/new.annot.svg");
    const { deps } = buildDeps({
      drawer,
      fetchLastCommitImpl: fetchLastCommit,
      storage: { renameImage } as unknown as StorageProvider,
    });
    const hh = new HeaderHost(host, deps);
    hh.build();

    const lookupP = hh.populateLastCommit("Inbox/x.annot.svg");
    await hh.renameCurrentImage("new.annot.svg");
    // Now release the first lookup — by this point `getCurrentImagePath`
    // returns the renamed path, so the race-guard skips the patch.
    release({
      authorName: "alice",
      messageHeadline: "stale",
      date: "2026-01-01T00:00:00Z",
      shortSha: "deadbee",
    } as LastCommitInfo);
    await lookupP;
    // Drawer was patched ONLY by the rename's setData call (drawing the
    // renamed file), never by setLastCommit (the stale lookup was
    // race-guarded out).
    expect(drawer.setLastCommit).not.toHaveBeenCalled();
  });
});
