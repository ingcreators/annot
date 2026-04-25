/**
 * Helpers for the page-elements section — pure functions of a
 * `PageElement` plus the SVG namespace constant. Extracted from the
 * previous monolithic right-panel as part of Phase 3 of
 * `docs/plans/_done/plugin-ui-slots.md`.
 */

import type { PageElement } from "@ingcreators/annot-core";

export const SVG_NS = "http://www.w3.org/2000/svg";

/** Material Symbols glyph name appropriate to the element's role. */
export function iconForElement(el: PageElement): string {
  const tag = el.tag;
  if (tag === "button" || el.role === "button") return "smart_button";
  if (tag === "a" || el.role === "link") return "link";
  if (tag === "input") {
    const t = el.inputType || "text";
    if (t === "checkbox") return "check_box";
    if (t === "radio") return "radio_button_checked";
    if (t === "submit" || t === "button") return "smart_button";
    if (t === "email") return "alternate_email";
    if (t === "search") return "search";
    if (t === "password") return "key";
    return "edit";
  }
  if (tag === "textarea") return "edit_note";
  if (tag === "select" || el.role === "combobox") return "list";
  if (tag === "label") return "label";
  if (/^h[1-6]$/.test(tag)) return "title";
  if (el.role === "tab") return "tab";
  if (el.role === "menuitem") return "more_vert";
  if (el.role === "checkbox") return "check_box";
  if (el.role === "radio") return "radio_button_checked";
  if (el.role === "slider") return "tune";
  return "widgets";
}

/** Primary text shown on a row — first available of: ariaLabel,
 *  text, placeholder, role, tag. Trimmed for compactness. */
export function primaryLabelFor(el: PageElement): string {
  const candidate = el.ariaLabel || el.text || el.placeholder || el.role || el.tag;
  if (!candidate) return el.tag;
  // Sidebar rows are ~220 px after icon + sub. Keep label snug.
  return candidate.length > 36 ? `${candidate.slice(0, 33)}…` : candidate;
}

/** Sub-label (small grey text on the right) — type / role hint. */
export function subLabelFor(el: PageElement): string {
  if (el.tag === "input" && el.inputType) return el.inputType;
  if (el.tag === "a") return "link";
  if (/^h[1-6]$/.test(el.tag)) return el.tag;
  if (el.role && el.role !== el.tag) return el.role;
  return el.tag;
}

/** Tooltip — the full label without truncation, plus role and href. */
export function fullDescriptionFor(el: PageElement): string {
  const parts: string[] = [];
  const label = el.ariaLabel || el.text || el.placeholder;
  if (label) parts.push(label);
  parts.push(`<${el.tag}${el.role ? ` role="${el.role}"` : ""}>`);
  if (el.href) parts.push(`→ ${el.href}`);
  return parts.join("\n");
}
