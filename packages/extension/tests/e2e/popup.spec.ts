import { expect, test } from "./fixtures.js";

// Popup UX: the toolbar popup renders its capture actions. Opened as
// a regular extension page — the <annot-extension-popup> element is
// light-DOM Lit, so locators hit its markup directly.

test("the popup offers the capture actions and gallery entry", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

  await expect(page.locator("annot-extension-popup")).toBeVisible();
  for (const label of ["Visible Area", "Select Region", "Whole Page", "Gallery"]) {
    await expect(page.locator(".popup-btn", { hasText: label })).toBeVisible();
  }
});
