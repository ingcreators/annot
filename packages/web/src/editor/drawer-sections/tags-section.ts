/**
 * Built-in `drawer.tags` section — embeds the `TagEditor` so users
 * can add / remove / edit tags on the open image. Migrated from the
 * previous monolithic `FileDetailsDrawer.#render`'s "Tags" block as
 * part of Phase 2 of `docs/plans/plugin-ui-slots.md`.
 *
 * Reactive lifecycle: `update(ctx)` re-pushes the latest tags into
 * the existing `TagEditor` instance via `setTags`, preserving the
 * editor's mid-edit state where possible (the editor itself
 * decides how to reconcile the new external tag list with any
 * in-progress add).
 */

import type { UISection } from "../../app/plugin-host.js";
import type { FileDetailsData } from "../file-details-drawer-types.js";
import { TagEditor } from "../tag-editor.js";

export interface TagsSectionDeps {
  getData(): FileDetailsData;
  /** Forwarded to the TagEditor's `onTagsChange` so the host can
   *  persist the edit + propagate updates elsewhere (e.g. the
   *  save pipeline). */
  onTagsChange?(tags: Record<string, string>): void;
}

export function createTagsSection(deps: TagsSectionDeps): UISection {
  return {
    id: "drawer.tags",
    title: "Tags",
    priority: 20,
    mount(container) {
      const tagsContent = document.createElement("div");
      tagsContent.className = "file-details-tags-editor";
      container.appendChild(tagsContent);

      const tagEditor = new TagEditor(tagsContent);
      tagEditor.setTags(deps.getData().tags);
      tagEditor.onTagsChange = (t) => {
        deps.onTagsChange?.(t);
      };

      return {
        update() {
          // Push the latest tags into the existing TagEditor — the
          // editor preserves its UI state where possible, so this is
          // a cheaper path than rebuilding the editor from scratch
          // on every drawer-data change.
          tagEditor.setTags(deps.getData().tags);
        },
        unmount() {
          // No explicit teardown needed — the host removes the
          // section's DOM, and TagEditor doesn't register any
          // window-level listeners. The closure refs drop with
          // GC.
        },
      };
    },
  };
}
