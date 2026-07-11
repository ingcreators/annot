import { expect, test } from "@playwright/test";
import {
  annotations,
  dragOnCanvas,
  imageCard,
  openImageInEditor,
  selectTool,
  setupEditorWithImage,
  waitForSaved,
} from "./helpers.js";

// Persistence contract: the debounced autosave writes to the
// BrowserStore (IndexedDB `annot` DB) and everything survives a
// full page reload — no explicit save action required.

test("a drawn annotation autosaves and survives a page reload", async ({ page }) => {
  await setupEditorWithImage(page);

  await selectTool(page, "shape");
  await dragOnCanvas(page, { x: 100, y: 100 }, { x: 300, y: 220 });
  await expect(annotations(page)).toHaveCount(1);
  await waitForSaved(page);

  await page.reload();

  // The deep-linked edit route restores the same editor session.
  await expect(page.locator("body")).toHaveClass(/editor-mode/);
  await expect(page.locator("#svg-root image")).toBeVisible();
  await expect(annotations(page)).toHaveCount(1);
});

test("annotations persist when the image is reopened from the gallery", async ({ page }) => {
  await setupEditorWithImage(page);
  await selectTool(page, "arrow");
  await dragOnCanvas(page, { x: 120, y: 120 }, { x: 320, y: 260 });
  await waitForSaved(page);

  await page.locator('button[aria-label="Back to Gallery"]').click();
  await expect(imageCard(page, "sample")).toBeVisible();

  await page.reload();
  await expect(imageCard(page, "sample")).toBeVisible();

  await openImageInEditor(page, "sample");
  await expect(annotations(page)).toHaveCount(1);
});

test("the persisted SVG carries the annot format version attribute", async ({ page }) => {
  await setupEditorWithImage(page);
  await selectTool(page, "shape");
  await dragOnCanvas(page, { x: 100, y: 100 }, { x: 300, y: 220 });
  await waitForSaved(page);

  // Read the record straight out of the BrowserStore IndexedDB to
  // assert the on-disk format contract. `annotationsSvg` is the
  // annotations-only representation (`exportAnnotationsSvgForIdb`):
  // versioned root, no base <image>, and the `#annotations` wrapper
  // deliberately flattened away — see packages/editor/src/export.ts.
  const svg = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("annot");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const records = await new Promise<Array<{ annotationsSvg?: string }>>((resolve, reject) => {
      const req = db.transaction("images", "readonly").objectStore("images").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return records[0]?.annotationsSvg ?? null;
  });

  expect(svg).not.toBeNull();
  expect(svg).toContain('data-annot-version="1"');
  // The drawn shape is present; the MB-class base image is not
  // duplicated into the annotations layer.
  expect(svg).toContain("<rect");
  expect(svg).not.toContain("<image");
});
