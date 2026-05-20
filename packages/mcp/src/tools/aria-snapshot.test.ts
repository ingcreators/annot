import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

import { type BrowserLauncher, type BrowserLike, BrowserPool } from "../browser/pool.js";
import { handleAriaSnapshot } from "./aria-snapshot.js";

const SAMPLE_YAML = [
  '- textbox "Email" [ref=e3]',
  '- textbox "Password" [ref=e5]',
  '- checkbox "Remember me" [ref=e7]',
  '- button "Sign in" [ref=e9]',
  "",
].join("\n");

/**
 * Stub Chromium pool whose `page.locator(selector).ariaSnapshot()`
 * returns a fixed YAML string. Same shape as the other tools'
 * test stubs (`stubPool` in `annotate-url.test.ts`).
 */
function stubPool(opts: { yaml: string; assertRootSelector?: string }) {
  const gotoSpy = vi.fn(async () => undefined);
  const ariaSnapshotSpy = vi.fn(async (_options?: { mode?: string; timeout?: number }) => {
    return opts.yaml;
  });
  const contextCloseSpy = vi.fn(async () => {});
  const locatorSpy = vi.fn((selector: string) => {
    if (opts.assertRootSelector !== undefined) {
      expect(selector).toBe(opts.assertRootSelector);
    }
    return {
      async ariaSnapshot(snapshotOptions?: { mode?: string; timeout?: number }) {
        return ariaSnapshotSpy(snapshotOptions);
      },
    };
  });

  const page = {
    goto: gotoSpy,
    locator: locatorSpy,
  };
  const context = {
    async newPage() {
      return page;
    },
    close: contextCloseSpy,
  };
  const browser: BrowserLike & { newContext: () => Promise<typeof context> } = {
    close: vi.fn(async () => {}),
    newContext: vi.fn(async () => context),
  };
  const launcher: BrowserLauncher = {
    async launch() {
      return browser;
    },
  };
  const pool = new BrowserPool(launcher);
  return { pool, gotoSpy, ariaSnapshotSpy, contextCloseSpy, locatorSpy };
}

describe("handleAriaSnapshot", () => {
  test("captures URL and returns aria-snapshot YAML inline", async () => {
    const { pool, gotoSpy, ariaSnapshotSpy, contextCloseSpy } = stubPool({ yaml: SAMPLE_YAML });

    const result = await handleAriaSnapshot({ url: "https://example.com/login" }, { pool });

    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: SAMPLE_YAML }]);
    expect(gotoSpy).toHaveBeenCalledWith("https://example.com/login", { waitUntil: "load" });
    expect(ariaSnapshotSpy).toHaveBeenCalledTimes(1);
    expect(ariaSnapshotSpy).toHaveBeenCalledWith({ mode: "ai" });
    expect(contextCloseSpy).toHaveBeenCalledTimes(1);
  });

  test("defaults to `body` as the root selector", async () => {
    const { pool } = stubPool({ yaml: SAMPLE_YAML, assertRootSelector: "body" });
    await handleAriaSnapshot({ url: "https://example.com/" }, { pool });
  });

  test("honours a custom `rootSelector`", async () => {
    const { pool } = stubPool({ yaml: SAMPLE_YAML, assertRootSelector: "main" });
    await handleAriaSnapshot({ url: "https://example.com/", rootSelector: "main" }, { pool });
  });

  test("forwards `timeout` to ariaSnapshot()", async () => {
    const { pool, ariaSnapshotSpy } = stubPool({ yaml: SAMPLE_YAML });
    await handleAriaSnapshot({ url: "https://example.com/", timeout: 5000 }, { pool });
    expect(ariaSnapshotSpy).toHaveBeenCalledWith({ mode: "ai", timeout: 5000 });
  });

  test("honours `waitFor`", async () => {
    const { pool, gotoSpy } = stubPool({ yaml: SAMPLE_YAML });
    await handleAriaSnapshot({ url: "https://example.com/", waitFor: "networkidle" }, { pool });
    expect(gotoSpy).toHaveBeenCalledWith("https://example.com/", { waitUntil: "networkidle" });
  });

  test("writes YAML to `output` path when set", async () => {
    const { pool } = stubPool({ yaml: SAMPLE_YAML });
    const dir = mkdtempSync(join(tmpdir(), "annot-mcp-aria-"));
    const outputPath = join(dir, "login.snapshot.yaml");

    const result = await handleAriaSnapshot(
      { url: "https://example.com/", output: outputPath },
      { pool },
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain(outputPath);
      expect(result.content[0].text).toContain("Wrote aria-snapshot");
    }
    const onDisk = readFileSync(outputPath, "utf8");
    expect(onDisk).toBe(SAMPLE_YAML);
  });

  test("rejects missing `url`", async () => {
    const { pool } = stubPool({ yaml: SAMPLE_YAML });
    const result = await handleAriaSnapshot({}, { pool });
    expect(result.isError).toBe(true);
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("url");
    }
  });

  test("rejects relative `output` path", async () => {
    const { pool } = stubPool({ yaml: SAMPLE_YAML });
    const result = await handleAriaSnapshot(
      { url: "https://example.com/", output: "relative/path.yaml" },
      { pool },
    );
    expect(result.isError).toBe(true);
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("absolute");
    }
  });

  test("surfaces Playwright errors as `isError: true`", async () => {
    // Use a fresh pool whose launcher throws — no stubPool needed here.
    const failingPool = new BrowserPool({
      async launch() {
        throw new Error("Chromium binary not found");
      },
    });
    const result = await handleAriaSnapshot({ url: "https://example.com/" }, { pool: failingPool });
    expect(result.isError).toBe(true);
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("Chromium binary not found");
    }
  });
});
