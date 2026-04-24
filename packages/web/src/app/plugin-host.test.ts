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

import { describe, expect, it, vi } from "vitest";
import { PluginHost, type AnnotPlugin, type ExternalLink } from "./plugin-host.js";

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
});
