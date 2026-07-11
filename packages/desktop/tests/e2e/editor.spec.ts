import { readFile } from "node:fs/promises";
import {
  annotations,
  backToGallery,
  dragOnCanvas,
  enterInbox,
  expect,
  INBOX,
  libraryFile,
  openImageInEditor,
  SEEDED_FILE,
  test,
  toolButton,
  waitForSaved,
} from "./fixtures.js";

// Desktop editor UX: a library image opens in the shared
// EditorShell, drawing autosaves through SavePipeline →
// DesktopStore.updateImage, and the write upgrades the plain
// seeded PNG to a re-editable one — rendered pixels for outside
// viewers plus the XMP packet (<annot:annotations> + original
// image) that lets the editor round-trip the layer on reopen.

test("a library image opens in the editor with the shared chrome", async ({ window }) => {
  await enterInbox(window);
  await openImageInEditor(window, "seeded");

  await expect(window.locator("#svg-root image")).toHaveAttribute("href", /^data:image\/png/);
  await expect(annotations(window)).toHaveCount(0);
  // The shared toolbar mounts with the full tool set.
  for (const tool of ["arrow", "shape", "text", "redact"]) {
    await expect(toolButton(window, tool)).toBeVisible();
  }
});

test("a drawn annotation autosaves into the on-disk PNG's XMP and round-trips", async ({
  window,
  userData,
}) => {
  const file = libraryFile(userData, INBOX, SEEDED_FILE);
  const originalBytes = await readFile(file);

  await enterInbox(window);
  await openImageInEditor(window, "seeded");

  await toolButton(window, "shape").click();
  await expect(toolButton(window, "shape")).toHaveClass(/active/);
  await dragOnCanvas(window, { x: 0.2, y: 0.25 }, { x: 0.6, y: 0.65 });
  await expect(annotations(window)).toHaveCount(1);

  // The 500 ms debounced autosave flushes through SavePipeline —
  // the header indicator returning to "Saved" is the signal that
  // DesktopStore.updateImage wrote the file.
  await waitForSaved(window);

  // Still a PNG, but now carrying the annot XMP payload.
  const saved = await readFile(file);
  expect(saved.subarray(0, 8)).toEqual(originalBytes.subarray(0, 8));
  const savedText = saved.toString("latin1");
  expect(savedText).toContain("annot:annotations");
  expect(savedText).toContain("<rect");

  // Reopen from disk: readEditableImage must recover the original
  // (un-annotated) screenshot AND the annotation layer.
  await backToGallery(window);
  await enterInbox(window);
  await openImageInEditor(window, "seeded");
  await expect(annotations(window)).toHaveCount(1);
});

test("undo removes the drawn shape", async ({ window }) => {
  await enterInbox(window);
  await openImageInEditor(window, "seeded");

  await toolButton(window, "shape").click();
  await dragOnCanvas(window, { x: 0.2, y: 0.25 }, { x: 0.6, y: 0.65 });
  await expect(annotations(window)).toHaveCount(1);

  await window.locator("#svg-root").click({ position: { x: 10, y: 10 } });
  await window.keyboard.press("Control+z");
  await expect(annotations(window)).toHaveCount(0);
});
