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

import type { StorageProvider } from "@ingcreators/annot-core/storage";
import { describe, expect, it, vi } from "vitest";
import {
  PluginHost,
  type AnnotPlugin,
  type ExternalLink,
  type StorageRegistration,
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
      const reg = fakeStorageReg("cloud", 25);
      const plugin: AnnotPlugin = {
        name: "cloud",
        register(ctx) {
          ctx.registerStorage(reg);
        },
      };
      host.registerAll([plugin]);
      expect(host.findStorageRegistration("cloud")).toBe(reg);
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

    it.each(["browser", "device", "googledrive", "github", "extension"])(
      "rejects collision with built-in mode %s",
      (builtin) => {
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
      },
    );

    it("throws on duplicate plugin mode (collision with previously-registered plugin)", () => {
      const host = new PluginHost();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const first: AnnotPlugin = {
        name: "first",
        register(ctx) {
          ctx.registerStorage(fakeStorageReg("cloud"));
        },
      };
      const second: AnnotPlugin = {
        name: "second",
        register(ctx) {
          ctx.registerStorage(fakeStorageReg("cloud"));
        },
      };
      host.registerAll([first, second]);
      // The first plugin's registration wins; the second's throw
      // is logged + isolated.
      const reg = host.findStorageRegistration("cloud")!;
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
      const reg = fakeStorageReg("cloud", 25, {
        connect: async () => fakeStore,
      });
      host.registerAll([
        { name: "cloud", register: (ctx) => ctx.registerStorage(reg) },
      ]);
      const back = host.findStorageRegistration("cloud");
      const result = await back!.connect({ forcePicker: false });
      expect(result).toBe(fakeStore);
    });
  });
});
