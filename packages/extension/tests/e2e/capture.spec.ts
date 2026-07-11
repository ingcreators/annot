import { expect, FIXTURE_PAGE_URL, readExtensionImages, test, triggerCapture } from "./fixtures.js";

// Capture pipeline: visible-area capture of a real http page,
// offscreen encode, and the stored ImageRecord contract in the
// extension-origin IDBStore.

test("visible-area capture stores a complete record (pixels + metadata + element tree)", async ({
  context,
  sw,
}) => {
  // Keep this test at the storage layer: block the PWA origin so the
  // auto-opened editor tab can't load and transfer-then-delete the
  // record out of the extension IDB while we assert on it.
  await context.route("**localhost:3000/**", (route) => route.abort());

  const page = await context.newPage();
  await page.goto(FIXTURE_PAGE_URL);
  await page.bringToFront();

  await triggerCapture(sw, "visible-area");

  await expect
    .poll(async () => (await readExtensionImages(sw)).length, { timeout: 20_000 })
    .toBe(1);
  const [record] = await readExtensionImages(sw);
  if (!record) throw new Error("record disappeared between polls");

  // Pixels: PNG data URL with the tab's viewport dimensions.
  expect(record.originalDataUrl).toMatch(/^data:image\//);
  const viewport = page.viewportSize();
  expect(record.width).toBe(viewport?.width);
  expect(record.height).toBe(viewport?.height);

  // Fresh capture carries no annotations yet.
  expect(record.annotationsSvg).toBe("");

  // Source metadata tags from the captured URL.
  expect(record.sourceUrl).toBe(FIXTURE_PAGE_URL);
  expect(record.tags?.host).toBe("localhost");

  // The MAIN-world DOM walk ran and its ElementTree landed on the
  // record (the field the April 2026 transfer bug silently dropped).
  expect(record.elementTree?.root).toBeTruthy();
  const treeJson = JSON.stringify(record.elementTree);
  expect(treeJson).toContain("Primary action");
});

test("two consecutive captures store two uniquely named records", async ({ context, sw }) => {
  await context.route("**localhost:3000/**", (route) => route.abort());

  const page = await context.newPage();
  await page.goto(FIXTURE_PAGE_URL);
  await page.bringToFront();

  await triggerCapture(sw, "visible-area");
  await expect
    .poll(async () => (await readExtensionImages(sw)).length, { timeout: 20_000 })
    .toBe(1);
  await triggerCapture(sw, "visible-area");
  await expect
    .poll(async () => (await readExtensionImages(sw)).length, { timeout: 20_000 })
    .toBe(2);

  const records = await readExtensionImages(sw);
  const paths = records.map((r) => r.path);
  expect(new Set(paths).size).toBe(2);
});
