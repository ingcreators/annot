import {
  type Project,
  createProject,
  deleteProject,
  isTauri,
  listProjects,
} from "@ingcreators/annot-core/utils/tauri-bridge";

export class ProjectManager {
  #dialog: HTMLDialogElement | null = null;
  #projects: Project[] = [];
  onChange?: () => void;

  async show(): Promise<void> {
    if (!isTauri) return;
    this.#projects = await listProjects();
    this.#createDialog();
    this.#dialog!.showModal();
  }

  #createDialog(): void {
    // Remove existing
    this.#dialog?.remove();

    const dialog = document.createElement("dialog");
    dialog.className = "pm-dialog";
    dialog.innerHTML = `
      <div class="pm-header">
        <h2>Projects</h2>
        <button class="pm-close">\u00d7</button>
      </div>
      <div class="pm-body">
        <div class="pm-list"></div>
        <div class="pm-new">
          <input type="text" class="pm-input" placeholder="New project name..." />
          <button class="pm-add-btn">Add</button>
        </div>
      </div>
    `;

    const list = dialog.querySelector(".pm-list")!;
    for (const p of this.#projects) {
      const row = document.createElement("div");
      row.className = "pm-row";
      row.innerHTML = `
        <span class="pm-name">${this.#esc(p.name)}</span>
        <span class="pm-count">${p.image_count} images</span>
        ${p.id === 1 ? "" : '<button class="pm-del">\u00d7</button>'}
      `;
      const delBtn = row.querySelector(".pm-del");
      if (delBtn) {
        delBtn.addEventListener("click", () => this.#delete(p.id));
      }
      list.appendChild(row);
    }

    dialog.querySelector(".pm-close")!.addEventListener("click", () => dialog.close());

    const input = dialog.querySelector(".pm-input") as HTMLInputElement;
    const addBtn = dialog.querySelector(".pm-add-btn")!;
    addBtn.addEventListener("click", () => {
      const name = input.value.trim();
      if (name) this.#add(name);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const name = input.value.trim();
        if (name) this.#add(name);
      }
    });

    document.body.appendChild(dialog);
    this.#dialog = dialog;
  }

  async #add(name: string): Promise<void> {
    try {
      await createProject(name);
      this.#dialog?.close();
      this.onChange?.();
    } catch (err) {
      console.error("Failed to create project:", err);
    }
  }

  async #delete(id: number): Promise<void> {
    try {
      await deleteProject(id);
      this.#dialog?.close();
      this.onChange?.();
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
  }

  #esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
