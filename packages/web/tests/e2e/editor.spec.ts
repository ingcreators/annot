import { expect, test } from "@playwright/test";
import {
  annotations,
  dragOnCanvas,
  selectTool,
  setupEditorWithImage,
  toolButton,
} from "./helpers.js";

// Editor UX: opening an image, tool selection, drawing, undo/redo,
// keyboard behaviour, and leaving the editor.

test("double-clicking a gallery card opens the editor on the edit route", async ({ page }) => {
  await setupEditorWithImage(page);

  await expect(page).toHaveURL(/\/edit\/img\/browser\//);
  // Select is the default tool after open.
  await expect(toolButton(page, "")).toHaveClass(/active/);
  // The base screenshot renders inside the canvas SVG.
  await expect(page.locator("#svg-root image")).toBeVisible();
  // Editor chrome replaces the gallery.
  await expect(page.locator("#file-manager")).toBeHidden();
  await expect(page.locator("annot-editor-header")).toBeVisible();
  await expect(page.locator("annot-save-status .save-status-label")).toHaveText("Saved");
});

test("the toolbar offers the full drawing tool set", async ({ page }) => {
  await setupEditorWithImage(page);

  for (const tool of ["arrow", "shape", "highlight", "text", "freehand", "marker", "redact"]) {
    await expect(toolButton(page, tool)).toBeVisible();
  }
});

test("draws a rectangle with the shape tool", async ({ page }) => {
  await setupEditorWithImage(page);

  await selectTool(page, "shape");
  await dragOnCanvas(page, { x: 100, y: 100 }, { x: 300, y: 220 });

  await expect(annotations(page)).toHaveCount(1);
});

test("draws an arrow with the arrow tool", async ({ page }) => {
  await setupEditorWithImage(page);

  await selectTool(page, "arrow");
  await dragOnCanvas(page, { x: 120, y: 120 }, { x: 320, y: 260 });

  await expect(annotations(page)).toHaveCount(1);
});

test("places text with the text tool", async ({ page }) => {
  await setupEditorWithImage(page);

  await selectTool(page, "text");
  await dragOnCanvas(page, { x: 100, y: 100 }, { x: 340, y: 180 });
  await page.keyboard.type("Hello E2E");
  await page.keyboard.press("Escape");

  await expect(annotations(page)).toHaveCount(1);
  await expect(page.locator("#svg-root #annotations")).toContainText("Hello E2E");
});

test("undo removes the drawn shape and redo restores it", async ({ page }) => {
  await setupEditorWithImage(page);

  await selectTool(page, "shape");
  await dragOnCanvas(page, { x: 100, y: 100 }, { x: 300, y: 220 });
  await expect(annotations(page)).toHaveCount(1);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(annotations(page)).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+y");
  await expect(annotations(page)).toHaveCount(1);
});

test("Escape returns from a drawing tool to Select", async ({ page }) => {
  await setupEditorWithImage(page);

  await selectTool(page, "shape");
  await page.keyboard.press("Escape");

  await expect(toolButton(page, "")).toHaveClass(/active/);
  await expect(toolButton(page, "shape")).not.toHaveClass(/active/);
});

test("Back to Gallery returns to the gallery view", async ({ page }) => {
  await setupEditorWithImage(page);

  await page.locator('button[aria-label="Back to Gallery"]').click();

  await expect(page.locator("body")).not.toHaveClass(/editor-mode/);
  await expect(page.locator("#file-manager")).toBeVisible();
  await expect(page.locator(".gallery-item")).toHaveCount(1);
});
