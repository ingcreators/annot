/**
 * `<annot-template-picker>` — modal picker that shows a
 * recently-used row at the top, then a "Built-in" section,
 * then a "User templates" section. One click on any card emits
 * a `template-selected` event carrying the chosen entry's id +
 * source kind so the parent can clone-and-open.
 *
 * Phase 8c of `docs/plans/_done/annot-html-document.md`. Pairs with
 * Phase 8b's "Save as template…" dialog (the WRITE side) and
 * Phase 8a's `cloneTemplate` (the post-selection clone).
 *
 * Presentational component only — fetching the `Templates/`
 * folder, parsing each candidate, and running `cloneTemplate`
 * on the selection are all the parent's concern. The parent
 * (Phase 8d's file-manager wiring) hands us a pre-filtered
 * list and reacts to `template-selected`.
 *
 * Recently-used tracking lives inside the picker via
 * `localStorage[<recentKey>]` so callers don't need to wire
 * persistence themselves. The default key is shared
 * (`annot-recent-templates`) so the gallery's "New" entry and
 * the editor's File menu both surface the same chips. Pass an
 * explicit `recentKey` to opt out (e.g. for tests, or when a
 * future host wants per-host history).
 *
 * Built-in section is empty in Phase 8c — Phase 9 (built-in
 * starter templates) populates it. The empty-state copy
 * acknowledges this so users see "Coming soon" rather than a
 * silent gap.
 */

import { html, LitElement, nothing, unsafeHTML } from "./lit.js";

/** CSS for the picker chrome. Inline so the host doesn't have
 *  to thread an extra stylesheet import. Variables reuse the
 *  shared `--annot-*` design tokens, falling back to neutral
 *  defaults when the design-system stylesheet hasn't loaded
 *  yet (e.g. in Storybook / standalone tests). */
const PICKER_CSS = `
.annot-template-picker {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0.5rem;
  font-family: var(--annot-doc-font-sans, system-ui, sans-serif);
  color: var(--annot-text-primary, inherit);
}
.annot-template-picker-section-title {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--annot-text-secondary, #6b7280);
}
.annot-template-picker-recent-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.annot-template-picker-chip {
  padding: 4px 12px;
  border: 1px solid var(--annot-input-border, #d1d5db);
  border-radius: 999px;
  background: var(--annot-input-bg, transparent);
  color: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: border-color 0.12s, background-color 0.12s;
}
.annot-template-picker-chip:hover {
  border-color: var(--annot-accent, #2563eb);
  background: var(--annot-accent-bg, rgba(37, 99, 235, 0.08));
}
.annot-template-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.75rem;
}
.annot-template-picker-card {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 12px 14px;
  border: 1px solid var(--annot-input-border, #d1d5db);
  border-radius: 8px;
  background: var(--annot-panel-bg, transparent);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.12s, transform 0.08s;
}
.annot-template-picker-card:hover {
  border-color: var(--annot-accent, #2563eb);
  transform: translateY(-1px);
}
.annot-template-picker-card-title {
  font-weight: 600;
  font-size: 0.9375rem;
}
.annot-template-picker-card-desc {
  font-size: 0.8125rem;
  color: var(--annot-text-secondary, #6b7280);
  line-height: 1.4;
  /* Clamp at 3 lines so long descriptions don't blow out the
     card height. */
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.annot-template-picker-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.25rem;
}
.annot-template-picker-card-tag {
  font-size: 0.6875rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--annot-accent-bg, rgba(37, 99, 235, 0.08));
  color: var(--annot-accent, #2563eb);
}
.annot-template-picker-card-builtin-pill {
  align-self: flex-start;
  font-size: 0.6875rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--annot-accent, #2563eb);
  color: #ffffff;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.annot-template-picker-card-thumb {
  width: 100%;
  height: 96px;
  object-fit: cover;
  border-radius: 4px;
  background: var(--annot-input-bg, #f3f4f6);
}
.annot-template-picker-empty,
.annot-template-picker-loading {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--annot-text-secondary, #6b7280);
  font-style: italic;
}
`;

/** A user-authored template (lives at `Templates/<file>` on the
 *  active store). The `path` is the storage-relative path the
 *  parent uses to load + parse the template's bytes. */
export interface UserTemplateEntry {
  /** Unique id — the basePath-relative path to the template
   *  file (e.g. `Templates/manual.annot.html`). Used as the
   *  recently-used identifier and as the event payload. */
  readonly path: string;
  /** Display name. Comes from the file's `meta.template.name`
   *  if a full parse has happened, otherwise the filename
   *  with the `.annot.html` extension stripped. */
  readonly title: string;
  readonly description?: string;
  readonly tags?: readonly string[];
}

/** A package-resident built-in starter template (Phase 9 will
 *  populate `BUILTIN_TEMPLATES` from `@ingcreators/annot-doc`).
 *  Phase 8c renders the empty-state copy when this list is
 *  empty. */
export interface BuiltinTemplateEntry {
  /** Stable id (e.g. `manual` / `feature-guide`). */
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /** Pre-baked thumbnail (data URL). Optional — falls back
   *  to a generic placeholder card. */
  readonly thumbnailDataUrl?: string;
}

/** Event detail for `template-selected` — discriminated by the
 *  `kind` field so handlers can dispatch correctly. */
export type TemplateSelectedDetail =
  | { readonly kind: "user"; readonly path: string }
  | { readonly kind: "builtin"; readonly id: string };

const DEFAULT_RECENT_KEY = "annot-recent-templates";
const RECENT_LIMIT = 5;

/** Read the recently-used list from localStorage. Returns an
 *  empty array on parse error / missing entry / SSR. Exported
 *  for tests + parent components that want to pre-populate
 *  recent state from elsewhere. */
export function readRecentTemplateIds(key: string = DEFAULT_RECENT_KEY): readonly string[] {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => typeof x === "string");
  } catch {
    return [];
  }
}

/** Mark an id as recently used. Pushes to the front, dedupes,
 *  caps at `RECENT_LIMIT`. No-op on SSR / quota errors. */
export function recordRecentTemplateId(
  id: string,
  key: string = DEFAULT_RECENT_KEY,
): readonly string[] {
  const current = readRecentTemplateIds(key);
  const next = [id, ...current.filter((x) => x !== id)].slice(0, RECENT_LIMIT);
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(next));
  } catch {
    /* quota / private mode — recently-used becomes ephemeral */
  }
  return next;
}

/** Drop an id from the recently-used list. Used by the parent
 *  when a template gets renamed / deleted so stale chips
 *  vanish. No-op on SSR / quota errors. */
export function forgetRecentTemplateId(
  id: string,
  key: string = DEFAULT_RECENT_KEY,
): readonly string[] {
  const current = readRecentTemplateIds(key);
  if (!current.includes(id)) return current;
  const next = current.filter((x) => x !== id);
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(next));
  } catch {
    /* swallow */
  }
  return next;
}

export class AnnotTemplatePickerElement extends LitElement {
  static override properties = {
    userTemplates: { attribute: false },
    builtinTemplates: { attribute: false },
    loadingUser: { type: Boolean, attribute: "loading-user" },
    recentKey: { type: String, attribute: "recent-key" },
  };

  declare userTemplates: readonly UserTemplateEntry[];
  declare builtinTemplates: readonly BuiltinTemplateEntry[];
  /** When true, the user-templates section shows a loading
   *  affordance. Parent flips this off once the listing +
   *  parse is done. */
  declare loadingUser: boolean;
  declare recentKey: string;

  /** In-memory mirror of the recently-used list — re-read on
   *  connect, written through `recordRecentTemplateId` on
   *  click. Stored on the element so the render path doesn't
   *  re-hit localStorage every frame. */
  #recentIds: readonly string[] = [];

  constructor() {
    super();
    this.userTemplates = [];
    this.builtinTemplates = [];
    this.loadingUser = false;
    this.recentKey = DEFAULT_RECENT_KEY;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#recentIds = readRecentTemplateIds(this.recentKey);
  }

  /** Re-read localStorage if the key changes. Most callers
   *  set it once on mount, but the property's reactive so a
   *  late-binding consumer doesn't see a stale list. */
  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has("recentKey")) {
      this.#recentIds = readRecentTemplateIds(this.recentKey);
    }
  }

  override render() {
    const recent = this.#computeRecentEntries();
    return html`
      <style>${unsafeHTML(PICKER_CSS)}</style>
      <div class="annot-template-picker">
        ${recent.length > 0 ? this.#renderRecent(recent) : nothing}
        ${this.#renderBuiltinSection()}
        ${this.#renderUserSection()}
      </div>
    `;
  }

  /** Walk the recently-used IDs and resolve each one against
   *  the user-template + built-in lists. IDs whose source
   *  template no longer exists are skipped (renamed / deleted
   *  templates "fall off" the chip row naturally). */
  #computeRecentEntries(): {
    detail: TemplateSelectedDetail;
    title: string;
  }[] {
    const out: { detail: TemplateSelectedDetail; title: string }[] = [];
    for (const id of this.#recentIds) {
      const user = this.userTemplates.find((t) => t.path === id);
      if (user) {
        out.push({ detail: { kind: "user", path: user.path }, title: user.title });
        continue;
      }
      const builtin = this.builtinTemplates.find((t) => t.id === id);
      if (builtin) {
        out.push({ detail: { kind: "builtin", id: builtin.id }, title: builtin.title });
      }
    }
    return out;
  }

  #renderRecent(entries: readonly { detail: TemplateSelectedDetail; title: string }[]) {
    return html`
      <section class="annot-template-picker-recent" aria-label="Recently used templates">
        <h3 class="annot-template-picker-section-title">Recently used</h3>
        <div class="annot-template-picker-recent-row">
          ${entries.map(
            (e) => html`
              <button
                type="button"
                class="annot-template-picker-chip"
                @click=${() => this.#select(e.detail)}
              >
                ${e.title}
              </button>
            `,
          )}
        </div>
      </section>
    `;
  }

  #renderBuiltinSection() {
    return html`
      <section class="annot-template-picker-section" aria-label="Built-in templates">
        <h3 class="annot-template-picker-section-title">Built-in</h3>
        ${
          this.builtinTemplates.length > 0
            ? html`
                <div class="annot-template-picker-grid">
                  ${this.builtinTemplates.map((t) => this.#renderBuiltinCard(t))}
                </div>
              `
            : html`
                <p class="annot-template-picker-empty">
                  Built-in starter templates are coming soon.
                </p>
              `
        }
      </section>
    `;
  }

  #renderUserSection() {
    return html`
      <section class="annot-template-picker-section" aria-label="User templates">
        <h3 class="annot-template-picker-section-title">User templates</h3>
        ${
          this.loadingUser
            ? html`<p class="annot-template-picker-loading">Loading…</p>`
            : this.userTemplates.length > 0
              ? html`
                  <div class="annot-template-picker-grid">
                    ${this.userTemplates.map((t) => this.#renderUserCard(t))}
                  </div>
                `
              : html`
                  <p class="annot-template-picker-empty">
                    No user templates yet. Save the current document as a
                    template to populate this list.
                  </p>
                `
        }
      </section>
    `;
  }

  #renderUserCard(t: UserTemplateEntry) {
    return html`
      <button
        type="button"
        class="annot-template-picker-card"
        data-template-source="user"
        data-template-id=${t.path}
        title=${t.description ?? ""}
        @click=${() => this.#select({ kind: "user", path: t.path })}
      >
        <span class="annot-template-picker-card-title">${t.title}</span>
        ${
          t.description
            ? html`<span class="annot-template-picker-card-desc">${t.description}</span>`
            : nothing
        }
        ${
          t.tags && t.tags.length > 0
            ? html`
                <span class="annot-template-picker-card-tags">
                  ${t.tags.map(
                    (tag) => html`<span class="annot-template-picker-card-tag">${tag}</span>`,
                  )}
                </span>
              `
            : nothing
        }
      </button>
    `;
  }

  #renderBuiltinCard(t: BuiltinTemplateEntry) {
    return html`
      <button
        type="button"
        class="annot-template-picker-card annot-template-picker-card-builtin"
        data-template-source="builtin"
        data-template-id=${t.id}
        title=${t.description ?? ""}
        @click=${() => this.#select({ kind: "builtin", id: t.id })}
      >
        ${
          t.thumbnailDataUrl
            ? html`<img
                class="annot-template-picker-card-thumb"
                src=${t.thumbnailDataUrl}
                alt=""
              />`
            : nothing
        }
        <span class="annot-template-picker-card-builtin-pill">Built-in</span>
        <span class="annot-template-picker-card-title">${t.title}</span>
        ${
          t.description
            ? html`<span class="annot-template-picker-card-desc">${t.description}</span>`
            : nothing
        }
      </button>
    `;
  }

  #select(detail: TemplateSelectedDetail): void {
    const id = detail.kind === "user" ? detail.path : detail.id;
    this.#recentIds = recordRecentTemplateId(id, this.recentKey);
    // Trigger a re-render so the chip row reflects the new
    // most-recent state without waiting for the parent to
    // re-render the picker.
    this.requestUpdate();
    this.dispatchEvent(
      new CustomEvent<TemplateSelectedDetail>("template-selected", {
        detail,
        bubbles: true,
      }),
    );
  }
}

if (!customElements.get("annot-template-picker")) {
  customElements.define("annot-template-picker", AnnotTemplatePickerElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-template-picker": AnnotTemplatePickerElement;
  }
}
