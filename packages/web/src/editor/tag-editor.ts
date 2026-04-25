/**
 * Compact tag editor — displays key:value chips with add/remove.
 * Used by the file-details drawer.
 */

import { setTooltip } from "@ingcreators/annot-editor/tooltip";

export class TagEditor {
  #container: HTMLElement;
  #tags: Record<string, string> = {};
  #chipsEl: HTMLElement;
  #addBtn: HTMLButtonElement;

  onTagsChange?: (tags: Record<string, string>) => void;

  constructor(container: HTMLElement) {
    this.#container = container;

    const wrap = document.createElement("div");
    wrap.className = "tag-editor";

    this.#chipsEl = document.createElement("div");
    this.#chipsEl.className = "tag-chips";
    wrap.appendChild(this.#chipsEl);

    this.#addBtn = document.createElement("button");
    this.#addBtn.className = "tag-add-btn";
    this.#addBtn.textContent = "+ Tag";
    setTooltip(this.#addBtn, "Add tag");
    this.#addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.#showAddInput();
    });
    wrap.appendChild(this.#addBtn);

    this.#container.appendChild(wrap);
  }

  get tags(): Record<string, string> {
    return { ...this.#tags };
  }

  setTags(tags: Record<string, string>): void {
    this.#tags = { ...tags };
    this.#renderChips();
  }

  #renderChips(): void {
    this.#chipsEl.innerHTML = "";
    for (const [key, value] of Object.entries(this.#tags)) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";

      const label = document.createElement("span");
      label.className = "tag-chip-label";
      label.textContent = `${key}: ${value}`;
      chip.appendChild(label);

      const del = document.createElement("button");
      del.className = "tag-chip-delete";
      del.textContent = "\u00d7";
      setTooltip(del, `Remove ${key}`);
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        delete this.#tags[key];
        this.#renderChips();
        this.onTagsChange?.(this.tags);
      });
      chip.appendChild(del);

      this.#chipsEl.appendChild(chip);
    }
  }

  #showAddInput(): void {
    // Remove existing input row
    this.#container.querySelector(".tag-input-row")?.remove();

    const row = document.createElement("div");
    row.className = "tag-input-row";

    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.placeholder = "key";
    keyInput.className = "tag-input tag-input-key";

    const valInput = document.createElement("input");
    valInput.type = "text";
    valInput.placeholder = "value";
    valInput.className = "tag-input tag-input-value";

    const okBtn = document.createElement("button");
    okBtn.className = "tag-ok-btn";
    okBtn.textContent = "\u2713";
    setTooltip(okBtn, "Add");

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "tag-cancel-btn";
    cancelBtn.textContent = "\u00d7";
    setTooltip(cancelBtn, "Cancel");

    const addTag = () => {
      const k = keyInput.value.trim();
      const v = valInput.value.trim();
      if (k) {
        this.#tags[k] = v;
        this.#renderChips();
        this.onTagsChange?.(this.tags);
      }
      row.remove();
    };

    okBtn.addEventListener("click", addTag);
    cancelBtn.addEventListener("click", () => row.remove());

    // Enter to add, Escape to cancel
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addTag();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        row.remove();
      }
    };
    keyInput.addEventListener("keydown", onKey);
    valInput.addEventListener("keydown", onKey);

    row.appendChild(keyInput);
    row.appendChild(valInput);
    row.appendChild(okBtn);
    row.appendChild(cancelBtn);

    this.#container.appendChild(row);
    keyInput.focus();
  }
}
