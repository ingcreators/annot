import { describe, expect, it } from "vitest";

import {
  type EditorConfigVitePlugin,
  editorConfigVirtualPlugin,
  productDocsIntegration,
  resolveEditorConfig,
} from "./integration.js";

interface AstroSetupCalls {
  logs: string[];
  updates: Array<{ vite?: { plugins?: EditorConfigVitePlugin[] } }>;
}

function setupRig(): {
  context: {
    logger: { info: (msg: string) => void };
    updateConfig: (cfg: { vite?: { plugins?: EditorConfigVitePlugin[] } }) => void;
  };
  calls: AstroSetupCalls;
} {
  const calls: AstroSetupCalls = { logs: [], updates: [] };
  return {
    context: {
      logger: { info: (msg: string) => calls.logs.push(msg) },
      updateConfig: (cfg) => {
        calls.updates.push(cfg);
      },
    },
    calls,
  };
}

function runSetup(integration: ReturnType<typeof productDocsIntegration>): AstroSetupCalls {
  const { context, calls } = setupRig();
  const hook = integration.hooks["astro:config:setup"];
  if (typeof hook !== "function") throw new Error("hook missing");
  hook(context as never);
  return calls;
}

describe("productDocsIntegration", () => {
  it("returns an Astro integration named correctly", () => {
    const integration = productDocsIntegration();
    expect(integration.name).toBe("@ingcreators/annot-product-docs-astro");
  });

  it("installs astro:config:setup hook", () => {
    const integration = productDocsIntegration();
    expect(typeof integration.hooks["astro:config:setup"]).toBe("function");
  });

  it("logs verbose output when verbose=true", () => {
    const integration = productDocsIntegration({ verbose: true });
    const { logs } = runSetup(integration);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/installed/);
    expect(logs[0]).toMatch(/contentDir=docs/);
    expect(logs[0]).toMatch(/configPath=annot-docs.config.ts/);
    expect(logs[0]).toMatch(/editor\.embedMode=newTab/);
    expect(logs[0]).toMatch(/editor\.cloudUrl=https:\/\/annot\.work/);
  });

  it("is silent when verbose=false (default)", () => {
    const integration = productDocsIntegration();
    const { logs } = runSetup(integration);
    expect(logs).toEqual([]);
  });

  it("respects custom contentDir + configPath in logs", () => {
    const integration = productDocsIntegration({
      contentDir: "src/screens",
      configPath: "config/annot.ts",
      verbose: true,
    });
    const { logs } = runSetup(integration);
    expect(logs[0]).toMatch(/contentDir=src\/screens/);
    expect(logs[0]).toMatch(/configPath=config\/annot\.ts/);
  });

  it("registers the editor-config virtual plugin in astro:config:setup", () => {
    const integration = productDocsIntegration();
    const { updates } = runSetup(integration);
    expect(updates).toHaveLength(1);
    const plugins = updates[0]?.vite?.plugins ?? [];
    expect(plugins.length).toBeGreaterThanOrEqual(1);
    expect(plugins[0]?.name).toBe("annot-docs:editor-config-virtual");
  });

  it("reflects the integration's editor option in the virtual plugin's output", () => {
    const integration = productDocsIntegration({
      editor: {
        embedMode: "inline",
        cloudUrl: "https://annot.internal.example.com",
      },
      verbose: true,
    });
    const { logs, updates } = runSetup(integration);
    expect(logs[0]).toMatch(/editor\.embedMode=inline/);
    expect(logs[0]).toMatch(/editor\.cloudUrl=https:\/\/annot\.internal\.example\.com/);
    const plugin = updates[0]?.vite?.plugins?.[0];
    const loaded = plugin?.load("\0virtual:annot-docs/editor-config") ?? "";
    expect(loaded).toMatch(/"embedMode":"inline"/);
    expect(loaded).toMatch(/"cloudUrl":"https:\/\/annot\.internal\.example\.com"/);
  });
});

describe("resolveEditorConfig", () => {
  it("returns the built-in defaults when no editor option supplied", () => {
    const resolved = resolveEditorConfig(undefined);
    expect(resolved).toEqual({
      embedMode: "newTab",
      cloudUrl: "https://annot.work",
    });
  });

  it("preserves the built-in cloudUrl when only embedMode is overridden", () => {
    const resolved = resolveEditorConfig({ embedMode: "inline" });
    expect(resolved.embedMode).toBe("inline");
    expect(resolved.cloudUrl).toBe("https://annot.work");
  });

  it("preserves the built-in embedMode when only cloudUrl is overridden", () => {
    const resolved = resolveEditorConfig({
      cloudUrl: "https://annot.example.com",
    });
    expect(resolved.embedMode).toBe("newTab");
    expect(resolved.cloudUrl).toBe("https://annot.example.com");
  });
});

describe("editorConfigVirtualPlugin", () => {
  it("resolves and loads the virtual id", () => {
    const plugin = editorConfigVirtualPlugin({
      embedMode: "inline",
      cloudUrl: "https://annot.example.com",
    });
    const resolved = plugin.resolveId("virtual:annot-docs/editor-config");
    expect(resolved).toBe("\0virtual:annot-docs/editor-config");
    const loaded = resolved ? plugin.load(resolved) : null;
    expect(loaded).toBeTruthy();
    expect(loaded as string).toMatch(/"embedMode":"inline"/);
  });

  it("redirects every import of `editor-config-virtual.{ts,js}` to the virtual id", () => {
    const plugin = editorConfigVirtualPlugin({
      embedMode: "newTab",
      cloudUrl: "https://annot.work",
    });
    expect(plugin.resolveId("/abs/path/to/editor-config-virtual.ts")).toBe(
      "\0virtual:annot-docs/editor-config",
    );
    expect(plugin.resolveId("/abs/path/to/dist/editor-config-virtual.js")).toBe(
      "\0virtual:annot-docs/editor-config",
    );
  });

  it("returns null for unrelated ids", () => {
    const plugin = editorConfigVirtualPlugin({
      embedMode: "newTab",
      cloudUrl: "https://annot.work",
    });
    expect(plugin.resolveId("./some-other-file.ts")).toBeNull();
    expect(plugin.resolveId("react")).toBeNull();
  });

  it("returns null when loading an unrelated id", () => {
    const plugin = editorConfigVirtualPlugin({
      embedMode: "newTab",
      cloudUrl: "https://annot.work",
    });
    expect(plugin.load("/some/other/file.ts")).toBeNull();
  });
});
