import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, test as base, chromium, expect, type Worker } from "@playwright/test";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");

export const FIXTURE_PAGE_URL = "http://localhost:3100/";
export const PWA_APP_URL = "http://localhost:3000/app/";

interface ExtensionFixtures {
  context: BrowserContext;
  sw: Worker;
  extensionId: string;
}

/** Each test gets its own persistent Chromium profile with the
 *  unpacked `dist/` extension loaded — fresh extension IDB, fresh
 *  PWA origin storage, no cross-test cleanup. `channel: "chromium"`
 *  selects the full Chromium build: MV3 extensions require the new
 *  headless mode, which the default headless shell doesn't ship. */
export const test = base.extend<ExtensionFixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    await use(context);
    await context.close();
  },
  sw: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    await use(sw);
  },
  extensionId: async ({ sw }, use) => {
    await use(await sw.evaluate(() => chrome.runtime.id));
  },
});

export { expect };

/** Trigger a capture the way the popup does: send the PopupMessage
 *  from an extension-privileged content context in the target tab.
 *  (The service worker can't message itself — `runtime.sendMessage`
 *  never delivers to the sender's own context — so this is the
 *  closest scriptable stand-in for clicking the popup button.) */
export async function triggerCapture(
  sw: Worker,
  type: "visible-area" | "select-region" | "whole-page-stitched",
  tabUrl = FIXTURE_PAGE_URL,
): Promise<void> {
  await sw.evaluate(
    async ({ msgType, url }) => {
      const [tab] = await chrome.tabs.query({ url: `${url}*` });
      if (!tab?.id) throw new Error(`no tab matching ${url}`);
      // Same cast as host.ts `requestElementTreeChrome`: chrome-types'
      // `executeScript` overloads don't model the `args` -> `func`
      // parameter relationship.
      await (
        chrome.scripting.executeScript as unknown as (i: Record<string, unknown>) => Promise<void>
      )({
        target: { tabId: tab.id },
        func: (t: string) => void chrome.runtime.sendMessage({ type: t }),
        args: [msgType],
      });
    },
    { msgType: type, url: tabUrl },
  );
}

/** Minimal shape of the stored capture record the tests assert on. */
export interface StoredImageRecord {
  path: string;
  originalDataUrl: string;
  annotationsSvg: string;
  width: number;
  height: number;
  sourceUrl?: string;
  tags?: Record<string, string>;
  elementTree?: { root?: unknown } | null;
}

/** Read every record from the extension-origin IDBStore
 *  (`chrome-extension://<id>` DB "annot", store "images"). Returns
 *  [] while the DB / store doesn't exist yet, so callers can poll. */
export async function readExtensionImages(sw: Worker): Promise<StoredImageRecord[]> {
  return sw.evaluate(async () => {
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("annot");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (!db.objectStoreNames.contains("images")) {
        db.close();
        return [];
      }
      const records = await new Promise<StoredImageRecord[]>((resolve, reject) => {
        const req = db.transaction("images", "readonly").objectStore("images").getAll();
        req.onsuccess = () => resolve(req.result as StoredImageRecord[]);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return records;
    } catch {
      return [];
    }
  });
}
