/**
 * Doc-mode keyboard shortcut catalog — surfaced in the keyboard-help
 * modal alongside the editor's default groups.
 *
 * Lives in its own tiny module so the host's barrel
 * (`host-ui/src/index.ts`) can re-export `DOC_SHORTCUT_GROUPS`
 * without statically pulling in the full `<annot-doc-shell>` (a
 * heavy custom-element file with a deep import graph) for hosts
 * that only need the catalog. The PWA's `web/src/app.ts` reads the
 * constant via the barrel AND dynamically imports the shell behind
 * a code-split point — keeping the shell out of the eager bundle.
 *
 * Phase 8 of `docs/plans/_done/annot-html-document-ux-polish.md`.
 */

import type { ShortcutGroup } from "./keyboard-help.js";

export const DOC_SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Document — Editing",
    entries: [
      { keys: ["Ctrl", "B"], description: "Bold (in selection)" },
      { keys: ["Ctrl", "I"], description: "Italic (in selection)" },
      { keys: ["Ctrl", "U"], description: "Underline (in selection)" },
      { keys: ["Ctrl", "Z"], description: "Undo" },
      { keys: ["Ctrl", "Y"], description: "Redo" },
      { keys: ["Ctrl", "Shift", "Z"], description: "Redo" },
    ],
  },
  {
    title: "Document — Blocks",
    entries: [
      { keys: ["/"], description: "Open block menu (in empty paragraph)" },
      { keys: ["Ctrl", "Enter"], description: "Insert paragraph below" },
      { keys: ["Ctrl", "Shift", "Enter"], description: "Insert paragraph above" },
      { keys: ["Enter"], description: "Split list / quote / callout entry" },
      { keys: ["Esc"], description: "Close menus / format toolbar" },
    ],
  },
  {
    title: "Document — Block kind",
    entries: [
      { keys: ["Ctrl", "Shift", "1"], description: "Convert to Heading 1" },
      { keys: ["Ctrl", "Shift", "2"], description: "Convert to Heading 2" },
      { keys: ["Ctrl", "Shift", "3"], description: "Convert to Heading 3" },
      { keys: ["Ctrl", "Shift", "8"], description: "Convert to bulleted list" },
      { keys: ["Ctrl", "Shift", "7"], description: "Convert to numbered list" },
      { keys: ["Ctrl", "Shift", ">"], description: "Convert to quote" },
    ],
  },
];
