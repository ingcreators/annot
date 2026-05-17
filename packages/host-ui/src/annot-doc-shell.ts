/**
 * `<annot-doc-shell>` — renderer for an `AnnotDocument` with an
 * optional editing mode.
 *
 * Phases of `docs/plans/_done/annot-html-document.md`:
 * - Phase 3 landed read-only rendering + TOC drawer.
 * - Phase 4a added an editing mode: contentEditable on heading +
 *   paragraph blocks, per-block toolbar (delete / move up / move
 *   down), `DocumentHistory`-backed undo/redo via Ctrl+Z /
 *   Ctrl+Shift+Z / Ctrl+Y. Bold / italic / underline come for
 *   free via the browser's default contentEditable shortcut
 *   handling (Ctrl+B / Ctrl+I / Ctrl+U → execCommand).
 * - Phase 4b (this file's update) adds the slash menu
 *   (`<annot-doc-block-menu>`), insert above / insert below in
 *   the block toolbar, and the `/`-typed-in-empty-block trigger
 *   that opens the menu anchored to that block.
 * - Future phase work will extend contentEditable to the
 *   remaining text-bearing block kinds (list items, callout /
 *   quote inner paragraphs, figcaption).
 *
 * Light DOM (Hybrid CSS) following the host-ui convention.
 */

import { newIdB58 } from "@ingcreators/annot-core";
import { readEditableImage } from "@ingcreators/annot-core/xmp";
import type {
  AnnotDocument,
  Block,
  HeadingBlock,
  ImageBlock,
  ListBlock,
  StepBlock,
} from "@ingcreators/annot-doc";
import { buildStyleBlock, createImageBlockFromDataUrl } from "@ingcreators/annot-doc";
import {
  AnnotDocBlockMenuElement,
  type BlockMenuItem,
  type BlockMenuSelectDetail,
} from "./annot-doc-block-menu.js";
import "./annot-doc-block-menu.js";
import "./annot-doc-block-toolbar.js";
import type { BlockDragStartDetail, BlockToolbarActionDetail } from "./annot-doc-block-toolbar.js";
import { annotationChildrenEqual, buildBlockSvg } from "./build-block-svg.js";
import { decomposeBlockSvg } from "./decompose-block-svg.js";
import "./annot-doc-empty-state.js";
import type { EmptyStateActionDetail } from "./annot-doc-empty-state.js";
import type { MetadataChangedDetail } from "./idb-metadata-cache.js";
import "./annot-doc-insert-bar.js";
import { DocumentHistory } from "./annot-doc-history.js";
import { AnnotDocImageEditorModalElement } from "./annot-doc-image-editor-modal.js";
import type { BlockDropAtDetail, InsertBlockDetail } from "./annot-doc-insert-bar.js";
import "./annot-doc-image-editor-modal.js";
import {
  AnnotDocSelectionToolbarElement,
  type BlockKindChangeDetail,
  type BlockKindOption,
  type FormatChangeDetail,
  type LinkRequestDetail,
} from "./annot-doc-selection-toolbar.js";
import "./annot-doc-selection-toolbar.js";
import { DOC_SHORTCUT_GROUPS } from "./doc-shortcut-groups.js";
import { openKeyboardHelpModal } from "./keyboard-help.js";
import {
  html,
  LitElement,
  nothing,
  type PropertyValues,
  type TemplateResult,
  unsafeHTML,
} from "./lit.js";
import {
  attachStepImageViewport,
  type StepImageViewportController,
} from "./step-image-viewport.js";

/** CSS for the shell chrome. Concatenated with
 *  `buildStyleBlock(doc)` at render time. */
const SHELL_CSS = `
/* The custom element itself defaults to display: inline (the spec
   default for unknown HTML elements), which makes \`width: 100%\` on
   the inner .annot-doc-shell div resolve against an inline parent
   whose intrinsic width is the children's min-content. Visible
   symptom: docs with \`meta.maxWidth: "full"\` still rendered as
   narrow as the step card's toolbar — the article never claimed
   the viewport width because the custom element above it didn't.
   \`display: block\` on the host element makes the chain
   load-bearing. */
annot-doc-shell {
  display: block;
}
.annot-doc-shell {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 1.5rem;
  align-items: start;
  width: 100%;
  /* Phase 6 of annot-html-document-ux-polish.md — anchors the
     drop-zone overlay (the .annot-doc-shell-dropzone child,
     position: absolute) so it covers the shell instead of the
     viewport. */
  position: relative;
}
.annot-doc-shell.no-toc {
  grid-template-columns: 1fr;
}
.annot-doc-toc {
  position: sticky;
  top: 0;
  padding: 1.5rem 0.5rem 1.5rem 1rem;
  max-height: 100vh;
  overflow-y: auto;
  font-size: 0.875rem;
  border-right: 1px solid var(--annot-doc-muted, #6b7280);
}
.annot-doc-toc h2.annot-doc-toc-title {
  margin: 0 0 0.75rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--annot-doc-muted);
  font-weight: 600;
}
.annot-doc-toc ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.annot-doc-toc a {
  display: block;
  padding: 0.25rem 0.5rem;
  text-decoration: none;
  color: var(--annot-doc-fg);
  border-left: 2px solid transparent;
  border-radius: 2px;
  line-height: 1.4;
}
.annot-doc-toc a:hover,
.annot-doc-toc a:focus-visible {
  border-left-color: var(--annot-doc-accent);
  background: var(--annot-doc-code-bg);
  outline: none;
}
.annot-doc-toc .toc-level-2 { padding-left: 1rem; }
.annot-doc-toc .toc-level-3 { padding-left: 2rem; }
.annot-doc-shell-empty {
  padding: 2rem;
  color: var(--annot-doc-muted, #6b7280);
  text-align: center;
  font-style: italic;
}

/* ---- Editing mode ---- */
.annot-doc-shell.editing .annot-doc-block-host {
  position: relative;
  margin: 0.25rem 0;
  border-radius: 4px;
  border: 1px solid transparent;
}
.annot-doc-shell.editing figure[data-annot-block="image"] {
  cursor: pointer;
  position: relative;
}
.annot-doc-shell.editing figure[data-annot-block="image"]::after {
  content: "Click to edit";
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.65);
  color: #ffffff;
  border-radius: 4px;
  font-size: 0.75rem;
  /* Phase 6 of annot-html-document-ux-polish.md — ambient hint
     visible at low opacity even without hover so users know
     image blocks are interactive. Hover bumps to full
     visibility. */
  opacity: 0.5;
  transition: opacity 0.12s ease-in;
  pointer-events: none;
}
.annot-doc-shell.editing figure[data-annot-block="image"]:hover::after {
  opacity: 1;
}
@media (hover: none) {
  /* Touch — keep the badge fully visible since there is no
     hover state to ramp from. */
  .annot-doc-shell.editing figure[data-annot-block="image"]::after {
    opacity: 1;
  }
}

/* Phase 6 — drop-zone overlay. Mounted as a sibling of the
   article (inside the .annot-doc-shell wrapper) and shown
   while the user is dragging files over the shell.
   Pointer-events: none on the chrome so the underlying drop
   event still fires. */
.annot-doc-shell-dropzone {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(37, 99, 235, 0.08);
  border: 2px dashed var(--annot-doc-accent, #2563eb);
  border-radius: 6px;
  pointer-events: none;
  z-index: 100;
  font-size: 1rem;
  font-weight: 500;
  color: var(--annot-doc-accent, #2563eb);
}
.annot-doc-shell-dropzone-label {
  padding: 12px 20px;
  background: var(--annot-doc-bg, #ffffff);
  border-radius: 999px;
  border: 1px solid var(--annot-doc-accent, #2563eb);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
}
.annot-doc-shell.editing .annot-doc-block-host:hover,
.annot-doc-shell.editing .annot-doc-block-host:focus-within {
  border-color: var(--annot-doc-muted);
}
.annot-doc-shell.editing .annot-doc-block-host > [data-annot-block] {
  margin: 0;
}
.annot-doc-shell.editing annot-doc-block-toolbar {
  position: absolute;
  top: -16px;
  right: 8px;
  /* Phase 2 of annot-html-document-ux-polish.md — toolbar is
     always slightly visible (0.4) for ambient discoverability,
     and goes to full opacity on hover / focus-within. Removes
     the "invisible until hover" gesture-only affordance the v1
     shipped. */
  opacity: 0.4;
  transition: opacity 0.12s ease-in;
  z-index: 1;
}
.annot-doc-shell.editing .annot-doc-block-host:hover annot-doc-block-toolbar,
.annot-doc-shell.editing .annot-doc-block-host:focus-within annot-doc-block-toolbar {
  opacity: 1;
}
@media (hover: none) {
  /* Touch devices have no hover state — keep the toolbar
     fully visible so the actions are reachable by tap. Phase 9
     will sweep this pattern across the rest of the doc surface. */
  .annot-doc-shell.editing annot-doc-block-toolbar {
    opacity: 1;
  }
}
/* Phase 3b of card-procedure-template — in-block layout
   switcher. Anchored to the step block's top-right corner; the
   doc-wide style block in inject-styles.ts makes
   [data-annot-block="step"] 'position: relative' so the
   absolute positioning here lands inside the card. The pill
   appears at 0.4 opacity for ambient discoverability and pops
   to full opacity on hover / focus-within, matching the block
   toolbar's affordance pattern. */
.annot-doc-step-layout-switcher {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  opacity: 0.4;
  transition: opacity 0.12s ease-in;
}
[data-annot-block="step"]:hover .annot-doc-step-layout-switcher,
[data-annot-block="step"]:focus-within .annot-doc-step-layout-switcher {
  opacity: 1;
}
@media (hover: none) {
  .annot-doc-step-layout-switcher { opacity: 1; }
}
.annot-doc-step-layout-switcher select {
  background: var(--annot-card-bg, #ffffff);
  color: var(--annot-doc-fg);
  border: 1px solid var(--annot-doc-muted);
  border-radius: 4px;
  padding: 2px 4px;
  font-size: 0.8rem;
  line-height: 1.2;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  cursor: pointer;
}
/* Phase 7d — viewport toolbar pinned to the top-left corner of
   the step image area. Same hover/opacity treatment as the
   layout switcher; flips to the LEFT side so the two
   affordances don't overlap.
   Phase 7d-polish: grew from 1-3 buttons (Save / Reset) to
   3-5 buttons (zoom-in / zoom-out / reset-view / Save / Clear).
   Icon buttons (+/−/⟲) are sized to a fixed 26px square; text
   buttons (Save view / Clear) flex to their content. The
   pill-shaped buttons gain a subtle backdrop-filter blur so
   the toolbar reads cleanly on top of busy screenshots. */
.annot-doc-step-viewport-controls {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 2;
  display: flex;
  gap: 4px;
  /* Hidden by default so the toolbar doesn't cover the underlying
     screenshot at rest — user-reported visual obstruction. The
     hover / focus-within rule below brings it back when the user
     interacts with the card. pointer-events: none while hidden
     so a stray cursor near the toolbar position can't trigger
     a zoom while the buttons are invisible.
     Touch devices (no hover state) keep the toolbar visible via
     the (hover: none) override below — there's no other
     affordance for triggering the buttons. */
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease-in;
}
[data-annot-block="step"]:hover .annot-doc-step-viewport-controls,
[data-annot-block="step"]:focus-within .annot-doc-step-viewport-controls {
  opacity: 1;
  pointer-events: auto;
}
@media (hover: none) {
  .annot-doc-step-viewport-controls {
    opacity: 1;
    pointer-events: auto;
  }
}
.annot-doc-step-viewport-controls button {
  background: var(--annot-card-bg, #ffffff);
  color: var(--annot-doc-fg);
  border: 1px solid var(--annot-doc-muted);
  border-radius: 4px;
  padding: 2px 8px;
  min-width: 26px;
  height: 26px;
  font-size: 0.85rem;
  line-height: 1;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  font: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.annot-doc-step-viewport-controls button[data-step-viewport-action="zoom-in"],
.annot-doc-step-viewport-controls button[data-step-viewport-action="zoom-out"],
.annot-doc-step-viewport-controls button[data-step-viewport-action="reset-view"] {
  padding: 0;
  font-size: 1rem;
  font-weight: 500;
}
.annot-doc-step-viewport-controls button:hover,
.annot-doc-step-viewport-controls button:focus-visible {
  border-color: var(--annot-doc-accent);
  color: var(--annot-doc-accent);
  outline: none;
}
/* The pan/zoom interaction surface — keep the SVG itself
   clickable for grab+wheel but suppress text-select inside
   it (otherwise drag triggers a text selection on the
   ancestor article). */
[data-annot-block="step"] .annot-doc-image-svg-slot svg {
  user-select: none;
  -webkit-user-select: none;
}
.annot-doc-block-toolbar .block-action-handle {
  cursor: grab;
  user-select: none;
  color: var(--annot-doc-muted, #6b7280);
}
.annot-doc-block-toolbar .block-action-handle:active {
  cursor: grabbing;
}
.annot-doc-block-toolbar {
  display: inline-flex;
  gap: 0.125rem;
  padding: 0.125rem;
  background: var(--annot-doc-bg);
  border: 1px solid var(--annot-doc-muted);
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.annot-doc-block-toolbar .block-action {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  color: var(--annot-doc-fg);
  font-size: 0.875rem;
  line-height: 1;
}
.annot-doc-block-toolbar .block-action:hover:not(:disabled) {
  background: var(--annot-doc-code-bg);
}
.annot-doc-block-toolbar .block-action:focus-visible:not(:disabled) {
  outline: 2px solid var(--annot-doc-accent, #2563eb);
  outline-offset: 1px;
}
.annot-doc-block-toolbar .block-action:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.annot-doc-block-toolbar .block-action-danger:hover:not(:disabled) {
  background: rgba(220, 38, 38, 0.12);
  color: #dc2626;
}
.annot-doc-block-toolbar .block-action-image:hover:not(:disabled) {
  background: var(--annot-doc-code-bg);
  color: var(--annot-doc-accent, #2563eb);
}
[data-annot-block][contenteditable="true"]:focus-visible {
  outline: 2px solid var(--annot-doc-accent);
  outline-offset: 2px;
  border-radius: 2px;
}

/* Phase 2 of annot-html-document-ux-polish.md — between-block
 * insert bar. Default state: 12px-tall transparent band with a
 * faint hairline running across the middle. On hover / focus,
 * the bar grows a centered "+ Insert" pill so the user sees a
 * concrete affordance rather than a gesture they have to
 * discover. Click opens the existing annot-doc-block-menu
 * anchored to the bar. The slash-typed-in-empty-block path
 * stays — this is purely additive. */
.annot-doc-insert-bar-button {
  display: block;
  width: 100%;
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  position: relative;
  height: 12px;
  color: var(--annot-doc-accent, #2563eb);
}
.annot-doc-insert-bar-button:focus-visible {
  outline: none;
}
.annot-doc-insert-bar-rule {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--annot-doc-muted, #d1d5db);
  opacity: 0;
  transition: opacity 0.12s ease-in, background 0.12s ease-in,
    height 0.12s ease-in;
}
.annot-doc-insert-bar-button:hover .annot-doc-insert-bar-rule,
.annot-doc-insert-bar-button:focus-visible .annot-doc-insert-bar-rule {
  opacity: 0.6;
}
/* Phase 7 of annot-html-document-ux-polish.md — drop target
   indicator. When a block is being dragged over this bar, the
   hairline thickens + colours up to make the drop position
   obvious. */
.annot-doc-insert-bar-button.is-drop-target .annot-doc-insert-bar-rule {
  opacity: 1;
  height: 3px;
  background: var(--annot-doc-accent, #2563eb);
}
.annot-doc-insert-bar-label {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--annot-doc-bg, #ffffff);
  color: var(--annot-doc-accent, #2563eb);
  border: 1px solid var(--annot-doc-accent, #2563eb);
  border-radius: 999px;
  opacity: 0;
  transition: opacity 0.12s ease-in;
  pointer-events: none;
  white-space: nowrap;
}
.annot-doc-insert-bar-button:hover .annot-doc-insert-bar-label,
.annot-doc-insert-bar-button:focus-visible .annot-doc-insert-bar-label {
  opacity: 1;
}
.annot-doc-insert-bar-plus {
  font-weight: 700;
  line-height: 1;
}
@media (hover: none) {
  /* Touch — show the pill at low opacity so users see the
     affordance without needing to hover. Tapping the bar opens
     the block menu the same as on desktop. */
  .annot-doc-insert-bar-rule {
    opacity: 0.4;
  }
  .annot-doc-insert-bar-label {
    opacity: 0.6;
  }
}

/* Discoverability hint for empty contentEditable blocks. The
 * :empty pseudo-selector matches when innerHTML is exactly
 * empty (no <br>, no whitespace) — true on a freshly-mounted
 * block before the user has typed anything. The placeholder
 * disappears the moment any content lands. pointer-events:
 * none on the pseudo so the user's first click still lands on
 * the contentEditable + sets the caret correctly. */
.annot-doc-shell.editing
  [data-annot-block="paragraph"][contenteditable="true"]:empty::before,
.annot-doc-shell.editing
  [data-annot-block="heading"][contenteditable="true"]:empty::before {
  content: "Type / for commands, or paste / drop an image…";
  color: var(--annot-doc-muted);
  pointer-events: none;
  font-style: italic;
  opacity: 0.7;
}

/* ---- Slash menu (mounted to <body> by openFor) ---- */
annot-doc-block-menu {
  display: block;
  width: 240px;
  max-height: 360px;
  overflow-y: auto;
  background: var(--annot-doc-bg, #ffffff);
  color: var(--annot-doc-fg, #1f2937);
  border: 1px solid var(--annot-doc-muted, #6b7280);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  padding: 4px;
}
.annot-doc-block-menu {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.annot-doc-block-menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: transparent;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  text-align: left;
  font-size: 0.875rem;
  color: inherit;
}
.annot-doc-block-menu-item.active,
.annot-doc-block-menu-item:hover {
  background: var(--annot-doc-code-bg, #f3f4f6);
}
.annot-doc-block-menu-label {
  font-weight: 500;
}
.annot-doc-block-menu-desc {
  font-size: 0.8em;
  color: var(--annot-doc-muted, #6b7280);
}

/* Phase 9 of annot-html-document-ux-polish.md — mobile / touch
   sweep. The TOC moves behind a hamburger toggle below 768px;
   the toggle button itself is hidden on desktop where the
   sticky TOC has its own column. */
.annot-doc-shell-toc-toggle {
  display: none;
  position: absolute;
  top: 4px;
  left: 4px;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  background: var(--annot-doc-bg, #ffffff);
  border: 1px solid var(--annot-doc-muted, #d1d5db);
  border-radius: 6px;
  color: inherit;
  cursor: pointer;
  font-size: 1.1rem;
  z-index: 99;
}
.annot-doc-shell-toc-toggle:hover,
.annot-doc-shell-toc-toggle:focus-visible {
  background: var(--annot-doc-code-bg, #f3f4f6);
  outline: none;
}

@media (max-width: 768px) {
  .annot-doc-shell {
    grid-template-columns: 1fr;
  }
  .annot-doc-shell-toc-toggle {
    display: inline-flex;
  }
  .annot-doc-toc {
    position: static;
    max-height: none;
    border-right: none;
    border-bottom: 1px solid var(--annot-doc-muted);
    padding: 0.75rem 0;
  }
  /* TOC drawer hides by default on mobile; hamburger toggle
     reveals. The toggle adds .toc-open to the shell wrapper. */
  .annot-doc-shell:not(.toc-open) .annot-doc-toc {
    display: none;
  }
  /* Bump per-block toolbar to ≥44 px touch targets on touch
     viewports so individual actions are tappable. */
  .annot-doc-block-toolbar .block-action {
    width: 36px;
    height: 36px;
  }
  /* Insert bar grows from 12 px to a comfortable tap zone. */
  .annot-doc-insert-bar-button {
    height: 24px;
  }
}

@media (hover: none) {
  /* Touch — bump action targets to 44 × 44 regardless of
     viewport width; the desktop hover surface keeps its tighter
     28 / 32 px sizing. */
  .annot-doc-block-toolbar .block-action {
    width: 40px;
    height: 40px;
  }
  .annot-doc-insert-bar-button {
    height: 28px;
  }
}

/* Phase 13 of annot-html-document-ux-polish.md — respect users
   who've asked the OS to reduce motion. Disable the soft fade /
   slide transitions across the doc shell (block toolbar opacity,
   insert-bar pill, drop-zone overlay, etc.) so vestibular-
   sensitive users see crisp state changes. */
@media (prefers-reduced-motion: reduce) {
  .annot-doc-shell.editing annot-doc-block-toolbar,
  .annot-doc-shell.editing figure[data-annot-block="image"]::after,
  .annot-doc-insert-bar-rule,
  .annot-doc-insert-bar-label {
    transition: none;
  }
  .annot-doc-empty-state-card {
    transition: none;
  }
}
`;

const COMMIT_DEBOUNCE_MS = 600;

export interface DocHeadingActivatedDetail {
  /** Heading-block index in the document's list of heading
   *  blocks (NOT in the full block list). */
  index: number;
  /** Heading text (plain — inline tags stripped). */
  text: string;
}

export interface DocChangedDetail {
  document: AnnotDocument;
  /** What triggered the change — useful for analytics / future
   *  PWA orchestration. `gallery-sync` is emitted when the
   *  Phase 3 pull pass re-embeds one or more linked blocks
   *  with the latest gallery state. */
  reason: "block-action" | "undo" | "redo" | "commit" | "external" | "gallery-sync";
}

/** Phase 2 of `card-document-image-gallery-link-sync.md` — payload
 *  the shell hands the host when the user saves an in-doc image
 *  edit on a block linked to a gallery `ImageRecord`. The host
 *  resolves `sourceImagePath` against its `StorageProvider` and
 *  writes the new bitmap + annotation fragment back to the
 *  corresponding `ImageRecord`. */
export interface LinkedImagePushDetail {
  /** `ImageBlock.id` / `StepBlock.id` — for tracing / logging
   *  (the host doesn't need it for the lookup; `sourceImagePath`
   *  is the storage key). */
  readonly blockId: string;
  /** The doc-side back-reference. Path of the gallery `ImageRecord`
   *  the host should update. */
  readonly sourceImagePath: string;
  /** Base bitmap data URL extracted from the saved doc-block SVG. */
  readonly originalDataUrl: string;
  /** Flat `<svg>` annotation fragment (no base image, no
   *  `<g id="annotations">` wrapper). Drop-in replacement for
   *  `ImageRecord.annotationsSvg`. */
  readonly annotationsSvg: string;
  /** Pixel width — drop-in for `ImageRecord.width`. */
  readonly width: number;
  /** Pixel height — drop-in for `ImageRecord.height`. */
  readonly height: number;
}

/** Result the host returns from a `pushLinkedImage` invocation.
 *
 *  - `"synced"` — gallery record updated successfully.
 *  - `"dead-link"` — `sourceImagePath` no longer resolves to a
 *    gallery record. The shell strips the back-reference from the
 *    block on receipt (the doc edit stays in place; only the link
 *    is severed).
 *  - `"error"` — push failed for another reason. The host already
 *    surfaced the error (toast / log); the shell preserves the
 *    link in case it's a transient failure. */
export type LinkedImagePushResult = "synced" | "dead-link" | "error";

/** Host-supplied callback that performs the doc → gallery push.
 *  Set to `null` when the host doesn't own a storage backend
 *  (Storybook preview, headless tests, VSCode webview without a
 *  matching gallery library). When null the shell silently skips
 *  the push — the doc still updates, the gallery just doesn't. */
export type PushLinkedImageFn = (detail: LinkedImagePushDetail) => Promise<LinkedImagePushResult>;

/** Phase 3 of `card-document-image-gallery-link-sync.md` — result
 *  the host returns from a `pullLinkedImage` invocation. */
export type LinkedImagePullResult =
  | {
      /** Gallery record found; the shell compares the parts and
       *  re-embeds when the doc copy diverges. */
      readonly status: "found";
      readonly originalDataUrl: string;
      readonly annotationsSvg: string;
      readonly width: number;
      readonly height: number;
    }
  | {
      /** `sourceImagePath` doesn't resolve to a gallery record.
       *  The shell leaves the block alone — the doc keeps its
       *  inlined snapshot. (Phase 5 will surface a UI badge.) */
      readonly status: "dead-link";
    }
  | {
      /** Read failed for another reason (network, permission).
       *  The shell skips this block; subsequent doc opens retry. */
      readonly status: "error";
    };

/** Host-supplied callback that performs the gallery → doc pull:
 *  resolve `sourceImagePath` against the active `StorageProvider`,
 *  return the record's bitmap + annotations + dims, or signal a
 *  dead-link / error. Set to `null` when the host doesn't own a
 *  storage backend (in which case the shell silently skips). */
export type PullLinkedImageFn = (sourceImagePath: string) => Promise<LinkedImagePullResult>;

/** Phase 3 — payload of the `linked-images-synced` event the
 *  shell fires after a pull pass has finished. Hosts use it to
 *  toast a single "Image X updated from gallery." line per
 *  refreshed block. The event is suppressed when no block
 *  changed (idle pulls stay silent). */
export interface LinkedImagesSyncedDetail {
  readonly updated: ReadonlyArray<{
    readonly blockId: string;
    readonly sourceImagePath: string;
  }>;
}

export class AnnotDocShellElement extends LitElement {
  static override properties = {
    document: { attribute: false },
    showToc: { type: Boolean, attribute: "show-toc" },
    editing: { type: Boolean, attribute: "editing" },
    dropZoneActive: { state: true },
    tocOpen: { state: true },
  };

  declare document: AnnotDocument | null;
  declare showToc: boolean;
  declare editing: boolean;
  declare dropZoneActive: boolean;
  /** Phase 2 of `card-document-image-gallery-link-sync.md` —
   *  optional callback the host installs to push a saved in-doc
   *  image edit back to its linked gallery `ImageRecord`. When
   *  unset the shell behaves exactly as it did pre-Phase-2 (doc
   *  edit lands locally, gallery is untouched). See
   *  `PushLinkedImageFn` / `LinkedImagePushDetail` /
   *  `LinkedImagePushResult` for the contract. Not declared as a
   *  Lit reactive property — it's a function reference set
   *  imperatively by the host once at mount time and never
   *  changes through the shell's lifetime, so no re-render is
   *  needed on assignment. */
  pushLinkedImage: PushLinkedImageFn | null = null;
  /** Phase 3 of `card-document-image-gallery-link-sync.md` —
   *  optional callback the host installs to fetch the latest
   *  gallery state for a linked block. The shell calls this once
   *  per linked block on every fresh-document load (i.e. when
   *  the `document` property is set externally, not via internal
   *  history-push). When unset the shell silently skips the
   *  pull pass — the doc stays at whatever state it was loaded
   *  with. See `PullLinkedImageFn` / `LinkedImagePullResult`. */
  pullLinkedImage: PullLinkedImageFn | null = null;
  /** Identity-tracker so the pull pass fires at most once per
   *  externally-set document. Reset every time `willUpdate`
   *  sees a non-suppressed `document` change. */
  #pulledForDoc: AnnotDocument | null = null;
  /** Phase 9 of `annot-html-document-ux-polish.md` — mobile-only
   *  toggle for the TOC drawer. Default true so desktop sees the
   *  TOC at boot; the CSS `@media (max-width: 768px)` rules hide
   *  the TOC unless the user explicitly opens it via the
   *  hamburger button rendered next to the article. */
  declare tocOpen: boolean;
  /** Counter mirroring `dragenter` vs `dragleave` events so we
   *  hide the drop-zone overlay only when the cursor truly
   *  leaves the shell, not on every nested-element exit. */
  #dragCounter = 0;
  /** Phase 7 of `annot-html-document-ux-polish.md` — index of the
   *  block currently being dragged via the toolbar's ☰ handle, or
   *  null when no block reorder is in flight. Used to scope the
   *  insert-bar drop handlers to legitimate reorder gestures
   *  only. */
  #draggedBlockIndex: number | null = null;
  /** Phase 10 of `annot-html-document-ux-polish.md` — lazy
   *  image-slot materialisation. The observer fires when a
   *  figure's `.annot-doc-image-svg-slot` placeholder enters
   *  within ~200vh of the viewport, at which point we inline the
   *  full SVG bytes carried in `data-annot-image-svg`. Created
   *  lazily so test environments without IO don't pay the
   *  construction cost. */
  #imageSlotObserver: IntersectionObserver | null = null;
  #observedImageSlots: WeakSet<HTMLElement> = new WeakSet();
  /** Phase 7d — active pan/zoom controllers per step block image
   *  slot. Keyed by block id (the `data-annot-image-id` on the
   *  enclosing `<section>`). Disposed when the slot is removed
   *  from the article or when the shell unmounts. */
  #viewportControllers: Map<string, { ctrl: StepImageViewportController; svg: SVGSVGElement }> =
    new Map();

  #history: DocumentHistory | null = null;
  /** Set briefly while we're applying a mutation internally
   *  (block action / undo / redo). Suppresses the
   *  `willUpdate`-side history reset that would otherwise fire
   *  on every property change. */
  #suppressHistoryReset = false;
  #commitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Phase 4 of `card-document-image-gallery-link-sync.md` —
   *  bound window listener for `annot-metadata-changed`. The
   *  reference is stored so `disconnectedCallback` can detach
   *  the same function. */
  #onMetadataChanged: ((e: Event) => void) | null = null;

  constructor() {
    super();
    this.document = null;
    this.showToc = true;
    this.editing = false;
    this.dropZoneActive = false;
    // Default to closed on mobile so the article gets the
    // viewport's full width by default; the hamburger button
    // is the discoverable opt-in. Desktop ignores this state
    // (CSS unconditionally renders the TOC there).
    this.tocOpen = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("keydown", this.#onKeydown);
    this.addEventListener("paste", this.#onPaste as EventListener);
    this.addEventListener("dragover", this.#onDragOver as EventListener);
    this.addEventListener("dragenter", this.#onDragEnter as EventListener);
    this.addEventListener("dragleave", this.#onDragLeave as EventListener);
    this.addEventListener("drop", this.#onDrop as EventListener);
    // Phase 3 of `annot-html-document-ux-polish.md` — listen for
    // selection changes globally so the inline format toolbar
    // shows / hides as the user drags / clicks inside an
    // editable block. The handler scopes itself to selections
    // that fall within this shell's contentEditable elements.
    document.addEventListener("selectionchange", this.#onSelectionChange);
    document.addEventListener("mousedown", this.#onDocMousedown, { capture: true });
    document.addEventListener("keydown", this.#onDocKeydown, { capture: true });
    document.addEventListener("format-change", this.#onFormatChange as EventListener);
    document.addEventListener("block-kind-change", this.#onBlockKindChange as EventListener);
    document.addEventListener("link-request", this.#onLinkRequest as EventListener);
    // Phase 4 of `card-document-image-gallery-link-sync.md` —
    // listen for cross-tab + same-tab metadata changes so a gallery
    // edit landing while the doc is open propagates immediately,
    // not just on next doc-load. The IDB metadata cache dispatches
    // `annot-metadata-changed` `CustomEvent`s on `window` for every
    // `putImage` + on `BroadcastChannel` echo from peer tabs.
    if (typeof window !== "undefined") {
      const handler = (e: Event) => this.#handleMetadataChanged(e);
      this.#onMetadataChanged = handler;
      window.addEventListener("annot-metadata-changed", handler);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("keydown", this.#onKeydown);
    this.removeEventListener("paste", this.#onPaste as EventListener);
    this.removeEventListener("dragover", this.#onDragOver as EventListener);
    this.removeEventListener("dragenter", this.#onDragEnter as EventListener);
    this.removeEventListener("dragleave", this.#onDragLeave as EventListener);
    this.removeEventListener("drop", this.#onDrop as EventListener);
    document.removeEventListener("selectionchange", this.#onSelectionChange);
    document.removeEventListener("mousedown", this.#onDocMousedown, { capture: true });
    document.removeEventListener("keydown", this.#onDocKeydown, { capture: true });
    document.removeEventListener("format-change", this.#onFormatChange as EventListener);
    document.removeEventListener("block-kind-change", this.#onBlockKindChange as EventListener);
    document.removeEventListener("link-request", this.#onLinkRequest as EventListener);
    if (this.#onMetadataChanged && typeof window !== "undefined") {
      window.removeEventListener("annot-metadata-changed", this.#onMetadataChanged);
      this.#onMetadataChanged = null;
    }
    AnnotDocSelectionToolbarElement.closeActive();
    if (this.#commitTimer !== null) {
      clearTimeout(this.#commitTimer);
      this.#commitTimer = null;
    }
    // Phase 10 — release the IntersectionObserver so it doesn't
    // pin the shell + its observed slot elements after the
    // shell tears down (e.g. when navigating away from a doc
    // back to the gallery).
    this.#imageSlotObserver?.disconnect();
    this.#imageSlotObserver = null;
    // Phase 7d — release viewport-controller event listeners.
    for (const entry of this.#viewportControllers.values()) entry.ctrl.dispose();
    this.#viewportControllers.clear();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("document")) {
      if (this.#suppressHistoryReset) {
        this.#suppressHistoryReset = false;
      } else {
        this.#history = this.document ? new DocumentHistory(this.document) : null;
        // Phase 3 of `card-document-image-gallery-link-sync.md`
        // — a fresh, externally-set document is the trigger for
        // the gallery → doc pull pass. Schedule it for the next
        // microtask so the first render lands without blocking;
        // the pass itself is async and emits a follow-up history
        // push (`reason: "gallery-sync"`) when a block needed
        // re-embedding. Guard against re-firing on subsequent
        // renders of the same identity (e.g. Lit re-running
        // `willUpdate` after a `dropZoneActive` state change).
        if (this.document && this.#pulledForDoc !== this.document) {
          const target = this.document;
          this.#pulledForDoc = target;
          queueMicrotask(() => {
            // Bail if the document changed again before the
            // microtask ran (rapid back-to-back loads in tests).
            if (this.document !== target) return;
            void this.#pullLinkedImagesPass(target);
          });
        }
      }
    }
  }

  protected override updated(_changed: PropertyValues): void {
    // Phase 10 of `annot-html-document-ux-polish.md` — image SVG
    // slots need IO observation regardless of editing mode (so
    // read-only viewers also benefit from lazy load). Run the
    // sweep first; the rest of the body is an editing-mode
    // hot-loop.
    this.#materialiseImageSlots();
    // Phase 7d — dispose viewport controllers whose block is
    // no longer in the document (deletion / reorder paths).
    this.#sweepStaleViewportControllers();

    // Imperatively populate contentEditable bodies for heading +
    // paragraph blocks. See `renderHeading`'s comment for why we
    // can't use Lit template parts here.
    //
    // Phase 2 of `annot-html-document-ux-polish.md` interleaves
    // `<annot-doc-insert-bar>` between every block-host inside
    // `<article>`. We can no longer use a positional index over
    // `article.children` to reach the block-host for `blocks[idx]`
    // — the children alternate `bar, host, bar, host, ..., bar`.
    // Look up wrappers via `data-block-index` instead so the
    // mapping stays correct regardless of how many bars sit
    // between blocks.
    if (!this.editing || !this.document) return;
    const article = this.querySelector("article[data-annot-doc]");
    if (!article) return;
    this.document.blocks.forEach((block, idx) => {
      const wrapper = article.querySelector(
        `.annot-doc-block-host[data-block-index="${idx}"]`,
      ) as HTMLElement | null;
      if (!wrapper) return;
      const blockEl = wrapper.querySelector("[data-annot-block]") as HTMLElement | null;
      if (!blockEl) return;
      if (block.kind === "heading" || block.kind === "paragraph") {
        // Only update DOM when the document's text disagrees with
        // what's already there — preserves the cursor when typing.
        if (blockEl.innerHTML !== block.inlineHtml) {
          blockEl.innerHTML = block.inlineHtml;
        }
        return;
      }
      // Phase 5 of `annot-html-document-ux-polish.md` — populate
      // the multi-paragraph / list / figcaption editables. Same
      // focus-aware update strategy: never overwrite the active
      // element so the user's cursor / IME state survives.
      if (block.kind === "list") {
        const liEls = blockEl.querySelectorAll<HTMLElement>("li[contenteditable='true']");
        block.items.forEach((html, i) => {
          const li = liEls[i];
          if (!li) return;
          if (document.activeElement === li) return;
          if (li.innerHTML !== html) li.innerHTML = html;
        });
        return;
      }
      if (block.kind === "quote" || block.kind === "callout") {
        const pEls = blockEl.querySelectorAll<HTMLElement>("p[contenteditable='true']");
        block.paragraphs.forEach((html, i) => {
          const p = pEls[i];
          if (!p) return;
          if (document.activeElement === p) return;
          if (p.innerHTML !== html) p.innerHTML = html;
        });
        return;
      }
      if (block.kind === "image") {
        const figcaption = blockEl.querySelector(
          "figcaption[contenteditable='true']",
        ) as HTMLElement | null;
        if (!figcaption) return;
        if (document.activeElement === figcaption) return;
        const next = block.caption ?? "";
        if (figcaption.innerHTML !== next) figcaption.innerHTML = next;
      }
      // Phase 3 of card-procedure-template — step blocks populate
      // their title + body contentEditable slots through the same
      // focus-aware update strategy.
      if (block.kind === "step") {
        const titleEl = blockEl.querySelector(
          "[data-step-title][contenteditable='true']",
        ) as HTMLElement | null;
        const bodyEl = blockEl.querySelector(
          "[data-step-body][contenteditable='true']",
        ) as HTMLElement | null;
        if (titleEl && document.activeElement !== titleEl) {
          if (titleEl.innerHTML !== block.title) titleEl.innerHTML = block.title;
        }
        if (bodyEl && document.activeElement !== bodyEl) {
          if (bodyEl.innerHTML !== block.body) bodyEl.innerHTML = block.body;
        }
      }
    });
  }

  override render(): TemplateResult {
    if (!this.document) {
      return html`<div class="annot-doc-shell-empty">No document loaded.</div>`;
    }

    const docCss = buildStyleBlock(this.document);
    const headings = this.document.blocks.filter((b): b is HeadingBlock => b.kind === "heading");
    const headingIds = buildHeadingIdMap(headings);
    const tocVisible = this.showToc && headings.length > 0;
    const editing = this.editing;
    const blocks = this.document.blocks;

    const shellClasses = [
      "annot-doc-shell",
      tocVisible ? "" : "no-toc",
      editing ? "editing" : "",
      // Phase 9 — only meaningful below 768px (CSS gates the
      // TOC visibility there); harmless on desktop.
      this.tocOpen ? "toc-open" : "",
    ]
      .filter(Boolean)
      .join(" ");

    // Phase 4 of `annot-html-document-ux-polish.md` — when the
    // document is brand-new (zero blocks or one empty paragraph)
    // AND we're in editing mode, show the onboarding empty-state
    // panel ABOVE the article. Read-only mode + non-empty docs
    // skip it. The panel doesn't replace the article — both
    // co-exist so paste / drop into the article still works
    // alongside the cards.
    const showEmptyState = editing && isEmptyDocument(blocks);

    return html`
      <style>
${unsafeHTML(`${docCss}\n${SHELL_CSS}`)}
      </style>
      <div
        class=${shellClasses}
        @insert-block=${(e: CustomEvent<InsertBlockDetail>) => this.#onInsertBarSelect(e)}
        @empty-state-action=${(e: CustomEvent<EmptyStateActionDetail>) =>
          this.#onEmptyStateAction(e)}
        @block-drag-start=${(e: CustomEvent<BlockDragStartDetail>) => this.#onBlockDragStart(e)}
        @block-drag-end=${() => this.#onBlockDragEnd()}
        @block-drop-at=${(e: CustomEvent<BlockDropAtDetail>) => this.#onBlockDropAt(e)}
      >
        ${
          tocVisible
            ? html`
              <button
                type="button"
                class="annot-doc-shell-toc-toggle"
                aria-label=${this.tocOpen ? "Hide section list" : "Show section list"}
                aria-expanded=${this.tocOpen ? "true" : "false"}
                title="Sections"
                @click=${() => {
                  this.tocOpen = !this.tocOpen;
                }}
              >
                ☰
              </button>
            `
            : nothing
        }
        ${tocVisible ? this.#renderToc(headings, headingIds) : nothing}
        <article
          data-annot-doc
          @input=${this.#onArticleInput}
          @blur=${this.#onArticleBlur}
          @click=${(e: MouseEvent) => this.#onArticleClick(e)}
        >
          ${this.#renderDocHeader(blocks)}
          ${showEmptyState ? html`<annot-doc-empty-state></annot-doc-empty-state>` : nothing}
          ${
            editing
              ? this.#renderEditingBody(blocks, headingIds)
              : blocks.map((b) => this.#renderBlock(b, headingIds))
          }
        </article>
        ${
          editing && this.dropZoneActive
            ? html`
              <div class="annot-doc-shell-dropzone" aria-hidden="true">
                <span class="annot-doc-shell-dropzone-label">
                  Drop image here to insert
                </span>
              </div>
            `
            : nothing
        }
      </div>
    `;
  }

  #renderInsertBar(insertAt: number): TemplateResult {
    return html`
      <annot-doc-insert-bar
        .insertAt=${insertAt}
        data-insert-at=${insertAt}
      ></annot-doc-insert-bar>
    `;
  }

  /** Phase 7c of `docs/plans/_done/card-procedure-template.md` —
   *  Scribe-style document header rendering in the editor /
   *  preview. Mirrors the standalone-view bytes produced by
   *  the serializer (`buildDocHeaderHtml` in
   *  `@ingcreators/annot-doc`); both surfaces source the same
   *  data so what-you-see-is-what-you-get holds.
   *
   *  Returns `nothing` when `meta.header` is absent or all of
   *  its fields are empty — the article retains its block-flow
   *  layout exactly as before Phase 7c.
   */
  #renderDocHeader(blocks: readonly Block[]): unknown {
    const doc = this.document;
    const header = doc?.meta.header;
    if (!header || (!header.icon && !header.description)) return nothing;
    const stepCount = blocks.reduce((n, b) => (b.kind === "step" ? n + 1 : n), 0);
    const stepLabel = stepCount === 1 ? "1 step" : `${stepCount} steps`;
    return html`
      <section data-annot-doc-header>
        ${header.icon ? html`<img data-annot-doc-header-icon src=${header.icon} alt="">` : nothing}
        <h1 data-annot-doc-header-title>${doc?.title ?? ""}</h1>
        ${
          header.description
            ? html`<p data-annot-doc-header-description>${header.description}</p>`
            : nothing
        }
        ${
          doc?.meta.author || stepCount > 0
            ? html`
              <div data-annot-doc-header-meta>
                ${
                  doc?.meta.author
                    ? html`<span data-annot-doc-header-author>${doc.meta.author}</span>`
                    : nothing
                }
                ${
                  stepCount > 0
                    ? html`<span data-annot-doc-header-step-count>${stepLabel}</span>`
                    : nothing
                }
              </div>
            `
            : nothing
        }
      </section>
    `;
  }

  /** Build the editing-mode article body as a single flat
   *  iterable of TemplateResults — `[bar0, block0, bar1, block1,
   *  ..., barN]`. Phase 2 of `annot-html-document-ux-polish.md`
   *  interleaves insert-bars between every pair of blocks AND at
   *  both ends. The single-iterable shape keeps Lit's child-part
   *  reconciliation stable across `document.blocks` length
   *  changes (mixing `flatMap` with a sibling interpolation
   *  causes ChildPart parent-marker ejections during async
   *  insert / paste flows). */
  #renderEditingBody(
    blocks: readonly Block[],
    headingIds: Map<HeadingBlock, string>,
  ): TemplateResult[] {
    const items: TemplateResult[] = [];
    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i];
      if (!block) continue;
      items.push(this.#renderInsertBar(i));
      items.push(this.#renderEditingBlock(block, i, headingIds, blocks.length));
    }
    items.push(this.#renderInsertBar(blocks.length));
    return items;
  }

  // -------------------------------------------------------------------------
  // Public editing API
  // -------------------------------------------------------------------------

  /** Fold any pending typing edits into the document model and push
   *  a history snapshot. Idempotent and safe to call when no edits
   *  are pending. */
  commit(): void {
    this.#flushPendingCommit();
  }

  undo(): boolean {
    this.#flushPendingCommit();
    const snap = this.#history?.undo();
    if (!snap) return false;
    this.#applyInternal(snap, "undo");
    return true;
  }

  redo(): boolean {
    this.#flushPendingCommit();
    const snap = this.#history?.redo();
    if (!snap) return false;
    this.#applyInternal(snap, "redo");
    return true;
  }

  canUndo(): boolean {
    return this.#history?.canUndo() ?? false;
  }

  canRedo(): boolean {
    return this.#history?.canRedo() ?? false;
  }

  // -------------------------------------------------------------------------
  // Internal mutation pipeline
  // -------------------------------------------------------------------------

  #applyInternal(doc: AnnotDocument, reason: DocChangedDetail["reason"]): void {
    this.#suppressHistoryReset = true;
    this.document = doc;
    this.dispatchEvent(
      new CustomEvent<DocChangedDetail>("doc-changed", {
        bubbles: true,
        composed: true,
        detail: { document: doc, reason },
      }),
    );
  }

  #onBlockAction(e: CustomEvent<BlockToolbarActionDetail>, index: number): void {
    e.stopPropagation();
    if (!this.document) return;
    const action = e.detail.action;
    // Sync any in-progress text edits before mutating the block list
    // so the user's typing isn't lost.
    this.#syncDomIntoDocument();

    if (action === "insertImage") {
      // Asynchronous — opens the OS file picker, then inserts
      // the resulting image block AFTER the current block. The
      // shell already has #insertImageFromFile; we add a thin
      // index-aware caller here so the toolbar button reuses the
      // same data-URL → ImageBlock pipeline as paste / drop / the
      // slash menu's image entry.
      void this.#promptImageFileAndInsertAfter(index);
      return;
    }

    const blocks = [...this.document.blocks];
    if (action === "delete") {
      blocks.splice(index, 1);
      if (blocks.length === 0) {
        // The article must always have at least one block — maintain
        // the invariant by inserting an empty paragraph.
        blocks.push({ kind: "paragraph", inlineHtml: "" });
      }
    } else if (action === "moveUp") {
      if (index <= 0) return;
      const moved = blocks.splice(index, 1)[0];
      if (!moved) return;
      blocks.splice(index - 1, 0, moved);
    } else if (action === "moveDown") {
      if (index >= blocks.length - 1) return;
      const moved = blocks.splice(index, 1)[0];
      if (!moved) return;
      blocks.splice(index + 1, 0, moved);
    } else if (action === "insertAbove" || action === "insertBelow") {
      const insertAt = action === "insertAbove" ? index : index + 1;
      blocks.splice(insertAt, 0, { kind: "paragraph", inlineHtml: "" });
    }

    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
  }

  // -------------------------------------------------------------------------
  // Slash menu
  // -------------------------------------------------------------------------

  #maybeOpenSlashMenu(target: HTMLElement): void {
    // Trigger only when the user typed `/` into an empty editable
    // block (the canonical Notion-style entry point). We strip the
    // `/` so the new block starts blank.
    if (!target.matches('[data-annot-block][contenteditable="true"]')) return;
    if (target.textContent !== "/") return;
    target.textContent = "";
    const wrapper = target.closest(".annot-doc-block-host") as HTMLElement | null;
    if (!wrapper) return;
    const indexAttr = wrapper.getAttribute("data-block-index");
    if (!indexAttr) return;
    const index = Number.parseInt(indexAttr, 10);
    if (Number.isNaN(index)) return;

    const menu = AnnotDocBlockMenuElement.openFor(target);
    menu.addEventListener(
      "block-menu-select",
      (e: Event) => {
        this.#onSlashMenuSelect(e as CustomEvent<BlockMenuSelectDetail>, index);
      },
      { once: true },
    );
  }

  #onSlashMenuSelect(e: CustomEvent<BlockMenuSelectDetail>, index: number): void {
    if (!this.document) return;
    this.#syncDomIntoDocument();
    const item = e.detail.item;
    if (item.kind === "image") {
      // Special-case the image entry: open the OS file picker, then
      // splice the resulting block in place. The slash menu's
      // trigger block (an empty paragraph by virtue of how the
      // menu opens) gets replaced with the image block.
      void this.#promptImageFileAndReplace(index);
      return;
    }
    if (item.kind === "step") {
      // Phase 7a of card-procedure-template — `stepImageless`
      // flag skips the file-picker dance and inserts a text-only
      // step block directly. Same replacement semantics as the
      // image-bearing path; the only difference is the block's
      // `svg` field is the empty string.
      if (item.stepImageless) {
        this.#replaceWithImagelessStep(index);
        return;
      }
      // Phase 3 of card-procedure-template — same picker-driven
      // path as image, but the resulting block is a `StepBlock`
      // (with empty title + body + the doc's default layout).
      void this.#promptImageFileAndReplaceWithStep(index);
      return;
    }
    const newBlock = createBlockFromMenuItem(item);
    const blocks = [...this.document.blocks];
    blocks[index] = newBlock;
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
  }

  // -------------------------------------------------------------------------
  // Insert-bar (Phase 2 of `annot-html-document-ux-polish.md`)
  // -------------------------------------------------------------------------

  /** Handles the `insert-block` event the between-block insert
   *  bars dispatch. Splices a fresh block at `insertAt` (0 ≤ idx
   *  ≤ blocks.length). Image blocks route through the OS file
   *  picker so the new block has bytes; everything else
   *  materialises empty so the user can immediately type. */
  #onInsertBarSelect(e: CustomEvent<InsertBlockDetail>): void {
    e.stopPropagation();
    if (!this.document) return;
    this.#syncDomIntoDocument();
    const { insertAt, item } = e.detail;
    const safeAt = Math.max(0, Math.min(this.document.blocks.length, insertAt));
    if (item.kind === "image") {
      void this.#promptImageFileAndInsertAt(safeAt);
      return;
    }
    if (item.kind === "step") {
      // Phase 7a — text-only step bypasses the file picker.
      if (item.stepImageless) {
        this.#insertImagelessStepAt(safeAt);
        return;
      }
      // Phase 3 of card-procedure-template — picker-driven step
      // insertion mirrors the image entry.
      void this.#promptImageFileAndInsertStepAt(safeAt);
      return;
    }
    const newBlock = createBlockFromMenuItem(item);
    const blocks = [...this.document.blocks];
    blocks.splice(safeAt, 0, newBlock);
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
  }

  /** Insert-bar's image-kind entry point — opens the OS file
   *  picker, then splices the resulting image block at
   *  `insertAt`. Pairs with `#promptImageFileAndInsertAfter` /
   *  `#promptImageFileAndReplace` (the toolbar / slash-menu
   *  variants); all three converge on `#insertImageFromFile`. */
  async #promptImageFileAndInsertAt(insertAt: number): Promise<void> {
    const file = await pickImageFile();
    if (!file) return;
    await this.#insertImageFromFile(file, { insertAtIndex: insertAt });
  }

  // -------------------------------------------------------------------------
  // Block drag-and-drop reorder (Phase 7 of `annot-html-document-ux-polish.md`)
  // -------------------------------------------------------------------------

  /** Records the source block index when the user grabs the
   *  toolbar's ☰ handle. The shell uses this in the matching
   *  `block-drop-at` handler to splice the block to its new
   *  position; insert-bars only react when a real reorder is
   *  in flight. */
  #onBlockDragStart(e: CustomEvent<BlockDragStartDetail>): void {
    if (e.detail.fromIndex < 0) return;
    this.#draggedBlockIndex = e.detail.fromIndex;
  }

  #onBlockDragEnd(): void {
    this.#draggedBlockIndex = null;
  }

  /** Reorders `document.blocks` so the dragged block lands at
   *  `insertAt`. Drops onto the source block's own neighboring
   *  insert-bars are no-ops (the drop position equals the
   *  current position). Pushes one history snapshot. */
  #onBlockDropAt(e: CustomEvent<BlockDropAtDetail>): void {
    if (!this.document) return;
    if (this.#draggedBlockIndex === null) return;
    const fromIndex = this.#draggedBlockIndex;
    const insertAt = e.detail.insertAt;
    this.#draggedBlockIndex = null;
    // Drop on the bar immediately above OR below the source
    // block resolves to the same position — bail out cleanly.
    if (insertAt === fromIndex || insertAt === fromIndex + 1) return;
    const blocks = [...this.document.blocks];
    const [moved] = blocks.splice(fromIndex, 1);
    if (!moved) return;
    // Adjust the splice target if removing earlier in the list
    // shifted everything after it left by one.
    const adjustedAt = insertAt > fromIndex ? insertAt - 1 : insertAt;
    const safeAt = Math.max(0, Math.min(blocks.length, adjustedAt));
    blocks.splice(safeAt, 0, moved);
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
  }

  // -------------------------------------------------------------------------
  // Empty-state onboarding (Phase 4 of `annot-html-document-ux-polish.md`)
  // -------------------------------------------------------------------------

  /** Routes empty-state card clicks. The shell self-handles
   *  three of the four actions; `useTemplate` intentionally
   *  bubbles up to the host (which owns storage + the
   *  template-picker dialog). The bubble is allowed by NOT
   *  calling `e.stopPropagation()` for that branch. */
  #onEmptyStateAction = (e: CustomEvent<EmptyStateActionDetail>): void => {
    const action = e.detail.action;
    if (action === "useTemplate") {
      // Bubble up — the host listens for this on its
      // `#annot-doc-host` container and runs the existing
      // template-picker flow.
      return;
    }
    e.stopPropagation();
    if (action === "startWithHeading") {
      this.#applyStartWithHeading();
    } else if (action === "insertImage") {
      void this.#promptImageFileAndInsertAt(0);
    } else if (action === "pasteHint") {
      this.#focusFirstEditableAndHintPaste();
    }
  };

  #applyStartWithHeading(): void {
    if (!this.document) return;
    const newDoc: AnnotDocument = {
      ...this.document,
      blocks: [
        { kind: "heading", level: 1, inlineHtml: "" },
        { kind: "paragraph", inlineHtml: "" },
      ],
    };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
    // Focus the heading after the next render so the cursor
    // lands inside the new contentEditable.
    queueMicrotask(() => {
      const heading = this.querySelector(
        '.annot-doc-block-host[data-block-index="0"] [data-annot-block="heading"][contenteditable="true"]',
      ) as HTMLElement | null;
      heading?.focus();
    });
  }

  #focusFirstEditableAndHintPaste(): void {
    // Focus the first editable so Ctrl+V works AND the
    // article's existing `:empty::before` placeholder ("Type /
    // for commands, or paste / drop an image…") becomes the
    // visible hint.
    queueMicrotask(() => {
      const editable = this.querySelector(
        '[data-annot-block][contenteditable="true"]',
      ) as HTMLElement | null;
      editable?.focus();
    });
  }

  // -------------------------------------------------------------------------
  // Capture insertion — paste / drop / file picker
  // -------------------------------------------------------------------------

  #onPaste = (e: ClipboardEvent): void => {
    if (!this.editing) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    // Phase 6 of `annot-html-document-ux-polish.md` — collect ALL
    // image items in the clipboard payload + insert them
    // sequentially. v1's `for ... return` only inserted the first.
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return; // text-only paste — let browser handle
    e.preventDefault();
    void this.#insertImagesSequential(files);
  };

  #onDragOver = (e: DragEvent): void => {
    if (!this.editing) return;
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  #onDragEnter = (e: DragEvent): void => {
    if (!this.editing) return;
    if (!e.dataTransfer?.types.includes("Files")) return;
    this.#dragCounter += 1;
    if (this.#dragCounter === 1) this.dropZoneActive = true;
  };

  #onDragLeave = (e: DragEvent): void => {
    if (!this.editing) return;
    if (!e.dataTransfer?.types.includes("Files")) return;
    this.#dragCounter = Math.max(0, this.#dragCounter - 1);
    if (this.#dragCounter === 0) this.dropZoneActive = false;
  };

  #onDrop = (e: DragEvent): void => {
    // Phase 6 — clear the overlay regardless of whether the drop
    // was inside the editing region (the user committed the drag,
    // so the visual cue should retract).
    this.#dragCounter = 0;
    this.dropZoneActive = false;
    if (!this.editing) return;
    // Collect all image entries — items + .files — and insert
    // sequentially in order so a multi-screenshot drop lands as
    // multiple ordered blocks.
    const files: File[] = [];
    const items = Array.from(e.dataTransfer?.items ?? []);
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    // Browser fallback when dataTransfer.items isn't populated
    // (rare; some legacy drag sources omit it). `.files` is the
    // canonical drop surface there.
    if (files.length === 0) {
      const ftFiles = Array.from(e.dataTransfer?.files ?? []);
      for (const file of ftFiles) {
        if (file.type.startsWith("image/")) files.push(file);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    void this.#insertImagesSequential(files);
  };

  /** Insert a list of image files sequentially after the current
   *  document tail. Sequencing matters because each call awaits
   *  `#insertImageFromFile` (which awaits an async file-read +
   *  image-decode) — running them in parallel would race on
   *  `this.document` and lose all but the last block. */
  async #insertImagesSequential(files: readonly File[]): Promise<void> {
    for (const file of files) {
      await this.#insertImageFromFile(file);
    }
  }

  async #promptImageFileAndReplace(index: number): Promise<void> {
    const file = await pickImageFile();
    if (!file) return;
    await this.#insertImageFromFile(file, { replaceIndex: index });
  }

  /** Block-toolbar "Insert image" entry point — opens the OS
   *  file picker, then splices the resulting image block in
   *  after `index`. Discoverable analogue to paste / drop /
   *  slash-menu image insertion (each of which starts from a
   *  different user gesture but converges on the same
   *  `#insertImageFromFile` pipeline). */
  async #promptImageFileAndInsertAfter(index: number): Promise<void> {
    const file = await pickImageFile();
    if (!file) return;
    await this.#insertImageFromFile(file, { insertAtIndex: index + 1 });
  }

  /** Insert / replace an image block built from the given `File`.
   *  The bitmap is inlined as a data URL so the document remains
   *  self-contained — Phase 8+ may add an asset-link path that
   *  defers to a `StorageProvider` instead. Default (no opts) →
   *  append at end of block list.
   *
   *  When the file is a re-editable `.annot.png` / `.annot.jpg`
   *  (carrying XMP metadata with the original bitmap +
   *  annotation `<g>` fragment), the resulting block embeds the
   *  ORIGINAL bitmap + the existing annotations — not the
   *  rendered-flat preview pixels. This is the difference
   *  between dropping a screenshot and dropping a "screenshot
   *  with my arrows still editable inside" file: the latter
   *  must round-trip back through the editor modal with every
   *  shape selectable, otherwise the user has effectively
   *  flattened their annotations on import. */
  /** Phase 3 of card-procedure-template — picker entry point
   *  matching `#promptImageFileAndInsertAt` for step blocks.
   *  Splices a fresh step block at `insertAt`. */
  async #promptImageFileAndInsertStepAt(insertAt: number): Promise<void> {
    const file = await pickImageFile();
    if (!file) return;
    await this.#insertStepFromFile(file, { insertAtIndex: insertAt });
  }

  /** Phase 3 of card-procedure-template — picker entry point
   *  matching `#promptImageFileAndReplace` for the slash-menu's
   *  Step entry. Replaces the trigger block (the empty paragraph
   *  the slash menu opened in) with a fresh step block. */
  async #promptImageFileAndReplaceWithStep(index: number): Promise<void> {
    const file = await pickImageFile();
    if (!file) return;
    await this.#insertStepFromFile(file, { replaceIndex: index });
  }

  /** Phase 3 of card-procedure-template — shared step-from-file
   *  pipeline. Mirrors `#insertImageFromFile`'s shape: tries the
   *  XMP-extracted-annotations path first (so dropping an
   *  `.annot.png` produces an editable step block), falls back
   *  to the bitmap-only path otherwise. The resulting step block
   *  carries empty `title` / `body` strings and the document's
   *  `meta.cardLayout.defaultStepLayout` (or `image-top` when
   *  unset). */
  async #insertStepFromFile(
    file: File,
    opts: { replaceIndex?: number; insertAtIndex?: number } = {},
  ): Promise<void> {
    if (!this.document) return;
    const layout = this.document.meta.cardLayout?.defaultStepLayout ?? "image-top";
    const editableMeta = await tryReadAnnotImageBytes(file);
    let svg: string;
    let id: string;
    if (editableMeta) {
      // Reuse the image-block creation helper to canonicalise the
      // SVG payload + mint the id, then promote the result to a
      // step shape with the chosen layout + empty text slots.
      const seed = createImageBlockFromAnnotMeta(editableMeta);
      svg = seed.svg;
      id = seed.id;
    } else {
      let dataUrl: string;
      try {
        dataUrl = await fileToDataUrl(file);
      } catch (err) {
        this.dispatchEvent(
          new CustomEvent("doc-error", {
            bubbles: true,
            composed: true,
            detail: { reason: "file-read", error: err },
          }),
        );
        return;
      }
      let dimensions: { width: number; height: number };
      try {
        dimensions = await getImageDimensions(dataUrl);
      } catch (err) {
        this.dispatchEvent(
          new CustomEvent("doc-error", {
            bubbles: true,
            composed: true,
            detail: { reason: "image-decode", error: err },
          }),
        );
        return;
      }
      const seed = createImageBlockFromDataUrl(dataUrl, dimensions.width, dimensions.height);
      svg = seed.svg;
      id = seed.id;
    }
    if (!this.document) return;
    const stepBlock: StepBlock = { kind: "step", id, svg, title: "", body: "", layout };
    const blocks = [...this.document.blocks];
    if (
      opts.replaceIndex !== undefined &&
      opts.replaceIndex >= 0 &&
      opts.replaceIndex < blocks.length
    ) {
      blocks[opts.replaceIndex] = stepBlock;
    } else if (opts.insertAtIndex !== undefined) {
      const at = Math.max(0, Math.min(blocks.length, opts.insertAtIndex));
      blocks.splice(at, 0, stepBlock);
    } else {
      blocks.push(stepBlock);
    }
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
  }

  /** Phase 7a of card-procedure-template — splice an image-less
   *  step block (empty `svg` field) at `insertAt`. No file picker,
   *  no XMP probe; the block is text-only so it can be inserted
   *  synchronously the same way an empty paragraph would. */
  #insertImagelessStepAt(insertAt: number): void {
    if (!this.document) return;
    const stepBlock = this.#makeImagelessStepBlock();
    const blocks = [...this.document.blocks];
    const at = Math.max(0, Math.min(blocks.length, insertAt));
    blocks.splice(at, 0, stepBlock);
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
  }

  /** Phase 7a — replace the block at `index` with an image-less
   *  step block. Mirrors `#promptImageFileAndReplaceWithStep`'s
   *  splice semantics but skips the picker. */
  #replaceWithImagelessStep(index: number): void {
    if (!this.document) return;
    if (index < 0 || index >= this.document.blocks.length) return;
    const stepBlock = this.#makeImagelessStepBlock();
    const blocks = [...this.document.blocks];
    blocks[index] = stepBlock;
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
  }

  #makeImagelessStepBlock(): StepBlock {
    const layout = this.document?.meta.cardLayout?.defaultStepLayout ?? "image-top";
    return {
      kind: "step",
      id: `img-${newIdB58()}`,
      svg: "",
      title: "",
      body: "",
      layout,
    };
  }

  async #insertImageFromFile(
    file: File,
    opts: { replaceIndex?: number; insertAtIndex?: number } = {},
  ): Promise<void> {
    if (!this.document) return;

    // Try the XMP-extracted-annotations path first. When the
    // file is a plain PNG / JPEG (no annotations chunk),
    // `readEditableImage` returns null and we fall through to
    // the bitmap-only path.
    const editableMeta = await tryReadAnnotImageBytes(file);
    let block: ImageBlock;
    if (editableMeta) {
      block = createImageBlockFromAnnotMeta(editableMeta);
    } else {
      let dataUrl: string;
      try {
        dataUrl = await fileToDataUrl(file);
      } catch (err) {
        this.dispatchEvent(
          new CustomEvent("doc-error", {
            bubbles: true,
            composed: true,
            detail: { reason: "file-read", error: err },
          }),
        );
        return;
      }
      let dimensions: { width: number; height: number };
      try {
        dimensions = await getImageDimensions(dataUrl);
      } catch (err) {
        this.dispatchEvent(
          new CustomEvent("doc-error", {
            bubbles: true,
            composed: true,
            detail: { reason: "image-decode", error: err },
          }),
        );
        return;
      }
      block = createImageBlockFromDataUrl(dataUrl, dimensions.width, dimensions.height);
    }
    if (!this.document) return;
    const blocks = [...this.document.blocks];
    if (
      opts.replaceIndex !== undefined &&
      opts.replaceIndex >= 0 &&
      opts.replaceIndex < blocks.length
    ) {
      blocks[opts.replaceIndex] = block;
    } else if (opts.insertAtIndex !== undefined) {
      const at = Math.max(0, Math.min(blocks.length, opts.insertAtIndex));
      blocks.splice(at, 0, block);
    } else {
      blocks.push(block);
    }
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
  }

  #onArticleInput = (e: Event): void => {
    if (!this.editing) return;
    // Slash menu trigger — only fires when an editable block's text
    // is exactly `/`. The handler clears the slash and opens the
    // menu anchored to the same block.
    const target = e.target as HTMLElement | null;
    if (target?.textContent === "/") {
      this.#maybeOpenSlashMenu(target);
      return;
    }
    if (this.#commitTimer !== null) clearTimeout(this.#commitTimer);
    this.#commitTimer = setTimeout(() => {
      this.#commitTimer = null;
      const dirty = this.#syncDomIntoDocument();
      if (dirty && this.#history && this.document) {
        this.#history.push(this.document);
        this.dispatchEvent(
          new CustomEvent<DocChangedDetail>("doc-changed", {
            bubbles: true,
            composed: true,
            detail: { document: this.document, reason: "commit" },
          }),
        );
      }
    }, COMMIT_DEBOUNCE_MS);
  };

  #onArticleBlur = (): void => {
    if (!this.editing) return;
    this.#flushPendingCommit();
  };

  #flushPendingCommit(): void {
    if (this.#commitTimer !== null) {
      clearTimeout(this.#commitTimer);
      this.#commitTimer = null;
    }
    const dirty = this.#syncDomIntoDocument();
    if (dirty && this.#history && this.document) {
      this.#history.push(this.document);
      // Mirror the debounced `#onArticleInput` path: notify the
      // host so autosave persists the synced model. Without this
      // dispatch, programmatic mutations driven through
      // `commit()` (inline-link `createLink`, format-toolbar
      // B / I / U, image-modal apply, blur after a typing burst
      // that hadn't ticked yet) update the in-memory document
      // but never reach the storage layer — reopening the file
      // shows the pre-mutation state.
      this.dispatchEvent(
        new CustomEvent<DocChangedDetail>("doc-changed", {
          bubbles: true,
          composed: true,
          detail: { document: this.document, reason: "commit" },
        }),
      );
    }
  }

  /** Walk the rendered article and pull current contentEditable
   *  innerHTML back into the document model for editable block
   *  kinds (Phase 4a: heading, paragraph). Other kinds are
   *  preserved as-is (their text editing lands in Phase 4b).
   *
   *  Returns `true` when the document changed; `false` when the
   *  DOM matched the model already (no-op). */
  #syncDomIntoDocument(): boolean {
    if (!this.document) return false;
    const article = this.querySelector("article[data-annot-doc]");
    if (!article) return false;
    // Phase 2 of `annot-html-document-ux-polish.md` interleaves
    // `<annot-doc-insert-bar>` between every block-host inside
    // `<article>`. Filter to the block-hosts so the index → block
    // mapping stays correct regardless of how many bars sit
    // between blocks.
    const wrappers = Array.from(article.querySelectorAll(".annot-doc-block-host")) as HTMLElement[];
    if (wrappers.length !== this.document.blocks.length) return false;
    let dirty = false;
    const newBlocks = this.document.blocks.map((block, idx) => {
      const wrapper = wrappers[idx];
      if (!wrapper) return block;
      const updated = syncBlockFromDom(wrapper, block);
      if (updated !== block) dirty = true;
      return updated;
    });
    if (dirty) {
      this.#suppressHistoryReset = true;
      this.document = { ...this.document, blocks: newBlocks };
    }
    return dirty;
  }

  #onKeydown = (e: KeyboardEvent): void => {
    if (!this.editing) return;
    const cmd = e.ctrlKey || e.metaKey;
    if (cmd) {
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        this.undo();
        return;
      }
      if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        this.redo();
        return;
      }
      // Phase 8 of `annot-html-document-ux-polish.md` — additional
      // shortcuts: insert paragraph above / below the current
      // block + block-kind conversion of the current block.
      if (e.key === "Enter") {
        e.preventDefault();
        this.#insertParagraphRelativeToCursor(e.shiftKey ? "above" : "below");
        return;
      }
      if (e.shiftKey) {
        // Headings + lists + quote.
        if (key === "1") {
          e.preventDefault();
          this.#convertCurrentBlockKindAtCursor({
            id: "h1",
            label: "Heading 1",
            kind: "heading",
            level: 1,
          });
          return;
        }
        if (key === "2") {
          e.preventDefault();
          this.#convertCurrentBlockKindAtCursor({
            id: "h2",
            label: "Heading 2",
            kind: "heading",
            level: 2,
          });
          return;
        }
        if (key === "3") {
          e.preventDefault();
          this.#convertCurrentBlockKindAtCursor({
            id: "h3",
            label: "Heading 3",
            kind: "heading",
            level: 3,
          });
          return;
        }
        if (key === "8") {
          e.preventDefault();
          this.#convertCurrentBlockKindAtCursor({
            id: "ul",
            label: "Bulleted list",
            kind: "list",
            listOrdered: false,
          });
          return;
        }
        if (key === "7") {
          e.preventDefault();
          this.#convertCurrentBlockKindAtCursor({
            id: "ol",
            label: "Numbered list",
            kind: "list",
            listOrdered: true,
          });
          return;
        }
        if (e.key === ">" || e.key === ".") {
          // Ctrl+Shift+. produces ">" on US/JP keyboards. Both keys
          // map to "convert to quote" the same way.
          e.preventDefault();
          this.#convertCurrentBlockKindAtCursor({
            id: "quote",
            label: "Quote",
            kind: "quote",
          });
          return;
        }
      }
    }
    // Phase 5 of `annot-html-document-ux-polish.md` — Enter in
    // list / quote / callout editables splits the current entry
    // into a new sibling. Empty trailing entry exits the block:
    // - list → a paragraph after the list
    // - quote / callout → a paragraph after the wrapper
    // Shift+Enter falls through to the browser's default
    // (line break inside the same entry).
    if (e.key === "Enter" && !e.shiftKey) {
      if (this.#handleEnterInMultiEntryBlock(e)) return;
      // Figcaption Enter: blur to commit (single-line semantics).
      const target = e.target as HTMLElement | null;
      if (target?.matches("figcaption[contenteditable='true']")) {
        e.preventDefault();
        target.blur();
        return;
      }
    }
  };

  // -------------------------------------------------------------------------
  // Phase 8 — Keyboard shortcuts (`annot-html-document-ux-polish.md`)
  // -------------------------------------------------------------------------

  /** Phase 8 — opens the keyboard-help modal with the doc-mode
   *  shortcut group appended to the editor's defaults. Public so
   *  hosts can wire a Help button in their chrome. */
  openKeyboardHelp(): void {
    void openKeyboardHelpModal(DOC_SHORTCUT_GROUPS);
  }

  /** Phase 10 — public escape hatch for callers that want all
   *  image SVGs materialised right now instead of waiting for
   *  the IntersectionObserver to fire. Used by:
   *    - Tests, where happy-dom's IO stub never dispatches the
   *      intersection callback.
   *    - Print / export pipelines that need every image fully
   *      rendered before snapshotting.
   *    - SSR-style hosts where there is no scrolling viewport. */
  materialiseAllImagesNow(): void {
    const slots = this.querySelectorAll<HTMLElement>(
      ".annot-doc-image-svg-slot[data-annot-image-svg]",
    );
    for (const slot of Array.from(slots)) {
      materialiseImageSlot(slot);
      this.#attachViewportIfStepSlot(slot);
    }
  }

  /** Phase 7d — attach the pan/zoom controller to a freshly-
   *  materialised image slot when its enclosing block is a
   *  step block. No-op for `<figure>` image blocks (which have
   *  their own modal-driven editing flow).
   *
   *  When the block's SVG bytes change (annotation edit →
   *  `materialiseImageSlot` re-inlines a new `<svg>` element)
   *  the previous controller is disposed and a fresh one is
   *  attached to the new SVG. The saved viewport is re-applied
   *  as the initial; ephemeral pan/zoom state is reset. Pure
   *  re-renders (title typing, link edits) leave the SVG node
   *  untouched and keep the existing controller intact.
   */
  #attachViewportIfStepSlot(slot: HTMLElement): void {
    const section = slot.closest('[data-annot-block="step"]') as HTMLElement | null;
    if (!section) return;
    const blockId = section.getAttribute("data-annot-image-id");
    if (!blockId) return;
    const svg = slot.querySelector("svg") as SVGSVGElement | null;
    if (!svg) return;
    const existing = this.#viewportControllers.get(blockId);
    if (existing) {
      // Same SVG node? Keep the controller — its listeners are
      // still attached and the user's ephemeral pan/zoom state
      // survives the re-render.
      if (existing.svg === svg) return;
      // SVG was replaced (annotation save / step image swap).
      // Dispose the old controller and fall through to attach
      // a fresh one on the new node.
      existing.ctrl.dispose();
      this.#viewportControllers.delete(blockId);
    }
    // Look up the matching step block in the document model so
    // we can apply its saved `viewport` as the initial display
    // state.
    const block = this.document?.blocks.find((b) => b.kind === "step" && b.id === blockId);
    if (!block || block.kind !== "step") return;
    const initial = block.viewport
      ? { x: block.viewport.x, y: block.viewport.y, w: block.viewport.w, h: block.viewport.h }
      : undefined;
    // Phase 7d-polish 2: lock the viewBox aspect to 16:9 (the
    // card slot's CSS aspect-ratio). Without this, a non-16:9
    // saved viewport — or a wheel-zoom that drifted away from
    // 16:9 — letterboxes inside the slot, making the image's
    // visible top edge differ per card and breaking visual
    // alignment across a column of step blocks.
    const ctrl = attachStepImageViewport(svg, { initial, targetAspect: 16 / 9 });
    this.#viewportControllers.set(blockId, { ctrl, svg });
  }

  /** Phase 7d — drop viewport controllers whose block has left
   *  the document (deletion, kind change, etc.). Called from
   *  `updated()` so stale entries don't accumulate as the user
   *  edits. The pan-zoom listeners were attached to the SVG
   *  element that's already been removed from the DOM by Lit;
   *  disposing here releases the closure references so they're
   *  garbage-collected. */
  #sweepStaleViewportControllers(): void {
    const liveStepIds = new Set<string>();
    for (const b of this.document?.blocks ?? []) {
      if (b.kind === "step") liveStepIds.add(b.id);
    }
    for (const [blockId, entry] of this.#viewportControllers) {
      if (!liveStepIds.has(blockId)) {
        entry.ctrl.dispose();
        this.#viewportControllers.delete(blockId);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Phase 10 — Lazy image-slot materialisation
  // -------------------------------------------------------------------------

  /** Walks the article for `.annot-doc-image-svg-slot` placeholders
   *  and either inlines the full SVG eagerly (when no
   *  IntersectionObserver is available — happy-dom + tests) or
   *  hands them to `#imageSlotObserver` so they materialise
   *  lazily as the user scrolls. Idempotent: slots that have
   *  already materialised are skipped via the `data-annot-image-svg`
   *  attribute being cleared after inline. */
  #materialiseImageSlots(): void {
    if (!this.document) return;
    const slots = this.querySelectorAll<HTMLElement>(
      ".annot-doc-image-svg-slot[data-annot-image-svg]",
    );
    if (slots.length === 0) return;

    // Eager-materialise when IntersectionObserver isn't available
    // (happy-dom on some versions, jsdom). Tests + read-only
    // viewers without IO support still see the full SVG.
    if (typeof IntersectionObserver === "undefined") {
      for (const slot of Array.from(slots)) {
        materialiseImageSlot(slot);
        this.#attachViewportIfStepSlot(slot);
      }
      return;
    }

    // Lazy path — observe each slot once. The shared observer
    // dispatches `materialiseImageSlot` on first intersection
    // within ~200vh of the viewport.
    if (!this.#imageSlotObserver) {
      this.#imageSlotObserver = new IntersectionObserver(
        (entries, observer) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const target = entry.target as HTMLElement;
            materialiseImageSlot(target);
            this.#attachViewportIfStepSlot(target);
            observer.unobserve(target);
            this.#observedImageSlots.delete(target);
          }
        },
        { rootMargin: "200% 0px" },
      );
    }
    for (const slot of Array.from(slots)) {
      if (this.#observedImageSlots.has(slot)) continue;
      this.#observedImageSlots.add(slot);
      this.#imageSlotObserver.observe(slot);
    }
  }

  /** Resolve the block index that owns the currently-focused
   *  contentEditable. Falls back to scanning `window.getSelection()`
   *  when the active element isn't an editable (e.g. focus is on
   *  a header button after a click). Returns null when no doc
   *  block is focused. */
  #findFocusedBlockIndex(): number | null {
    const active = document.activeElement as HTMLElement | null;
    let editable: HTMLElement | null = null;
    if (active && this.contains(active) && active.getAttribute("contenteditable") === "true") {
      editable = active;
    } else {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        editable = this.#findEditableAncestor(range.commonAncestorContainer);
        if (editable && !this.contains(editable)) editable = null;
      }
    }
    if (!editable) return null;
    const wrapper = editable.closest<HTMLElement>(".annot-doc-block-host");
    if (!wrapper) return null;
    const indexAttr = wrapper.getAttribute("data-block-index");
    if (indexAttr === null) return null;
    const idx = Number.parseInt(indexAttr, 10);
    return Number.isNaN(idx) ? null : idx;
  }

  /** Insert an empty paragraph above OR below the block that
   *  carries the focused editable. Focuses the new paragraph. */
  #insertParagraphRelativeToCursor(direction: "above" | "below"): void {
    if (!this.document) return;
    this.#syncDomIntoDocument();
    const blockIndex = this.#findFocusedBlockIndex();
    if (blockIndex === null) return;
    const insertAt = direction === "above" ? blockIndex : blockIndex + 1;
    const blocks = [...this.document.blocks];
    blocks.splice(insertAt, 0, { kind: "paragraph", inlineHtml: "" });
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
    queueMicrotask(() => {
      const p = this.querySelector<HTMLElement>(
        `.annot-doc-block-host[data-block-index="${insertAt}"] [data-annot-block="paragraph"][contenteditable="true"]`,
      );
      p?.focus();
    });
  }

  /** Convert the block carrying the focused editable to the
   *  chosen kind, preserving inline HTML where possible. Wraps
   *  the existing `convertBlockKind` helper used by the Phase 3
   *  selection toolbar so both surfaces share the conversion
   *  rules. */
  #convertCurrentBlockKindAtCursor(option: BlockKindOption): void {
    if (!this.document) return;
    this.#syncDomIntoDocument();
    const blockIndex = this.#findFocusedBlockIndex();
    if (blockIndex === null) return;
    const current = this.document.blocks[blockIndex];
    if (!current) return;
    const replacement = convertBlockKind(current, option);
    if (!replacement) return;
    const blocks = [...this.document.blocks];
    blocks[blockIndex] = replacement;
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
  }

  /** Returns true when the event was consumed (handled here) so
   *  the caller knows to short-circuit. */
  #handleEnterInMultiEntryBlock(e: KeyboardEvent): boolean {
    if (!this.document) return false;
    const target = e.target as HTMLElement | null;
    if (!target) return false;
    const li = target.closest<HTMLElement>("li[contenteditable='true']");
    const quoteP = target.closest<HTMLElement>("p[data-quote-paragraph-index]");
    const calloutP = target.closest<HTMLElement>("p[data-callout-paragraph-index]");
    const editable = li ?? quoteP ?? calloutP;
    if (!editable) return false;
    const wrapper = editable.closest<HTMLElement>(".annot-doc-block-host");
    const indexAttr = wrapper?.getAttribute("data-block-index");
    if (!indexAttr) return false;
    const blockIndex = Number.parseInt(indexAttr, 10);
    if (Number.isNaN(blockIndex)) return false;
    const block = this.document.blocks[blockIndex];
    if (!block) return false;

    e.preventDefault();
    this.#syncDomIntoDocument();
    const isEmpty = (editable.textContent ?? "").trim() === "";

    if (li && block.kind === "list") {
      const itemIndex = Number.parseInt(li.getAttribute("data-list-item-index") ?? "", 10);
      if (Number.isNaN(itemIndex)) return false;
      this.#splitMultiEntry(blockIndex, itemIndex, isEmpty, "list");
      return true;
    }
    if (quoteP && block.kind === "quote") {
      const paraIndex = Number.parseInt(
        quoteP.getAttribute("data-quote-paragraph-index") ?? "",
        10,
      );
      if (Number.isNaN(paraIndex)) return false;
      this.#splitMultiEntry(blockIndex, paraIndex, isEmpty, "quote");
      return true;
    }
    if (calloutP && block.kind === "callout") {
      const paraIndex = Number.parseInt(
        calloutP.getAttribute("data-callout-paragraph-index") ?? "",
        10,
      );
      if (Number.isNaN(paraIndex)) return false;
      this.#splitMultiEntry(blockIndex, paraIndex, isEmpty, "callout");
      return true;
    }
    return false;
  }

  /** Insert a new sibling entry after `entryIndex` in the
   *  multi-entry block at `blockIndex`. When `isEmpty` is true
   *  AND the entry is the last one, drop it and exit the block
   *  by inserting a fresh paragraph block AFTER the wrapper.
   *  After applying, focuses the newly-created editable. */
  #splitMultiEntry(
    blockIndex: number,
    entryIndex: number,
    isEmpty: boolean,
    kind: "list" | "quote" | "callout",
  ): void {
    if (!this.document) return;
    const block = this.document.blocks[blockIndex];
    if (!block) return;
    const blocks = [...this.document.blocks];

    const entries: string[] =
      kind === "list" && block.kind === "list"
        ? [...block.items]
        : (block.kind === "quote" || block.kind === "callout") &&
            (kind === "quote" || kind === "callout")
          ? [...block.paragraphs]
          : [];
    if (entries.length === 0) return;

    const isLast = entryIndex === entries.length - 1;
    let focusInfo: { blockIndex: number; entryIndex: number; kind: typeof kind } | null = null;

    if (isEmpty && isLast && entries.length > 1) {
      // Drop the trailing empty entry and exit the block by
      // splicing a fresh paragraph block after this one.
      entries.pop();
      const updated = this.#withEntries(block, kind, entries);
      if (!updated) return;
      blocks[blockIndex] = updated;
      blocks.splice(blockIndex + 1, 0, { kind: "paragraph", inlineHtml: "" });
      // Focus the new paragraph.
      this.#applyAndFocus(blocks, () => {
        const next = this.querySelector<HTMLElement>(
          `.annot-doc-block-host[data-block-index="${blockIndex + 1}"] [data-annot-block="paragraph"][contenteditable="true"]`,
        );
        next?.focus();
      });
      return;
    }

    // Default: insert a new empty entry after `entryIndex`.
    entries.splice(entryIndex + 1, 0, "");
    const updated = this.#withEntries(block, kind, entries);
    if (!updated) return;
    blocks[blockIndex] = updated;
    focusInfo = { blockIndex, entryIndex: entryIndex + 1, kind };
    this.#applyAndFocus(blocks, () => {
      if (!focusInfo) return;
      const selector =
        focusInfo.kind === "list"
          ? `.annot-doc-block-host[data-block-index="${focusInfo.blockIndex}"] li[data-list-item-index="${focusInfo.entryIndex}"]`
          : focusInfo.kind === "quote"
            ? `.annot-doc-block-host[data-block-index="${focusInfo.blockIndex}"] p[data-quote-paragraph-index="${focusInfo.entryIndex}"]`
            : `.annot-doc-block-host[data-block-index="${focusInfo.blockIndex}"] p[data-callout-paragraph-index="${focusInfo.entryIndex}"]`;
      const next = this.querySelector<HTMLElement>(selector);
      next?.focus();
    });
  }

  #withEntries(block: Block, kind: "list" | "quote" | "callout", entries: string[]): Block | null {
    if (kind === "list" && block.kind === "list") {
      return { ...block, items: entries };
    }
    if (kind === "quote" && block.kind === "quote") {
      return { ...block, paragraphs: entries };
    }
    if (kind === "callout" && block.kind === "callout") {
      return { ...block, paragraphs: entries };
    }
    return null;
  }

  #applyAndFocus(blocks: Block[], focus: () => void): void {
    if (!this.document) return;
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
    queueMicrotask(focus);
  }

  // -------------------------------------------------------------------------
  // Phase 3 — Selection format toolbar
  // -------------------------------------------------------------------------

  #onSelectionChange = (): void => {
    if (!this.editing) {
      AnnotDocSelectionToolbarElement.closeActive();
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      AnnotDocSelectionToolbarElement.closeActive();
      return;
    }
    const range = selection.getRangeAt(0);
    const editable = this.#findEditableAncestor(range.commonAncestorContainer);
    if (!editable || !this.contains(editable)) {
      AnnotDocSelectionToolbarElement.closeActive();
      return;
    }
    const blockHost = editable.closest(".annot-doc-block-host") as HTMLElement | null;
    const blockIndex = blockHost?.getAttribute("data-block-index");
    const block =
      blockIndex !== null && blockIndex !== undefined
        ? this.document?.blocks[Number.parseInt(blockIndex, 10)]
        : null;
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      AnnotDocSelectionToolbarElement.closeActive();
      return;
    }
    AnnotDocSelectionToolbarElement.openFor({
      rect,
      format: {
        bold: this.#queryCommandState("bold"),
        italic: this.#queryCommandState("italic"),
        underline: this.#queryCommandState("underline"),
        link: this.#selectionInsideAnchor(),
      },
      currentBlockKindId: block ? blockKindIdFromBlock(block) : undefined,
    });
  };

  /** Whether the active selection / cursor sits inside an
   *  `<a>` element within an editable block. Used to drive
   *  the link button's pressed state + open-in-edit-mode
   *  affordance. */
  #selectionInsideAnchor(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    let node: Node | null = range.commonAncestorContainer;
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "A") {
        return true;
      }
      node = node.parentNode;
    }
    return false;
  }

  /** Walk up from `node` to find the first ancestor `<a>` —
   *  returns it for editing / removal flows. */
  #findAnchorAncestor(node: Node): HTMLAnchorElement | null {
    let current: Node | null = node;
    while (current) {
      if (current.nodeType === Node.ELEMENT_NODE && (current as Element).tagName === "A") {
        return current as HTMLAnchorElement;
      }
      current = current.parentNode;
    }
    return null;
  }

  #findEditableAncestor(node: Node): HTMLElement | null {
    let current: Node | null = node;
    while (current) {
      if (
        current.nodeType === Node.ELEMENT_NODE &&
        (current as HTMLElement).getAttribute("contenteditable") === "true"
      ) {
        return current as HTMLElement;
      }
      current = current.parentNode;
    }
    return null;
  }

  #queryCommandState(cmd: string): boolean {
    try {
      return document.queryCommandState(cmd);
    } catch {
      return false;
    }
  }

  /** Doc-wide mousedown: when the user clicks outside both the
   *  shell AND the floating selection toolbar, dismiss the
   *  toolbar so it doesn't linger over unrelated UI. The toolbar
   *  itself stops `mousedown` propagation so its own buttons
   *  don't trip this.  */
  #onDocMousedown = (e: MouseEvent): void => {
    const target = e.target as Node | null;
    if (!target) return;
    if (this.contains(target)) return;
    const toolbar = AnnotDocSelectionToolbarElement.getActive();
    if (toolbar?.contains(target)) return;
    AnnotDocSelectionToolbarElement.closeActive();
  };

  /** Doc-wide keydown — Esc dismisses the floating toolbar
   *  without canceling the user's selection. */
  #onDocKeydown = (e: KeyboardEvent): void => {
    // Ctrl+K / Cmd+K — Google-Docs-style "open link dialog"
    // shortcut when the focus is inside one of this shell's
    // editable blocks. Intercept before the contentEditable's
    // own keydown so the browser doesn't navigate the URL bar
    // or trigger an unrelated default.
    const cmdLike = e.ctrlKey || e.metaKey;
    if (cmdLike && (e.key === "k" || e.key === "K") && !e.altKey && !e.shiftKey) {
      const sel = window.getSelection();
      const editable = sel?.anchorNode ? this.#findEditableAncestor(sel.anchorNode) : null;
      if (editable && this.contains(editable)) {
        e.preventDefault();
        document.dispatchEvent(
          new CustomEvent<LinkRequestDetail>("link-request", {
            detail: { editing: this.#selectionInsideAnchor() },
            bubbles: false,
            composed: false,
          }),
        );
        return;
      }
    }
    if (e.key !== "Escape") return;
    if (!AnnotDocSelectionToolbarElement.getActive()) return;
    AnnotDocSelectionToolbarElement.closeActive();
  };

  /** Inline format dispatch from the selection toolbar. We run
   *  the existing browser execCommand path (the same one
   *  Ctrl+B / Ctrl+I / Ctrl+U already triggers) so the
   *  contentEditable mutates exactly the way it would for a
   *  keyboard shortcut. After the mutation lands, we commit so
   *  the inline change pushes a history snapshot. */
  #onFormatChange = (e: CustomEvent<FormatChangeDetail>): void => {
    e.stopPropagation();
    try {
      document.execCommand(e.detail.command);
    } catch {
      // Pre-1.1 happy-dom doesn't implement execCommand; the
      // host-ui test path stubs it where we need it. The browser
      // path is reliable for v1.
    }
    // Sync DOM-side text changes into the model + push a
    // snapshot.
    this.#syncDomIntoDocument();
    this.commit();
    // Refresh the toolbar's pressed-state so the button reflects
    // the new selection state immediately.
    this.#onSelectionChange();
  };

  /** Inline-link dispatch from the selection toolbar. Opens
   *  the link dialog (saving the active selection range first),
   *  applies the user's choice via `createLink` / `unlink`, and
   *  pushes a history snapshot.
   *
   *  Selection survives the dialog open/close round-trip because
   *  the toolbar's `mousedown.preventDefault()` keeps the
   *  contentEditable focused; we still cache the Range so we can
   *  restore it explicitly after the modal closes (the dialog's
   *  text inputs DO move focus away from the editable, even with
   *  the preventDefault). */
  #onLinkRequest = (e: CustomEvent<LinkRequestDetail>): void => {
    e.stopPropagation();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0).cloneRange();
    const existingAnchor = this.#findAnchorAncestor(range.commonAncestorContainer);
    // Default label = the selected text, OR the existing
    // link's text content when editing. Default URL = the
    // existing href when editing, else empty.
    let defaultLabel = "";
    let defaultUrl = "";
    if (existingAnchor) {
      defaultLabel = existingAnchor.textContent ?? "";
      defaultUrl = existingAnchor.getAttribute("href") ?? "";
    } else if (!range.collapsed) {
      defaultLabel = range.toString();
    }
    const allowRemove = existingAnchor !== null;

    void (async () => {
      const { showLinkDialog } = await import("./ui/link-dialog.js");
      const result = await showLinkDialog({ defaultUrl, defaultLabel, allowRemove });
      if (result.action === "cancel") return;
      // Restore the cached range — the dialog moved focus, so
      // we need to put the selection back before execCommand.
      const restored = window.getSelection();
      if (!restored) return;
      // When editing an existing link, select the whole `<a>`
      // so `unlink` + `createLink` work on the entire chip.
      if (existingAnchor) {
        const editRange = document.createRange();
        editRange.selectNode(existingAnchor);
        restored.removeAllRanges();
        restored.addRange(editRange);
      } else {
        restored.removeAllRanges();
        restored.addRange(range);
      }
      if (result.action === "remove") {
        try {
          document.execCommand("unlink");
        } catch {
          // happy-dom may not implement unlink; fall back to
          // tag stripping via the DOM.
          if (existingAnchor) {
            const text = document.createTextNode(existingAnchor.textContent ?? "");
            existingAnchor.replaceWith(text);
          }
        }
      } else {
        // result.action === "save"
        const { url, label } = result.input;
        // If we're editing an existing link, drop the old one
        // first so the new createLink lands cleanly without
        // nesting.
        if (existingAnchor) {
          try {
            document.execCommand("unlink");
          } catch {
            const text = document.createTextNode(existingAnchor.textContent ?? "");
            existingAnchor.replaceWith(text);
          }
        }
        // If the label differs from the current selection text,
        // replace the selection text first so the createLink
        // wraps the new text.
        const currentSelectionText = window.getSelection()?.toString() ?? "";
        if (label !== currentSelectionText) {
          try {
            document.execCommand("insertText", false, label);
          } catch {
            // Fallback: replace via DOM
            const r = window.getSelection()?.getRangeAt(0);
            if (r) {
              r.deleteContents();
              r.insertNode(document.createTextNode(label));
            }
          }
          // Re-select the newly-inserted text so createLink wraps
          // exactly the label.
          const labelRange = document.createRange();
          const editable = this.#findEditableAncestor(
            (window.getSelection()?.anchorNode ?? document.body) as Node,
          );
          if (editable && label.length > 0) {
            // The insertText command placed the cursor right
            // after the inserted text. Walk back by `label.length`
            // to wrap the newly-inserted text. The current
            // selection is collapsed at that position; extend
            // backwards.
            const selAfter = window.getSelection();
            if (selAfter && selAfter.rangeCount > 0) {
              const after = selAfter.getRangeAt(0);
              labelRange.setEnd(after.endContainer, after.endOffset);
              labelRange.setStart(after.endContainer, Math.max(0, after.endOffset - label.length));
              selAfter.removeAllRanges();
              selAfter.addRange(labelRange);
            }
          }
        }
        try {
          document.execCommand("createLink", false, url);
        } catch {
          // Fallback: wrap the selection in an `<a>` manually.
          const r = window.getSelection()?.getRangeAt(0);
          if (r) {
            const a = document.createElement("a");
            a.href = url;
            a.appendChild(r.extractContents());
            r.insertNode(a);
          }
        }
      }
      this.#syncDomIntoDocument();
      this.commit();
      this.#onSelectionChange();
    })();
  };

  /** Block-kind dispatch from the selection toolbar. Replaces the
   *  current block in the document model with a new one of the
   *  chosen kind, preserving the inline HTML where the target
   *  block kind also carries an `inlineHtml`-like field. */
  #onBlockKindChange = (e: CustomEvent<BlockKindChangeDetail>): void => {
    e.stopPropagation();
    if (!this.document) return;
    this.#syncDomIntoDocument();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const editable = this.#findEditableAncestor(range.commonAncestorContainer);
    const blockHost = editable?.closest(".annot-doc-block-host") as HTMLElement | null;
    const indexAttr = blockHost?.getAttribute("data-block-index");
    if (!indexAttr) return;
    const index = Number.parseInt(indexAttr, 10);
    if (Number.isNaN(index)) return;
    const current = this.document.blocks[index];
    if (!current) return;
    const replacement = convertBlockKind(current, e.detail.option);
    if (!replacement) return;
    const blocks = [...this.document.blocks];
    blocks[index] = replacement;
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
    AnnotDocSelectionToolbarElement.closeActive();
  };

  // -------------------------------------------------------------------------
  // TOC
  // -------------------------------------------------------------------------

  #renderToc(headings: readonly HeadingBlock[], ids: Map<HeadingBlock, string>): TemplateResult {
    return html`
      <nav class="annot-doc-toc" aria-label="Document outline">
        <h2 class="annot-doc-toc-title">Contents</h2>
        <ul>
          ${headings.map((h, i) => {
            const id = ids.get(h) ?? "";
            return html`
              <li class="toc-level-${h.level}">
                <a
                  href="#${id}"
                  @click=${(e: MouseEvent) => this.#onTocClick(e, id, i, h)}
                  >${unsafeHTML(h.inlineHtml)}</a
                >
              </li>
            `;
          })}
        </ul>
      </nav>
    `;
  }

  #onTocClick(e: MouseEvent, id: string, index: number, heading: HeadingBlock): void {
    e.preventDefault();
    const target = this.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    this.dispatchEvent(
      new CustomEvent<DocHeadingActivatedDetail>("doc-heading-activated", {
        bubbles: true,
        composed: true,
        detail: { index, text: stripInlineTags(heading.inlineHtml) },
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Block render — read-only
  // -------------------------------------------------------------------------

  #renderBlock(block: Block, ids: Map<HeadingBlock, string>): TemplateResult | typeof nothing {
    return renderBlockBody(block, ids, /* editable */ false);
  }

  // -------------------------------------------------------------------------
  // Block render — editing
  // -------------------------------------------------------------------------

  #renderEditingBlock(
    block: Block,
    index: number,
    ids: Map<HeadingBlock, string>,
    total: number,
  ): TemplateResult {
    return html`
      <div
        class="annot-doc-block-host"
        data-block-index=${index}
        @click=${(e: MouseEvent) => this.#onBlockHostClick(e, index)}
        @change=${(e: Event) => this.#onBlockHostChange(e, index)}
      >
        ${renderBlockBody(block, ids, /* editable */ true)}
        <annot-doc-block-toolbar
          .canMoveUp=${index > 0}
          .canMoveDown=${index < total - 1}
          @block-action=${(e: CustomEvent<BlockToolbarActionDetail>) =>
            this.#onBlockAction(e, index)}
        ></annot-doc-block-toolbar>
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // Image-block click → modal editor
  // -------------------------------------------------------------------------

  /** Phase 3b of card-procedure-template — capture `change`
   *  events from the in-block layout switcher (`<select
   *  data-step-layout-switcher>`). Updates the step's `layout`
   *  field and pushes a history snapshot. Ignores events from
   *  any other source (defensive — the block-host's only other
   *  changeable child is the contentEditable slots which don't
   *  fire `change`). */
  #onBlockHostChange(e: Event, index: number): void {
    if (!this.document) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.matches("[data-step-layout-switcher]")) {
      this.#onStepLayoutChange(target as HTMLSelectElement, index);
      return;
    }
  }

  #onStepLayoutChange(target: HTMLSelectElement, index: number): void {
    if (!this.document) return;
    const block = this.document.blocks[index];
    if (block?.kind !== "step") return;
    const next = target.value;
    if (
      next !== "image-top" &&
      next !== "image-bottom" &&
      next !== "image-left" &&
      next !== "image-right" &&
      next !== "image-fill"
    ) {
      return;
    }
    if (next === block.layout) return;
    this.#syncDomIntoDocument();
    const refreshed = this.document.blocks[index];
    if (refreshed?.kind !== "step") return;
    const blocks = [...this.document.blocks];
    blocks[index] = { ...refreshed, layout: next };
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
  }

  #onBlockHostClick(e: MouseEvent, index: number): void {
    if (!this.document) return;
    const block = this.document.blocks[index];
    if (block?.kind !== "image" && block?.kind !== "step") return;
    const target = e.target as HTMLElement | null;
    // Toolbar lives inside the same host wrapper; clicks on the
    // toolbar buttons must not bubble up into "edit image".
    if (target?.closest("annot-doc-block-toolbar")) return;
    // Phase 5 — figcaption is contentEditable; clicks there
    // (selecting / placing the cursor) must not open the modal.
    if (target?.closest("figcaption[contenteditable='true']")) return;
    // Phase 3 of card-procedure-template — step title + body are
    // contentEditable in editing mode; clicks there must not
    // open the image modal either.
    if (
      target?.closest("[data-step-title][contenteditable='true']") ||
      target?.closest("[data-step-body][contenteditable='true']")
    ) {
      return;
    }
    // Phase 3b — the in-block layout switcher sits inside the
    // same section; clicks on its `<select>` (or the wrapping
    // `<label>`) must not bubble into "edit image".
    if (target?.closest(".annot-doc-step-layout-switcher")) return;
    // Phase 7d-polish — viewport toolbar buttons short-circuit
    // here so they don't open the image modal. The actual
    // action handling lives in `#onArticleClick` (article-level
    // delegate) so it works in BOTH read and editing modes.
    // We return early without `stopPropagation` so the click
    // bubbles up to the article handler.
    if (target?.closest("[data-step-viewport-action]")) return;
    if (block.kind === "step") {
      // Phase 7a — image-less step blocks have no image slot to
      // click on. Defensive guard against a stray click anywhere
      // outside the contentEditable slots opening the editor for
      // an empty SVG.
      if (block.svg.length === 0) return;
      // Phase 7d-polish — drag-just-ended guard. A click that
      // immediately follows a viewport pan should NOT open the
      // image-editor modal; the user was panning, not selecting
      // the image. The controller surfaces `wasDragging()`
      // which stays true until the next pointerdown.
      const ctrl = this.#viewportControllers.get(block.id)?.ctrl;
      if (ctrl?.wasDragging()) return;
      void this.#openStepImageEditor(block, index);
      return;
    }
    void this.#openImageEditor(block, index);
  }

  /** Phase 7d-polish — article-level click delegate. Catches
   *  the viewport toolbar buttons in BOTH read and editing
   *  modes (the editing-mode `#onBlockHostClick` handler only
   *  fires inside `.annot-doc-block-host` wrappers, which read
   *  mode doesn't render).
   *
   *  Zoom-in / zoom-out / reset-view are ephemeral and run in
   *  read mode too. Save / clear mutate the model and are
   *  gated to the editing state — read-mode users can still
   *  see those buttons inside the toolbar template but they
   *  shouldn't appear there because `renderViewportToolbar`
   *  filters them by `editable`. */
  #onArticleClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    const viewportBtn = target?.closest("[data-step-viewport-action]") as HTMLElement | null;
    if (!viewportBtn) return;
    // Find the enclosing step block (`<section data-annot-
    // block="step" data-annot-image-id="...">`) so we can pick
    // the right controller / block index.
    const section = viewportBtn.closest('[data-annot-block="step"]') as HTMLElement | null;
    if (!section) return;
    const blockId = section.getAttribute("data-annot-image-id");
    if (!blockId) return;
    e.preventDefault();
    e.stopPropagation();
    const ctrl = this.#viewportControllers.get(blockId)?.ctrl;
    const action = viewportBtn.getAttribute("data-step-viewport-action");
    if (action === "zoom-in") {
      ctrl?.zoomBy(1 / 1.25);
      return;
    }
    if (action === "zoom-out") {
      ctrl?.zoomBy(1.25);
      return;
    }
    if (action === "reset-view") {
      ctrl?.reset();
      return;
    }
    // Save + clear are editing-mode-only — find the matching
    // block index in the model.
    if (action === "save" || action === "clear") {
      if (!this.document) return;
      const idx = this.document.blocks.findIndex((b) => b.kind === "step" && b.id === blockId);
      if (idx < 0) return;
      const block = this.document.blocks[idx];
      if (block?.kind !== "step") return;
      if (action === "save") this.#saveStepViewport(block, idx);
      else this.#resetStepViewport(block, idx);
    }
  }

  /** Phase 7d — capture the current pan/zoom state from the
   *  block's image slot and write it into `block.viewport`.
   *  Pushes a history snapshot so the user can Cmd-Z if they
   *  saved by accident. */
  #saveStepViewport(block: StepBlock, index: number): void {
    if (!this.document) return;
    const ctrl = this.#viewportControllers.get(block.id)?.ctrl;
    if (!ctrl) return;
    const current = ctrl.current();
    // Skip when the saved viewport is already equal to the
    // current state (avoid a no-op history entry).
    const existing = block.viewport;
    if (
      existing &&
      existing.x === current.x &&
      existing.y === current.y &&
      existing.w === current.w &&
      existing.h === current.h
    ) {
      return;
    }
    this.#syncDomIntoDocument();
    const refreshed = this.document.blocks[index];
    if (refreshed?.kind !== "step") return;
    const blocks = [...this.document.blocks];
    blocks[index] = { ...refreshed, viewport: current };
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
  }

  /** Phase 7d — clear the saved viewport AND reset the live
   *  controller back to the full image (the SVG's intrinsic
   *  viewBox, not the controller's saved initial). */
  #resetStepViewport(block: StepBlock, index: number): void {
    if (!this.document) return;
    const ctrl = this.#viewportControllers.get(block.id)?.ctrl;
    // Phase 7d-polish 2: snap back to the "no viewport saved"
    // default — the top-left-anchored 16:9 sub-rect inside the
    // intrinsic bitmap. With targetAspect locked at 16:9 this
    // matches what a freshly-attached controller (with no saved
    // viewport) would show, so the user gets the same view as
    // on first open.
    if (ctrl) ctrl.reset(ctrl.defaultRect());
    this.#syncDomIntoDocument();
    const refreshed = this.document.blocks[index];
    if (refreshed?.kind !== "step") return;
    if (refreshed.viewport === undefined) return;
    const blocks = [...this.document.blocks];
    const { viewport: _omit, ...rest } = refreshed;
    blocks[index] = rest;
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
  }

  async #openImageEditor(block: ImageBlock, index: number): Promise<void> {
    if (!this.document) return;
    // Phase 6 of `annot-html-document-ux-polish.md` — surface the
    // "Editing image N of M" context to the modal so users know
    // where they are. N / M are computed over IMAGE blocks only
    // (text-bearing blocks don't count toward the position).
    const imageBlocks = this.document.blocks
      .map((b, i) => ({ block: b, i }))
      .filter((entry) => entry.block.kind === "image");
    const positionInImages = imageBlocks.findIndex((entry) => entry.i === index) + 1;
    const totalImages = imageBlocks.length;
    const result = await AnnotDocImageEditorModalElement.openFor({
      id: block.id,
      svg: block.svg,
      positionInImages,
      totalImages,
      ...(block.sourceImagePath !== undefined ? { sourceImagePath: block.sourceImagePath } : {}),
    });
    if (result.kind !== "save") return;
    if (!this.document) return;
    const blocks = [...this.document.blocks];
    const target = blocks[index];
    if (target?.kind !== "image") return;
    // Phase 5 — when the modal returns `unlinked: true`, drop the
    // block's `sourceImagePath` as part of the same history entry
    // that carries the SVG edit. `#pushLinkedImageIfLinked` then
    // sees an unlinked block and skips the gallery push.
    let refreshed: ImageBlock;
    if (result.unlinked === true) {
      const { sourceImagePath: _drop, ...rest } = target;
      refreshed = { ...rest, svg: result.svg };
    } else {
      refreshed = { ...target, svg: result.svg };
    }
    blocks[index] = refreshed;
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
    // Phase 2 of `card-document-image-gallery-link-sync.md` —
    // when the block is linked to a gallery `ImageRecord`, hand
    // the host the decomposed payload so it can write the bitmap
    // + annotation fragment back through `storage.updateImage`.
    // Awaited so the dead-link unlink completes before the user's
    // next edit; the modal itself has already closed.
    await this.#pushLinkedImageIfLinked(refreshed, result.svg, index, "image");
  }

  /** Phase 3 of card-procedure-template — step block image edit.
   *  Mirrors `#openImageEditor`; the only difference is the block
   *  shape (StepBlock vs ImageBlock) on save. */
  async #openStepImageEditor(block: StepBlock, index: number): Promise<void> {
    if (!this.document) return;
    // Step blocks count toward the same "image N of M" tally as
    // standalone image blocks — both kinds carry editable
    // `<svg data-annot-version>` content. Phase 7a: image-less
    // step blocks (empty `svg`) are excluded — they have nothing
    // to edit and would skew the position count.
    const imageBearing = this.document.blocks
      .map((b, i) => ({ block: b, i }))
      .filter(
        (entry) =>
          entry.block.kind === "image" ||
          (entry.block.kind === "step" && entry.block.svg.length > 0),
      );
    const positionInImages = imageBearing.findIndex((entry) => entry.i === index) + 1;
    const totalImages = imageBearing.length;
    const result = await AnnotDocImageEditorModalElement.openFor({
      id: block.id,
      svg: block.svg,
      positionInImages,
      totalImages,
      ...(block.sourceImagePath !== undefined ? { sourceImagePath: block.sourceImagePath } : {}),
    });
    if (result.kind !== "save") return;
    if (!this.document) return;
    const blocks = [...this.document.blocks];
    const target = blocks[index];
    if (target?.kind !== "step") return;
    // Phase 5 — mirror the unlink handling from `#openImageEditor`
    // (see comment there for the rationale).
    let refreshed: StepBlock;
    if (result.unlinked === true) {
      const { sourceImagePath: _drop, ...rest } = target;
      refreshed = { ...rest, svg: result.svg };
    } else {
      refreshed = { ...target, svg: result.svg };
    }
    blocks[index] = refreshed;
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
    // See `#openImageEditor` — symmetrical push for step blocks.
    await this.#pushLinkedImageIfLinked(refreshed, result.svg, index, "step");
  }

  /** Phase 3 — gallery → doc pull pass. Fired by `willUpdate`
   *  the first time the shell observes a fresh, externally-set
   *  `document`. For each linked block (those carrying
   *  `sourceImagePath`), calls the host's `pullLinkedImage`
   *  callback and compares the returned gallery state with the
   *  block's inlined SVG. When they diverge, the block is
   *  re-embedded with a freshly-built SVG from the gallery
   *  state; once the whole pass finishes, a single
   *  `gallery-sync` history push lands plus a
   *  `linked-images-synced` event so the host can toast one
   *  line per refreshed block.
   *
   *  Phase 4 extends this with an optional `filterPath` argument
   *  — when set, only blocks whose `sourceImagePath` equals the
   *  filter are considered. This is the entry point for the
   *  `annot-metadata-changed` `kind: "path"` event handler:
   *  re-pull just the affected block(s) instead of running the
   *  full document sweep on every gallery edit.
   *
   *  Idempotent: if no block diverged the pass is a complete
   *  no-op — no history push, no event. Dead-link / error
   *  results leave the block alone (the user-visible badge for
   *  dead links is a Phase 5 concern). */
  async #pullLinkedImagesPass(initialDoc: AnnotDocument, filterPath?: string): Promise<void> {
    const pull = this.pullLinkedImage;
    if (!pull) return;
    // Collect (index, block, sourceImagePath) for every linked
    // image / step block in the initial snapshot. The pass runs
    // against this snapshot — concurrent user edits land on the
    // current `this.document` and aren't clobbered because we
    // re-read the latest doc before applying (see below).
    const linkedTargets: Array<{
      index: number;
      blockId: string;
      sourceImagePath: string;
      kind: "image" | "step";
    }> = [];
    initialDoc.blocks.forEach((block, index) => {
      if (block.kind === "image" && block.sourceImagePath !== undefined) {
        if (filterPath !== undefined && block.sourceImagePath !== filterPath) return;
        linkedTargets.push({
          index,
          blockId: block.id,
          sourceImagePath: block.sourceImagePath,
          kind: "image",
        });
      } else if (
        block.kind === "step" &&
        block.sourceImagePath !== undefined &&
        block.svg.length > 0
      ) {
        if (filterPath !== undefined && block.sourceImagePath !== filterPath) return;
        linkedTargets.push({
          index,
          blockId: block.id,
          sourceImagePath: block.sourceImagePath,
          kind: "step",
        });
      }
    });
    if (linkedTargets.length === 0) return;

    // Fan out the pulls concurrently — typical doc has 1-30 linked
    // blocks; running them in parallel keeps the pass under the
    // first-render budget. Failed / dead-link results are skipped
    // silently.
    const galleryResults = await Promise.all(
      linkedTargets.map(async (target) => {
        try {
          return { target, result: await pull(target.sourceImagePath) };
        } catch {
          return {
            target,
            result: { status: "error" as const } satisfies LinkedImagePullResult,
          };
        }
      }),
    );

    // Apply against the LATEST `this.document` (the user may
    // have undone / redone / typed while the pulls were in
    // flight). If the document changed identity mid-pass we
    // bail rather than overwrite the user's work; the next
    // doc-load will re-trigger the pass.
    if (this.document !== initialDoc) return;
    const currentDoc = this.document;
    if (!currentDoc) return;
    const updated: Array<{ blockId: string; sourceImagePath: string }> = [];
    let blocks: Block[] | null = null;
    for (const { target, result } of galleryResults) {
      if (result.status !== "found") continue;
      const source = blocks ?? currentDoc.blocks;
      const block = source[target.index];
      // Block may have shifted between snapshot + pass return if
      // a concurrent edit reordered the list. Match by id so we
      // don't accidentally re-embed a different image into the
      // wrong slot.
      if (!block || block.kind !== target.kind || block.id !== target.blockId) continue;
      if (block.svg.length === 0) continue;
      const parts = decomposeBlockSvg(block.svg);
      const inSync =
        parts.originalDataUrl === result.originalDataUrl &&
        parts.width === result.width &&
        parts.height === result.height &&
        annotationChildrenEqual(parts.annotationsSvg, result.annotationsSvg);
      if (inSync) continue;
      const refreshedSvg = buildBlockSvg({
        originalDataUrl: result.originalDataUrl,
        annotationsSvg: result.annotationsSvg,
        width: result.width,
        height: result.height,
      });
      if (blocks === null) blocks = [...currentDoc.blocks];
      blocks[target.index] = { ...block, svg: refreshedSvg };
      updated.push({ blockId: target.blockId, sourceImagePath: target.sourceImagePath });
    }
    if (blocks === null) return;
    const newDoc: AnnotDocument = { ...currentDoc, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "gallery-sync");
    this.dispatchEvent(
      new CustomEvent<LinkedImagesSyncedDetail>("linked-images-synced", {
        bubbles: true,
        composed: true,
        detail: { updated },
      }),
    );
  }

  /** Phase 4 — translate a same-tab / cross-tab
   *  `annot-metadata-changed` event into a targeted live pull.
   *  `kind: "path"` is the only event the shell reacts to:
   *  re-pull just that path against the host's storage and
   *  re-embed the matching block(s) when they diverge.
   *
   *  Listing / prefix events are ignored — they fire on listing
   *  reshape (folder rename) but not on individual image edits,
   *  and a doc-mode renderer doesn't expose the gallery listing.
   *  Prefix events from `forceRefresh` / plugin-uninstall paths
   *  intentionally bypass this layer; the next doc-open's full
   *  pull pass catches up.
   *
   *  The shell does NOT filter by namespace — `pullLinkedImage`
   *  resolves against the active storage, so an event from a
   *  non-active namespace falls through to a `dead-link` reply
   *  (silently ignored). Multi-storage-tab setups are rare; if
   *  they become a real concern we can plumb the active
   *  namespace through later. */
  #handleMetadataChanged(e: Event): void {
    const detail = (e as CustomEvent<MetadataChangedDetail>).detail;
    if (!detail || detail.kind !== "path") return;
    const doc = this.document;
    if (!doc) return;
    // Quick scan for matching linked blocks; bail when none.
    const hasMatch = doc.blocks.some(
      (b) => (b.kind === "image" || b.kind === "step") && b.sourceImagePath === detail.path,
    );
    if (!hasMatch) return;
    void this.#pullLinkedImagesPass(doc, detail.path);
  }

  /** Phase 2 — doc → gallery push helper. No-op when:
   *
   *   - the host hasn't installed a `pushLinkedImage` callback,
   *   - the block has no `sourceImagePath` (doc-only block),
   *   - decomposition produces an empty `originalDataUrl` (the
   *     saved SVG had no recognisable base bitmap — defensive,
   *     should not happen with editor-produced output).
   *
   *  On the `"dead-link"` reply, strip `sourceImagePath` from
   *  the block so the next edit doesn't keep poking at a missing
   *  gallery record. The strip lands as its own history entry —
   *  the user can undo it back to "still linked" state if the
   *  gallery record reappears (rename / unmove).
   *
   *  On `"error"` and `"synced"` no further mutation runs; the
   *  host owns user-facing messaging (toast). */
  async #pushLinkedImageIfLinked(
    block: ImageBlock | StepBlock,
    savedSvg: string,
    index: number,
    kind: "image" | "step",
  ): Promise<void> {
    const push = this.pushLinkedImage;
    if (!push) return;
    const sourceImagePath = block.sourceImagePath;
    if (sourceImagePath === undefined || sourceImagePath.length === 0) return;
    const parts = decomposeBlockSvg(savedSvg);
    if (parts.originalDataUrl.length === 0) return;
    let result: LinkedImagePushResult;
    try {
      result = await push({
        blockId: block.id,
        sourceImagePath,
        originalDataUrl: parts.originalDataUrl,
        annotationsSvg: parts.annotationsSvg,
        width: parts.width,
        height: parts.height,
      });
    } catch {
      // Host-side throw is treated as a transient error — leave
      // the link in place so the next edit retries. The host has
      // already logged / toasted; the shell stays quiet.
      return;
    }
    if (result !== "dead-link") return;
    // Strip `sourceImagePath` from the block. We re-find by index
    // since the doc may have shifted under us between the push
    // dispatch and the await landing (history.push earlier ran an
    // `#applyInternal`, but no other handler is mid-flight here).
    if (!this.document) return;
    const blocks = [...this.document.blocks];
    const target = blocks[index];
    if (kind === "image" && target?.kind === "image") {
      const { sourceImagePath: _drop, ...rest } = target;
      blocks[index] = rest;
    } else if (kind === "step" && target?.kind === "step") {
      const { sourceImagePath: _drop, ...rest } = target;
      blocks[index] = rest;
    } else {
      return;
    }
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
  }
}

customElements.define("annot-doc-shell", AnnotDocShellElement);

declare global {
  interface HTMLElementTagNameMap {
    "annot-doc-shell": AnnotDocShellElement;
  }
}

// ---------------------------------------------------------------------------
// Block body rendering — shared between read-only and editing modes.
// ---------------------------------------------------------------------------

function renderBlockBody(
  block: Block,
  ids: Map<HeadingBlock, string>,
  editable: boolean,
): TemplateResult | typeof nothing {
  switch (block.kind) {
    case "heading":
      return renderHeading(block, ids.get(block) ?? "", editable);
    case "paragraph":
      return renderParagraph(block, editable);
    case "list":
      return renderList(block, editable);
    case "code":
      return renderCode(block);
    case "quote":
      return renderQuote(block, editable);
    case "callout":
      return renderCallout(block, editable);
    case "divider":
      return html`<hr data-annot-block="divider" />`;
    case "image":
      return renderImage(block, editable);
    case "step":
      return renderStep(block, editable);
    case "unknown":
      return html`${unsafeHTML(block.rawHtml)}`;
  }
}

function renderHeading(block: HeadingBlock, id: string, editable: boolean): TemplateResult {
  // Editing mode: render an EMPTY contenteditable element. The
  // body is populated imperatively in `updated()`. Why: Lit's
  // template parts use comment-marker nodes inside the element to
  // patch dynamic content. The user's contentEditable interactions
  // may rip those markers out (e.g. on whole-line `innerHTML =`
  // replacements). When that happens, the next Lit render throws
  // "ChildPart has no parentNode". Keeping Lit out of the editable
  // body sidesteps the conflict entirely.
  if (editable) {
    if (block.level === 1) {
      return html`<h1
        id=${id}
        contenteditable="true"
        data-annot-block="heading"
        data-level="1"
      ></h1>`;
    }
    if (block.level === 2) {
      return html`<h2
        id=${id}
        contenteditable="true"
        data-annot-block="heading"
        data-level="2"
      ></h2>`;
    }
    return html`<h3
      id=${id}
      contenteditable="true"
      data-annot-block="heading"
      data-level="3"
    ></h3>`;
  }
  const inner = unsafeHTML(block.inlineHtml);
  if (block.level === 1) {
    return html`<h1
      id=${id}
      data-annot-block="heading"
      data-level="1"
    >${inner}</h1>`;
  }
  if (block.level === 2) {
    return html`<h2
      id=${id}
      data-annot-block="heading"
      data-level="2"
    >${inner}</h2>`;
  }
  return html`<h3
    id=${id}
    data-annot-block="heading"
    data-level="3"
  >${inner}</h3>`;
}

function renderParagraph(block: { inlineHtml: string }, editable: boolean): TemplateResult {
  if (editable) {
    // Body populated imperatively; see comment in `renderHeading`.
    return html`<p contenteditable="true" data-annot-block="paragraph"></p>`;
  }
  return html`<p data-annot-block="paragraph">${unsafeHTML(block.inlineHtml)}</p>`;
}

function renderList(block: ListBlock, editable: boolean): TemplateResult {
  // Phase 5 of `annot-html-document-ux-polish.md` — each `<li>`
  // becomes contentEditable individually. Like the heading +
  // paragraph paths, the body is populated imperatively in
  // `updated()` so Lit's child-part markers stay out of the
  // editable region. Editing-mode renders empty `<li>` shells
  // with `data-list-item-index=N` so sync + `updated` can map
  // each `<li>` back to `items[N]`.
  const items = editable
    ? block.items.map(
        (_, idx) => html`<li contenteditable="true" data-list-item-index=${idx}></li>`,
      )
    : block.items.map((it) => html`<li>${unsafeHTML(it)}</li>`);
  if (block.ordered) {
    return html`
      <ol
        data-annot-block="list"
        data-list-style=${block.listStyle}
        start=${block.start ?? nothing}
      >
        ${items}
      </ol>
    `;
  }
  return html`
    <ul data-annot-block="list" data-list-style=${block.listStyle}>
      ${items}
    </ul>
  `;
}

function renderQuote(block: { paragraphs: readonly string[] }, editable: boolean): TemplateResult {
  // Phase 5 — quote inner paragraphs become individually editable.
  // The `<blockquote>` wrapper stays read-only (decorative).
  const paras = editable
    ? block.paragraphs.map(
        (_, idx) => html`<p contenteditable="true" data-quote-paragraph-index=${idx}></p>`,
      )
    : block.paragraphs.map((p) => html`<p>${unsafeHTML(p)}</p>`);
  return html`
    <blockquote data-annot-block="quote">
      ${paras}
    </blockquote>
  `;
}

function renderCallout(
  block: { tone: string; paragraphs: readonly string[] },
  editable: boolean,
): TemplateResult {
  // Phase 5 — callout inner paragraphs become individually editable.
  const paras = editable
    ? block.paragraphs.map(
        (_, idx) => html`<p contenteditable="true" data-callout-paragraph-index=${idx}></p>`,
      )
    : block.paragraphs.map((p) => html`<p>${unsafeHTML(p)}</p>`);
  return html`
    <aside data-annot-block="callout" data-tone=${block.tone}>
      ${paras}
    </aside>
  `;
}

function renderCode(block: { lang?: string; text: string }): TemplateResult {
  if (block.lang !== undefined) {
    return html`<pre data-annot-block="code" data-lang=${block.lang}><code>${block.text}</code></pre>`;
  }
  return html`<pre data-annot-block="code"><code>${block.text}</code></pre>`;
}

function renderImage(block: ImageBlock, editable = false): TemplateResult {
  // Phase 5 of `annot-html-document-ux-polish.md` — figcaption is
  // contentEditable in editing mode. The SVG above stays
  // click-to-edit-modal as today (only the caption is touched
  // here). The figcaption renders even when `caption` is
  // undefined so users can add one in-place; the empty-paragraph
  // placeholder doesn't apply (figcaptions live in their own
  // selector tree).
  //
  // Phase 10 of `annot-html-document-ux-polish.md` — figure
  // body is a placeholder slot the shell's IntersectionObserver
  // pipeline materialises lazily. The slot carries an
  // `aspect-ratio` style derived from the SVG's viewBox so the
  // page lays out at the right height before the SVG mounts;
  // `data-annot-image-svg` is the bytes the shell will inline
  // once the figure intersects within ~200vh of the viewport.
  // Test environments without `IntersectionObserver` (happy-dom
  // pre-1.x) materialise eagerly via the same path so the
  // existing tests don't see a regression.
  const aspect = extractSvgAspectRatio(block.svg);
  const slotStyle = aspect
    ? `aspect-ratio: ${aspect}; background: var(--annot-doc-code-bg, #f3f4f6);`
    : "";
  if (editable) {
    return html`
      <figure data-annot-block="image" data-annot-image-id=${block.id}>
        <div
          class="annot-doc-image-svg-slot"
          data-annot-image-svg=${block.svg}
          style=${slotStyle}
        ></div>
        <figcaption contenteditable="true" data-annot-figcaption></figcaption>
      </figure>
    `;
  }
  return html`
    <figure data-annot-block="image" data-annot-image-id=${block.id}>
      <div
        class="annot-doc-image-svg-slot"
        data-annot-image-svg=${block.svg}
        style=${slotStyle}
      ></div>
      ${
        block.caption !== undefined
          ? html`<figcaption>${unsafeHTML(block.caption)}</figcaption>`
          : nothing
      }
    </figure>
  `;
}

/** Phase 1 + 3 of `docs/plans/_done/card-procedure-template.md` —
 *  step-block renderer. Phase 1 shipped the read-only minimal
 *  render; Phase 3 layers in the editing affordances:
 *
 *    - `<h3 data-step-title>` and `<p data-step-body>` become
 *      `contenteditable="true"` in editing mode; the shell's
 *      `#syncDomIntoDocument` + `#populateContentEditables`
 *      pipeline keeps the model in sync with the DOM.
 *    - The SVG slot keeps its lazy-materialisation machinery
 *      shared with image blocks; clicking it opens the same
 *      `<annot-doc-image-editor-modal>` the image block uses.
 *
 *  Card chrome + per-layout grid live in `injectDocumentStyles`
 *  (Phase 2); this function only emits the bare HTML structure. */
function renderStep(block: StepBlock, editable: boolean): TemplateResult {
  // Phase 7a of `docs/plans/_done/card-procedure-template.md` — an empty
  // `block.svg` marks an image-less step (text-only narrative
  // card). The image slot is omitted entirely; the `data-step-
  // image-less="1"` attribute lets `injectDocumentStyles` collapse
  // the layout grid to a single text area regardless of the
  // declared `data-step-layout`.
  const imageless = block.svg.length === 0;
  // Phase 7d-polish: the slot's aspect ratio is now fixed to
  // 16:9 in CSS (`injectDocumentStyles`), matching the PPTX
  // slide canvas and giving multi-column card grids uniform
  // row heights. The inline `aspect-ratio` style is no longer
  // needed — the SVG inside the slot uses its viewBox +
  // default `preserveAspectRatio="xMidYMid meet"` to letterbox
  // any non-16:9 source.
  const imageSlot = imageless
    ? null
    : html`<div class="annot-doc-image-svg-slot" data-annot-image-svg=${block.svg}></div>`;
  if (editable) {
    // Editing mode: empty contentEditable elements. The bodies
    // are populated imperatively in `updated()` (same strategy
    // heading / paragraph use) so the cursor / IME state
    // survives re-renders. The empty elements are caret targets
    // immediately.
    //
    // The layout switcher sits at the top-right corner of the
    // card (position: absolute via the host CSS). It carries the
    // current `block.layout` as the selected option and uses a
    // `data-step-layout-switcher` marker so the block-host's
    // `@change` listener can identify the event source.
    if (imageless) {
      return html`
        <section
          data-annot-block="step"
          data-annot-image-id=${block.id}
          data-step-layout=${block.layout}
          data-step-image-less="1"
        >
          <h3 data-step-title contenteditable="true"></h3>
          <p data-step-body contenteditable="true"></p>
          <label class="annot-doc-step-layout-switcher" aria-label="Card layout">
            <select data-step-layout-switcher .value=${block.layout}>
              <option value="image-top">Image top</option>
              <option value="image-bottom">Image bottom</option>
              <option value="image-left">Image left</option>
              <option value="image-right">Image right</option>
              <option value="image-fill">Image fill</option>
            </select>
          </label>
        </section>
      `;
    }
    return html`
      <section
        data-annot-block="step"
        data-annot-image-id=${block.id}
        data-step-layout=${block.layout}
      >
        ${imageSlot}
        ${renderViewportToolbar(block, /* editable */ true)}
        <h3 data-step-title contenteditable="true"></h3>
        <p data-step-body contenteditable="true"></p>
        <label class="annot-doc-step-layout-switcher" aria-label="Card layout">
          <select data-step-layout-switcher .value=${block.layout}>
            <option value="image-top">Image top</option>
            <option value="image-bottom">Image bottom</option>
            <option value="image-left">Image left</option>
            <option value="image-right">Image right</option>
            <option value="image-fill">Image fill</option>
          </select>
        </label>
      </section>
    `;
  }
  if (imageless) {
    return html`
      <section
        data-annot-block="step"
        data-annot-image-id=${block.id}
        data-step-layout=${block.layout}
        data-step-image-less="1"
      >
        <h3 data-step-title>${unsafeHTML(block.title)}</h3>
        <p data-step-body>${unsafeHTML(block.body)}</p>
      </section>
    `;
  }
  return html`
    <section
      data-annot-block="step"
      data-annot-image-id=${block.id}
      data-step-layout=${block.layout}
    >
      ${imageSlot}
      ${renderViewportToolbar(block, /* editable */ false)}
      <h3 data-step-title>${unsafeHTML(block.title)}</h3>
      <p data-step-body>${unsafeHTML(block.body)}</p>
    </section>
  `;
}

/** Phase 7d — viewport toolbar pinned to the top-left corner
 *  of the step's image area. Carries:
 *
 *    - Zoom in / zoom out / reset-to-initial buttons (visible
 *      in both view AND edit modes — wheel-only zoom was hard
 *      to operate, so Phase 7d-polish surfaces explicit UI).
 *    - Edit mode only: "Save view" / "Update view" button that
 *      captures the controller's current viewBox state into
 *      `block.viewport`.
 *    - Edit mode only: "Clear" button (when a saved viewport
 *      exists) that drops `block.viewport` and snaps the
 *      controller back to the intrinsic (full image) viewBox.
 *
 *  The buttons fire `click` events with `data-step-viewport-
 *  action` markers; the shell's `@click` delegate routes them
 *  through `#onStepViewportAction`. */
function renderViewportToolbar(block: StepBlock, editable: boolean): TemplateResult {
  return html`
    <div
      data-step-viewport-controls
      class="annot-doc-step-viewport-controls"
      aria-label="Image viewport controls"
    >
      <button
        type="button"
        data-step-viewport-action="zoom-in"
        aria-label="Zoom in"
        title="Zoom in"
      >+</button>
      <button
        type="button"
        data-step-viewport-action="zoom-out"
        aria-label="Zoom out"
        title="Zoom out"
      >−</button>
      <button
        type="button"
        data-step-viewport-action="reset-view"
        aria-label="Reset view"
        title="Reset view (back to saved initial)"
      >⟲</button>
      ${
        editable
          ? html`<button
              type="button"
              data-step-viewport-action="save"
              title="Save current view as the initial display state"
            >
              ${block.viewport ? "Update" : "Save"}
            </button>`
          : nothing
      }
      ${
        editable && block.viewport
          ? html`<button
              type="button"
              data-step-viewport-action="clear"
              title="Clear saved view (show the full image)"
            >
              Clear
            </button>`
          : nothing
      }
    </div>
  `;
}

/** Phase 10 — inline the SVG bytes carried in
 *  `data-annot-image-svg` and clear the attribute so subsequent
 *  passes (e.g. on document edit re-renders) don't re-parse it.
 *  Idempotent: a slot whose attribute has already been cleared
 *  short-circuits at the `getAttribute` check.
 *
 *  Phase 7d-polish 3: strip the leading `<?xml ?>` processing
 *  instruction + any whitespace before the `<svg>` root.
 *  `exportSVGString` (the modal-save path) prepends
 *  `<?xml version="1.0" encoding="UTF-8"?>\n` to its output —
 *  great for standalone `.annot.svg` files, but when set as
 *  `slot.innerHTML` the trailing newline becomes a text node
 *  ABOVE the SVG and the slot's inherited line-height pushes
 *  the SVG down by ~20px. Visible as a grey bar at the top of
 *  cards whose annotations have been edited via the modal
 *  (unannotated cards generated by `create-card-document` don't
 *  carry the prefix, so they don't have the gap — explaining
 *  the user-reported annotated-vs-unannotated difference). */
function materialiseImageSlot(slot: HTMLElement): void {
  const raw = slot.getAttribute("data-annot-image-svg");
  if (!raw) return;
  // Drop any `<?xml ?>` declaration plus trailing whitespace so
  // the slot's first child is the `<svg>` element, not a text
  // node. Idempotent / safe when the prefix is already absent.
  const svg = raw.replace(/^\s*<\?xml[^?]*\?>\s*/, "").trimStart();
  slot.innerHTML = svg;
  // User-reported regression: annotated step cards (the ones
  // whose `block.svg` came from `exportSVGString`) showed a ~20px
  // grey strip above the SVG even after the `<?xml ?>` prefix
  // strip. Live-browser HTML parsing of XMLSerializer-produced
  // SVG can leave inter-element whitespace / comment nodes BEFORE
  // the `<svg>` child inside the slot, and the slot's default
  // line-height pushes the SVG down. Defensively peel any non-
  // `<svg>` child node off so the slot's first (and only) child
  // is the `<svg>` element. Pairs with the `position: absolute;
  // inset: 0` rule on the inner SVG (inject-styles.ts) — the CSS
  // pins the SVG to top:0 even if a stray node slips past, but
  // we also keep the DOM clean so the markup matches the visual.
  for (const child of Array.from(slot.childNodes)) {
    const isSvgElement =
      child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName.toLowerCase() === "svg";
    if (!isSvgElement) child.remove();
  }
  slot.removeAttribute("data-annot-image-svg");
  // The aspect-ratio style stops being load-bearing once the
  // SVG is in — clearing it lets the SVG's intrinsic size
  // govern layout (matches the pre-Phase-10 sizing).
  slot.style.removeProperty("aspect-ratio");
  slot.style.removeProperty("background");
}

/** Phase 10 — derive a CSS `aspect-ratio` value (`W / H`) from
 *  the SVG's `viewBox` (or `width`/`height`) so the slot reserves
 *  layout space before the bytes materialise. Returns `null` if
 *  the dimensions can't be parsed; the slot then sizes from
 *  whatever content it gets at materialisation time. */
function extractSvgAspectRatio(svg: string): string | null {
  // Prefer viewBox — works regardless of `width="100%"` etc.
  const vbMatch = svg.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (vbMatch) {
    const parts = vbMatch[1]?.trim().split(/\s+/).map(Number) ?? [];
    if (parts.length === 4) {
      const [, , w, h] = parts;
      if (w !== undefined && h !== undefined && w > 0 && h > 0) return `${w} / ${h}`;
    }
  }
  // Fall back to width / height attributes — only useful when
  // both are pixel values.
  const wMatch = svg.match(/<svg\b[^>]*\swidth\s*=\s*"(\d+(?:\.\d+)?)/i);
  const hMatch = svg.match(/<svg\b[^>]*\sheight\s*=\s*"(\d+(?:\.\d+)?)/i);
  if (wMatch && hMatch) {
    const w = Number.parseFloat(wMatch[1] ?? "");
    const h = Number.parseFloat(hMatch[1] ?? "");
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return `${w} / ${h}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHeadingIdMap(headings: readonly HeadingBlock[]): Map<HeadingBlock, string> {
  const map = new Map<HeadingBlock, string>();
  headings.forEach((h, i) => {
    map.set(h, `annot-doc-heading-${i}`);
  });
  return map;
}

/** Best-effort plain-text extraction from canonical inline HTML
 *  for use in event details / aria labels. Strips tags only —
 *  doesn't decode entities, since the canonical form has only
 *  the standard `&lt;` / `&gt;` / `&amp;` triple. */
function stripInlineTags(inlineHtml: string): string {
  return inlineHtml
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Pull DOM state back into a block. Phase 4a covers heading +
 *  paragraph; other kinds round-trip unchanged. Returns the same
 *  object reference when nothing changed, so callers can detect
 *  no-ops cheaply via `!==`. */
function syncBlockFromDom(wrapper: HTMLElement, block: Block): Block {
  const blockEl = wrapper.querySelector("[data-annot-block]") as HTMLElement | null;
  if (!blockEl) return block;
  if (block.kind === "heading" || block.kind === "paragraph") {
    const inlineHtml = blockEl.innerHTML;
    if (inlineHtml === block.inlineHtml) return block;
    return { ...block, inlineHtml };
  }
  // Phase 5 of `annot-html-document-ux-polish.md` — extend the
  // sync to the multi-paragraph + list + figcaption block kinds.
  // Reads each child editable's innerHTML in document order;
  // identity preserved when nothing changed (callers detect
  // no-op via `!==`).
  if (block.kind === "list") {
    const liEls = Array.from(blockEl.querySelectorAll<HTMLElement>("li[contenteditable='true']"));
    if (liEls.length !== block.items.length) return block;
    const next = liEls.map((el) => el.innerHTML);
    if (next.every((html, i) => html === block.items[i])) return block;
    return { ...block, items: next };
  }
  if (block.kind === "quote" || block.kind === "callout") {
    const pEls = Array.from(blockEl.querySelectorAll<HTMLElement>("p[contenteditable='true']"));
    if (pEls.length !== block.paragraphs.length) return block;
    const next = pEls.map((el) => el.innerHTML);
    if (next.every((html, i) => html === block.paragraphs[i])) return block;
    return { ...block, paragraphs: next };
  }
  if (block.kind === "image") {
    const figcaption = blockEl.querySelector(
      "figcaption[contenteditable='true']",
    ) as HTMLElement | null;
    if (!figcaption) return block;
    const html = figcaption.innerHTML;
    // Empty figcaption → drop the field entirely so the
    // serializer doesn't emit an empty `<figcaption>` element.
    if (html.trim() === "") {
      if (block.caption === undefined) return block;
      const { caption: _, ...rest } = block;
      return rest;
    }
    if (html === block.caption) return block;
    return { ...block, caption: html };
  }
  // Phase 3 of card-procedure-template — read step title + body
  // back from their contentEditable slots.
  if (block.kind === "step") {
    const titleEl = blockEl.querySelector(
      "[data-step-title][contenteditable='true']",
    ) as HTMLElement | null;
    const bodyEl = blockEl.querySelector(
      "[data-step-body][contenteditable='true']",
    ) as HTMLElement | null;
    const nextTitle = titleEl ? titleEl.innerHTML : block.title;
    const nextBody = bodyEl ? bodyEl.innerHTML : block.body;
    if (nextTitle === block.title && nextBody === block.body) return block;
    return { ...block, title: nextTitle, body: nextBody };
  }
  return block;
}

/** Materialise a fresh `Block` from the slash menu's selection.
 *  Phase 4b: each kind starts empty so the user can immediately
 *  type into the new element. v1's catalog reaches every kind
 *  EXCEPT `image` — the image path goes through a file picker and
 *  is handled separately by `#promptImageFileAndReplace`. */
function createBlockFromMenuItem(item: BlockMenuItem): Block {
  switch (item.kind) {
    case "heading":
      return { kind: "heading", level: item.level ?? 1, inlineHtml: "" };
    case "paragraph":
      return { kind: "paragraph", inlineHtml: "" };
    case "list":
      return {
        kind: "list",
        ordered: item.listOrdered ?? false,
        listStyle: item.listOrdered ? "decimal" : "disc",
        items: [""],
      };
    case "code":
      return { kind: "code", text: "" };
    case "quote":
      return { kind: "quote", paragraphs: [""] };
    case "callout":
      return { kind: "callout", tone: item.tone ?? "info", paragraphs: [""] };
    case "divider":
      return { kind: "divider" };
    case "image":
      // Defensive default — the slash-menu handler intercepts
      // image selections before reaching this branch and routes
      // through the file picker instead. If we somehow get here
      // (e.g. test path bypassing the handler), fall back to an
      // empty paragraph so the document remains valid.
      return { kind: "paragraph", inlineHtml: "" };
    case "step":
      // Phase 3 of card-procedure-template — same defensive
      // fallback as `image`. Real step insertion routes through
      // the file picker so the resulting block has a usable SVG.
      return { kind: "paragraph", inlineHtml: "" };
  }
}

// ---------------------------------------------------------------------------
// Phase 8 — Doc-mode keyboard shortcut catalog moved to
// `./doc-shortcut-groups.ts` so the host's barrel
// (`host-ui/src/index.ts`) can re-export `DOC_SHORTCUT_GROUPS`
// without dragging this entire shell into the eager bundle. The
// PWA dynamically imports the shell behind a code-split point;
// the static `DOC_SHORTCUT_GROUPS` re-export used to defeat that
// split (`[INEFFECTIVE_DYNAMIC_IMPORT]` Rollup warning). Imported
// at the top of this file for internal use; the public surface
// is unchanged from the consumer's POV.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 4 — Empty-state predicate
// ---------------------------------------------------------------------------

/** A document is "empty" for onboarding purposes when it has
 *  no blocks at all, OR exactly one paragraph block with no
 *  inline HTML. The serializer's empty default + the slash
 *  menu's "starts blank" semantics both produce documents in
 *  the second shape. */
function isEmptyDocument(blocks: readonly Block[]): boolean {
  if (blocks.length === 0) return true;
  if (blocks.length !== 1) return false;
  const only = blocks[0];
  if (!only) return false;
  if (only.kind !== "paragraph") return false;
  return only.inlineHtml.trim() === "";
}

// ---------------------------------------------------------------------------
// Phase 3 — Block-kind conversion (selection toolbar)
// ---------------------------------------------------------------------------

/** Map a `Block` to the matching id in
 *  `SELECTION_BLOCK_KIND_OPTIONS` so the toolbar's dropdown can
 *  highlight the active entry. Non-text-bearing blocks return
 *  undefined (the toolbar shouldn't have been showing for them
 *  anyway — only paragraph + heading are contentEditable in
 *  v1). */
function blockKindIdFromBlock(block: Block): string | undefined {
  switch (block.kind) {
    case "paragraph":
      return "paragraph";
    case "heading":
      return `h${block.level}`;
    case "list":
      return block.ordered ? "ol" : "ul";
    case "quote":
      return "quote";
    case "callout":
      return `callout-${block.tone}`;
    default:
      return undefined;
  }
}

/** Convert `current` to the kind described by `option`. Preserves
 *  inline HTML where the target kind also carries text;
 *  otherwise extracts the inline HTML and wraps it as the only
 *  entry of the target's items / paragraphs array. Returns
 *  `null` when the source kind doesn't carry any extractable
 *  text (`divider`, `image`) — the caller is responsible for
 *  not converting those. */
function convertBlockKind(current: Block, option: BlockKindOption): Block | null {
  const inline = extractInlineHtmlFromBlock(current);
  if (inline === null) return null;
  switch (option.kind) {
    case "paragraph":
      return { kind: "paragraph", inlineHtml: inline };
    case "heading":
      return { kind: "heading", level: option.level ?? 1, inlineHtml: inline };
    case "list":
      return {
        kind: "list",
        ordered: option.listOrdered ?? false,
        listStyle: option.listOrdered ? "decimal" : "disc",
        items: [inline],
      };
    case "quote":
      return { kind: "quote", paragraphs: [inline] };
    case "callout":
      return { kind: "callout", tone: option.tone ?? "info", paragraphs: [inline] };
  }
}

/** Pull the canonical inline HTML out of a text-bearing block.
 *  Multi-paragraph blocks (quote / callout / list) collapse to
 *  the first entry — Phase 5 will extend contentEditable to
 *  those, at which point conversions will need a smarter
 *  reverse mapping. Returns `null` for non-text blocks. */
function extractInlineHtmlFromBlock(block: Block): string | null {
  switch (block.kind) {
    case "paragraph":
    case "heading":
      return block.inlineHtml;
    case "list":
      return block.items[0] ?? "";
    case "quote":
    case "callout":
      return block.paragraphs[0] ?? "";
    case "code":
      return block.text;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Capture-insertion helpers
// ---------------------------------------------------------------------------

interface AnnotImageMeta {
  readonly originalDataUrl: string;
  readonly annotationsSvg: string;
  readonly width: number;
  readonly height: number;
}

/** Try reading the file as an Annot-editable image (`.annot.png`
 *  / `.annot.jpg`). Returns null when the file is a plain PNG /
 *  JPEG without the XMP `<annotations>` tag — the caller falls
 *  back to the flat-bitmap path in that case.
 *
 *  Reported in production: dragging a `.annot.png` into a doc
 *  would paste the rendered-flat pixels and lose the editable
 *  annotation tree. The XMP carrier the file ships with already
 *  has everything we need to reconstruct the original
 *  `<image>` + annotation `<g>` — just read it and inject. */
async function tryReadAnnotImageBytes(file: File): Promise<AnnotImageMeta | null> {
  // Cheap MIME early-out so we don't read multi-megabyte non-
  // image files in vain. The XMP-reader's magic-byte check
  // would reject them too but only after a full ArrayBuffer
  // copy.
  const t = file.type;
  if (t && t !== "image/png" && t !== "image/jpeg" && t !== "image/jpg") return null;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
  const meta = readEditableImage(bytes);
  if (!meta) return null;
  if (!Number.isFinite(meta.width) || meta.width <= 0) return null;
  if (!Number.isFinite(meta.height) || meta.height <= 0) return null;
  if (!meta.originalImageDataUrl) return null;
  return {
    originalDataUrl: meta.originalImageDataUrl,
    annotationsSvg: meta.annotationsSvg,
    width: meta.width,
    height: meta.height,
  };
}

/** Build an `ImageBlock` whose `<svg>` carries the original
 *  bitmap as `<image href>` + the existing annotations group
 *  inline. The doc-image-editor modal's `synthesiseRecord`
 *  reads the `<image>` for the bitmap and hands the rest to
 *  `restoreAnnotations` — which already accepts both `<g
 *  id="annotations">…</g>` and bare `<g>…</g>` shapes that
 *  XMP-emitted fragments use. */
function createImageBlockFromAnnotMeta(meta: AnnotImageMeta): ImageBlock {
  const w = Math.round(meta.width);
  const h = Math.round(meta.height);
  const id = `img-${newIdB58()}`;
  // The XMP `annotationsSvg` is canonical inner content — a
  // `<g>` (with or without `id="annotations"`) that wraps the
  // editable shapes. Inject as-is so the editor's restore path
  // sees the same tree it would after a normal `.annot.svg`
  // load. If the field is empty (defensive: an `.annot.png`
  // with no shapes), fall back to an empty annotations group
  // so the editor still has something to mount into.
  const annotationsFragment = meta.annotationsSvg.trim() || `<g id="annotations"></g>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<image href="${escapeAttrValue(meta.originalDataUrl)}" width="${w}" height="${h}"/>` +
    `${annotationsFragment}` +
    "</svg>";
  return { kind: "image", id, svg };
}

/** Mirrors the `escapeAttrValue` in `@ingcreators/annot-doc/src/
 *  create-image-block.ts` — kept inline here so this Tier-C
 *  helper doesn't have to pull a private export across the
 *  Tier-A / Tier-C boundary. */
function escapeAttrValue(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Read a `File` as a data URL via FileReader. Wrapped in a
 *  Promise so the shell's async insertion handler can `await`. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("FileReader returned non-string result"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

/** Decode a data URL into image dimensions via the browser's
 *  `Image()` constructor. happy-dom in the test environment
 *  resolves the load immediately for data URLs (no network), so
 *  this works unchanged in tests. */
function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("getImageDimensions: failed to decode image"));
    img.src = dataUrl;
  });
}

/** Open a hidden `<input type="file" accept="image/*">` and
 *  resolve with the user's selection (or `null` on cancel). The
 *  cancel path uses the modern `cancel` event where supported,
 *  falling back to a focus-back signal that approximates it. */
function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    let resolved = false;
    const finish = (result: File | null) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };
    input.addEventListener("change", () => {
      finish(input.files?.[0] ?? null);
    });
    input.addEventListener("cancel", () => {
      finish(null);
    });
    input.click();
  });
}
