import { describe, expect, it } from "vitest";

import { productDocsIntegration } from "./integration.js";

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
    const logs: string[] = [];
    const hook = integration.hooks["astro:config:setup"];
    if (typeof hook !== "function") throw new Error("hook missing");
    // Mimic the Astro logger.info shape (only `info` is called).
    hook({
      logger: { info: (msg: string) => logs.push(msg) } as never,
    } as never);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/installed/);
    expect(logs[0]).toMatch(/contentDir=docs/);
    expect(logs[0]).toMatch(/configPath=annot-docs.config.ts/);
  });

  it("is silent when verbose=false (default)", () => {
    const integration = productDocsIntegration();
    const logs: string[] = [];
    const hook = integration.hooks["astro:config:setup"];
    if (typeof hook !== "function") throw new Error("hook missing");
    hook({
      logger: { info: (msg: string) => logs.push(msg) } as never,
    } as never);
    expect(logs).toEqual([]);
  });

  it("respects custom contentDir + configPath in logs", () => {
    const integration = productDocsIntegration({
      contentDir: "src/screens",
      configPath: "config/annot.ts",
      verbose: true,
    });
    const logs: string[] = [];
    const hook = integration.hooks["astro:config:setup"];
    if (typeof hook !== "function") throw new Error("hook missing");
    hook({
      logger: { info: (msg: string) => logs.push(msg) } as never,
    } as never);
    expect(logs[0]).toMatch(/contentDir=src\/screens/);
    expect(logs[0]).toMatch(/configPath=config\/annot\.ts/);
  });
});
