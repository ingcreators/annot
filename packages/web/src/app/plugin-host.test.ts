/**
 * Plugin host — behavioural tests.
 *
 * Covers the invariants that matter for the OSS ↔ Cloud boundary:
 *   - multiple plugins' listeners fire in registration order
 *   - an error in one listener doesn't block sibling listeners
 *   - registration via a captured `ctx` after `registerAll` is still
 *     scoped to the same host (the context isn't per-call-stack)
 *   - external-link sources compose (multi-plugin contributions
 *     stack into a single drawer section)
 */

import { builtinIcon } from "@ingcreators/annot-core";
import type { StorageProvider } from "@ingcreators/annot-core/storage";
import { describe, expect, it, vi } from "vitest";
import {
  type AnnotPlugin,
  type ExternalLink,
  PluginHost,
  type SidebarTab,
  type StorageRegistration,
  type UISection,
  type UISectionLifecycle,
} from "./plugin-host.js";

/** Minimal `StorageRegistration` factory for tests — only fills the
 *  fields the host inspects (mode, priority). connect/restore/status
 *  return safe stubs that won't get called by the assertions below. */
function fakeStorageReg(
  mode: string,
  priority = 100,
  overrides: Partial<StorageRegistration> = {},
): StorageRegistration {
  return {
    mode,
    label: mode,
    priority,
    connect: async () => null,
    restore: () => null,
    status: () => ({ connected: false }),
    ...overrides,
  };
}

/** Minimal `SidebarTab` factory for tests. */
function fakeTab(id: string, overrides: Partial<SidebarTab> = {}): SidebarTab {
  return {
    id,
    label: id,
    priority: 100,
    onClick: () => {},
    ...overrides,
  };
}

/** Minimal `UISection` factory for tests. The default `mount`
 *  returns an empty teardown function — callers that exercise the
 *  lifecycle override `mount` with their own implementation. */
function fakeSection(id: string, overrides: Partial<UISection> = {}): UISection {
  return {
    id,
    title: id,
    priority: 100,
    mount: (): UISectionLifecycle => () => {},
    ...overrides,
  };
}

describe("PluginHost", () => {
  it("fires onAfterSave listeners in registration order", () => {
    const host = new PluginHost();
    const order: string[] = [];
    const pluginA: AnnotPlugin = {
      name: "a",
      register(ctx) {
        ctx.onAfterSave((ev) => {
          order.push(`a:${ev.path}`);
        });
      },
    };
    const pluginB: AnnotPlugin = {
      name: "b",
      register(ctx) {
        ctx.onAfterSave((ev) => {
          order.push(`b:${ev.path}`);
        });
      },
    };
    host.registerAll([pluginA, pluginB]);
    host.dispatchAfterSave({ path: "x.png", mode: "browser" });
    expect(order).toEqual(["a:x.png", "b:x.png"]);
  });

  it("isolates listener errors — a throw in one doesn't block others", () => {
    const host = new PluginHost();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const received: string[] = [];
    const throwingPlugin: AnnotPlugin = {
      name: "throws",
      register(ctx) {
        ctx.onAfterSave(() => {
          throw new Error("boom");
        });
      },
    };
    const healthyPlugin: AnnotPlugin = {
      name: "healthy",
      register(ctx) {
        ctx.onAfterSave((ev) => {
          received.push(ev.path);
        });
      },
    };
    host.registerAll([throwingPlugin, healthyPlugin]);
    host.dispatchAfterSave({ path: "x.png", mode: "browser" });
    expect(received).toEqual(["x.png"]);
    // The host surfaces the error rather than swallowing it silently —
    // a plugin bug should be debuggable, just not crashing.
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("composes external-link contributions across plugins", () => {
    const host = new PluginHost();
    const pluginA: AnnotPlugin = {
      name: "a",
      register(ctx) {
        ctx.addExternalLinkSource((path) => [{ label: `a@${path}`, url: "http://a" }]);
      },
    };
    const pluginB: AnnotPlugin = {
      name: "b",
      register(ctx) {
        ctx.addExternalLinkSource((path) => [{ label: `b@${path}`, url: "http://b" }]);
      },
    };
    host.registerAll([pluginA, pluginB]);
    const links = host.collectExternalLinks("foo.png", null);
    expect(links).toEqual<ExternalLink[]>([
      { label: "a@foo.png", url: "http://a" },
      { label: "b@foo.png", url: "http://b" },
    ]);
  });

  it("filters `undefined` return values — sources can opt out per-path", () => {
    const host = new PluginHost();
    const plugin: AnnotPlugin = {
      name: "conditional",
      register(ctx) {
        ctx.addExternalLinkSource((path) =>
          path.endsWith(".png") ? [{ label: "png", url: "http://p" }] : undefined,
        );
      },
    };
    host.registerAll([plugin]);
    expect(host.collectExternalLinks("a.png", null)).toHaveLength(1);
    expect(host.collectExternalLinks("a.svg", null)).toBeUndefined();
  });

  it("returns `undefined` (not `[]`) when no sources contribute", () => {
    // Important: the drawer's `externalLinks` prop hides the section
    // entirely when undefined; passing `[]` would render an empty
    // section. The host preserves that distinction.
    const host = new PluginHost();
    expect(host.collectExternalLinks("x.png", null)).toBeUndefined();
  });

  it("freezes the registration context so plugins can't mutate it", () => {
    const host = new PluginHost();
    let capturedCtx: unknown = null;
    const plugin: AnnotPlugin = {
      name: "grabby",
      register(ctx) {
        capturedCtx = ctx;
      },
    };
    host.registerAll([plugin]);
    expect(Object.isFrozen(capturedCtx)).toBe(true);
  });

  describe("onBeforeSave", () => {
    it("awaits listeners sequentially in registration order", async () => {
      const host = new PluginHost();
      const order: string[] = [];
      const pluginA: AnnotPlugin = {
        name: "a",
        register(ctx) {
          ctx.onBeforeSave(async () => {
            await Promise.resolve();
            order.push("a");
          });
        },
      };
      const pluginB: AnnotPlugin = {
        name: "b",
        register(ctx) {
          ctx.onBeforeSave(() => {
            order.push("b");
          });
        },
      };
      host.registerAll([pluginA, pluginB]);
      await host.dispatchBeforeSave({ path: "x.png", mode: "browser", tags: {} });
      expect(order).toEqual(["a", "b"]);
    });

    it("propagates listener throws to cancel the save — no isolation", async () => {
      const host = new PluginHost();
      const after: string[] = [];
      const cancelPlugin: AnnotPlugin = {
        name: "cancel",
        register(ctx) {
          ctx.onBeforeSave(() => {
            throw new Error("server rejected");
          });
        },
      };
      const followerPlugin: AnnotPlugin = {
        name: "follower",
        register(ctx) {
          ctx.onBeforeSave(() => {
            after.push("ran");
          });
        },
      };
      host.registerAll([cancelPlugin, followerPlugin]);
      await expect(
        host.dispatchBeforeSave({ path: "x.png", mode: "browser", tags: {} }),
      ).rejects.toThrow("server rejected");
      // A cancel stops the chain — downstream listeners don't run.
      expect(after).toEqual([]);
    });

    it("propagates async rejection the same way", async () => {
      const host = new PluginHost();
      const plugin: AnnotPlugin = {
        name: "async-cancel",
        register(ctx) {
          ctx.onBeforeSave(async () => {
            await Promise.resolve();
            throw new Error("network timeout");
          });
        },
      };
      host.registerAll([plugin]);
      await expect(
        host.dispatchBeforeSave({ path: "x.png", mode: "browser", tags: {} }),
      ).rejects.toThrow("network timeout");
    });

    it("resolves cleanly when no listeners are registered", async () => {
      const host = new PluginHost();
      await expect(
        host.dispatchBeforeSave({ path: "x.png", mode: "browser", tags: {} }),
      ).resolves.toBeUndefined();
    });
  });

  it("surfaces + isolates register() throws so one bad plugin doesn't kill init", () => {
    const host = new PluginHost();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const received: string[] = [];
    const brokenPlugin: AnnotPlugin = {
      name: "broken",
      register() {
        throw new Error("register-time explosion");
      },
    };
    const healthyPlugin: AnnotPlugin = {
      name: "healthy",
      register(ctx) {
        ctx.onEditorReady((ev) => {
          received.push(ev.path ?? "(null)");
        });
      },
    };
    host.registerAll([brokenPlugin, healthyPlugin]);
    host.dispatchEditorReady({ path: "x.png", tags: {} });
    expect(received).toEqual(["x.png"]);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  describe("registerStorage", () => {
    it("registers a plugin storage and resolves it via findStorageRegistration", () => {
      const host = new PluginHost();
      const reg = fakeStorageReg("fakecloud", 25);
      const plugin: AnnotPlugin = {
        name: "fakecloud-plugin",
        register(ctx) {
          ctx.registerStorage(reg);
        },
      };
      host.registerAll([plugin]);
      expect(host.findStorageRegistration("fakecloud")).toBe(reg);
    });

    it("returns undefined for unregistered modes — bridge falls back to browser", () => {
      const host = new PluginHost();
      expect(host.findStorageRegistration("nonexistent")).toBeUndefined();
    });

    it("listStorageRegistrations preserves registration order", () => {
      const host = new PluginHost();
      const a = fakeStorageReg("alpha", 50);
      const b = fakeStorageReg("beta", 25);
      const c = fakeStorageReg("gamma", 100);
      host.registerAll([
        { name: "p1", register: (ctx) => ctx.registerStorage(a) },
        { name: "p2", register: (ctx) => ctx.registerStorage(b) },
        { name: "p3", register: (ctx) => ctx.registerStorage(c) },
      ]);
      // The host preserves *registration* order; sidebar sorts by
      // `priority` separately. Verifying the registration order here
      // means the sort is the only thing that controls visual order.
      expect(host.listStorageRegistrations().map((r) => r.mode)).toEqual([
        "alpha",
        "beta",
        "gamma",
      ]);
    });

    it("throws when a plugin tries to register a built-in mode key", () => {
      const host = new PluginHost();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const plugin: AnnotPlugin = {
        name: "rogue",
        register(ctx) {
          // GitHub is a built-in — collision must be rejected so a
          // misconfigured plugin can't shadow the built-in.
          ctx.registerStorage(fakeStorageReg("github"));
        },
      };
      // The throw is isolated by `registerAll` (per the existing
      // register-time error policy) — but we can verify the host
      // logged the error and didn't accept the registration.
      host.registerAll([plugin]);
      expect(host.findStorageRegistration("github")).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it.each([
      "browser",
      "device",
      "googledrive",
      "github",
      "extension",
      "cloud",
    ])("rejects collision with built-in mode %s", (builtin) => {
      const host = new PluginHost();
      // Bypass `registerAll`'s error isolation by calling the
      // ctx method directly via a captured reference — gives us
      // a clean `expect(...).toThrow` assertion.
      let captured: ((reg: StorageRegistration) => void) | undefined;
      host.registerAll([
        {
          name: "capture",
          register(ctx) {
            captured = ctx.registerStorage;
          },
        },
      ]);
      expect(() => captured!(fakeStorageReg(builtin))).toThrow(/collides with a built-in/);
    });

    it("throws on duplicate plugin mode (collision with previously-registered plugin)", () => {
      const host = new PluginHost();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const first: AnnotPlugin = {
        name: "first",
        register(ctx) {
          ctx.registerStorage(fakeStorageReg("fakecloud"));
        },
      };
      const second: AnnotPlugin = {
        name: "second",
        register(ctx) {
          ctx.registerStorage(fakeStorageReg("fakecloud"));
        },
      };
      host.registerAll([first, second]);
      // The first plugin's registration wins; the second's throw
      // is logged + isolated.
      const reg = host.findStorageRegistration("fakecloud")!;
      expect(reg).toBeDefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("plugin-registered store survives registration round-trip — connect can hand back any StorageProvider", async () => {
      // Smoke test that the registration's `connect` factory shape
      // round-trips: the same instance the plugin built is what
      // findStorageRegistration sees later. Catches accidental
      // copying / freezing of the registration object.
      const host = new PluginHost();
      const fakeStore = { id: "fake-store-instance" } as unknown as StorageProvider;
      const reg = fakeStorageReg("fakecloud", 25, {
        connect: async () => fakeStore,
      });
      host.registerAll([{ name: "fakecloud-plugin", register: (ctx) => ctx.registerStorage(reg) }]);
      const back = host.findStorageRegistration("fakecloud");
      const result = await back!.connect({ forcePicker: false });
      expect(result).toBe(fakeStore);
    });
  });

  describe("addSidebarTab / updateSidebarTab", () => {
    it("registers a tab and resolves it via findSidebarTab", () => {
      const host = new PluginHost();
      const tab = fakeTab("recent", { priority: 10 });
      host.registerAll([{ name: "p", register: (ctx) => ctx.addSidebarTab(tab) }]);
      expect(host.findSidebarTab("recent")).toEqual(tab);
    });

    it("listSidebarTabs preserves registration order", () => {
      const host = new PluginHost();
      host.registerAll([
        { name: "p1", register: (ctx) => ctx.addSidebarTab(fakeTab("a", { priority: 50 })) },
        { name: "p2", register: (ctx) => ctx.addSidebarTab(fakeTab("b", { priority: 25 })) },
        { name: "p3", register: (ctx) => ctx.addSidebarTab(fakeTab("c", { priority: 100 })) },
      ]);
      // Sidebar sort by priority is the sidebar's job; the host
      // returns registration order so the sort is the only thing
      // that controls visual order.
      expect(host.listSidebarTabs().map((t) => t.id)).toEqual(["a", "b", "c"]);
    });

    it("throws on duplicate tab id (collision with previously-registered tab)", () => {
      const host = new PluginHost();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      host.registerAll([
        { name: "p1", register: (ctx) => ctx.addSidebarTab(fakeTab("recent")) },
        { name: "p2", register: (ctx) => ctx.addSidebarTab(fakeTab("recent")) },
      ]);
      // The first registration wins; the second's throw is logged
      // and isolated by the existing per-plugin try/catch in
      // `registerAll`.
      expect(host.findSidebarTab("recent")).toBeDefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("updateSidebarTab mutates only the supplied fields", () => {
      const host = new PluginHost();
      let captured: ((id: string, partial: Partial<SidebarTab>) => void) | undefined;
      host.registerAll([
        {
          name: "p",
          register(ctx) {
            ctx.addSidebarTab(fakeTab("recent", { label: "Recent", icon: builtinIcon("history") }));
            captured = ctx.updateSidebarTab;
          },
        },
      ]);
      captured!("recent", { badge: "12" });
      const tab = host.findSidebarTab("recent")!;
      expect(tab.label).toBe("Recent");
      expect(tab.icon).toEqual({ kind: "builtin", id: "history" });
      expect(tab.badge).toBe("12");
    });

    it("updateSidebarTab throws on unknown id", () => {
      const host = new PluginHost();
      let captured: ((id: string, partial: Partial<SidebarTab>) => void) | undefined;
      host.registerAll([
        {
          name: "p",
          register(ctx) {
            captured = ctx.updateSidebarTab;
          },
        },
      ]);
      expect(() => captured!("nonexistent", { badge: "1" })).toThrow(/not registered/);
    });

    it("setting one tab active flips every other tab to inactive (single-active enforcement)", () => {
      const host = new PluginHost();
      let captured: ((id: string, partial: Partial<SidebarTab>) => void) | undefined;
      host.registerAll([
        {
          name: "p1",
          register(ctx) {
            ctx.addSidebarTab(fakeTab("a", { isActive: true }));
            ctx.addSidebarTab(fakeTab("b"));
            captured = ctx.updateSidebarTab;
          },
        },
        {
          name: "p2",
          register(ctx) {
            ctx.addSidebarTab(fakeTab("c"));
          },
        },
      ]);
      // Sanity: only "a" starts active.
      expect(host.findSidebarTab("a")?.isActive).toBe(true);
      expect(host.findSidebarTab("b")?.isActive).toBeFalsy();
      expect(host.findSidebarTab("c")?.isActive).toBeFalsy();

      // Activate "c" (a different plugin's tab). Sidebar enforces
      // single-active across plugin boundaries, so "a" deactivates.
      captured!("c", { isActive: true });
      expect(host.findSidebarTab("a")?.isActive).toBe(false);
      expect(host.findSidebarTab("b")?.isActive).toBeFalsy();
      expect(host.findSidebarTab("c")?.isActive).toBe(true);
    });

    it("addSidebarTab with isActive: true also enforces single-active vs previously-active tab", () => {
      const host = new PluginHost();
      host.registerAll([
        {
          name: "p1",
          register: (ctx) => ctx.addSidebarTab(fakeTab("a", { isActive: true })),
        },
        {
          name: "p2",
          // A misconfigured second plugin tries to register another
          // initial-active tab. The host honors single-active by
          // deactivating the first one rather than refusing the
          // registration — keeps the rule simple ("at most one
          // active at any moment") regardless of how the state got
          // there.
          register: (ctx) => ctx.addSidebarTab(fakeTab("b", { isActive: true })),
        },
      ]);
      expect(host.findSidebarTab("a")?.isActive).toBe(false);
      expect(host.findSidebarTab("b")?.isActive).toBe(true);
    });

    it("onSidebarChange fires after addSidebarTab and updateSidebarTab", () => {
      const host = new PluginHost();
      const log: string[] = [];
      host.onSidebarChange(() => {
        log.push("changed");
      });
      let captured: ((id: string, partial: Partial<SidebarTab>) => void) | undefined;
      host.registerAll([
        {
          name: "p",
          register(ctx) {
            ctx.addSidebarTab(fakeTab("recent"));
            captured = ctx.updateSidebarTab;
          },
        },
      ]);
      // One fire from addSidebarTab.
      expect(log).toHaveLength(1);
      captured!("recent", { badge: "5" });
      expect(log).toHaveLength(2);
    });

    it("returns undefined for an unregistered tab id", () => {
      const host = new PluginHost();
      expect(host.findSidebarTab("nonexistent")).toBeUndefined();
    });
  });

  describe("addDrawerSection / addRightPanelSection", () => {
    it("registers a drawer section and resolves it via findDrawerSection", () => {
      const host = new PluginHost();
      const section = fakeSection("cloud.comments", { priority: 25 });
      host.registerAll([{ name: "cloud", register: (ctx) => ctx.addDrawerSection(section) }]);
      expect(host.findDrawerSection("cloud.comments")).toBe(section);
    });

    it("registers a right-panel section and resolves it via findRightPanelSection", () => {
      const host = new PluginHost();
      const section = fakeSection("cloud.team-presence");
      host.registerAll([{ name: "cloud", register: (ctx) => ctx.addRightPanelSection(section) }]);
      expect(host.findRightPanelSection("cloud.team-presence")).toBe(section);
    });

    it("the two namespaces are independent — same id allowed across targets", () => {
      // A common Cloud pattern: a "comments" section in both the
      // drawer and the right-panel. Independent namespaces let
      // the plugin reuse the suffix without colliding.
      const host = new PluginHost();
      const drawerComments = fakeSection("comments", { title: "Comments (drawer)" });
      const rightPanelComments = fakeSection("comments", { title: "Comments (panel)" });
      host.registerAll([
        {
          name: "cloud",
          register(ctx) {
            ctx.addDrawerSection(drawerComments);
            ctx.addRightPanelSection(rightPanelComments);
          },
        },
      ]);
      expect(host.findDrawerSection("comments")).toBe(drawerComments);
      expect(host.findRightPanelSection("comments")).toBe(rightPanelComments);
    });

    it("listDrawerSections / listRightPanelSections preserve registration order", () => {
      const host = new PluginHost();
      host.registerAll([
        {
          name: "p1",
          register(ctx) {
            ctx.addDrawerSection(fakeSection("a"));
            ctx.addDrawerSection(fakeSection("b"));
            ctx.addRightPanelSection(fakeSection("x"));
          },
        },
        {
          name: "p2",
          register(ctx) {
            ctx.addDrawerSection(fakeSection("c"));
            ctx.addRightPanelSection(fakeSection("y"));
          },
        },
      ]);
      expect(host.listDrawerSections().map((s) => s.id)).toEqual(["a", "b", "c"]);
      expect(host.listRightPanelSections().map((s) => s.id)).toEqual(["x", "y"]);
    });

    it("throws on duplicate drawer-section id (collision with previous registration)", () => {
      const host = new PluginHost();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      host.registerAll([
        { name: "p1", register: (ctx) => ctx.addDrawerSection(fakeSection("file")) },
        { name: "p2", register: (ctx) => ctx.addDrawerSection(fakeSection("file")) },
      ]);
      // First registration wins; the second's throw is logged +
      // isolated by `registerAll`'s per-plugin try/catch (same
      // pattern as the storage / sidebar-tab paths).
      expect(host.findDrawerSection("file")).toBeDefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("throws on duplicate right-panel-section id", () => {
      const host = new PluginHost();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      host.registerAll([
        { name: "p1", register: (ctx) => ctx.addRightPanelSection(fakeSection("tool")) },
        { name: "p2", register: (ctx) => ctx.addRightPanelSection(fakeSection("tool")) },
      ]);
      expect(host.findRightPanelSection("tool")).toBeDefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("returns undefined for an unregistered section id", () => {
      const host = new PluginHost();
      expect(host.findDrawerSection("nonexistent")).toBeUndefined();
      expect(host.findRightPanelSection("nonexistent")).toBeUndefined();
    });

    it("registration captures the lifecycle factory shape — both teardown function and reactive object are valid mounts", () => {
      // Smoke test that `mount` accepts both shapes the plan
      // promises:
      //   - simple: returns a function
      //   - reactive: returns { update?, unmount }
      // Phase 1 doesn't render anything, so we just verify the
      // factory is callable and the return value matches the
      // declared type.
      const host = new PluginHost();
      const teardownSpy = vi.fn();
      const updateSpy = vi.fn();
      const unmountSpy = vi.fn();
      const simple: UISection = fakeSection("simple", {
        mount: () => teardownSpy,
      });
      const reactive: UISection = fakeSection("reactive", {
        mount: () => ({
          update: updateSpy,
          unmount: unmountSpy,
        }),
      });
      host.registerAll([
        {
          name: "p",
          register(ctx) {
            ctx.addDrawerSection(simple);
            ctx.addDrawerSection(reactive);
          },
        },
      ]);
      // Use a stand-in object — the test environment is `node`,
      // so `document.createElement` isn't available. Phase 2 / 3
      // tests that exercise the actual drawer / right-panel render
      // path will switch to happy-dom.
      const stub = {} as unknown as HTMLElement;
      const ctx = {
        path: "x",
        mode: "browser",
        tags: {},
        setTitle: () => {},
      };
      // Pull the registered shapes back and exercise their mount
      // factories. Both should produce the documented lifecycle
      // shape; the host doesn't transform what mount returns.
      const simpleLifecycle = host.findDrawerSection("simple")!.mount(stub, ctx);
      const reactiveLifecycle = host.findDrawerSection("reactive")!.mount(stub, ctx);
      expect(typeof simpleLifecycle).toBe("function");
      expect(typeof reactiveLifecycle).toBe("object");
      // Spot-check the lifecycle is wired through correctly.
      (simpleLifecycle as () => void)();
      expect(teardownSpy).toHaveBeenCalled();
      (reactiveLifecycle as { update?: (c: typeof ctx) => void; unmount(): void }).update!(ctx);
      expect(updateSpy).toHaveBeenCalled();
    });
  });
});
