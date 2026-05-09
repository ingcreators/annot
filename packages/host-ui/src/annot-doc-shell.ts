/**
 * `<annot-doc-shell>` — read-only renderer for an `AnnotDocument`.
 *
 * Phase 3 of `docs/plans/annot-html-document.md`. Mounts an
 * `AnnotDocument` (parsed from `.annot.html` via
 * `@ingcreators/annot-doc`) as DOM, with a left-side TOC drawer
 * that scrolls headings into view on click. No editing, no
 * dirty-tracking — the editor surface lands in Phase 4.
 *
 * Light DOM (Hybrid CSS) following the host-ui convention. The
 * shell renders both:
 *
 *   - The CSS that `injectDocumentStyles` would inline into a saved
 *     file (so the in-editor render matches the standalone-viewer
 *     render); and
 *   - A small per-shell stylesheet for the shell chrome (TOC
 *     panel, grid layout, empty-state copy).
 *
 * Render order is `<style>` then `<div class="annot-doc-shell">`,
 * which lets a host swap the document at runtime and the
 * matching styles re-emit in the same render pass.
 */

import type {
  AnnotDocument,
  Block,
  HeadingBlock,
  ImageBlock,
  ListBlock,
} from "@ingcreators/annot-doc";
import { buildStyleBlock } from "@ingcreators/annot-doc";
import { html, LitElement, nothing, type TemplateResult, unsafeHTML } from "./lit.js";

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

export interface DocHeadingActivatedDetail {
  /** Heading-block index in the document's list of heading
   *  blocks (NOT in the full block list). */
  index: number;
  /** Heading text (plain — inline tags stripped). */
  text: string;
}

export class AnnotDocShellElement extends LitElement {
  static override properties = {
    document: { attribute: false },
    showToc: { type: Boolean, attribute: "show-toc" },
  };

  declare document: AnnotDocument | null;
  declare showToc: boolean;

  constructor() {
    super();
    this.document = null;
    this.showToc = true;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render(): TemplateResult {
    if (!this.document) {
      return html`<div class="annot-doc-shell-empty">No document loaded.</div>`;
    }

    const docCss = buildStyleBlock(this.document);
    const headings = this.document.blocks.filter((b): b is HeadingBlock => b.kind === "heading");
    const headingIds = buildHeadingIdMap(headings);
    const tocVisible = this.showToc && headings.length > 0;

    return html`
      <style>
${unsafeHTML(`${docCss}\n${SHELL_CSS}`)}
      </style>
      <div class="annot-doc-shell ${tocVisible ? "" : "no-toc"}">
        ${tocVisible ? this.#renderToc(headings, headingIds) : nothing}
        <article data-annot-doc>
          ${this.document.blocks.map((b) => this.#renderBlock(b, headingIds))}
        </article>
      </div>
    `;
  }

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
  // Block render
  // -------------------------------------------------------------------------

  #renderBlock(block: Block, ids: Map<HeadingBlock, string>): TemplateResult | typeof nothing {
    switch (block.kind) {
      case "heading":
        return this.#renderHeading(block, ids.get(block) ?? "");
      case "paragraph":
        return html`<p data-annot-block="paragraph">${unsafeHTML(block.inlineHtml)}</p>`;
      case "list":
        return this.#renderList(block);
      case "code":
        return this.#renderCode(block);
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
        return this.#renderImage(block);
      case "unknown":
        return html`${unsafeHTML(block.rawHtml)}`;
    }
  }

  #renderHeading(block: HeadingBlock, id: string): TemplateResult {
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

  #renderList(block: ListBlock): TemplateResult {
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

  #renderCode(block: { lang?: string; text: string }): TemplateResult {
    if (block.lang !== undefined) {
      return html`<pre data-annot-block="code" data-lang=${block.lang}><code>${block.text}</code></pre>`;
    }
    return html`<pre data-annot-block="code"><code>${block.text}</code></pre>`;
  }

  #renderImage(block: ImageBlock): TemplateResult {
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
}

customElements.define("annot-doc-shell", AnnotDocShellElement);

declare global {
  interface HTMLElementTagNameMap {
    "annot-doc-shell": AnnotDocShellElement;
  }
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
