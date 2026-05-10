/**
 * `<annot-doc-shell>` — renderer for an `AnnotDocument` with an
 * optional editing mode.
 *
 * Phases of `docs/plans/annot-html-document.md`:
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

import type {
  AnnotDocument,
  Block,
  HeadingBlock,
  ImageBlock,
  ListBlock,
} from "@ingcreators/annot-doc";
import { buildStyleBlock, createImageBlockFromDataUrl } from "@ingcreators/annot-doc";
import {
  AnnotDocBlockMenuElement,
  type BlockMenuItem,
  type BlockMenuSelectDetail,
} from "./annot-doc-block-menu.js";
import "./annot-doc-block-menu.js";
import "./annot-doc-block-toolbar.js";
import type { BlockToolbarActionDetail } from "./annot-doc-block-toolbar.js";
import { DocumentHistory } from "./annot-doc-history.js";
import { AnnotDocImageEditorModalElement } from "./annot-doc-image-editor-modal.js";
import "./annot-doc-image-editor-modal.js";
import {
  html,
  LitElement,
  nothing,
  type PropertyValues,
  type TemplateResult,
  unsafeHTML,
} from "./lit.js";

/** CSS for the shell chrome. Concatenated with
 *  `buildStyleBlock(doc)` at render time. */
const SHELL_CSS = `
.annot-doc-shell {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 1.5rem;
  align-items: start;
  width: 100%;
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
  opacity: 0;
  transition: opacity 0.12s ease-in;
  pointer-events: none;
}
.annot-doc-shell.editing figure[data-annot-block="image"]:hover::after {
  opacity: 1;
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
  opacity: 0;
  transition: opacity 0.12s ease-in;
  z-index: 1;
}
.annot-doc-shell.editing .annot-doc-block-host:hover annot-doc-block-toolbar,
.annot-doc-shell.editing .annot-doc-block-host:focus-within annot-doc-block-toolbar {
  opacity: 1;
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

@media (max-width: 768px) {
  .annot-doc-shell {
    grid-template-columns: 1fr;
  }
  .annot-doc-toc {
    position: static;
    max-height: none;
    border-right: none;
    border-bottom: 1px solid var(--annot-doc-muted);
    padding: 0.75rem 0;
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
   *  PWA orchestration. */
  reason: "block-action" | "undo" | "redo" | "commit" | "external";
}

export class AnnotDocShellElement extends LitElement {
  static override properties = {
    document: { attribute: false },
    showToc: { type: Boolean, attribute: "show-toc" },
    editing: { type: Boolean, attribute: "editing" },
  };

  declare document: AnnotDocument | null;
  declare showToc: boolean;
  declare editing: boolean;

  #history: DocumentHistory | null = null;
  /** Set briefly while we're applying a mutation internally
   *  (block action / undo / redo). Suppresses the
   *  `willUpdate`-side history reset that would otherwise fire
   *  on every property change. */
  #suppressHistoryReset = false;
  #commitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.document = null;
    this.showToc = true;
    this.editing = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("keydown", this.#onKeydown);
    this.addEventListener("paste", this.#onPaste as EventListener);
    this.addEventListener("dragover", this.#onDragOver as EventListener);
    this.addEventListener("drop", this.#onDrop as EventListener);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("keydown", this.#onKeydown);
    this.removeEventListener("paste", this.#onPaste as EventListener);
    this.removeEventListener("dragover", this.#onDragOver as EventListener);
    this.removeEventListener("drop", this.#onDrop as EventListener);
    if (this.#commitTimer !== null) {
      clearTimeout(this.#commitTimer);
      this.#commitTimer = null;
    }
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("document")) {
      if (this.#suppressHistoryReset) {
        this.#suppressHistoryReset = false;
      } else {
        this.#history = this.document ? new DocumentHistory(this.document) : null;
      }
    }
  }

  protected override updated(_changed: PropertyValues): void {
    // Imperatively populate contentEditable bodies for heading +
    // paragraph blocks. See `renderHeading`'s comment for why we
    // can't use Lit template parts here.
    if (!this.editing || !this.document) return;
    const article = this.querySelector("article[data-annot-doc]");
    if (!article) return;
    const wrappers = Array.from(article.children) as HTMLElement[];
    this.document.blocks.forEach((block, idx) => {
      if (block.kind !== "heading" && block.kind !== "paragraph") return;
      const wrapper = wrappers[idx];
      if (!wrapper) return;
      const blockEl = wrapper.querySelector("[data-annot-block]") as HTMLElement | null;
      if (!blockEl) return;
      // Only update DOM when the document's text disagrees with
      // what's already there — preserves the cursor when typing.
      if (blockEl.innerHTML !== block.inlineHtml) {
        blockEl.innerHTML = block.inlineHtml;
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

    const shellClasses = ["annot-doc-shell", tocVisible ? "" : "no-toc", editing ? "editing" : ""]
      .filter(Boolean)
      .join(" ");

    return html`
      <style>
${unsafeHTML(`${docCss}\n${SHELL_CSS}`)}
      </style>
      <div class=${shellClasses}>
        ${tocVisible ? this.#renderToc(headings, headingIds) : nothing}
        <article
          data-annot-doc
          @input=${this.#onArticleInput}
          @blur=${this.#onArticleBlur}
        >
          ${blocks.map((b, i) =>
            editing
              ? this.#renderEditingBlock(b, i, headingIds, blocks.length)
              : this.#renderBlock(b, headingIds),
          )}
        </article>
      </div>
    `;
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
    const newBlock = createBlockFromMenuItem(item);
    const blocks = [...this.document.blocks];
    blocks[index] = newBlock;
    const newDoc: AnnotDocument = { ...this.document, blocks };
    this.#history?.push(newDoc);
    this.#applyInternal(newDoc, "block-action");
  }

  // -------------------------------------------------------------------------
  // Capture insertion — paste / drop / file picker
  // -------------------------------------------------------------------------

  #onPaste = (e: ClipboardEvent): void => {
    if (!this.editing) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void this.#insertImageFromFile(file);
          return;
        }
      }
    }
    // No image item — let the browser handle text paste in the
    // contentEditable element naturally.
  };

  #onDragOver = (e: DragEvent): void => {
    if (!this.editing) return;
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  #onDrop = (e: DragEvent): void => {
    if (!this.editing) return;
    // Mirror the paste handler — items + getAsFile is the more
    // universally-implemented surface (browsers + happy-dom + the
    // various drag emulators), where the `.files` getter is
    // sometimes left empty in non-browser DOMs.
    const items = Array.from(e.dataTransfer?.items ?? []);
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void this.#insertImageFromFile(file);
          return;
        }
      }
    }
    // Browser fallback when dataTransfer.items isn't populated
    // (rare; some legacy drag sources omit it). `.files` is the
    // canonical drop surface there.
    const files = Array.from(e.dataTransfer?.files ?? []);
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        e.preventDefault();
        void this.#insertImageFromFile(file);
        return;
      }
    }
  };

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
   *  append at end of block list. */
  async #insertImageFromFile(
    file: File,
    opts: { replaceIndex?: number; insertAtIndex?: number } = {},
  ): Promise<void> {
    if (!this.document) return;
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
    const block = createImageBlockFromDataUrl(dataUrl, dimensions.width, dimensions.height);
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
    const wrappers = Array.from(article.children) as HTMLElement[];
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
    if (!cmd) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if ((key === "z" && e.shiftKey) || key === "y") {
      e.preventDefault();
      this.redo();
    }
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

  #onBlockHostClick(e: MouseEvent, index: number): void {
    if (!this.document) return;
    const block = this.document.blocks[index];
    if (block?.kind !== "image") return;
    // Toolbar lives inside the same host wrapper; clicks on the
    // toolbar buttons must not bubble up into "edit image".
    if ((e.target as HTMLElement | null)?.closest("annot-doc-block-toolbar")) return;
    void this.#openImageEditor(block, index);
  }

  async #openImageEditor(block: ImageBlock, index: number): Promise<void> {
    const result = await AnnotDocImageEditorModalElement.openFor({
      id: block.id,
      svg: block.svg,
    });
    if (result.kind !== "save") return;
    if (!this.document) return;
    const blocks = [...this.document.blocks];
    const target = blocks[index];
    if (target?.kind !== "image") return;
    blocks[index] = { ...target, svg: result.svg };
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
      return renderList(block);
    case "code":
      return renderCode(block);
    case "quote":
      return html`
        <blockquote data-annot-block="quote">
          ${block.paragraphs.map((p) => html`<p>${unsafeHTML(p)}</p>`)}
        </blockquote>
      `;
    case "callout":
      return html`
        <aside data-annot-block="callout" data-tone=${block.tone}>
          ${block.paragraphs.map((p) => html`<p>${unsafeHTML(p)}</p>`)}
        </aside>
      `;
    case "divider":
      return html`<hr data-annot-block="divider" />`;
    case "image":
      return renderImage(block);
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

function renderList(block: ListBlock): TemplateResult {
  const items = block.items.map((it) => html`<li>${unsafeHTML(it)}</li>`);
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

function renderCode(block: { lang?: string; text: string }): TemplateResult {
  if (block.lang !== undefined) {
    return html`<pre data-annot-block="code" data-lang=${block.lang}><code>${block.text}</code></pre>`;
  }
  return html`<pre data-annot-block="code"><code>${block.text}</code></pre>`;
}

function renderImage(block: ImageBlock): TemplateResult {
  return html`
    <figure data-annot-block="image" data-annot-image-id=${block.id}>
      ${unsafeHTML(block.svg)}
      ${
        block.caption !== undefined
          ? html`<figcaption>${unsafeHTML(block.caption)}</figcaption>`
          : nothing
      }
    </figure>
  `;
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
  }
}

// ---------------------------------------------------------------------------
// Capture-insertion helpers
// ---------------------------------------------------------------------------

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
