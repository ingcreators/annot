/**
 * keyboard-help — modal overlay listing all editor keyboard shortcuts.
 *
 * Triggered by `?` from anywhere in the editor (ignoring inputs /
 * text-editing contexts). Shortcuts are grouped by category so users
 * can skim to find what they need:
 *   - Selection & Clipboard (Delete / Ctrl+A / C / V / D)
 *   - Transform (Shift+H / V)
 *   - Arrange / Z-order (Ctrl+] / [ variants)
 *   - Group (Ctrl+G / Shift+G)
 *   - Drawing (Esc to end session)
 *   - Navigation / view
 *
 * Dismissed by `Esc`, the × button, or clicking the backdrop — the
 * standard overlay conventions so users never feel trapped.
 *
 * Phase 2a of `docs/plans/_done/vscode-extension-host.md` moved this
 * out of `packages/web/src/editor/` and onto the host-neutral
 * `@ingcreators/annot-core`-rooted icon API (`renderIconElement` +
 * `builtinIcon`) so the shell no longer depends on
 * `packages/web/src/ui/annot-icon-imperative.ts`. The matching CSS
 * lives in `packages/web/src/styles/app.css` (`keyboard-help-*`
 * class names); hosts other than the PWA copy / re-import the
 * subset they want when they integrate the shell.
 */

import { builtinIcon, renderIconElement } from "@ingcreators/annot-core";

export interface ShortcutEntry {
  keys: string[]; // e.g. ["Ctrl", "Shift", "]"]
  description: string;
}

export interface ShortcutGroup {
  title: string;
  entries: ShortcutEntry[];
}

export const DEFAULT_SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Selection",
    entries: [
      { keys: ["Ctrl", "A"], description: "Select all" },
      { keys: ["Delete"], description: "Delete selected" },
      { keys: ["Esc"], description: "Deselect / cancel" },
    ],
  },
  {
    title: "Clipboard",
    entries: [
      { keys: ["Ctrl", "C"], description: "Copy" },
      { keys: ["Ctrl", "V"], description: "Paste" },
      { keys: ["Ctrl", "D"], description: "Duplicate in place" },
    ],
  },
  {
    title: "Move",
    entries: [
      { keys: ["↑", "↓", "←", "→"], description: "Nudge 1 px" },
      { keys: ["Shift", "↑↓←→"], description: "Nudge 10 px" },
    ],
  },
  {
    title: "Transform",
    entries: [
      { keys: ["Shift", "H"], description: "Flip horizontal" },
      { keys: ["Shift", "V"], description: "Flip vertical" },
    ],
  },
  {
    title: "Arrange",
    entries: [
      { keys: ["Ctrl", "Shift", "]"], description: "Bring to front" },
      { keys: ["Ctrl", "]"], description: "Bring forward" },
      { keys: ["Ctrl", "["], description: "Send backward" },
      { keys: ["Ctrl", "Shift", "["], description: "Send to back" },
    ],
  },
  {
    title: "Group",
    entries: [
      { keys: ["Ctrl", "G"], description: "Group selected" },
      { keys: ["Ctrl", "Shift", "G"], description: "Ungroup" },
    ],
  },
  {
    title: "Drawing",
    entries: [{ keys: ["Esc"], description: "End draw session / commit" }],
  },
  {
    title: "Help",
    entries: [{ keys: ["?"], description: "Show this panel" }],
  },
];

export interface InstallKeyboardHelpOptions {
  /** Phase 8 of `docs/plans/annot-html-document-ux-polish.md` —
   *  additional groups appended to the default list when the
   *  modal opens. The shell injects a "Document editing" group
   *  here when the doc shell is the active mode. Evaluated on
   *  every open so the list stays in sync with mode switches. */
  extraGroups?: () => readonly ShortcutGroup[];
}

/** Singleton modal currently open, if any. Tracked at module
 *  scope so the imperative `openKeyboardHelpModal` entry point +
 *  the `?`-keystroke install can share the no-stack guard. */
let activeKeyboardHelpModal: HTMLElement | null = null;

function closeActiveKeyboardHelp(): void {
  activeKeyboardHelpModal?.remove();
  activeKeyboardHelpModal = null;
}

/** Phase 8 of `annot-html-document-ux-polish.md` — programmatic
 *  modal open. Used by callers that don't want to rely on the
 *  global `?` keystroke (e.g. a Help button in the doc-mode
 *  header strip, or a per-shell `Ctrl+/` handler). */
export function openKeyboardHelpModal(extraGroups: readonly ShortcutGroup[] = []): () => void {
  if (activeKeyboardHelpModal) return closeActiveKeyboardHelp;
  const groups = [...DEFAULT_SHORTCUT_GROUPS, ...extraGroups];
  activeKeyboardHelpModal = buildModal(closeActiveKeyboardHelp, groups);
  document.body.appendChild(activeKeyboardHelpModal);
  return closeActiveKeyboardHelp;
}

/**
 * Mount a global `?` key listener that opens a modal listing
 * shortcuts. The caller owns the returned teardown function so the
 * listener can be removed if the editor is torn down.
 */
export function installKeyboardHelp(opts: InstallKeyboardHelpOptions = {}): () => void {
  const open = () => {
    if (activeKeyboardHelpModal) return;
    const groups = [...DEFAULT_SHORTCUT_GROUPS, ...(opts.extraGroups ? opts.extraGroups() : [])];
    activeKeyboardHelpModal = buildModal(closeActiveKeyboardHelp, groups);
    document.body.appendChild(activeKeyboardHelpModal);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Skip when typing in any text surface — `?` is a legit character
    // users should be able to type into a textarea / input / contentEditable.
    const t = e.target as HTMLElement | null;
    if (t) {
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (t.closest?.("foreignObject")) return;
    }
    if (e.key === "?") {
      // On US/JP layouts "?" is produced by Shift+/; we don't care
      // which physical key produced it — `e.key === "?"` is the
      // reliable check.
      e.preventDefault();
      open();
    } else if (e.key === "Escape" && activeKeyboardHelpModal) {
      // Intercept Esc so it closes the help modal specifically when
      // the help modal is open. Without the `modal` guard we'd shadow
      // other tools' Esc handlers (e.g. draw session commit).
      e.preventDefault();
      e.stopPropagation();
      closeActiveKeyboardHelp();
    }
  };

  document.addEventListener("keydown", onKeyDown);
  return () => {
    document.removeEventListener("keydown", onKeyDown);
    closeActiveKeyboardHelp();
  };
}

function buildModal(onClose: () => void, groups: readonly ShortcutGroup[]): HTMLElement {
  const backdrop = document.createElement("div");
  backdrop.className = "keyboard-help-backdrop";
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) onClose();
  });

  const panel = document.createElement("div");
  panel.className = "keyboard-help-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Keyboard shortcuts");

  // Header with title + close button.
  const header = document.createElement("div");
  header.className = "keyboard-help-header";
  const title = document.createElement("h2");
  title.className = "keyboard-help-title";
  title.textContent = "Keyboard shortcuts";
  header.appendChild(title);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "keyboard-help-close";
  const closeIcon = renderIconElement(builtinIcon("close"));
  if (closeIcon) closeBtn.appendChild(closeIcon);
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.addEventListener("click", onClose);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Two-column grid of groups so the modal reads compactly even with
  // many entries. Each group is a self-contained card with a muted
  // uppercase title matching the property panel's section style.
  const body = document.createElement("div");
  body.className = "keyboard-help-body";
  for (const group of groups) {
    const section = document.createElement("div");
    section.className = "keyboard-help-group";
    const h = document.createElement("div");
    h.className = "keyboard-help-group-title";
    h.textContent = group.title;
    section.appendChild(h);
    for (const entry of group.entries) {
      const row = document.createElement("div");
      row.className = "keyboard-help-row";
      const keys = document.createElement("div");
      keys.className = "keyboard-help-keys";
      for (let i = 0; i < entry.keys.length; i++) {
        if (i > 0) {
          const plus = document.createElement("span");
          plus.className = "keyboard-help-plus";
          plus.textContent = "+";
          keys.appendChild(plus);
        }
        const kbd = document.createElement("kbd");
        kbd.className = "keyboard-help-kbd";
        kbd.textContent = entry.keys[i]!;
        keys.appendChild(kbd);
      }
      row.appendChild(keys);
      const desc = document.createElement("div");
      desc.className = "keyboard-help-desc";
      desc.textContent = entry.description;
      row.appendChild(desc);
      section.appendChild(row);
    }
    body.appendChild(section);
  }
  panel.appendChild(body);

  backdrop.appendChild(panel);
  return backdrop;
}
