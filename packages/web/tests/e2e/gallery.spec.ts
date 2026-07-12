import { expect, test } from "@playwright/test";
import {
  clickCardMenuItem,
  gotoGallery,
  imageCard,
  makeTestPng,
  uploadTestImage,
  uploadTestImages,
} from "./helpers.js";

// Gallery / file-manager UX: boot, import, rename, delete, search,
// folders. Each test runs in a fresh browser context, so IndexedDB
// starts empty — no cross-test cleanup needed.

test("boots into an empty gallery with the New menu available", async ({ page }) => {
  await gotoGallery(page);

  await expect(page.locator("annot-sidebar")).toBeVisible();
  await expect(page.locator("button.sidebar-new-btn")).toBeVisible();
  await expect(page.locator(".gallery-item")).toHaveCount(0);

  // Gallery header ships the global search field.
  await expect(page.locator("input.header-search")).toBeVisible();

  // The editor chrome must stay hidden while browsing the gallery.
  await expect(page.locator("body")).not.toHaveClass(/editor-mode/);
  await expect(page.locator("#canvas-container")).toBeHidden();
});

test("imports an image via Upload Files… and shows a card with its dimensions", async ({
  page,
}) => {
  await gotoGallery(page);
  await uploadTestImage(page, "sample.png");

  const card = imageCard(page, "sample");
  await expect(card).toBeVisible();
  // The card advertises itself to assistive tech as an openable image.
  await expect(card).toHaveAttribute("role", "button");
  await expect(card).toHaveAttribute("aria-label", /^Image /);
  // Thumbnail + metadata row render for the imported PNG (640×400).
  await expect(card.locator(".gallery-thumb")).toBeVisible();
  await expect(card.locator(".gallery-item-meta")).toContainText(/640\s*[×x]\s*400/);
});

test("renames an image from the card actions menu", async ({ page }) => {
  await gotoGallery(page);
  await uploadTestImage(page, "sample.png");

  await clickCardMenuItem(imageCard(page, "sample"), "Rename");

  const dialog = page.locator("annot-dialog");
  await expect(dialog.locator(".app-dialog-title")).toHaveText("Rename image");
  await dialog.locator(".app-dialog-input").fill("renamed.png");
  await dialog.locator(".app-dialog-ok").click();

  await expect(imageCard(page, "renamed")).toBeVisible();
  await expect(imageCard(page, "sample")).toHaveCount(0);
});

test("deletes an image after an explicit confirmation", async ({ page }) => {
  await gotoGallery(page);
  await uploadTestImage(page, "sample.png");

  await clickCardMenuItem(imageCard(page, "sample"), "Delete");

  // Deletion is destructive — the dialog must warn and require opt-in.
  const dialog = page.locator("annot-dialog");
  await expect(dialog.locator(".app-dialog-title")).toContainText("Delete");
  await expect(dialog).toContainText("This cannot be undone.");
  await dialog.locator(".app-dialog-ok").click();

  await expect(page.locator(".gallery-item")).toHaveCount(0);
});

test("cancelling the delete dialog keeps the image", async ({ page }) => {
  await gotoGallery(page);
  await uploadTestImage(page, "sample.png");

  await clickCardMenuItem(imageCard(page, "sample"), "Delete");
  await page.locator("annot-dialog .app-dialog-cancel").click();

  await expect(imageCard(page, "sample")).toBeVisible();
});

test("search filters gallery cards by name", async ({ page }) => {
  await gotoGallery(page);
  await uploadTestImage(page, "alpha.png");
  await uploadTestImage(page, "beta.png");
  await expect(page.locator(".gallery-item")).toHaveCount(2);

  await page.locator("input.header-search").fill("alpha");

  await expect(imageCard(page, "alpha")).toBeVisible();
  await expect(imageCard(page, "beta")).toHaveCount(0);

  await page.locator("input.header-search").fill("");
  await expect(page.locator(".gallery-item")).toHaveCount(2);
});

test("creates a folder from the New menu and navigates into it", async ({ page }) => {
  await gotoGallery(page);

  await page.locator("button.sidebar-new-btn").click();
  await page.locator("button.new-menu-item", { hasText: "New Folder" }).click();
  const dialog = page.locator("annot-dialog");
  await dialog.locator(".app-dialog-input").fill("shots");
  await dialog.locator(".app-dialog-ok").click();

  const folder = page.locator(".gallery-folder-card", { hasText: "shots" });
  await expect(folder).toBeVisible();

  // Navigating in-app does not push a `/folder/…` URL (folder state
  // is restored from localStorage instead); the breadcrumb is the
  // visible signal that we're inside the folder.
  await folder.dblclick();
  await expect(page.locator(".breadcrumb-item.active")).toHaveText("shots");
  // The folder we're inside no longer lists itself.
  await expect(page.locator(".gallery-folder-card", { hasText: "shots" })).toHaveCount(0);
});

test("a /folder/<path> deep link opens the gallery scoped to that folder", async ({ page }) => {
  await gotoGallery(page);
  await page.locator("button.sidebar-new-btn").click();
  await page.locator("button.new-menu-item", { hasText: "New Folder" }).click();
  const dialog = page.locator("annot-dialog");
  await dialog.locator(".app-dialog-input").fill("shots");
  await dialog.locator(".app-dialog-ok").click();
  await expect(page.locator(".gallery-folder-card", { hasText: "shots" })).toBeVisible();

  await page.goto("./folder/shots");

  await expect(page.locator("annot-gallery-page")).toBeVisible();
  await expect(page.locator(".breadcrumb-item.active")).toHaveText("shots");
});

test("a single-image upload opens the editor; a multi-file batch stays in the gallery", async ({
  page,
}) => {
  await gotoGallery(page);

  // Single image → straight into the editor (unified post-import
  // UX, 2026-07-12 product decision).
  const single = page.waitForEvent("filechooser");
  await page.locator("button.sidebar-new-btn").click();
  await page.locator("button.new-menu-item", { hasText: "Upload Files…" }).click();
  await (await single).setFiles({
    name: "solo.png",
    mimeType: "image/png",
    buffer: makeTestPng(),
  });
  await expect(page.locator("body")).toHaveClass(/editor-mode/);
  await expect(page.locator("#svg-root image")).toBeVisible();
  await page.locator(".editor-header-brand").click();
  await expect(page.locator("body")).not.toHaveClass(/editor-mode/);

  // Multi-file batch → import silently, stay on the gallery.
  await uploadTestImages(page, ["batch-a.png", "batch-b.png"]);
  await expect(page.locator("body")).not.toHaveClass(/editor-mode/);
  await expect(page.locator(".gallery-item")).toHaveCount(3);
});
