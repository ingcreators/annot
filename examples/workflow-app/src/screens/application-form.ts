import { LitElement, html } from "lit";

import { onLocaleChange, t } from "../i18n.js";
import { navigate } from "../router.js";
import {
  getState,
  onStateChange,
  startDraft,
  updateDraft,
  type ApplicationCategory,
} from "../state.js";

const CATEGORIES: ReadonlyArray<ApplicationCategory> = [
  "leave",
  "expense",
  "purchase",
];

export class WfApplicationForm extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  static override properties = {
    errors: { state: true },
  };

  declare errors: Record<string, string>;

  #unsubLocale?: () => void;
  #unsubState?: () => void;

  constructor() {
    super();
    this.errors = {};
  }

  override connectedCallback(): void {
    super.connectedCallback();
    startDraft();
    this.#unsubLocale = onLocaleChange(() => this.requestUpdate());
    this.#unsubState = onStateChange(() => this.requestUpdate());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#unsubLocale?.();
    this.#unsubState?.();
  }

  override render(): unknown {
    const user = getState().currentUser;
    if (!user || user.role !== "applicant") {
      queueMicrotask(() => navigate("/menu"));
      return html``;
    }
    const draft = getState().draft ?? { category: "", amount: 0, reason: "" };
    const showAmount = draft.category !== "" && draft.category !== "leave";
    return html`
      <section class="wf-page wf-page--narrow">
        <div class="wf-card wf-stack" data-testid="screen-application-form">
          <h1 class="wf-heading">${t("form.heading")}</h1>
          <form class="wf-stack" @submit=${(e: Event) => this.#next(e)}>
            <div class="wf-field">
              <label class="wf-label" for="form-category">
                ${t("form.category.label")}
                <span class="wf-required">(${t("common.required")})</span>
              </label>
              <select
                id="form-category"
                class="wf-input"
                data-testid="form-category"
                .value=${draft.category}
                @change=${(e: Event) => this.#setCategory(e)}
                required
              >
                <option value="" disabled ?selected=${draft.category === ""}>
                  ${t("form.category.placeholder")}
                </option>
                ${CATEGORIES.map(
                  (c) => html`
                    <option value=${c} ?selected=${draft.category === c}>
                      ${t(`form.category.${c}`)}
                    </option>
                  `,
                )}
              </select>
              ${this.errors["category"]
                ? html`<p class="wf-error" data-testid="form-error-category">
                    ${this.errors["category"]}
                  </p>`
                : null}
            </div>
            ${showAmount
              ? html`
                  <div class="wf-field" data-testid="form-amount-row">
                    <label class="wf-label" for="form-amount">
                      ${t("form.amount.label")}
                      <span class="wf-required">(${t("common.required")})</span>
                    </label>
                    <input
                      id="form-amount"
                      class="wf-input"
                      type="number"
                      min="0"
                      step="1"
                      data-testid="form-amount"
                      .value=${String(draft.amount ?? 0)}
                      @input=${(e: Event) => this.#setAmount(e)}
                    />
                    <p class="wf-muted">${t("form.amount.help")}</p>
                    ${this.errors["amount"]
                      ? html`<p class="wf-error" data-testid="form-error-amount">
                          ${this.errors["amount"]}
                        </p>`
                      : null}
                  </div>
                `
              : null}
            <div class="wf-field">
              <label class="wf-label" for="form-reason">
                ${t("form.reason.label")}
                <span class="wf-required">(${t("common.required")})</span>
              </label>
              <textarea
                id="form-reason"
                class="wf-input"
                rows="5"
                data-testid="form-reason"
                placeholder=${t("form.reason.placeholder")}
                .value=${draft.reason}
                @input=${(e: Event) => this.#setReason(e)}
              ></textarea>
              ${this.errors["reason"]
                ? html`<p class="wf-error" data-testid="form-error-reason">
                    ${this.errors["reason"]}
                  </p>`
                : null}
            </div>
            <div class="wf-row" style="justify-content: space-between">
              <a
                href="#/menu"
                @click=${(e: Event) => this.#back(e)}
                data-testid="form-back"
              >
                ${t("common.back")}
              </a>
              <button
                type="submit"
                class="wf-button"
                data-variant="primary"
                data-testid="form-next"
              >
                ${t("form.next")}
              </button>
            </div>
          </form>
        </div>
      </section>
    `;
  }

  #setCategory(e: Event): void {
    const value = (e.target as HTMLSelectElement).value as
      | ApplicationCategory
      | "";
    updateDraft({ category: value });
    this.errors = { ...this.errors, category: "" };
  }

  #setAmount(e: Event): void {
    const value = Number.parseInt((e.target as HTMLInputElement).value, 10);
    updateDraft({ amount: Number.isFinite(value) ? Math.max(0, value) : 0 });
    this.errors = { ...this.errors, amount: "" };
  }

  #setReason(e: Event): void {
    updateDraft({ reason: (e.target as HTMLTextAreaElement).value });
    this.errors = { ...this.errors, reason: "" };
  }

  #back(e: Event): void {
    e.preventDefault();
    navigate("/menu");
  }

  #next(e: Event): void {
    e.preventDefault();
    const draft = getState().draft;
    const errors: Record<string, string> = {};
    if (!draft || draft.category === "") {
      errors["category"] = t("form.error.categoryRequired");
    }
    if (
      draft &&
      draft.category !== "" &&
      draft.category !== "leave" &&
      !(Number.isFinite(draft.amount) && draft.amount >= 0)
    ) {
      errors["amount"] = t("form.error.amountInvalid");
    }
    if (!draft || draft.reason.trim() === "") {
      errors["reason"] = t("form.error.reasonRequired");
    }
    if (Object.keys(errors).length > 0) {
      this.errors = errors;
      return;
    }
    navigate("/apply/confirm");
  }
}

customElements.define("wf-application-form", WfApplicationForm);

declare global {
  interface HTMLElementTagNameMap {
    "wf-application-form": WfApplicationForm;
  }
}
