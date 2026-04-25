/**
 * Built-in `drawer.file` section — shows filename (inline-editable),
 * folder, dimensions, file size, timestamps, source URL.
 *
 * Migrated from the previous monolithic `FileDetailsDrawer.#render`'s
 * "File" block as part of Phase 2 of `docs/plans/plugin-ui-slots.md`.
 * Reactive lifecycle: `update(ctx)` re-reads via `deps.getData()` so
 * a rename or `setData` call refreshes the DOM in place.
 */

import { setTooltip } from "@ingcreators/annot-core/utils";
import type { UISection } from "../../app/plugin-host.js";
import type { FileDetailsData } from "../file-details-drawer-types.js";
import { validateFilename } from "../file-details-drawer-types.js";
import { formatBytes, formatDate, makeRow } from "./helpers.js";

export interface FileSectionDeps {
  getData(): FileDetailsData;
  /** Commit a filename change. The host is expected to call
   *  `storage.renameImage`, then call `setData` on the drawer with
   *  the final (possibly uniquified) name so this section's input
   *  reflects the truth. Reject the promise to surface an inline
   *  error message under the filename input. */
  onRename?(newFilename: string): Promise<void>;
}

export function createFileSection(deps: FileSectionDeps): UISection {
  let bodyRef: HTMLElement | null = null;

  const render = (container: HTMLElement) => {
    container.innerHTML = "";
    const data = deps.getData();
    container.appendChild(makeNameRow(data, deps.onRename));
    container.appendChild(
      makeRow("Location", data.folderPath || "(root)", { selectable: true, mono: true }),
    );
    container.appendChild(makeRow("Dimensions", `${data.width} × ${data.height} px`));
    container.appendChild(makeRow("File size", formatBytes(data.fileSizeBytes)));
    if (data.createdAt) {
      container.appendChild(makeRow("Created", formatDate(data.createdAt)));
    }
    if (data.updatedAt) {
      container.appendChild(makeRow("Modified", formatDate(data.updatedAt)));
    }
    if (data.sourceUrl) {
      container.appendChild(
        makeRow("Source", data.sourceUrl, { selectable: true, mono: true, link: true }),
      );
    }
  };

  return {
    id: "drawer.file",
    title: "File",
    priority: 10,
    mount(container) {
      bodyRef = container;
      render(container);
      return {
        update() {
          if (bodyRef) render(bodyRef);
        },
        unmount() {
          bodyRef = null;
        },
      };
    },
  };
}

/**
 * The Name row is special: it's inline-editable. The rest of the
 * row behaves like any other read-only metadata display until the
 * user focuses the value, at which point the span becomes a text
 * input.
 *
 * Commit rules:
 *   - Enter or blur → commit (calls onRename)
 *   - Escape       → cancel (restores original)
 *   - Empty / unchanged name → silently cancel
 *   - Invalid chars (/\:*?"<>|) → stay in editing mode, show inline error
 *
 * Extension is preserved across edits but NOT protected from the
 * user — advanced users can change extensions if they really want,
 * which matches Finder / Explorer behavior.
 */
function makeNameRow(
  data: FileDetailsData,
  onRename?: (next: string) => Promise<void>,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "file-details-row";

  const lbl = document.createElement("span");
  lbl.className = "file-details-row-label";
  lbl.textContent = "Name";
  row.appendChild(lbl);

  const wrap = document.createElement("div");
  wrap.className = "file-details-name-wrap";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "file-details-name-input";
  input.value = data.filename;
  input.spellcheck = false;
  input.autocomplete = "off";
  setTooltip(input, "Click to rename. Enter to save, Esc to cancel.");
  input.setAttribute("aria-label", "File name, editable");

  const errorEl = document.createElement("div");
  errorEl.className = "file-details-name-error";
  errorEl.setAttribute("aria-live", "polite");

  // Select only the base name (before the last dot) when the user
  // focuses — matches Finder / Explorer "rename" behavior so users
  // don't accidentally wipe the extension.
  input.addEventListener("focus", () => {
    const dot = input.value.lastIndexOf(".");
    if (dot > 0) {
      // defer so browser's default all-select is overridden
      setTimeout(() => input.setSelectionRange(0, dot), 0);
    }
  });

  const commit = async () => {
    const next = input.value.trim();
    if (!next || next === data.filename) {
      input.value = data.filename; // restore
      errorEl.textContent = "";
      return;
    }
    const err = validateFilename(next);
    if (err) {
      errorEl.textContent = err;
      input.focus();
      return;
    }
    try {
      input.disabled = true;
      errorEl.textContent = "";
      await onRename?.(next);
      // setData() from the host will refresh input.value with the
      // final (possibly uniquified) name on the next `update`.
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message || "Rename failed";
      errorEl.textContent = msg;
      input.value = data.filename; // restore
    } finally {
      input.disabled = false;
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur(); // triggers commit via blur listener
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.value = data.filename; // cancel
      errorEl.textContent = "";
      input.blur();
    }
  });
  input.addEventListener("blur", () => {
    commit();
  });

  wrap.appendChild(input);
  wrap.appendChild(errorEl);
  row.appendChild(wrap);

  return row;
}
