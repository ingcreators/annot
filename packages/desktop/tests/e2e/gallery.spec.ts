import { readFile } from "node:fs/promises";
import {
  enterInbox,
  expect,
  folderCard,
  INBOX,
  imageCard,
  libraryFile,
  makeTestPng,
  test,
} from "./fixtures.js";

// Desktop gallery UX: the app boots into the unified
// <annot-file-manager-shell> mounted against DesktopStore, lists
// the on-disk library seeded before launch, and the sidebar's
// New → Upload Files… flow persists an imported PNG into
// `<userData>/library/` and opens it in the editor.

test("boots into the unified gallery listing the seeded library", async ({ window }) => {
  // Root shows the folder tree with the default Inbox.
  await expect(folderCard(window, INBOX)).toBeVisible();
  // The editor chrome must stay hidden while browsing the gallery.
  await expect(window.locator("body")).not.toHaveClass(/editor-mode/);

  // The seeded plain PNG (no XMP yet) is listed inside Inbox —
  // DesktopStore's raw-raster fallback. The listing probes the
  // real pixel dimensions at index time (metadata-unification
  // Phase 3), so the card meta shows dims like any annot-authored
  // capture.
  await enterInbox(window);
  const card = imageCard(window, "seeded");
  await expect(card).toBeVisible();
  await expect(window.locator(".gallery-item")).toHaveCount(1);
  await expect(card.locator(".gallery-item-meta")).toContainText(/640\s*[×x]\s*400/);
});

test("Upload Files… imports a PNG to disk and opens it in the editor", async ({
  window,
  userData,
}) => {
  // The upload flow drives a transient <input type=file> that never
  // attaches to the DOM — the file arrives via the filechooser
  // event, same as the PWA suite.
  const chooser = window.waitForEvent("filechooser");
  await window.locator("button.sidebar-new-btn").click();
  await window.locator("button.new-menu-item", { hasText: "Upload Files…" }).click();
  await (await chooser).setFiles({
    name: "uploaded.png",
    mimeType: "image/png",
    buffer: makeTestPng(320, 200),
  });

  // Unlike the PWA, the desktop host opens fresh imports in the
  // editor directly (persistViaDesktopStore's openInEditor default).
  await expect(window.locator("body")).toHaveClass(/editor-mode/, { timeout: 30_000 });
  await expect(window.locator("#svg-root image")).toHaveAttribute("href", /^data:image\/png/);

  // Browsing at the gallery root, the import lands in Inbox/ under
  // the suggested filename, written as a real PNG on disk.
  const saved = await readFile(libraryFile(userData, INBOX, "uploaded.png"));
  expect([...saved.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});
