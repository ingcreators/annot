import {
  expect,
  FIXTURE_PAGE_URL,
  PWA_APP_URL,
  readExtensionImages,
  test,
  triggerCapture,
} from "./fixtures.js";

// Extension → PWA handoff: the auto-opened editor tab, the
// externally_connectable messaging channel, and the bulk transfer
// that re-homes records (with every field intact) into the PWA's
// BrowserStore.

test("a capture opens the PWA editor with the screenshot loaded", async ({ context, sw }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE_PAGE_URL);
  await page.bringToFront();

  const editorPagePromise = context.waitForEvent("page", { timeout: 30_000 });
  await triggerCapture(sw, "visible-area");

  // The service worker opens `${ANNOTATION_URL}/edit/img/extension/…?extId=…`
  // (localhost:3000 in the build:dev the e2e script produces).
  const editorPage = await editorPagePromise;
  await editorPage.waitForURL(/\/app\/edit\/img\//, { timeout: 30_000 });

  await expect(editorPage.locator("body")).toHaveClass(/editor-mode/, { timeout: 20_000 });
  await expect(editorPage.locator("#svg-root image")).toBeVisible();
});

test("transfer re-homes the record into the PWA with the element tree intact", async ({
  context,
  sw,
}) => {
  const page = await context.newPage();
  await page.goto(FIXTURE_PAGE_URL);
  await page.bringToFront();

  const editorPagePromise = context.waitForEvent("page", { timeout: 30_000 });
  await triggerCapture(sw, "visible-area");
  const editorPage = await editorPagePromise;
  await editorPage.waitForURL(/\/app\/edit\/img\//, { timeout: 30_000 });
  await expect(editorPage.locator("body")).toHaveClass(/editor-mode/, { timeout: 20_000 });

  // The bulk transfer copies the record into the PWA's BrowserStore
  // and deletes it from the extension IDB.
  await expect
    .poll(async () => (await readExtensionImages(sw)).length, { timeout: 20_000 })
    .toBe(0);

  // Every field must survive the hop — `elementTree` is the one the
  // April 2026 regression silently dropped (see CLAUDE.md pitfalls).
  const transferred = await editorPage.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("annot");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const records = await new Promise<
      Array<{ originalDataUrl?: string; sourceUrl?: string; elementTree?: unknown }>
    >((resolve, reject) => {
      const req = db.transaction("images", "readonly").objectStore("images").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return records;
  });

  expect(transferred).toHaveLength(1);
  expect(transferred[0]?.originalDataUrl).toMatch(/^data:image\//);
  expect(transferred[0]?.sourceUrl).toBe(FIXTURE_PAGE_URL);
  expect(transferred[0]?.elementTree).toBeTruthy();
});

test("the PWA origin can ping the extension over externally_connectable", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(PWA_APP_URL);

  const reply = await page.evaluate(
    (extId) =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage(extId, { action: "ping" }, undefined, (res) =>
          resolve(res ?? { ok: false }),
        );
      }),
    extensionId,
  );

  expect(reply).toMatchObject({ ok: true });
});
