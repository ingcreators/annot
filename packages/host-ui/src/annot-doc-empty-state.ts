/**
 * `<annot-doc-empty-state>` — onboarding panel rendered by
 * `<annot-doc-shell>` when the document is brand-new (zero
 * blocks or one empty paragraph).
 *
 * Phase 4 of `docs/plans/annot-html-document-ux-polish.md`.
 *
 * The v1 empty-document experience was a single italic line
 * ("Type / for commands, or paste / drop an image…") leaning
 * on a typed-`/` gesture the user had to discover. Phase 4
 * replaces it with four large clickable cards:
 *
 *   - **Start with a heading** — inserts an H1 + empty
 *     paragraph and focuses the heading.
 *   - **Insert an image** — opens the OS file picker.
 *   - **Use a template** — bubbles up to the host so it can
 *     open the existing template-picker modal (host owns
 *     storage + listDocuments).
 *   - **Paste a screenshot** — focuses the article and shows
 *     a Ctrl+V hint.
 *
 * Each card click dispatches an `empty-state-action` event
 * with `{action}` payload the shell catches (or, for
 * `useTemplate`, lets bubble to the host). Light DOM (Hybrid
 * CSS) following the host-ui convention.
 */

import { html, LitElement, type TemplateResult } from "./lit.js";

export type EmptyStateAction = "startWithHeading" | "insertImage" | "useTemplate" | "pasteHint";

export interface EmptyStateActionDetail {
  action: EmptyStateAction;
}

const EMPTY_STATE_CSS = `
.annot-doc-empty-state {
  display: grid;
  grid-template-columns: repeat(2, minmax(180px, 1fr));
  gap: 12px;
  padding: 1.5rem;
  max-width: 640px;
  margin: 2rem auto;
}
.annot-doc-empty-state-heading {
  grid-column: 1 / -1;
  text-align: center;
  margin: 0 0 8px;
  color: var(--annot-doc-fg, #1f2937);
  font-size: 1.25rem;
  font-weight: 600;
}
.annot-doc-empty-state-subheading {
  grid-column: 1 / -1;
  text-align: center;
  margin: 0 0 16px;
  color: var(--annot-doc-muted, #6b7280);
  font-size: 0.875rem;
}
.annot-doc-empty-state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 16px;
  background: var(--annot-doc-bg, #ffffff);
  border: 1px solid var(--annot-doc-muted, #d1d5db);
  border-radius: 8px;
  color: inherit;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: border-color 0.12s ease-in, background 0.12s ease-in;
}
.annot-doc-empty-state-card:hover,
.annot-doc-empty-state-card:focus-visible {
  border-color: var(--annot-doc-accent, #2563eb);
  background: var(--annot-doc-code-bg, #f3f4f6);
  outline: none;
}
.annot-doc-empty-state-card-icon {
  font-size: 1.5rem;
  line-height: 1;
}
.annot-doc-empty-state-card-title {
  font-weight: 600;
  font-size: 0.95rem;
}
.annot-doc-empty-state-card-desc {
  font-size: 0.8rem;
  color: var(--annot-doc-muted, #6b7280);
}
@media (max-width: 520px) {
  .annot-doc-empty-state {
    grid-template-columns: 1fr;
  }
}
`;

interface CardSpec {
  action: EmptyStateAction;
  icon: string;
  title: string;
  desc: string;
}

const CARDS: readonly CardSpec[] = [
  {
    action: "startWithHeading",
    icon: "𝐇",
    title: "Start with a heading",
    desc: "Insert an H1 and a paragraph. Begin typing your title.",
  },
  {
    action: "insertImage",
    icon: "🖼",
    title: "Insert an image",
    desc: "Pick a screenshot from your computer.",
  },
  {
    action: "useTemplate",
    icon: "📄",
    title: "Use a template",
    desc: "Start from a built-in or saved layout.",
  },
  {
    action: "pasteHint",
    icon: "📋",
    title: "Paste a screenshot",
    desc: "Press Ctrl+V to insert from your clipboard.",
  },
];

export class AnnotDocEmptyStateElement extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render(): TemplateResult {
    return html`
      <style>${EMPTY_STATE_CSS}</style>
      <div class="annot-doc-empty-state" role="region" aria-label="Get started">
        <h2 class="annot-doc-empty-state-heading">Start your document</h2>
        <p class="annot-doc-empty-state-subheading">
          Pick a starting point — or paste / drop an image to begin.
        </p>
        ${CARDS.map((card) => this.#renderCard(card))}
      </div>
    `;
  }

  #renderCard(card: CardSpec): TemplateResult {
    return html`
      <button
        type="button"
        class="annot-doc-empty-state-card"
        data-empty-action=${card.action}
        @click=${() => this.#dispatch(card.action)}
      >
        <span class="annot-doc-empty-state-card-icon" aria-hidden="true">${card.icon}</span>
        <span class="annot-doc-empty-state-card-title">${card.title}</span>
        <span class="annot-doc-empty-state-card-desc">${card.desc}</span>
      </button>
    `;
  }

  #dispatch(action: EmptyStateAction): void {
    this.dispatchEvent(
      new CustomEvent<EmptyStateActionDetail>("empty-state-action", {
        bubbles: true,
        composed: true,
        detail: { action },
      }),
    );
  }
}

if (!customElements.get("annot-doc-empty-state")) {
  customElements.define("annot-doc-empty-state", AnnotDocEmptyStateElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-doc-empty-state": AnnotDocEmptyStateElement;
  }
}
